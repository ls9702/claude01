import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyWorkspace, type Id, type Workspace } from '../types/models';
import { deleteMessage, deleteWithUndo } from './undoDelete';
import { UNDO_DESTRUCTIVE_MS, useUndoStore } from './undoStore';
import { useWorkspaceStore } from './workspaceStore';

// Same in-memory `StateStorage` swap `workspaceStore.test.ts` uses — IndexedDB
// does not exist under vitest's node environment.
vi.mock('./persistMiddleware', () => {
  const memory = new Map<string, string>();
  return {
    idbStorage: {
      getItem: async (key: string) => memory.get(key) ?? null,
      setItem: async (key: string, value: string) => {
        memory.set(key, value);
      },
      removeItem: async (key: string) => {
        memory.delete(key);
      },
    },
  };
});

const store = () => useWorkspaceStore.getState();
const ws = () => useWorkspaceStore.getState().workspace;
const undo = () => useUndoStore.getState();

/** Deep structural copy, so an assertion cannot be fooled by shared refs. */
const clone = (workspace: Workspace): Workspace =>
  JSON.parse(JSON.stringify(workspace)) as Workspace;

/**
 * A trip with a card in each of two columns, one sheet with two days, and two
 * timeline entries — every cascade path a delete can walk.
 */
function seedTrip(title = '오사카'): {
  tripId: Id;
  columnIds: Id[];
  cardIds: Id[];
  sheetId: Id;
  dayIds: Id[];
} {
  const tripId = store().addTrip(title);
  const columnIds = ws().trips[tripId].columnOrder;
  const cardIds = [
    store().addCard(tripId, columnIds[0], { title: '유니버설' })!,
    store().addCard(tripId, columnIds[1], { title: '도톤보리' })!,
  ];
  const sheetId = store().addSheet(tripId, '일정 1')!;
  const dayIds = [store().addDay(sheetId)!, store().addDay(sheetId)!];
  store().scheduleCard(cardIds[0], dayIds[0], 600);
  store().scheduleCard(cardIds[1], dayIds[1], 720);
  return { tripId, columnIds, cardIds, sheetId, dayIds };
}

beforeEach(() => {
  useWorkspaceStore.setState({ workspace: emptyWorkspace(), dirty: false });
  useUndoStore.setState({ current: null });
});

describe('deleteMessage', () => {
  it('names the entity and its label', () => {
    expect(deleteMessage('trip', '오사카')).toBe('여행 「오사카」 삭제됨');
    expect(deleteMessage('column', '식사')).toBe('카테고리 「식사」 삭제됨');
    expect(deleteMessage('card', '유니버설')).toBe('카드 「유니버설」 삭제됨');
    expect(deleteMessage('sheet', '일정 1')).toBe('일정표 「일정 1」 삭제됨');
    expect(deleteMessage('day', '1일차')).toBe('일자 「1일차」 삭제됨');
  });

  it('drops the quotes for a blank label', () => {
    expect(deleteMessage('day', '   ')).toBe('일자 삭제됨');
  });
});

describe('deleteWithUndo', () => {
  it('offers a 10초 undo and restores a deleted trip exactly', () => {
    const { tripId } = seedTrip();
    const before = clone(ws());

    deleteWithUndo('trip', '오사카', () => store().deleteTrip(tripId));

    expect(ws().trips[tripId]).toBeUndefined();
    expect(Object.keys(ws().cards)).toHaveLength(0);
    expect(Object.keys(ws().entries)).toHaveLength(0);
    expect(ws().tombstones.length).toBeGreaterThan(before.tombstones.length);

    const offered = undo().current;
    expect(offered?.message).toBe('여행 「오사카」 삭제됨');
    expect(offered?.durationMs).toBe(UNDO_DESTRUCTIVE_MS);

    undo().runUndo();

    // Ids, *Order arrays, updatedAt stamps and the tombstone list all come back.
    expect(clone(ws())).toEqual(before);
    expect(undo().current).toBeNull();
  });

  it('restores a deleted card, its column order and its entries', () => {
    const { cardIds, columnIds } = seedTrip();
    const before = clone(ws());

    deleteWithUndo('card', '유니버설', () => store().deleteCard(cardIds[0]));

    expect(ws().cards[cardIds[0]]).toBeUndefined();
    expect(ws().columns[columnIds[0]].cardOrder).not.toContain(cardIds[0]);
    expect(Object.keys(ws().entries)).toHaveLength(1);

    undo().runUndo();

    expect(clone(ws())).toEqual(before);
    expect(ws().columns[columnIds[0]].cardOrder).toContain(cardIds[0]);
    expect(Object.keys(ws().entries)).toHaveLength(2);
  });

  it('restores a deleted sheet with its days, entries and sheetOrder', () => {
    const { tripId, sheetId, dayIds } = seedTrip();
    const before = clone(ws());

    deleteWithUndo('sheet', '일정 1', () => store().deleteSheet(sheetId));

    expect(ws().sheets[sheetId]).toBeUndefined();
    expect(ws().trips[tripId].sheetOrder).toEqual([]);
    for (const dayId of dayIds) expect(ws().days[dayId]).toBeUndefined();
    expect(Object.keys(ws().entries)).toHaveLength(0);

    undo().runUndo();

    expect(clone(ws())).toEqual(before);
    expect(ws().trips[tripId].sheetOrder).toEqual([sheetId]);
    expect(Object.keys(ws().entries)).toHaveLength(2);
  });

  it('restores a deleted 카테고리 including the cards it handed off', () => {
    const { columnIds, cardIds } = seedTrip();
    const before = clone(ws());

    expect(deleteWithUndo('column', '이동수단', () => store().deleteColumn(columnIds[0]))).toBe(
      true,
    );
    // deleteColumn moves the orphaned cards to the first remaining column.
    expect(ws().cards[cardIds[0]].columnId).toBe(columnIds[1]);

    undo().runUndo();

    expect(clone(ws())).toEqual(before);
    expect(ws().cards[cardIds[0]].columnId).toBe(columnIds[0]);
  });

  it('offers nothing when the delete declines (a trip\'s last 카테고리)', () => {
    const tripId = store().addTrip('삿포로');
    const columnIds = [...ws().trips[tripId].columnOrder];
    for (const id of columnIds.slice(1)) store().deleteColumn(id);

    const before = clone(ws());
    const result = deleteWithUndo('column', '이동수단', () => store().deleteColumn(columnIds[0]));

    expect(result).toBe(false);
    expect(undo().current).toBeNull();
    expect(clone(ws())).toEqual(before);
  });

  it('leaves later offers in charge of the single undo slot', () => {
    const { cardIds } = seedTrip();

    deleteWithUndo('card', '유니버설', () => store().deleteCard(cardIds[0]));
    deleteWithUndo('card', '도톤보리', () => store().deleteCard(cardIds[1]));

    expect(undo().current?.message).toBe('카드 「도톤보리」 삭제됨');

    // The surviving offer restores the workspace as of *its* capture, so the
    // first card stays deleted — one slot, one snapshot.
    undo().runUndo();
    expect(ws().cards[cardIds[1]]).toBeDefined();
    expect(ws().cards[cardIds[0]]).toBeUndefined();
  });
});
