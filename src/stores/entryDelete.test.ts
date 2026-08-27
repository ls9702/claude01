import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyWorkspace, type Id, type TimelineEntry } from '../types/models';
import { deleteEntryWithUndo } from './entryDelete';
import { UNDO_DEFAULT_MS, useUndoStore } from './undoStore';
import { useWorkspaceStore } from './workspaceStore';

// Same in-memory `StateStorage` swap the other store specs use — IndexedDB does
// not exist under vitest's node environment.
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

/** A trip with one card placed at 10:00 on 1일차. */
function seed(): { cardId: Id; dayId: Id; entry: TimelineEntry } {
  const tripId = store().addTrip('오사카');
  const columnId = ws().trips[tripId].columnOrder[0];
  const cardId = store().addCard(tripId, columnId, { title: '이치란' })!;
  const sheetId = store().addSheet(tripId, '일정 1')!;
  const dayId = store().addDay(sheetId)!;
  const entryId = store().scheduleCard(cardId, dayId, 600, 90)!;
  store().updateEntry(entryId, { note: '줄 서기' });
  return { cardId, dayId, entry: ws().entries[entryId] };
}

beforeEach(() => {
  useWorkspaceStore.setState({ workspace: emptyWorkspace(), dirty: false });
  useUndoStore.setState({ current: null });
});

describe('deleteEntryWithUndo', () => {
  it('takes the placement off the schedule and leaves the card on the board', () => {
    const { cardId, entry } = seed();

    deleteEntryWithUndo(entry);

    expect(ws().entries[entry.id]).toBeUndefined();
    // The whole point of 휴지통: this is a placement, not the card.
    expect(ws().cards[cardId]).toBeDefined();
    expect(ws().cards[cardId].title).toBe('이치란');
    expect(ws().columns[ws().cards[cardId].columnId].cardOrder).toContain(cardId);
  });

  it("names the card in the toast and offers the ordinary undo", () => {
    const { entry } = seed();

    deleteEntryWithUndo(entry);

    expect(undo().current?.message).toBe("'이치란' 삭제됨");
    expect(undo().current?.undo).toBeTypeOf('function');
    expect(undo().current?.durationMs).toBe(UNDO_DEFAULT_MS);
  });

  it('restores an identical placement — day, minute, length and note', () => {
    const { cardId, dayId, entry } = seed();

    deleteEntryWithUndo(entry);
    undo().runUndo();

    const restored = Object.values(ws().entries);
    expect(restored).toHaveLength(1);
    expect(restored[0]).toMatchObject({
      cardId,
      dayId,
      startMin: 600,
      durationMin: 90,
      note: '줄 서기',
    });
    // A new placement, not a resurrected row: what came back is the spot on the
    // timetable, and the store hands out a fresh id for it.
    expect(restored[0].id).not.toBe(entry.id);
    expect(undo().current).toBeNull();
  });

  it('restores a note-less entry without inventing one', () => {
    const { entry } = seed();
    const bare = { ...entry, note: undefined };

    deleteEntryWithUndo(bare);
    undo().runUndo();

    expect(Object.values(ws().entries)[0].note).toBeUndefined();
  });

  it('says 일정 when the card behind the entry is already gone', () => {
    const { cardId, entry } = seed();
    store().deleteCard(cardId);
    // Deleting the card took its entries with it; the drag is holding a stale
    // one, which is exactly the case this fallback is for.
    deleteEntryWithUndo(entry);

    expect(undo().current?.message).toBe("'일정' 삭제됨");
  });
});
