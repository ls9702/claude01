import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import {
  emptyWorkspace,
  type BoardColumn,
  type Card,
  type GeoPoint,
  type Id,
  type Millis,
  type Tombstone,
  type Trip,
  type Workspace,
} from '../types/models';
import { newId } from '../utils/ids';
import { idbStorage } from './persistMiddleware';

/* ------------------------------------------------------------------ *
 * Mutation payload types (the public write API of the workspace)
 * ------------------------------------------------------------------ */

/** Fields of a {@link Trip} that callers may change. */
export type TripPatch = Partial<Pick<Trip, 'title' | 'currency'>>;

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
