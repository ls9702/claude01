import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import {
  emptyWorkspace,
  type BoardColumn,
  type Card,
  type CardComment,
  type CardExpense,
  type CardPhoto,
  type Day,
  type FlightLeg,
  type GeoPoint,
  type Id,
  type MemoMessage,
  type Millis,
  type Sheet,
  type TimelineEntry,
  type Tombstone,
  type Trip,
  type Workspace,
} from '../types/models';
import {
  FLIGHT_CARD_PREFIX,
  flightCardTitle,
  legDurationMin,
  legPlacements,
  planSheetDays,
  type LegKind,
  type SheetFlightOpts,
} from '../utils/flights';
import { getActiveProfileId } from '../profile/profile';
import { newId } from '../utils/ids';
import { clampEntry, snapMin } from '../utils/time';
import { idbStorage } from './persistMiddleware';

export type { SheetFlightOpts } from '../utils/flights';

/* ------------------------------------------------------------------ *
 * Mutation payload types (the public write API of the workspace)
 * ------------------------------------------------------------------ */

/**
 * Fields of a {@link Trip} that callers may change. Passing `undefined` for
 * `localCurrency` / `fxRate` clears the 현지 통화 pair (M7b), and `undefined`
 * for `destination` takes the trip off the map's default view (M12).
 */
export type TripPatch = Partial<
  Pick<Trip, 'title' | 'currency' | 'localCurrency' | 'fxRate' | 'destination'>
>;

/** Fields of a {@link BoardColumn} that callers may change. */
export type ColumnPatch = Partial<Pick<BoardColumn, 'name' | 'color' | 'icon'>>;

/**
 * Fields of a {@link Card} that callers may change. `columnId` is deliberately
 * absent — moving a card between columns must go through {@link moveCard} so
 * the `cardOrder` arrays stay in sync. Passing `undefined` clears a field.
 */
export type CardPatch = Partial<
  Pick<Card, 'title' | 'memo' | 'url' | 'location' | 'budget' | 'defaultDurationMin'>
>;

/** Fields of a {@link Sheet} that callers may change (flights arrive in M2b). */
export type SheetPatch = Partial<Pick<Sheet, 'name'>>;

/** Fields of a {@link Day} that callers may change. */
export type DayPatch = Partial<Pick<Day, 'date' | 'label'>>;

/** Optional day metadata; a day with neither reads as `N일차`. */
export interface NewDayData {
  /** `YYYY-MM-DD`. */
  date?: string;
  label?: string;
}

/** Fields of a {@link TimelineEntry} that callers may change directly. */
export type EntryPatch = Partial<Pick<TimelineEntry, 'note'>>;

/** Fallback length of a dropped card that carries no `defaultDurationMin`. */
export const DEFAULT_ENTRY_MIN = 60;

/**
 * How many photos one card may hold (M10).
 *
 * Not a storage limit — the blobs are capped at ~500KB each, so a full card is
 * about 6MB — but a *legibility* one: a strip of thumbnails stops being a strip
 * somewhere past a dozen, and a card is an idea, not an album.
 */
export const MAX_PHOTOS_PER_CARD = 12;

/** Name of the sheet auto-created on a trip's first visit to the 일정 tab. */
export const FIRST_SHEET_NAME = '일정 1';

/** Board category the 항공편 마법사 files its generated cards under. */
export const FLIGHT_COLUMN_NAME = '이동수단';

/** Everything needed to create a card; only `title` is required. */
export interface NewCardData {
  title: string;
  memo?: string;
  url?: string;
  location?: GeoPoint;
  budget?: number;
  defaultDurationMin?: number;
}

/** One of the five columns seeded into every new trip. */
export interface SeedColumn {
  name: string;
  color: string;
  icon: string;
  /** 체크리스트 카테고리로 태어나는가 (M29). 없으면 평범한 칸. */
  todo?: boolean;
  /** 예산을 시트마다 한 번만 세는 칸인가 (M31). 없으면 배치 단위. */
  budgetOnce?: boolean;
}

/**
 * Categories every trip starts with. Order matters — it becomes the trip's
 * initial `columnOrder`.
 *
 * 「할일」은 처음부터 체크리스트다 (M29): 환전·유심·예약처럼 이 칸에 들어가는
 * 일은 장소도 시간도 없고, 지도에 찍히지도 시간표에 놓이지도 않는다. 그런 것에
 * 사람이 해줄 수 있는 유일한 일이 「끝냈다」이므로 여섯 번째 칸을 만들지 않고
 * 이미 있던 칸에 그 성질을 준다.
 */
export const SEED_COLUMNS: readonly SeedColumn[] = [
  { name: '이동수단', color: 'sky', icon: '🚗' },
  { name: '할일', color: 'violet', icon: '📌', todo: true },
  { name: '식사', color: 'amber', icon: '🍽️' },
  // 숙소는 예산을 시트마다 한 번만 센다 (M31): 4박 예약 하나를 네 칸에 걸어도
  // 결제는 한 번이고, 배치 단위로 세면 40만원이 160만원이 된다.
  { name: '숙소', color: 'rose', icon: '🏨', budgetOnce: true },
  { name: '볼거리', color: 'emerald', icon: '🎡' },
];

/* ------------------------------------------------------------------ *
 * Draft helpers — every mutation runs against a copy, never in place
 * ------------------------------------------------------------------ */

/** A mutable copy of the workspace handed to a mutation body. */
type Draft = Workspace;

/** Shallow-clones every collection so React sees new references. */
function draftOf(ws: Workspace): Draft {
  return {
    schemaVersion: ws.schemaVersion,
    trips: { ...ws.trips },
    sheets: { ...ws.sheets },
    columns: { ...ws.columns },
    cards: { ...ws.cards },
    days: { ...ws.days },
    entries: { ...ws.entries },
    tombstones: [...ws.tombstones],
    seenBy: ws.seenBy ? { ...ws.seenBy } : undefined,
    // Cloned only when it exists, so a workspace that never had a 메모 keeps
    // no `memos` key at all — the shape every pre-M21 device already handles.
    memos: ws.memos ? { ...ws.memos } : undefined,
  };
}

/**
 * `{ by: 'song' }`, or nothing at all when no profile has been picked (M13).
 *
 * Spread into the literal rather than assigned, so a device that never chose a
 * profile writes a comment with **no** `by` key — exactly the shape everything
 * written before M13 has, which is the one shape the whole app already handles.
 */
function authorStamp(): { by: string } | Record<string, never> {
  const id = getActiveProfileId();
  return id ? { by: id } : {};
}

/**
 * Replaces `map[id]` with a patched copy and stamps `updatedAt`.
 * Returns the new entity, or `null` when the id is unknown.
 */
function touch<T extends { updatedAt: Millis }>(
  map: Record<Id, T>,
  id: Id,
  patch: Partial<T>,
  now: Millis,
): T | null {
  const current = map[id];
  if (!current) return null;
  const next = { ...current, ...patch, updatedAt: now } as T;
  map[id] = next;
  return next;
}

/** Records a deletion so a later sync merge does not resurrect the entity. */
function bury(draft: Draft, entity: Tombstone['entity'], id: Id, now: Millis): void {
  draft.tombstones.push({ id, entity, deletedAt: now });
}

/** Clamps an insertion index into `[0, length]`. */
const clampIndex = (index: number, length: number): number => {
  if (!Number.isFinite(index)) return length;
  return Math.min(Math.max(Math.trunc(index), 0), length);
};

/** Deletes every entry that points at `cardId`, leaving tombstones behind. */
function removeEntriesForCard(draft: Draft, cardId: Id, now: Millis): void {
  for (const entry of Object.values(draft.entries)) {
    if (entry.cardId !== cardId) continue;
    delete draft.entries[entry.id];
    bury(draft, 'entry', entry.id, now);
  }
}

/** Deletes a day plus its entries. The caller fixes up `sheet.dayOrder`. */
function removeDay(draft: Draft, dayId: Id, now: Millis): void {
  delete draft.days[dayId];
  bury(draft, 'day', dayId, now);
  for (const entry of Object.values(draft.entries)) {
    if (entry.dayId !== dayId) continue;
    delete draft.entries[entry.id];
    bury(draft, 'entry', entry.id, now);
  }
}

/* ------------------------------------------------------------------ *
 * 항공편 마법사 helpers (M2b)
 *
 * The wizard owns two cards per sheet, and `models.ts` is frozen — there is no
 * `outboundCardId` to hold onto. So the link is the **card title prefix**
 * (`✈️`) plus "this card has an entry in this sheet", and an edit is a
 * *delete-and-recreate*: `updateSheetFlights` wipes the sheet's flight entries
 * (and any flight card left with no entries anywhere), then lays the new legs
 * down from scratch. Cheap, and it cannot drift out of sync.
 * ------------------------------------------------------------------ */

/** The trip's 이동수단 column, falling back to its first surviving column. */
function flightColumnId(draft: Draft, trip: Trip): Id | null {
  const columns = trip.columnOrder
    .map((columnId) => draft.columns[columnId])
    .filter((column): column is BoardColumn => Boolean(column));
  const named = columns.find((column) => column.name.trim() === FLIGHT_COLUMN_NAME);
  return named?.id ?? columns[0]?.id ?? null;
}

/** Creates a day record. The caller owns the sheet's `dayOrder`. */
function newDay(draft: Draft, sheet: Sheet, data: NewDayData, now: Millis): Id {
  const dayId = newId();
  draft.days[dayId] = {
    id: dayId,
    tripId: sheet.tripId,
    sheetId: sheet.id,
    date: data.date,
    label: data.label,
    createdAt: now,
    updatedAt: now,
  };
  return dayId;
}

/** Appends an entry without the public guards — both ends are ours already. */
function newEntry(
  draft: Draft,
  tripId: Id,
  cardId: Id,
  dayId: Id,
  startMin: number,
  durationMin: number,
  now: Millis,
): Id {
  const span = clampEntry(snapMin(startMin), durationMin);
  const entryId = newId();
  draft.entries[entryId] = {
    id: entryId,
    tripId,
    cardId,
    dayId,
    startMin: span.startMin,
    durationMin: span.durationMin,
    createdAt: now,
    updatedAt: now,
  };
  return entryId;
}

/**
 * Drops the sheet's wizard-made flight entries, and every flight card they
 * leave behind with nothing scheduled anywhere. Everything gets a tombstone.
 */
function clearFlightPlacements(draft: Draft, sheetId: Id, now: Millis): void {
  const dayIds = new Set(
    Object.values(draft.days)
      .filter((day) => day.sheetId === sheetId)
      .map((day) => day.id),
  );

  const orphanCandidates = new Set<Id>();
  for (const entry of Object.values(draft.entries)) {
    if (!dayIds.has(entry.dayId)) continue;
    const card = draft.cards[entry.cardId];
    if (!card?.title.startsWith(FLIGHT_CARD_PREFIX)) continue;
    delete draft.entries[entry.id];
    bury(draft, 'entry', entry.id, now);
    orphanCandidates.add(entry.cardId);
  }

  for (const cardId of orphanCandidates) {
    // A flight card the user also placed on another sheet stays put.
    if (Object.values(draft.entries).some((entry) => entry.cardId === cardId)) continue;
    const card = draft.cards[cardId];
    if (!card) continue;
    delete draft.cards[cardId];
    bury(draft, 'card', cardId, now);
    const column = draft.columns[card.columnId];
    if (column) {
      draft.columns[card.columnId] = {
        ...column,
        cardOrder: column.cardOrder.filter((id) => id !== cardId),
        updatedAt: now,
      };
    }
  }
}

/**
 * Creates one ✈️ card per leg the sheet carries and schedules it on the day
 * matching the leg's date (first/last day as a fallback), starting at `depTime`
 * and lasting as long as the leg is in the air. A leg with nowhere to land —
 * a dateless sheet with no days — is skipped, card and all.
 *
 * A 심야 leg gets **two** entries for that one card (B10): the tail of its
 * departure day and the head of the day it lands on — see {@link legPlacements}.
 * The second entry only appears when the sheet actually holds the arrival day;
 * otherwise the leg keeps its tail and nothing is invented.
 */
function syncFlightPlacements(draft: Draft, sheetId: Id, now: Millis): void {
  const sheet = draft.sheets[sheetId];
  if (!sheet) return;
  const trip = draft.trips[sheet.tripId];
  if (!trip) return;
  const columnId = flightColumnId(draft, trip);
  if (!columnId) return;

  const dayByDate = new Map<string, Id>();
  for (const dayId of sheet.dayOrder) {
    const date = draft.days[dayId]?.date;
    if (date && !dayByDate.has(date)) dayByDate.set(date, dayId);
  }

  const legs: [FlightLeg | undefined, LegKind][] = [
    [sheet.outboundFlight, 'outbound'],
    [sheet.inboundFlight, 'inbound'],
  ];

  for (const [leg, kind] of legs) {
    if (!leg) continue;
    const [departure, arrival] = legPlacements(leg);
    const fallback = kind === 'outbound' ? sheet.dayOrder[0] : sheet.dayOrder.at(-1);
    const dayId = dayByDate.get(departure.date) ?? fallback;
    if (!dayId) continue;

    const column = draft.columns[columnId];
    if (!column) continue;

    const cardId = newId();
    draft.cards[cardId] = {
      id: cardId,
      tripId: trip.id,
      columnId,
      title: flightCardTitle(leg, kind),
      // The card still states the whole flight, however many days it touches.
      defaultDurationMin: legDurationMin(leg),
      createdAt: now,
      updatedAt: now,
    };
    draft.columns[columnId] = {
      ...column,
      cardOrder: [...column.cardOrder, cardId],
      updatedAt: now,
    };

    newEntry(draft, trip.id, cardId, dayId, departure.startMin, departure.durationMin, now);

    const arrivalDayId = arrival ? dayByDate.get(arrival.date) : undefined;
    if (arrival && arrivalDayId) {
      newEntry(draft, trip.id, cardId, arrivalDayId, arrival.startMin, arrival.durationMin, now);
    }
  }
}

/* ------------------------------------------------------------------ *
 * Store
 * ------------------------------------------------------------------ */

export interface WorkspaceState {
  /** The single persisted blob of app data. */
  workspace: Workspace;
  /** True when there are local changes not yet pushed to a remote (M4). */
  dirty: boolean;
  /** False until IndexedDB rehydration has finished. Not persisted. */
  hydrated: boolean;

  /**
   * Generic escape hatch: applies `fn` to a shallow copy of the workspace and
   * marks the store dirty. Prefer the named mutations below — they also stamp
   * `updatedAt` and write tombstones.
   */
  mutate: (fn: (ws: Workspace) => void) => void;
  /** Replace the whole workspace (import / sync merge result). */
  replaceWorkspace: (ws: Workspace) => void;
  setDirty: (dirty: boolean) => void;

  /**
   * Records that `profileId` has the app open right now (M13) — this is the
   * "누가 봤는지" the other person reads in 설정.
   *
   * Unconditional: it stamps every time it is called, and makes the workspace
   * dirty every time. **The caller owns the throttle** (see
   * `profile.SEEN_THROTTLE_MS`) — a mutation that quietly decided not to
   * mutate would be the surprising one, and the store has no business deciding
   * how often "opening the app" is worth telling the other person about.
   *
   * No-op for a blank id. An unknown id is *not* rejected: this map is keyed by
   * profile id, and the model layer does not know what those are.
   */
  markSeen: (profileId: string) => void;

  /**
   * Records that a person has read up to `at` (M24) — the 안 읽음 배지의 반대편.
   *
   * Shares {@link Workspace.seenBy} with {@link markSeen} through namespaced
   * keys (`memo:<tripId>:<profileId>`, `card:<cardId>:<profileId>` — see
   * `read/readState`), so person-level read state rides the existing per-key
   * greatest-wins merge with no schema change at all.
   *
   * **Only ever advances.** An unread badge is watched by an effect that fires
   * on every render of the thread; a mutation that re-stamped the same value
   * would make the workspace dirty — and bounce a pointless push off the
   * server — every time a message arrived. So a stamp that is not newer than
   * the one already there changes nothing.
   *
   * No-op for a blank key or a non-positive `at`. Unlike {@link markSeen} the
   * caller owns nothing: the guard *is* the throttle.
   */
  markRead: (key: string, at: Millis) => void;

  /** Creates a trip plus the five seeded columns. Returns the new trip id. */
  addTrip: (title: string, currency?: string) => Id;
  /** Renames / re-currencies a trip. No-op for an unknown id. */
  updateTrip: (id: Id, patch: TripPatch) => void;
  /**
   * Deletes a trip and every sheet, column, card, day and timeline entry that
   * belongs to it. Every removed entity gets a tombstone.
   */
  deleteTrip: (id: Id) => void;

  /** Appends a column to the trip's `columnOrder`. Returns its id, or `null`. */
  addColumn: (tripId: Id, name: string, color: string, icon: string) => Id | null;
  /** Renames / recolors a column. No-op for an unknown id. */
  updateColumn: (id: Id, patch: ColumnPatch) => void;
  /**
   * 이 칸을 체크리스트 카테고리로 켜거나 끈다 (M29).
   *
   * `updateColumn`의 patch에 얹지 않고 따로 둔 이유는 저장하는 값이 다르기
   * 때문이다: 끄기는 필드를 *지우는* 것이 아니라 **명시적 `false`를 남기는**
   * 것이고 (그래야 이름이 「할일」인 칸에 자동 이행이 다시 손대지 못한다),
   * `ColumnPatch`의 `undefined`는 어느 필드에서든 「비운다」는 뜻이라 그 구분을
   * 실을 수 없다. No-op for an unknown id.
   */
  setColumnTodo: (id: Id, todo: boolean) => void;
  /**
   * 이 칸의 예산을 시트마다 한 번만 세도록 켜거나 끈다 (M31).
   *
   * {@link setColumnTodo}와 같은 이유로 `updateColumn` 바깥에 있다: 끄기가
   * 필드를 지우는 것이 아니라 **명시적 `false`를 남기는** 것이어야 이름이
   * 「숙소」인 칸에 자동 이행이 다시 손대지 않는다. No-op for an unknown id.
   */
  setColumnBudgetOnce: (id: Id, budgetOnce: boolean) => void;
  /**
   * Deletes a column, moving its cards to the trip's first remaining column.
   * Returns `false` (and changes nothing) when the column is unknown or is the
   * trip's last one — a board always keeps at least one category.
   */
  deleteColumn: (id: Id) => boolean;

  /** Appends a card to a column. Returns its id, or `null` when invalid. */
  addCard: (tripId: Id, columnId: Id, data: NewCardData) => Id | null;
  /** Patches a card. Passing `undefined` for an optional field clears it. */
  updateCard: (id: Id, patch: CardPatch) => void;
  /** Deletes a card and cascade-deletes its timeline entries (+ tombstones). */
  deleteCard: (id: Id) => void;
  /**
   * 할 일 체크를 켜고 끈다 (M29) — 보드의 체크박스와 「할 일」 시트가 같이 쓴다.
   *
   * 켜면 `doneAt`에 지금 시각이 박히고, 끄면 그 **필드가 사라진다**: 값을
   * `undefined`로 두는 것이 아니라 키째로 없앤 카드를 다시 지어 넣는다
   * (`removeMemoMessage`와 같은 손질). 그래야 동기화로 건너가는 모양이 M29
   * 이전 카드와 완전히 같다.
   *
   * 칸이 체크리스트인지는 **묻지 않는다**. 그건 화면이 체크박스를 그릴지 말지의
   * 규칙이지 데이터의 규칙이 아니고, 카드를 다른 칸으로 옮겼다고 끝낸 일이
   * 안 끝난 일이 되지는 않는다. No-op for an unknown id.
   */
  toggleCardDone: (id: Id) => void;
  /**
   * Reorders a card inside its column or moves it to another column of the
   * same trip. `toIndex` is the position in the destination `cardOrder`
   * *after* the card has been taken out of its source column; out-of-range
   * values are clamped.
   */
  moveCard: (cardId: Id, toColumnId: Id, toIndex: number) => void;

  /* --- 지출 / 코멘트 — M6 --------------------------------------------- */

  /**
   * Appends an expense to a card. Returns its id, or `null` for an unknown
   * card or a non-finite amount. Editing in place is deliberately missing —
   * removing and re-adding is enough for a receipt list.
   */
  addExpense: (cardId: Id, amount: number, label?: string) => Id | null;
  /** Drops one expense. No-op when the card or the expense is unknown. */
  removeExpense: (cardId: Id, expenseId: Id) => void;
  /** Appends a comment. Returns its id, or `null` for blank text. */
  addComment: (cardId: Id, text: string) => Id | null;
  /** Drops one comment. No-op when the card or the comment is unknown. */
  removeComment: (cardId: Id, commentId: Id) => void;

  /* --- 사진 — M10 ------------------------------------------------------ */

  /**
   * Records a photo that has **already been written** to the blob store.
   *
   * The caller owns the id precisely because of that ordering: the bytes go in
   * first, under an id it generated, and only a successful write earns a place
   * in the workspace. Metadata therefore never points at pixels that are not
   * there (the reverse — a blob with no metadata — is harmless and is what the
   * GC sweeps up).
   *
   * Returns the id it was given, or `null` when the card is unknown, the
   * dimensions are not positive finite numbers, or the card is already holding
   * {@link MAX_PHOTOS_PER_CARD}.
   */
  addPhoto: (cardId: Id, meta: { id: Id; w: number; h: number; bytes: number }) => Id | null;
  /**
   * Drops one photo's metadata. No-op when the card or the photo is unknown.
   *
   * Deliberately does **not** delete the blob: a card delete is undoable for
   * 10초 and would hand these ids straight back. `photoGc` sweeps the bytes
   * later, once nothing has referenced them for a grace period.
   */
  removePhoto: (cardId: Id, photoId: Id) => void;

  /* --- 메모 — M21 ------------------------------------------------------ */

  /**
   * Appends one message to a trip's 메모 thread.
   *
   * Photos arrive the same way {@link addPhoto}'s do — the caller has already
   * written the bytes under those ids, so metadata never points at pixels that
   * are not there. Text is trimmed; a message with neither text nor photos is
   * not a message, and neither is one addressed to a trip that is gone.
   *
   * Returns the new message id, or `null` in either of those cases.
   */
  addMemoMessage: (
    tripId: Id,
    input: { text?: string; photos?: CardPhoto[] },
  ) => Id | null;
  /**
   * Soft-deletes one message: strips its text and photos, stamps `removedAt`,
   * and bumps `updatedAt` so the *edit* rides the ordinary entity LWW.
   *
   * Not a tombstone — see {@link MemoMessage.removedAt}. Stripping the photo
   * ids is what hands those bytes to the GC (and, behind it, to the server
   * delete), so a deleted photo message really does stop costing storage.
   *
   * Authorship is not checked here. Only the UI offers the affordance, and
   * only on one's own messages — the same trust model as every other mutation
   * in this store, which has exactly two users and no permission system.
   *
   * No-op for an unknown id, and for a message that is already removed.
   */
  removeMemoMessage: (id: Id) => void;

  /* --- 일정 (timeline) — M2a ------------------------------------------ */

  /** Appends a sheet to the trip's `sheetOrder`. Returns its id, or `null`. */
  addSheet: (tripId: Id, name: string) => Id | null;
  /** Renames a sheet. No-op for an unknown id. */
  updateSheet: (id: Id, patch: SheetPatch) => void;
  /** Deletes a sheet plus every day and entry inside it (+ tombstones). */
  deleteSheet: (id: Id) => void;

  /* --- 시트 마법사 — M2b -------------------------------------------- */

  /**
   * Creates a sheet with its days already laid out, plus one ✈️ card + entry
   * per flight leg.
   *
   * The day range comes from {@link planSheetDays}: `outbound.date` through the
   * inbound leg's arrival date (its `date`, +1 when `arrNextDay`), or
   * `dayCount` days from the departure when there is no return leg, or
   * `dayCount` **dateless** days when there are no flights at all. A day carries
   * its `date` and nothing else — `N일차` is derived from its position at render
   * time, never stored (B12).
   *
   * The generated cards go into the trip's `이동수단` column (its first column
   * if there is none) and are titled `✈️ ICN→KIX OZ112`, falling back to
   * `✈️ 출발편` / `✈️ 귀국편`. Each entry starts at the leg's `depTime` and
   * lasts as long as the leg is in the air; a 심야 leg is **split** across the
   * two days it touches rather than clamped into a stub (B10).
   *
   * Returns the new sheet's id, or `null` for an unknown trip.
   */
  createSheetFromFlights: (
    tripId: Id,
    name: string,
    opts?: SheetFlightOpts,
  ) => { sheetId: Id } | null;

  /**
   * Re-plans an existing sheet's flights and day range.
   *
   * Days are re-dated **in place**, so an existing day keeps its entries and
   * simply shifts by the delta between the old and the new start date. A
   * shorter range removes the days that fall off the end — their entries are
   * deleted (and tombstoned), which returns those cards to 미배치; a longer one
   * appends fresh days. Flight cards/entries are recreated from scratch (see
   * the 항공편 마법사 helpers above). Passing neither leg clears the flights
   * and leaves the days untouched. No-op for an unknown sheet.
   */
  updateSheetFlights: (sheetId: Id, opts: SheetFlightOpts) => void;

  /** Appends a day to the sheet's `dayOrder`. Returns its id, or `null`. */
  addDay: (sheetId: Id, opts?: NewDayData) => Id | null;
  /** Patches a day's date/label. Passing `undefined` clears the field. */
  updateDay: (id: Id, patch: DayPatch) => void;
  /** Deletes a day and cascade-deletes its entries (+ tombstones). */
  deleteDay: (id: Id) => void;

  /**
   * Places a card on a day. `startMin` is snapped to the 15-minute grid and
   * the result is clamped inside `0…1440` — an entry that would run past
   * midnight is shortened, never moved. `durationMin` defaults to the card's
   * `defaultDurationMin`, then to {@link DEFAULT_ENTRY_MIN}.
   *
   * Returns the new entry id, or `null` when the card/day are unknown or
   * belong to different trips.
   */
  scheduleCard: (cardId: Id, dayId: Id, startMin: number, durationMin?: number) => Id | null;
  /** Moves an entry to `dayId` at a snapped, clamped `startMin`. */
  moveEntry: (entryId: Id, dayId: Id, startMin: number) => void;
  /** Changes an entry's length (min 15 minutes, never past midnight). */
  resizeEntry: (entryId: Id, durationMin: number) => void;
  /** Patches an entry's note. */
  updateEntry: (id: Id, patch: EntryPatch) => void;
  /**
   * 배치 하나에 붙는 메모를 쓰거나 지운다 (M39) — 엑셀 셀의 코멘트와 같은 자리.
   *
   * {@link updateEntry}와 달리 **문자열 하나만** 받고, 그 대신 세 가지를 지킨다.
   *
   * 1. 앞뒤 공백을 손질한다.
   * 2. 남는 것이 없으면 {@link TimelineEntry.note}를 **키째로** 없앤다
   *    (`toggleCardDone`·`removeMemoMessage`와 같은 손질). `{ note: undefined }`를
   *    덧쓰면 키가 `undefined`인 채로 남아, 「메모 없음」이 두 가지 모양을 갖는다.
   * 3. 내용이 그대로면 아무 일도 하지 않는다 — 시트를 열었다 저장만 눌렀다고
   *    워크스페이스가 더러워지고 푸시가 한 번 더 나가면 그건 저장이 아니라 잡음이다.
   *
   * 메모는 **카드가 아니라 배치**에 붙는다: 같은 카드를 두 번 놓으면 메모도 둘이고,
   * 서로를 모른다. 그래서 이 화면에서만 보이고 보드·지도·결산에는 새지 않는다.
   * No-op for an unknown id.
   */
  updateEntryNote: (entryId: Id, note: string) => void;
  /** Removes an entry, leaving a tombstone. */
  deleteEntry: (id: Id) => void;
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set, get) => {
      /**
       * The single funnel every named mutation goes through: builds a draft,
       * runs `body`, and commits with `dirty: true`. A `null` result means
       * "nothing to do" and leaves the store completely untouched.
       */
      const run = <T>(body: (draft: Draft, now: Millis) => T | null): T | null => {
        const now = Date.now();
        const draft = draftOf(get().workspace);
        const result = body(draft, now);
        if (result === null) return null;
        set({ workspace: draft, dirty: true });
        return result;
      };

      return {
        workspace: emptyWorkspace(),
        dirty: false,
        hydrated: false,

        mutate: (fn) =>
          set((state) => {
            const next: Workspace = { ...state.workspace };
            fn(next);
            return { workspace: next, dirty: true };
          }),

        replaceWorkspace: (ws) => set({ workspace: ws, dirty: true }),

        setDirty: (dirty) => set({ dirty }),

        markSeen: (profileId) => {
          run((draft, now) => {
            const id = profileId.trim();
            if (id === '') return null;
            draft.seenBy = { ...(draft.seenBy ?? {}), [id]: now };
            return true;
          });
        },

        markRead: (key, at) => {
          run((draft) => {
            const id = key.trim();
            if (id === '') return null;
            if (!Number.isFinite(at) || at <= 0) return null;
            const current = draft.seenBy?.[id];
            if (current !== undefined && current >= at) return null;
            draft.seenBy = { ...(draft.seenBy ?? {}), [id]: at };
            return true;
          });
        },

        addTrip: (title, currency = 'KRW') => {
          const id = run((draft, now) => {
            const tripId = newId();
            const columnOrder: Id[] = [];

            for (const seed of SEED_COLUMNS) {
              const columnId = newId();
              draft.columns[columnId] = {
                id: columnId,
                tripId,
                name: seed.name,
                color: seed.color,
                icon: seed.icon,
                // Spread, never `todo: seed.todo` — a plain column must keep
                // **no** key at all, which is the shape every pre-M29 device
                // (and the 자동 이행 rule) already reads as "not a checklist".
                ...(seed.todo ? { todo: true } : {}),
                // 같은 이유로 같은 모양 (M31): 평범한 칸에는 키가 아예 없다.
                ...(seed.budgetOnce ? { budgetOnce: true } : {}),
                cardOrder: [],
                createdAt: now,
                updatedAt: now,
              };
              columnOrder.push(columnId);
            }

            draft.trips[tripId] = {
              id: tripId,
              title: title.trim() || '새 여행',
              currency: currency.trim() || 'KRW',
              columnOrder,
              sheetOrder: [],
              createdAt: now,
              updatedAt: now,
            };
            return tripId;
          });
          // `run` only returns null when the body asks to abort; addTrip never does.
          return id as Id;
        },

        updateTrip: (id, patch) => {
          run((draft, now) => touch<Trip>(draft.trips, id, patch, now));
        },

        deleteTrip: (id) => {
          run((draft, now) => {
            if (!draft.trips[id]) return null;

            delete draft.trips[id];
            bury(draft, 'trip', id, now);

            for (const sheet of Object.values(draft.sheets)) {
              if (sheet.tripId !== id) continue;
              delete draft.sheets[sheet.id];
              bury(draft, 'sheet', sheet.id, now);
            }
            for (const column of Object.values(draft.columns)) {
              if (column.tripId !== id) continue;
              delete draft.columns[column.id];
              bury(draft, 'column', column.id, now);
            }
            for (const card of Object.values(draft.cards)) {
              if (card.tripId !== id) continue;
              delete draft.cards[card.id];
              bury(draft, 'card', card.id, now);
            }
            for (const day of Object.values(draft.days)) {
              if (day.tripId !== id) continue;
              delete draft.days[day.id];
              bury(draft, 'day', day.id, now);
            }
            for (const entry of Object.values(draft.entries)) {
              if (entry.tripId !== id) continue;
              delete draft.entries[entry.id];
              bury(draft, 'entry', entry.id, now);
            }

            // The 메모 thread goes with the trip, and **without** a tombstone —
            // there is no memo tombstone to write (see `sync/merge`'s `MAP_OF`),
            // and none is needed: "a memo whose trip is gone is dropped" is the
            // rule merge applies on its own, so the two ends agree without one.
            // Dropping them here as well is what lets the photo GC reclaim the
            // thread's bytes on a device that never syncs.
            if (draft.memos) {
              const kept = Object.fromEntries(
                Object.entries(draft.memos).filter(([, memo]) => memo.tripId !== id),
              );
              draft.memos = Object.keys(kept).length > 0 ? kept : undefined;
            }
            return true;
          });
        },

        addColumn: (tripId, name, color, icon) =>
          run((draft, now) => {
            const trip = draft.trips[tripId];
            if (!trip) return null;

            const columnId = newId();
            draft.columns[columnId] = {
              id: columnId,
              tripId,
              name: name.trim() || '새 카테고리',
              color,
              icon,
              cardOrder: [],
              createdAt: now,
              updatedAt: now,
            };
            draft.trips[tripId] = {
              ...trip,
              columnOrder: [...trip.columnOrder, columnId],
              updatedAt: now,
            };
            return columnId;
          }),

        updateColumn: (id, patch) => {
          run((draft, now) => touch<BoardColumn>(draft.columns, id, patch, now));
        },

        setColumnTodo: (id, todo) => {
          run((draft, now) => {
            const column = draft.columns[id];
            if (!column) return null;
            // 같은 값이면 아무 일도 없다: 카테고리 편집을 열었다 닫기만 해도
            // 워크스페이스가 dirty가 되어 NAS로 한 번 밀려가는 건, 아무것도
            // 바뀌지 않았다는 사실보다 시끄럽다.
            if (column.todo === todo) return null;
            return touch<BoardColumn>(draft.columns, id, { todo }, now);
          });
        },

        setColumnBudgetOnce: (id, budgetOnce) => {
          run((draft, now) => {
            const column = draft.columns[id];
            if (!column) return null;
            // 같은 값이면 아무 일도 없다 — `setColumnTodo`와 같은 이유다.
            if (column.budgetOnce === budgetOnce) return null;
            return touch<BoardColumn>(draft.columns, id, { budgetOnce }, now);
          });
        },

        deleteColumn: (id) =>
          run((draft, now) => {
            const column = draft.columns[id];
            if (!column) return null;
            const trip = draft.trips[column.tripId];
            if (!trip) return null;

            const remaining = trip.columnOrder.filter((columnId) => columnId !== id);
            // A board must keep at least one category to drop cards into.
            if (remaining.length === 0) return null;

            const fallbackId = remaining[0];
            const fallback = draft.columns[fallbackId];
            if (!fallback) return null;

            if (column.cardOrder.length > 0) {
              draft.columns[fallbackId] = {
                ...fallback,
                cardOrder: [...fallback.cardOrder, ...column.cardOrder],
                updatedAt: now,
              };
              for (const cardId of column.cardOrder) {
                touch<Card>(draft.cards, cardId, { columnId: fallbackId }, now);
              }
            }

            delete draft.columns[id];
            bury(draft, 'column', id, now);
            draft.trips[trip.id] = { ...trip, columnOrder: remaining, updatedAt: now };
            return true;
          }) === true,

        addCard: (tripId, columnId, data) =>
          run((draft, now) => {
            const column = draft.columns[columnId];
            if (!column || column.tripId !== tripId) return null;

            const cardId = newId();
            const author = getActiveProfileId();
            draft.cards[cardId] = {
              ...data,
              id: cardId,
              tripId,
              columnId,
              title: data.title.trim() || '새 카드',
              // Stamped once, here, and never patched again (M13).
              ...(author ? { createdBy: author } : {}),
              createdAt: now,
              updatedAt: now,
            };
            draft.columns[columnId] = {
              ...column,
              cardOrder: [...column.cardOrder, cardId],
              updatedAt: now,
            };
            return cardId;
          }),

        updateCard: (id, patch) => {
          run((draft, now) => touch<Card>(draft.cards, id, patch, now));
        },

        deleteCard: (id) => {
          run((draft, now) => {
            const card = draft.cards[id];
            if (!card) return null;

            delete draft.cards[id];
            bury(draft, 'card', id, now);

            const column = draft.columns[card.columnId];
            if (column) {
              draft.columns[card.columnId] = {
                ...column,
                cardOrder: column.cardOrder.filter((cardId) => cardId !== id),
                updatedAt: now,
              };
            }
            removeEntriesForCard(draft, id, now);
            return true;
          });
        },

        toggleCardDone: (id) => {
          run((draft, now) => {
            const card = draft.cards[id];
            if (!card) return null;

            if (card.doneAt) {
              // 되지어 넣는다 — `doneAt: undefined`가 아니라 키가 **없는** 카드로.
              const { doneAt: _cleared, ...rest } = card;
              draft.cards[id] = { ...rest, updatedAt: now };
              return true;
            }
            return touch<Card>(draft.cards, id, { doneAt: now }, now);
          });
        },

        moveCard: (cardId, toColumnId, toIndex) => {
          run((draft, now) => {
            const card = draft.cards[cardId];
            const target = draft.columns[toColumnId];
            if (!card || !target || target.tripId !== card.tripId) return null;
            const source = draft.columns[card.columnId];
            if (!source) return null;

            if (source.id === target.id) {
              const order = source.cardOrder.filter((id) => id !== cardId);
              order.splice(clampIndex(toIndex, order.length), 0, cardId);
              // Dropping a card back where it started is not a change.
              if (order.every((id, i) => id === source.cardOrder[i])) return null;
              draft.columns[source.id] = { ...source, cardOrder: order, updatedAt: now };
              return true;
            }

            draft.columns[source.id] = {
              ...source,
              cardOrder: source.cardOrder.filter((id) => id !== cardId),
              updatedAt: now,
            };
            const order = target.cardOrder.filter((id) => id !== cardId);
            order.splice(clampIndex(toIndex, order.length), 0, cardId);
            draft.columns[target.id] = { ...target, cardOrder: order, updatedAt: now };
            touch<Card>(draft.cards, cardId, { columnId: target.id }, now);
            return true;
          });
        },

        /* --- 지출 / 코멘트 (M6) ---------------------------------------- */

        addExpense: (cardId, amount, label) =>
          run((draft, now) => {
            const card = draft.cards[cardId];
            if (!card || !Number.isFinite(amount)) return null;

            const expenseId = newId();
            const expense: CardExpense = {
              id: expenseId,
              amount,
              label: label?.trim() || undefined,
              at: now,
              ...authorStamp(),
            };
            touch<Card>(
              draft.cards,
              cardId,
              { expenses: [...(card.expenses ?? []), expense] },
              now,
            );
            return expenseId;
          }),

        removeExpense: (cardId, expenseId) => {
          run((draft, now) => {
            const card = draft.cards[cardId];
            const kept = (card?.expenses ?? []).filter((item) => item.id !== expenseId);
            if (!card || kept.length === (card.expenses?.length ?? 0)) return null;
            // An emptied list goes back to `undefined` — exactly the shape a
            // card created before M6 has, so nothing downstream sees a special
            // case.
            return touch<Card>(
              draft.cards,
              cardId,
              { expenses: kept.length > 0 ? kept : undefined },
              now,
            );
          });
        },

        addComment: (cardId, text) =>
          run((draft, now) => {
            const card = draft.cards[cardId];
            const body = text.trim();
            if (!card || body === '') return null;

            const commentId = newId();
            const comment: CardComment = {
              id: commentId,
              text: body,
              at: now,
              ...authorStamp(),
            };
            touch<Card>(
              draft.cards,
              cardId,
              { comments: [...(card.comments ?? []), comment] },
              now,
            );
            return commentId;
          }),

        removeComment: (cardId, commentId) => {
          run((draft, now) => {
            const card = draft.cards[cardId];
            const kept = (card?.comments ?? []).filter((item) => item.id !== commentId);
            if (!card || kept.length === (card.comments?.length ?? 0)) return null;
            return touch<Card>(
              draft.cards,
              cardId,
              { comments: kept.length > 0 ? kept : undefined },
              now,
            );
          });
        },

        /* --- 사진 (M10) ------------------------------------------------ */

        addPhoto: (cardId, meta) =>
          run((draft, now) => {
            const card = draft.cards[cardId];
            if (!card) return null;
            const positive = (value: number): boolean => Number.isFinite(value) && value > 0;
            if (!positive(meta.w) || !positive(meta.h)) return null;
            const current = card.photos ?? [];
            if (current.length >= MAX_PHOTOS_PER_CARD) return null;

            const photo: CardPhoto = {
              id: meta.id,
              w: Math.round(meta.w),
              h: Math.round(meta.h),
              bytes: Number.isFinite(meta.bytes) ? Math.max(0, Math.round(meta.bytes)) : 0,
              createdAt: now,
            };
            touch<Card>(draft.cards, cardId, { photos: [...current, photo] }, now);
            return meta.id;
          }),

        removePhoto: (cardId, photoId) => {
          run((draft, now) => {
            const card = draft.cards[cardId];
            const kept = (card?.photos ?? []).filter((item) => item.id !== photoId);
            if (!card || kept.length === (card.photos?.length ?? 0)) return null;
            // Emptied goes back to `undefined` — the shape a pre-M10 card has.
            return touch<Card>(
              draft.cards,
              cardId,
              { photos: kept.length > 0 ? kept : undefined },
              now,
            );
          });
        },

        /* --- 메모 (M21) ------------------------------------------------ */

        addMemoMessage: (tripId, input) =>
          run((draft, now) => {
            if (!draft.trips[tripId]) return null;

            const text = input.text?.trim() ?? '';
            const photos = (input.photos ?? []).filter((photo) => Boolean(photo?.id));
            if (text === '' && photos.length === 0) return null;

            const memoId = newId();
            const memo: MemoMessage = {
              id: memoId,
              tripId,
              ...(text !== '' ? { text } : {}),
              ...(photos.length > 0 ? { photos } : {}),
              // Stamped once, at creation, exactly like a card's `createdBy`.
              ...authorStamp(),
              createdAt: now,
              updatedAt: now,
            };
            // The map is created on first use, so a workspace with no 메모 has
            // no `memos` key — see `draftOf`.
            draft.memos = { ...(draft.memos ?? {}), [memoId]: memo };
            return memoId;
          }),

        removeMemoMessage: (id) => {
          run((draft, now) => {
            const memo = draft.memos?.[id];
            if (!memo || memo.removedAt) return null;

            // Rebuilt rather than patched: `text`/`photos` have to be *gone*,
            // not set to `undefined`, so what syncs is the empty shape and the
            // photo ids stop being referenced anywhere.
            draft.memos = {
              ...draft.memos,
              [id]: {
                id: memo.id,
                tripId: memo.tripId,
                ...(memo.by ? { by: memo.by } : {}),
                removedAt: now,
                createdAt: memo.createdAt,
                updatedAt: now,
              },
            };
            return true;
          });
        },

        /* --- 일정 (timeline) ------------------------------------------ */

        addSheet: (tripId, name) =>
          run((draft, now) => {
            const trip = draft.trips[tripId];
            if (!trip) return null;

            const sheetId = newId();
            draft.sheets[sheetId] = {
              id: sheetId,
              tripId,
              name: name.trim() || '새 일정',
              dayOrder: [],
              createdAt: now,
              updatedAt: now,
            };
            draft.trips[tripId] = {
              ...trip,
              sheetOrder: [...trip.sheetOrder, sheetId],
              updatedAt: now,
            };
            return sheetId;
          }),

        updateSheet: (id, patch) => {
          run((draft, now) => touch<Sheet>(draft.sheets, id, patch, now));
        },

        deleteSheet: (id) => {
          run((draft, now) => {
            const sheet = draft.sheets[id];
            if (!sheet) return null;

            for (const dayId of sheet.dayOrder) removeDay(draft, dayId, now);
            // Defensive: a day that lost its place in `dayOrder` still belongs
            // to this sheet and must not outlive it.
            for (const day of Object.values(draft.days)) {
              if (day.sheetId === id) removeDay(draft, day.id, now);
            }

            delete draft.sheets[id];
            bury(draft, 'sheet', id, now);

            const trip = draft.trips[sheet.tripId];
            if (trip) {
              draft.trips[trip.id] = {
                ...trip,
                sheetOrder: trip.sheetOrder.filter((sheetId) => sheetId !== id),
                updatedAt: now,
              };
            }
            return true;
          });
        },

        createSheetFromFlights: (tripId, name, opts = {}) =>
          run((draft, now) => {
            const trip = draft.trips[tripId];
            if (!trip) return null;

            const plan = planSheetDays(opts);
            const sheetId = newId();
            const sheet: Sheet = {
              id: sheetId,
              tripId,
              name: name.trim() || '새 일정',
              dayOrder: [],
              outboundFlight: opts.outbound,
              inboundFlight: opts.inbound,
              createdAt: now,
              updatedAt: now,
            };
            draft.sheets[sheetId] = sheet;

            // No `label`: `N일차` is a *position*, and freezing it here is what
            // made an insert read `2일차 · 3일차 · 3일차` (B12). The header
            // derives it from `dayOrder` instead.
            sheet.dayOrder = Array.from({ length: plan.count }, (_, index) =>
              newDay(draft, sheet, { date: plan.dates?.[index] }, now),
            );

            draft.trips[tripId] = {
              ...trip,
              sheetOrder: [...trip.sheetOrder, sheetId],
              updatedAt: now,
            };

            syncFlightPlacements(draft, sheetId, now);
            return { sheetId };
          }),

        updateSheetFlights: (sheetId, opts) => {
          run((draft, now) => {
            const sheet = draft.sheets[sheetId];
            if (!sheet) return null;

            clearFlightPlacements(draft, sheetId, now);

            const plan = planSheetDays(opts);
            const existing = sheet.dayOrder.filter((dayId) => draft.days[dayId]);
            let dayOrder = existing;

            if (plan.count > 0) {
              // Surviving days keep their entries and take the new date at the
              // same position — that *is* the shift by (newStart − oldStart).
              dayOrder = existing.slice(0, plan.count);
              dayOrder.forEach((dayId, index) => {
                // Only the date moves; a `label` the user typed is theirs.
                touch<Day>(draft.days, dayId, { date: plan.dates?.[index] }, now);
              });
              // Days past the end of the new range go, entries and all.
              for (const dayId of existing.slice(plan.count)) removeDay(draft, dayId, now);
              for (let index = dayOrder.length; index < plan.count; index += 1) {
                dayOrder.push(newDay(draft, sheet, { date: plan.dates?.[index] }, now));
              }
            }

            draft.sheets[sheetId] = {
              ...sheet,
              dayOrder,
              outboundFlight: opts.outbound,
              inboundFlight: opts.inbound,
              updatedAt: now,
            };

            syncFlightPlacements(draft, sheetId, now);
            return true;
          });
        },

        addDay: (sheetId, opts) =>
          run((draft, now) => {
            const sheet = draft.sheets[sheetId];
            if (!sheet) return null;

            const dayId = newId();
            draft.days[dayId] = {
              id: dayId,
              tripId: sheet.tripId,
              sheetId,
              date: opts?.date,
              label: opts?.label,
              createdAt: now,
              updatedAt: now,
            };
            draft.sheets[sheetId] = {
              ...sheet,
              dayOrder: [...sheet.dayOrder, dayId],
              updatedAt: now,
            };
            return dayId;
          }),

        updateDay: (id, patch) => {
          run((draft, now) => touch<Day>(draft.days, id, patch, now));
        },

        deleteDay: (id) => {
          run((draft, now) => {
            const day = draft.days[id];
            if (!day) return null;

            removeDay(draft, id, now);

            const sheet = draft.sheets[day.sheetId];
            if (sheet) {
              draft.sheets[sheet.id] = {
                ...sheet,
                dayOrder: sheet.dayOrder.filter((dayId) => dayId !== id),
                updatedAt: now,
              };
            }
            return true;
          });
        },

        scheduleCard: (cardId, dayId, startMin, durationMin) =>
          run((draft, now) => {
            const card = draft.cards[cardId];
            const day = draft.days[dayId];
            if (!card || !day || day.tripId !== card.tripId) return null;

            const requested = durationMin ?? card.defaultDurationMin ?? DEFAULT_ENTRY_MIN;
            const span = clampEntry(snapMin(startMin), requested);

            const entryId = newId();
            draft.entries[entryId] = {
              id: entryId,
              tripId: card.tripId,
              cardId,
              dayId,
              startMin: span.startMin,
              durationMin: span.durationMin,
              createdAt: now,
              updatedAt: now,
            };
            return entryId;
          }),

        moveEntry: (entryId, dayId, startMin) => {
          run((draft, now) => {
            const entry = draft.entries[entryId];
            const day = draft.days[dayId];
            if (!entry || !day || day.tripId !== entry.tripId) return null;

            const span = clampEntry(snapMin(startMin), entry.durationMin);
            // Dropping an entry back where it started is not a change.
            if (
              entry.dayId === dayId &&
              entry.startMin === span.startMin &&
              entry.durationMin === span.durationMin
            ) {
              return null;
            }
            return touch<TimelineEntry>(draft.entries, entryId, { dayId, ...span }, now);
          });
        },

        resizeEntry: (entryId, durationMin) => {
          run((draft, now) => {
            const entry = draft.entries[entryId];
            if (!entry) return null;

            const span = clampEntry(entry.startMin, durationMin);
            if (span.durationMin === entry.durationMin) return null;
            return touch<TimelineEntry>(
              draft.entries,
              entryId,
              { durationMin: span.durationMin },
              now,
            );
          });
        },

        updateEntry: (id, patch) => {
          run((draft, now) => touch<TimelineEntry>(draft.entries, id, patch, now));
        },

        updateEntryNote: (entryId, note) => {
          run((draft, now) => {
            const entry = draft.entries[entryId];
            if (!entry) return null;

            const next = note.trim();
            if (next === (entry.note ?? '')) return null;

            if (next === '') {
              // 되지어 넣는다 — `note: undefined`가 아니라 키가 **없는** 배치로.
              const { note: _cleared, ...rest } = entry;
              draft.entries[entryId] = { ...rest, updatedAt: now };
              return true;
            }
            return touch<TimelineEntry>(draft.entries, entryId, { note: next }, now);
          });
        },

        deleteEntry: (id) => {
          run((draft, now) => {
            if (!draft.entries[id]) return null;
            delete draft.entries[id];
            bury(draft, 'entry', id, now);
            return true;
          });
        },
      };
    },
    {
      name: 'trip-board/workspace',
      version: 1,
      storage: createJSONStorage(() => idbStorage),
      // `hydrated` and the actions are derived/ephemeral — only persist data.
      partialize: (state) => ({ workspace: state.workspace, dirty: state.dirty }),
      onRehydrateStorage: () => (_state, error) => {
        if (error) console.warn('[workspaceStore] rehydrate failed', error);
        // Mark hydrated either way so the app never gets stuck on the splash.
        useWorkspaceStore.setState({ hydrated: true });
      },
    },
  ),
);
