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

const DAY_PREFIX = 'day:';
const ENTRY_PREFIX = 'entry:';

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
