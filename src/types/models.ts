/**
 * Trip Board — frozen data contract (M0).
 *
 * Every persisted entity lives in a single {@link Workspace} object which is
 * stored as one IndexedDB value. Ordering is explicit (`*Order` arrays of ids)
 * so drag & drop can reorder without touching the entities themselves.
 * Deletions are recorded as {@link Tombstone}s so a later sync milestone can
 * merge two workspaces without resurrecting removed rows.
 */

/** Opaque entity identifier (nanoid). */
export type Id = string;
/** Unix epoch milliseconds. */
export type Millis = number;

/** A trip: the top-level container for boards, sheets and timelines. */
export interface Trip {
  id: Id;
  title: string;
  /** ISO 4217-ish currency code used for budget display, e.g. `KRW`. */
  currency: string;
  /** Ordered {@link BoardColumn} ids for the 보드 tab. */
  columnOrder: Id[];
  /** Ordered {@link Sheet} ids for the 일정 tab. */
  sheetOrder: Id[];
  createdAt: Millis;
  updatedAt: Millis;
}

/** One flight of a sheet's outbound/inbound pair. */
export interface FlightLeg {
  date: string /*YYYY-MM-DD*/;
  depTime: string /*HH:mm*/;
  arrTime: string;
  /** True when the flight lands on the day after {@link FlightLeg.date}. */
  arrNextDay?: boolean;
  flightNo?: string;
  from?: string;
  to?: string;
}

/** A timesheet: an ordered run of days, optionally bracketed by flights. */
export interface Sheet {
  id: Id;
  tripId: Id;
  name: string;
  /** Ordered {@link Day} ids. */
  dayOrder: Id[];
  outboundFlight?: FlightLeg;
  inboundFlight?: FlightLeg;
  createdAt: Millis;
  updatedAt: Millis;
}

/** A kanban column on the brainstorm board. */
export interface BoardColumn {
  id: Id;
  tripId: Id;
  name: string;
  /** CSS color token / hex used for the column accent. */
  color: string;
  /** Emoji or icon key shown next to the column name. */
  icon: string;
  /** Ordered {@link Card} ids. */
  cardOrder: Id[];
  createdAt: Millis;
  updatedAt: Millis;
}

/** A map coordinate, optionally with a human-readable address. */
export interface GeoPoint {
  lat: number;
  lng: number;
  address?: string;
}

/** A brainstorm card: an idea that can be dragged onto the timeline. */
export interface Card {
  id: Id;
  tripId: Id;
  columnId: Id;
  title: string;
  memo?: string;
  url?: string;
  location?: GeoPoint;
  budget?: number;
  /** Default length in minutes used when the card is dropped on a day. */
  defaultDurationMin?: number;
  createdAt: Millis;
  updatedAt: Millis;
}

/** A single day column inside a {@link Sheet}. */
export interface Day {
  id: Id;
  tripId: Id;
  sheetId: Id;
  /** `YYYY-MM-DD`; absent for unscheduled/relative days. */
  date?: string;
  label?: string;
  createdAt: Millis;
  updatedAt: Millis;
}

/** A card placed on a day at a given time. */
export interface TimelineEntry {
  id: Id;
  tripId: Id;
  cardId: Id;
  dayId: Id;
  /** Minutes from midnight. */
  startMin: number;
  durationMin: number;
  note?: string;
  createdAt: Millis;
  updatedAt: Millis;
}

/** Record of a deletion, kept so sync/merge does not resurrect the entity. */
export interface Tombstone {
  id: Id;
  entity: 'trip' | 'sheet' | 'column' | 'card' | 'day' | 'entry';
  deletedAt: Millis;
}

/** The entire persisted state of the app. */
export interface Workspace {
  schemaVersion: 1;
  trips: Record<Id, Trip>;
  sheets: Record<Id, Sheet>;
  columns: Record<Id, BoardColumn>;
  cards: Record<Id, Card>;
  days: Record<Id, Day>;
  entries: Record<Id, TimelineEntry>;
  tombstones: Tombstone[];
}

/** A fresh, empty workspace. */
export const emptyWorkspace = (): Workspace => ({
  schemaVersion: 1,
  trips: {},
  sheets: {},
  columns: {},
  cards: {},
  days: {},
  entries: {},
  tombstones: [],
});
