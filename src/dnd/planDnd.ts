import type { Id } from '../types/models';

/**
 * Id namespacing for the combined "plan" drag context (board rail + day grid).
 *
 * Board cards keep their bare card id as their dnd id so
 * {@link import('./boardDnd').resolveBoardDrop} works unchanged; everything the
 * timeline adds is prefixed. Ids are nanoid (`A-Za-z0-9_-`), so `:` can never
 * appear inside one and the prefixes stay unambiguous.
 */

/** `data.type` marker on a day column droppable. */
export const DND_DAY = 'day';
/** `data.type` marker on a timeline entry draggable. */
export const DND_ENTRY = 'entry';
/** `data.type` marker on the 휴지통 drop zone (M34). */
export const DND_TRASH = 'trash';

const DAY_PREFIX = 'day:';
const ENTRY_PREFIX = 'entry:';

/**
 * Droppable id of the 휴지통 — the bar that appears while an **entry** is being
 * dragged and takes it off the schedule when dropped on (M34).
 *
 * A single constant rather than a prefix: there is exactly one trash zone per
 * plan context and it belongs to no day. It wears the same `:` namespacing as
 * the ids above, so it can never be mistaken for a bare card id.
 */
export const TRASH_DROPPABLE_ID = 'trash:entry';

/** Droppable id of a day column. */
export const dayDroppableId = (dayId: Id): string => `${DAY_PREFIX}${dayId}`;

/** Draggable id of a timeline entry. */
export const entryDraggableId = (entryId: Id): string => `${ENTRY_PREFIX}${entryId}`;

/** `'day:abc'` → `'abc'`; anything else → `null`. */
export const parseDayDroppableId = (id: string | null | undefined): Id | null =>
  id && id.startsWith(DAY_PREFIX) ? id.slice(DAY_PREFIX.length) || null : null;

/** `'entry:abc'` → `'abc'`; anything else → `null`. */
export const parseEntryDraggableId = (id: string | null | undefined): Id | null =>
  id && id.startsWith(ENTRY_PREFIX) ? id.slice(ENTRY_PREFIX.length) || null : null;

/**
 * What a dropped **entry** landed on (M34).
 *
 * The one branch the drag-end handler has to take before it does any pixel
 * arithmetic, kept here as a pure decision so it can be read (and tested)
 * without a DOM: 휴지통 first, then a day column, then nowhere at all.
 */
export type EntryDrop =
  | { kind: 'trash' }
  | { kind: 'day'; dayId: Id }
  /** Dropped outside every target — cancel, and change nothing. */
  | { kind: 'none' };

/** Reads an entry drag's `over` id as an {@link EntryDrop}. */
export function resolveEntryDrop(overId: string | null | undefined): EntryDrop {
  if (overId === TRASH_DROPPABLE_ID) return { kind: 'trash' };
  const dayId = parseDayDroppableId(overId);
  return dayId ? { kind: 'day', dayId } : { kind: 'none' };
}

/**
 * Which of the hits under the pointer the 일정 context lets win (M34).
 *
 * 휴지통 outranks the day columns, and it has to: the bar is drawn **over** the
 * grid, so the pointer standing on it is geometrically inside a day column too
 * — every hit test returns both. Whichever is listed first is the drop, so the
 * order is stated here rather than left to `pointerWithin`'s.
 *
 * An empty result means "the pointer is over neither"; the caller then falls
 * back to the board's own `closestCorners`, exactly as before this rule existed.
 */
export function planPointerPriority<T>(hits: readonly T[], idOf: (hit: T) => string): T[] {
  const trash = hits.filter((hit) => idOf(hit) === TRASH_DROPPABLE_ID);
  if (trash.length > 0) return trash;
  return hits.filter((hit) => parseDayDroppableId(idOf(hit)) !== null);
}
