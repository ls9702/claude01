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
  Id,
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
function reconcileOrder<T extends Timestamped>(order: Id[], members: T[]): Id[] {
  const alive = new Map(members.map((member) => [member.id, member]));
  const seen = new Set<Id>();
  const kept: Id[] = [];

  for (const id of order) {
    if (!alive.has(id) || seen.has(id)) continue;
    seen.add(id);
    kept.push(id);
  }

  const missing = members.filter((member) => !seen.has(member.id)).sort(byCreation);
  if (missing.length === 0 && kept.length === order.length) return order;
  return [...kept, ...missing.map((member) => member.id)];
}

/** Mutable working copy of the merged workspace, plus the live tombstone map. */
interface Draft {
  trips: Record<Id, Trip>;
  sheets: Record<Id, Sheet>;
  columns: Record<Id, BoardColumn>;
  cards: Record<Id, Card>;
  days: Record<Id, Day>;
  entries: Record<Id, TimelineEntry>;
  tombs: Map<string, Tombstone>;
}

/** The map a tombstone `entity` refers to. */
const MAP_OF: Record<EntityKind, keyof Omit<Draft, 'tombs'>> = {
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

  for (const trip of Object.values(draft.trips)) {
    const columnOrder = reconcileOrder(trip.columnOrder, columnsByTrip.get(trip.id) ?? []);
    const sheetOrder = reconcileOrder(trip.sheetOrder, sheetsByTrip.get(trip.id) ?? []);
    if (columnOrder !== trip.columnOrder || sheetOrder !== trip.sheetOrder) {
      draft.trips[trip.id] = { ...trip, columnOrder, sheetOrder };
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
    deepEqual(a.seenBy, b.seenBy)
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
  };
}
