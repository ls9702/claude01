/**
 * Trip Board — workspace merge (M4).
 *
 * The sync model is deliberately tiny: there is no operation log and no vector
 * clock, just two whole {@link Workspace} blobs and the `updatedAt` stamp every
 * entity already carries. {@link merge} folds them into one:
 *
 * 1. **Tombstones** union by `(entity, id)`, newest `deletedAt` wins.
 * 2. **Entities** union by id; on a conflict the greater `updatedAt` wins and a
 *    tie goes to `remote` (the server is the tie-breaker so two devices that
 *    both pull the same server copy land on the same answer).
 * 3. A tombstone **kills** an entity when `deletedAt > entity.updatedAt`.
 *    Otherwise the entity survives — someone edited it after the delete — and
 *    the tombstone is *kept* so the next merge can judge it again.
 * 4. **Referential integrity** is repaired (orphans dropped or re-parented) and
 *    every `*Order` array is reconciled against what actually survived.
 * 5. Tombstones older than {@link TOMBSTONE_TTL_MS} are pruned.
 *
 * Pure and deterministic: same inputs (and same `now`) → structurally identical
 * output, and `merge(a, merge(a, b))` equals `merge(a, b)`.
 *
 * The one caveat is step 5: pruning assumes every device syncs at least once
 * per TTL. A device that stays offline for longer can resurrect a row it never
 * heard was deleted — the accepted trade for not growing the blob forever.
 */

import type {
  BoardColumn,
  Card,
  Day,
  DrawElement,
  DrawPage,
  Id,
  MemoMessage,
  Millis,
  Sheet,
  TimelineEntry,
  Tombstone,
  Trip,
  Workspace,
} from '../types/models';

/** Tombstones stop being carried around after 30 days. */
export const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** The shape every mergeable entity shares. */
interface Timestamped {
  id: Id;
  createdAt: Millis;
  updatedAt: Millis;
}

type EntityKind = Tombstone['entity'];

/** `(entity, id)` collapsed into one map key. */
const tombKey = (entity: EntityKind, id: Id): string => `${entity}:${id}`;

/**
 * Total order used whenever ids have to be appended to an ordering array.
 * `createdAt` first (oldest idea first), then id so ties never flap.
 */
function byCreation(a: Timestamped, b: Timestamped): number {
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Union of two entity maps, resolving id collisions by `updatedAt`.
 * A tie hands the win to `remote` — see the module doc.
 */
function mergeMap<T extends Timestamped>(
  local: Record<Id, T>,
  remote: Record<Id, T>,
): Record<Id, T> {
  const out: Record<Id, T> = { ...local };
  for (const id of Object.keys(remote)) {
    const incoming = remote[id];
    const current = out[id];
    if (!current || incoming.updatedAt >= current.updatedAt) out[id] = incoming;
  }
  return out;
}

/**
 * Union of two `seenBy` maps, **per key, greatest wins** (M13).
 *
 * Not `mergeMap`: these are not entities, they carry no `updatedAt`, and there
 * is no whole-object LWW that could pick between them without throwing one
 * device's key away — which is precisely the case that matters, since each
 * device only ever writes its own key. Absent-safe on both sides, and returns
 * `undefined` for an empty result so a pre-M13 workspace stays byte-identical
 * to itself through a merge (an empty `{}` here would read as a change and
 * bounce a pointless push off the server).
 */
function mergeSeenBy(
  local: Record<string, Millis> | undefined,
  remote: Record<string, Millis> | undefined,
): Record<string, Millis> | undefined {
  if (!local && !remote) return undefined;
  const out: Record<string, Millis> = {};
  for (const source of [local, remote]) {
    for (const [key, at] of Object.entries(source ?? {})) {
      if (typeof at !== 'number' || !Number.isFinite(at)) continue;
      const current = out[key];
      if (current === undefined || at > current) out[key] = at;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Union of two tombstone lists keyed by `(entity, id)`, newest `deletedAt`. */
function mergeTombstones(local: Tombstone[], remote: Tombstone[]): Map<string, Tombstone> {
  const out = new Map<string, Tombstone>();
  for (const tomb of local) {
    const key = tombKey(tomb.entity, tomb.id);
    const current = out.get(key);
    if (!current || tomb.deletedAt > current.deletedAt) out.set(key, tomb);
  }
  for (const tomb of remote) {
    const key = tombKey(tomb.entity, tomb.id);
    const current = out.get(key);
    if (!current || tomb.deletedAt > current.deletedAt) out.set(key, tomb);
  }
  return out;
}

/**
 * Rebuilds an ordering array: drops ids that did not survive (and duplicates),
 * then appends every surviving member the array never mentioned, oldest first.
 *
 * Returns the *original* array when nothing changed so callers can skip
 * pointlessly cloning their parent entity.
 */
function reconcileList<T extends { id: Id }>(
  order: Id[],
  members: T[],
  compare: (a: T, b: T) => number,
): Id[] {
  const alive = new Map(members.map((member) => [member.id, member]));
  const seen = new Set<Id>();
  const kept: Id[] = [];

  for (const id of order) {
    if (!alive.has(id) || seen.has(id)) continue;
    seen.add(id);
    kept.push(id);
  }

  const missing = members.filter((member) => !seen.has(member.id)).sort(compare);
  if (missing.length === 0 && kept.length === order.length) return order;
  return [...kept, ...missing.map((member) => member.id)];
}

/** {@link reconcileList} with the entity ordering (`createdAt`, then id). */
const reconcileOrder = <T extends Timestamped>(order: Id[], members: T[]): Id[] =>
  reconcileList(order, members, byCreation);

/**
 * Same total order as {@link byCreation}, for the one thing that has no
 * `createdAt`: a {@link DrawElement} (see the model's note on why it carries
 * only `updatedAt`).
 */
function byUpdate(a: DrawElement, b: DrawElement): number {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt - b.updatedAt;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * 두 드로우 페이지 맵을 겹친다 (M52a) — **두 겹의 병합**.
 *
 * 페이지의 껍데기(제목·배경·`elementOrder`)는 평범한 엔티티 LWW로 갈리고,
 * `elements`는 **요소 하나하나가 따로** 갈린다. 페이지를 통째로 LWW하면 두 사람이
 * 같은 페이지에 동시에 그렸을 때 늦게 저장한 쪽이 상대의 획을 통째로 지운다 —
 * 그건 병합이 아니라 덮어쓰기다.
 *
 * 삭제는 톰스톤이 아니라 `deletedAt` 도장이다(모델의 설명 참조). 그래서 지운
 * 요소는 여전히 맵 안에 남아 「지웠다」를 상대에게 말하고, 30일이 지나면
 * {@link TOMBSTONE_TTL_MS}가 그것마저 걷어 간다 — 톰스톤 GC와 같은 시계다.
 *
 * `elementOrder`에는 **지운 요소도 그대로 남는다**. 그래야 실행취소로 되살린
 * 획이 맨 위가 아니라 원래 있던 층으로 돌아온다. 사라지는 것은 TTL이 걷어 간
 * 뒤다.
 */
function mergeDrawPage(local: DrawPage, remote: DrawPage, now: Millis): DrawPage {
  // 껍데기는 엔티티 LWW — 동점은 `mergeMap`과 같은 이유로 remote가 이긴다.
  const shell = remote.updatedAt >= local.updatedAt ? remote : local;

  const elements: Record<Id, DrawElement> = {};
  for (const source of [local.elements, remote.elements]) {
    for (const element of Object.values(source ?? {})) {
      const current = elements[element.id];
      if (!current || element.updatedAt >= current.updatedAt) elements[element.id] = element;
    }
  }
  // 지운 지 오래된 요소는 걷어 낸다 — 이 맵이 영원히 자라면 그것이 곧 파일 크기다.
  for (const element of Object.values(elements)) {
    if (element.deletedAt !== undefined && now - element.deletedAt > TOMBSTONE_TTL_MS) {
      delete elements[element.id];
    }
  }

  const elementOrder = reconcileList(shell.elementOrder ?? [], Object.values(elements), byUpdate);

  return {
    ...shell,
    // 삭제 도장은 **양쪽 중 무엇이든 찍힌 쪽**이 아니라 껍데기 LWW를 따른다:
    // 지운 뒤 되살린 페이지가 다시 지워지면 안 되고, 그 판정은 시각이 한다.
    elements,
    elementOrder,
  };
}

/** 두 워크스페이스의 `drawPages`를 겹친다. 양쪽 다 없으면 `undefined`. */
function mergeDrawPages(
  local: Record<Id, DrawPage> | undefined,
  remote: Record<Id, DrawPage> | undefined,
  now: Millis,
): Record<Id, DrawPage> {
  const out: Record<Id, DrawPage> = {};
  for (const [id, page] of Object.entries(local ?? {})) out[id] = page;
  for (const [id, page] of Object.entries(remote ?? {})) {
    const current = out[id];
    out[id] = current ? mergeDrawPage(current, page, now) : page;
  }
  // 한쪽에만 있던 페이지도 같은 TTL을 지난다.
  for (const [id, page] of Object.entries(out)) {
    if (page.deletedAt !== undefined && now - page.deletedAt > TOMBSTONE_TTL_MS) {
      delete out[id];
      continue;
    }
    if (local?.[id] && remote?.[id]) continue;
    const elements: Record<Id, DrawElement> = {};
    let pruned = false;
    for (const element of Object.values(page.elements ?? {})) {
      if (element.deletedAt !== undefined && now - element.deletedAt > TOMBSTONE_TTL_MS) {
        pruned = true;
        continue;
      }
      elements[element.id] = element;
    }
    if (pruned) {
      out[id] = {
        ...page,
        elements,
        elementOrder: reconcileList(page.elementOrder ?? [], Object.values(elements), byUpdate),
      };
    }
  }
  return out;
}

/** Mutable working copy of the merged workspace, plus the live tombstone map. */
interface Draft {
  trips: Record<Id, Trip>;
  sheets: Record<Id, Sheet>;
  columns: Record<Id, BoardColumn>;
  cards: Record<Id, Card>;
  days: Record<Id, Day>;
  entries: Record<Id, TimelineEntry>;
  /**
   * 메모 (M21). Merged like any other entity map — a soft-deleted message is
   * just a message whose newest edit stripped it, so LWW carries the delete.
   */
  memos: Record<Id, MemoMessage>;
  /**
   * 드로우 페이지 (M52a). 메모와 같은 자리에 있고 같은 이유로 `MAP_OF`에서
   * 닿을 수 없다 — 삭제가 `deletedAt` 도장이라 톰스톤이 필요 없다.
   */
  drawPages: Record<Id, DrawPage>;
  tombs: Map<string, Tombstone>;
}

/**
 * The map a tombstone `entity` refers to.
 *
 * `memos` is deliberately **not** reachable from here: `Tombstone['entity']` is
 * a closed set that every build looks up in this table, so a `'memo'` tombstone
 * arriving at a device that predates M21 would index it with `undefined` and
 * throw on the very next line. Memo deletions are soft (see
 * {@link MemoMessage.removedAt}) precisely so nothing has to be added here.
 */
const MAP_OF: Record<EntityKind, keyof Omit<Draft, 'tombs' | 'memos' | 'drawPages'>> = {
  trip: 'trips',
  sheet: 'sheets',
  column: 'columns',
  card: 'cards',
  day: 'days',
  entry: 'entries',
};

/**
 * Removes an entity found to be unreachable and records why, so the next merge
 * against a peer that still has it drops it there too instead of resurrecting
 * it. The stamp is pushed just past `updatedAt` when the clock lags behind the
 * entity, which keeps the kill effective (and the whole thing idempotent).
 */
function kill(draft: Draft, entity: EntityKind, item: Timestamped, now: Millis): void {
  const map = draft[MAP_OF[entity]] as Record<Id, Timestamped>;
  delete map[item.id];

  const key = tombKey(entity, item.id);
  const deletedAt = Math.max(now, item.updatedAt + 1);
  const current = draft.tombs.get(key);
  if (!current || current.deletedAt < deletedAt) {
    draft.tombs.set(key, { id: item.id, entity, deletedAt });
  }
}

/**
 * Drops every entity whose parent did not survive, and re-homes cards whose
 * column is gone onto the trip's first remaining column.
 *
 * Runs top-down (trip → sheet/column → day/card → entry) so a single pass is
 * enough: by the time a level is examined its parents are already final.
 */
function repairReferences(draft: Draft, now: Millis): void {
  for (const sheet of Object.values(draft.sheets)) {
    if (!draft.trips[sheet.tripId]) kill(draft, 'sheet', sheet, now);
  }
  for (const column of Object.values(draft.columns)) {
    if (!draft.trips[column.tripId]) kill(draft, 'column', column, now);
  }
  for (const day of Object.values(draft.days)) {
    if (!draft.trips[day.tripId] || !draft.sheets[day.sheetId]) kill(draft, 'day', day, now);
  }

  // Cards outlive their column: a deleted category must not delete its ideas.
  const columnsByTrip = new Map<Id, BoardColumn[]>();
  for (const column of Object.values(draft.columns)) {
    const list = columnsByTrip.get(column.tripId);
    if (list) list.push(column);
    else columnsByTrip.set(column.tripId, [column]);
  }

  for (const card of Object.values(draft.cards)) {
    const trip = draft.trips[card.tripId];
    if (!trip) {
      kill(draft, 'card', card, now);
      continue;
    }
    if (draft.columns[card.columnId]) continue;

    const survivors = columnsByTrip.get(trip.id) ?? [];
    // Honour the trip's own ordering first; fall back to age for a trip whose
    // columnOrder is itself stale (it is reconciled after this pass).
    const first =
      trip.columnOrder.map((id) => draft.columns[id]).find((column) => column?.tripId === trip.id) ??
      [...survivors].sort(byCreation)[0];

    if (!first) kill(draft, 'card', card, now);
    else draft.cards[card.id] = { ...card, columnId: first.id };
  }

  for (const entry of Object.values(draft.entries)) {
    if (!draft.trips[entry.tripId] || !draft.cards[entry.cardId] || !draft.days[entry.dayId]) {
      kill(draft, 'entry', entry, now);
    }
  }

  // A memo whose trip is gone is simply dropped — no tombstone, because there
  // is no memo tombstone to write (see `MAP_OF`). It does not need one: the
  // rule is a pure function of what survived the merge, so both devices reach
  // the same verdict on their own and the deletion converges without being
  // announced. The trip's own tombstone is what keeps the trip from coming
  // back and taking its thread with it.
  for (const memo of Object.values(draft.memos)) {
    if (!draft.trips[memo.tripId]) delete draft.memos[memo.id];
  }

  // 드로우 페이지도 같은 규칙이다 (M52a): 여행이 사라지면 그 스케치북도
  // 사라지고, 톰스톤은 쓰지 않는다 — 양쪽이 각자 같은 판정에 이른다.
  for (const page of Object.values(draft.drawPages)) {
    if (!draft.trips[page.tripId]) delete draft.drawPages[page.id];
  }
}

/** Rebuilds `columnOrder` / `sheetOrder` / `dayOrder` / `cardOrder`. */
function reconcileOrders(draft: Draft): void {
  const columnsByTrip = new Map<Id, BoardColumn[]>();
  const sheetsByTrip = new Map<Id, Sheet[]>();
  const daysBySheet = new Map<Id, Day[]>();
  const cardsByColumn = new Map<Id, Card[]>();

  const push = <T>(map: Map<Id, T[]>, key: Id, value: T): void => {
    const list = map.get(key);
    if (list) list.push(value);
    else map.set(key, [value]);
  };

  for (const column of Object.values(draft.columns)) push(columnsByTrip, column.tripId, column);
  for (const sheet of Object.values(draft.sheets)) push(sheetsByTrip, sheet.tripId, sheet);
  for (const day of Object.values(draft.days)) push(daysBySheet, day.sheetId, day);
  for (const card of Object.values(draft.cards)) push(cardsByColumn, card.columnId, card);

  // 드로우 페이지 순서 (M52a). 지운 페이지도 배열에 남는다 — 실행취소가 자리를
  // 되찾을 수 있어야 하고, TTL이 페이지를 걷어 갈 때 이 줄도 함께 사라진다.
  const pagesByTrip = new Map<Id, DrawPage[]>();
  for (const page of Object.values(draft.drawPages)) push(pagesByTrip, page.tripId, page);

  for (const trip of Object.values(draft.trips)) {
    const columnOrder = reconcileOrder(trip.columnOrder, columnsByTrip.get(trip.id) ?? []);
    const sheetOrder = reconcileOrder(trip.sheetOrder, sheetsByTrip.get(trip.id) ?? []);
    // 페이지가 하나도 없고 배열도 없던 여행은 **그대로 없는 채**로 둔다: 빈
    // 배열을 만들어 붙이면 M52a 이전 워크스페이스가 자기 자신과 달라져서 모든
    // 기기가 한 번씩 의미 없는 푸시를 한다 (`mergeSeenBy`와 같은 조심).
    const pages = pagesByTrip.get(trip.id) ?? [];
    const drawPageOrder =
      trip.drawPageOrder === undefined && pages.length === 0
        ? undefined
        : reconcileOrder(trip.drawPageOrder ?? [], pages);

    if (
      columnOrder !== trip.columnOrder ||
      sheetOrder !== trip.sheetOrder ||
      drawPageOrder !== trip.drawPageOrder
    ) {
      draft.trips[trip.id] = {
        ...trip,
        columnOrder,
        sheetOrder,
        ...(drawPageOrder === undefined ? {} : { drawPageOrder }),
      };
    }
  }
  for (const sheet of Object.values(draft.sheets)) {
    const dayOrder = reconcileOrder(sheet.dayOrder, daysBySheet.get(sheet.id) ?? []);
    if (dayOrder !== sheet.dayOrder) draft.sheets[sheet.id] = { ...sheet, dayOrder };
  }
  for (const column of Object.values(draft.columns)) {
    const cardOrder = reconcileOrder(column.cardOrder, cardsByColumn.get(column.id) ?? []);
    if (cardOrder !== column.cardOrder) draft.columns[column.id] = { ...column, cardOrder };
  }
}

/**
 * Order-insensitive deep equality for the JSON-shaped values a workspace is
 * made of. `undefined` and a missing key read as the same thing, which matters
 * because a round-trip through `JSON.stringify` drops optional fields (a card
 * with `memo: undefined` comes back from the server without `memo` at all).
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a == null && b == null;
  if (typeof a !== 'object' || typeof b !== 'object') return false;

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }

  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if (left[key] === undefined && right[key] === undefined) continue;
    if (!deepEqual(left[key], right[key])) return false;
  }
  return true;
}

/**
 * True when two workspaces carry the same content. Used by the sync engine to
 * decide whether a merge produced anything worth pushing back — comparing the
 * *result* against the server copy is what stops two devices from bouncing
 * no-op writes off each other forever.
 *
 * Tombstone arrays are compared as sets, since only `merge` output is sorted.
 */
export function workspaceEquals(a: Workspace, b: Workspace): boolean {
  const keyOf = (t: Tombstone): string => `${t.entity}:${t.id}:${t.deletedAt}`;
  const left = new Set(a.tombstones.map(keyOf));
  const right = new Set(b.tombstones.map(keyOf));
  if (left.size !== right.size) return false;
  for (const key of left) if (!right.has(key)) return false;

  return (
    a.schemaVersion === b.schemaVersion &&
    deepEqual(a.trips, b.trips) &&
    deepEqual(a.sheets, b.sheets) &&
    deepEqual(a.columns, b.columns) &&
    deepEqual(a.cards, b.cards) &&
    deepEqual(a.days, b.days) &&
    deepEqual(a.entries, b.entries) &&
    // `undefined` and `{}` are not the same value here, but `deepEqual` treats
    // a missing key and an `undefined` one alike — which is what makes a
    // pre-M13 workspace compare equal to itself after a round trip.
    deepEqual(a.seenBy, b.seenBy) &&
    deepEqual(a.memos, b.memos) &&
    deepEqual(a.drawPages, b.drawPages)
  );
}

/**
 * Folds two workspaces into one. Neither input is mutated.
 *
 * @param local  this device's workspace.
 * @param remote the server's copy — it also wins `updatedAt` ties.
 * @param now    injected clock, only used for tombstone TTL and for stamping
 *               integrity-repair deletions. Defaults to `Date.now()`.
 */
export function merge(local: Workspace, remote: Workspace, now: Millis = Date.now()): Workspace {
  const draft: Draft = {
    trips: mergeMap(local.trips, remote.trips),
    sheets: mergeMap(local.sheets, remote.sheets),
    columns: mergeMap(local.columns, remote.columns),
    cards: mergeMap(local.cards, remote.cards),
    days: mergeMap(local.days, remote.days),
    entries: mergeMap(local.entries, remote.entries),
    // Absent-safe on both sides: a pre-M21 workspace has no field at all.
    memos: mergeMap(local.memos ?? {}, remote.memos ?? {}),
    // 드로우만 `mergeMap`이 아니다 (M52a) — 페이지 안의 요소가 따로 갈린다.
    drawPages: mergeDrawPages(local.drawPages, remote.drawPages, now),
    tombs: mergeTombstones(local.tombstones, remote.tombstones),
  };

  // A tombstone only wins against an entity older than the deletion; an entity
  // edited afterwards survives, and the tombstone stays on for the next round.
  for (const tomb of draft.tombs.values()) {
    const map = draft[MAP_OF[tomb.entity]] as Record<Id, Timestamped>;
    const entity = map[tomb.id];
    if (entity && tomb.deletedAt > entity.updatedAt) delete map[tomb.id];
  }

  repairReferences(draft, now);
  reconcileOrders(draft);

  const tombstones = [...draft.tombs.values()]
    .filter((tomb) => now - tomb.deletedAt <= TOMBSTONE_TTL_MS)
    .map((tomb) => ({ id: tomb.id, entity: tomb.entity, deletedAt: tomb.deletedAt }))
    .sort((a, b) => {
      if (a.entity !== b.entity) return a.entity < b.entity ? -1 : 1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

  return {
    schemaVersion: 1,
    trips: draft.trips,
    sheets: draft.sheets,
    columns: draft.columns,
    cards: draft.cards,
    days: draft.days,
    entries: draft.entries,
    tombstones,
    seenBy: mergeSeenBy(local.seenBy, remote.seenBy),
    // `undefined` rather than `{}` for an empty thread, for exactly the reason
    // `mergeSeenBy` does it: a pre-M21 workspace has to stay byte-identical to
    // itself through a merge, or every pull would schedule a pointless push.
    memos: Object.keys(draft.memos).length > 0 ? draft.memos : undefined,
    // 같은 조심 (M52a): 드로우를 한 번도 쓰지 않은 워크스페이스는 병합을 지나도
    // 자기 자신과 바이트가 같아야 한다.
    drawPages: Object.keys(draft.drawPages).length > 0 ? draft.drawPages : undefined,
  };
}
