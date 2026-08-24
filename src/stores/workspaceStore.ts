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
}

/**
 * Categories every trip starts with. Order matters — it becomes the trip's
 * initial `columnOrder`.
 */
export const SEED_COLUMNS: readonly SeedColumn[] = [
  { name: '이동수단', color: 'sky', icon: '🚗' },
  { name: '할일', color: 'violet', icon: '📌' },
  { name: '식사', color: 'amber', icon: '🍽️' },
  { name: '숙소', color: 'rose', icon: '🏨' },
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
  };
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
            draft.cards[cardId] = {
              ...data,
              id: cardId,
              tripId,
              columnId,
              title: data.title.trim() || '새 카드',
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
            const comment: CardComment = { id: commentId, text: body, at: now };
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
