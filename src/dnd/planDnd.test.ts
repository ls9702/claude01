import { describe, expect, it } from 'vitest';
import {
  TRASH_DROPPABLE_ID,
  dayDroppableId,
  entryDraggableId,
  planPointerPriority,
  resolveEntryDrop,
} from './planDnd';

/** The shape `pointerWithin` hands the collision detector. */
const hit = (id: string) => ({ id });
const idOf = (h: { id: string }) => h.id;

describe('resolveEntryDrop', () => {
  it('reads the 휴지통 as a delete', () => {
    expect(resolveEntryDrop(TRASH_DROPPABLE_ID)).toEqual({ kind: 'trash' });
  });

  it('reads a day column as a move', () => {
    expect(resolveEntryDrop(dayDroppableId('d1'))).toEqual({ kind: 'day', dayId: 'd1' });
  });

  it('reads anything else as nowhere at all', () => {
    expect(resolveEntryDrop(null)).toEqual({ kind: 'none' });
    expect(resolveEntryDrop(undefined)).toEqual({ kind: 'none' });
    // A board column, a rail card, an entry — none of them take a dropped entry.
    expect(resolveEntryDrop('col-1')).toEqual({ kind: 'none' });
    expect(resolveEntryDrop(entryDraggableId('e1'))).toEqual({ kind: 'none' });
  });

  it('keeps 휴지통 out of the day namespace', () => {
    // Were the trash id ever to start with `day:`, the branch above would
    // silently become a move onto a day that does not exist.
    expect(resolveEntryDrop(TRASH_DROPPABLE_ID)).not.toEqual({ kind: 'day', dayId: 'entry' });
  });
});

describe('planPointerPriority', () => {
  it('lets 휴지통 win over the day column drawn under it', () => {
    // The bar floats over the grid, so the pointer standing on it is inside a
    // day column too — both come back from the hit test, every time.
    const hits = [hit(dayDroppableId('d1')), hit(TRASH_DROPPABLE_ID)];
    expect(planPointerPriority(hits, idOf).map(idOf)).toEqual([TRASH_DROPPABLE_ID]);
  });

  it('keeps day columns when there is no 휴지통 under the pointer', () => {
    const hits = [hit('col-1'), hit(dayDroppableId('d1')), hit(dayDroppableId('d2'))];
    expect(planPointerPriority(hits, idOf).map(idOf)).toEqual([
      dayDroppableId('d1'),
      dayDroppableId('d2'),
    ]);
  });

  it('yields nothing when the pointer is over neither — the board decides', () => {
    expect(planPointerPriority([hit('col-1'), hit('card-1')], idOf)).toEqual([]);
    expect(planPointerPriority([], idOf)).toEqual([]);
  });
});
