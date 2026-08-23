import type { BoardColumn, Id } from '../types/models';

/**
 * Pure drop-resolution for the kanban board.
 *
 * Kept free of React and of `@dnd-kit` types on purpose: M2a introduces one
 * combined "plan" DndContext (board + timeline) and will re-use this resolver
 * unchanged — only the wiring moves.
 */

/** Draggable/droppable kinds carried in `data` on dnd-kit nodes. */
export const DND_CARD = 'card';
export const DND_COLUMN = 'column';

export interface BoardDndSnapshot {
  /** columnId → its ordered card ids. */
  columns: Record<Id, Id[]>;
  /** cardId → the column it currently lives in. */
  columnOfCard: Record<Id, Id>;
}

/** The move to hand to `workspaceStore.moveCard`. */
export interface BoardMove {
  cardId: Id;
  toColumnId: Id;
  toIndex: number;
}

/** Builds the resolver input from the trip's columns, in board order. */
export function snapshotBoard(columns: readonly BoardColumn[]): BoardDndSnapshot {
  const snapshot: BoardDndSnapshot = { columns: {}, columnOfCard: {} };
  for (const column of columns) {
    snapshot.columns[column.id] = [...column.cardOrder];
    for (const cardId of column.cardOrder) snapshot.columnOfCard[cardId] = column.id;
  }
  return snapshot;
}

/**
 * Turns a drag end (`active.id` over `over.id`) into a {@link BoardMove}.
 *
 * - dropped on a **column** (its empty area) → append to that column;
 * - dropped on a **card** → take that card's slot, pushing it down. Within one
 *   column this reproduces `arrayMove` semantics, because `toIndex` is read
 *   from the order that still contains the dragged card.
 *
 * Returns `null` when the drop changes nothing or the ids are unknown.
 */
export function resolveBoardDrop(
  activeId: Id | null | undefined,
  overId: Id | null | undefined,
  snapshot: BoardDndSnapshot,
): BoardMove | null {
  if (!activeId || !overId || activeId === overId) return null;

  const fromColumnId = snapshot.columnOfCard[activeId];
  if (!fromColumnId) return null;

  let toColumnId: Id;
  let toIndex: number;

  if (snapshot.columns[overId]) {
    toColumnId = overId;
    toIndex = snapshot.columns[overId].filter((id) => id !== activeId).length;
  } else {
    const overColumnId = snapshot.columnOfCard[overId];
    if (!overColumnId) return null;
    toColumnId = overColumnId;
    toIndex = snapshot.columns[overColumnId].indexOf(overId);
    if (toIndex < 0) return null;
  }

  if (toColumnId === fromColumnId) {
    const order = snapshot.columns[fromColumnId];
    const next = order.filter((id) => id !== activeId);
    next.splice(Math.min(Math.max(toIndex, 0), next.length), 0, activeId);
    if (next.every((id, i) => id === order[i])) return null;
  }

  return { cardId: activeId, toColumnId, toIndex };
}
