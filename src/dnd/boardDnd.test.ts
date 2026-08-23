import { describe, expect, it } from 'vitest';
import type { BoardColumn } from '../types/models';
import { resolveBoardDrop, snapshotBoard, type BoardDndSnapshot } from './boardDnd';

const column = (id: string, cardOrder: string[]): BoardColumn => ({
  id,
  tripId: 't',
  name: id,
  color: 'sky',
  icon: '📌',
  cardOrder,
  createdAt: 0,
  updatedAt: 0,
});

const snap = (): BoardDndSnapshot =>
  snapshotBoard([column('c1', ['a', 'b', 'c']), column('c2', ['x']), column('c3', [])]);

describe('snapshotBoard', () => {
  it('indexes card → column', () => {
    const s = snap();
    expect(s.columns.c1).toEqual(['a', 'b', 'c']);
    expect(s.columnOfCard).toEqual({ a: 'c1', b: 'c1', c: 'c1', x: 'c2' });
  });
});

describe('resolveBoardDrop', () => {
  it('reorders within a column using the pre-removal index', () => {
    // Dragging A onto C must land A last, like arrayMove(0 → 2).
    expect(resolveBoardDrop('a', 'c', snap())).toEqual({
      cardId: 'a',
      toColumnId: 'c1',
      toIndex: 2,
    });
  });

  it('takes the slot of the card it is dropped on in another column', () => {
    expect(resolveBoardDrop('a', 'x', snap())).toEqual({
      cardId: 'a',
      toColumnId: 'c2',
      toIndex: 0,
    });
  });

  it('appends when dropped on a column body', () => {
    expect(resolveBoardDrop('a', 'c3', snap())).toEqual({
      cardId: 'a',
      toColumnId: 'c3',
      toIndex: 0,
    });
    expect(resolveBoardDrop('a', 'c2', snap())).toEqual({
      cardId: 'a',
      toColumnId: 'c2',
      toIndex: 1,
    });
  });

  it('ignores the card its own column when nothing moves', () => {
    // Dropping A onto its own column appends it — index 2 after removal.
    expect(resolveBoardDrop('c', 'c1', snap())).toBeNull();
    expect(resolveBoardDrop('a', 'c1', snap())).toEqual({
      cardId: 'a',
      toColumnId: 'c1',
      toIndex: 2,
    });
  });

  it('returns null for missing / self / unknown ids', () => {
    expect(resolveBoardDrop('a', null, snap())).toBeNull();
    expect(resolveBoardDrop(null, 'c2', snap())).toBeNull();
    expect(resolveBoardDrop('a', 'a', snap())).toBeNull();
    expect(resolveBoardDrop('zzz', 'c2', snap())).toBeNull();
    expect(resolveBoardDrop('a', 'zzz', snap())).toBeNull();
  });
});
