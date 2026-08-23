import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyWorkspace, type Id } from '../types/models';
import { SEED_COLUMNS, useWorkspaceStore } from './workspaceStore';

// The store persists through IndexedDB, which does not exist under vitest's
// node environment. Swap in an in-memory `StateStorage` so `persist` is
// exercised without warnings.
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

/** Ids of the seeded columns of `tripId`, in board order. */
const columnIds = (tripId: Id): Id[] => ws().trips[tripId].columnOrder;

beforeEach(() => {
  useWorkspaceStore.setState({ workspace: emptyWorkspace(), dirty: false });
});

describe('addTrip', () => {
  it('creates the trip with five seeded columns in order', () => {
    const tripId = store().addTrip('오사카 3박4일');
    const trip = ws().trips[tripId];

    expect(trip.title).toBe('오사카 3박4일');
    expect(trip.currency).toBe('KRW');
    expect(trip.sheetOrder).toEqual([]);
    expect(trip.columnOrder).toHaveLength(5);
    expect(Object.keys(ws().columns)).toHaveLength(5);

    const columns = trip.columnOrder.map((id) => ws().columns[id]);
    expect(columns.map((c) => c.name)).toEqual(['이동수단', '할일', '식사', '숙소', '볼거리']);
    expect(columns.map((c) => c.icon)).toEqual(['🚗', '📌', '🍽️', '🏨', '🎡']);
    expect(columns.map((c) => c.color)).toEqual([
      'sky',
      'violet',
      'amber',
      'rose',
      'emerald',
    ]);
    expect(columns.every((c) => c.tripId === tripId && c.cardOrder.length === 0)).toBe(true);
    expect(columns.map((c) => c.name)).toEqual(SEED_COLUMNS.map((s) => s.name));
  });

  it('marks the store dirty and honours a custom currency', () => {
    expect(store().dirty).toBe(false);
    const tripId = store().addTrip('도쿄', 'JPY');
    expect(ws().trips[tripId].currency).toBe('JPY');
    expect(store().dirty).toBe(true);
  });

  it('falls back to a default title for blank input', () => {
    const tripId = store().addTrip('   ');
    expect(ws().trips[tripId].title).toBe('새 여행');
  });
});

describe('deleteTrip', () => {
  it('cascades to columns/cards/sheets/days/entries and leaves tombstones', () => {
    const tripId = store().addTrip('제주');
    const [first] = columnIds(tripId);
    const cardId = store().addCard(tripId, first, { title: '렌터카' })!;

    // Sheets/days/entries have no UI yet — seed them through `mutate`.
    const now = Date.now();
    store().mutate((draft) => {
      draft.sheets = {
        s1: { id: 's1', tripId, name: '본편', dayOrder: ['d1'], createdAt: now, updatedAt: now },
      };
      draft.days = { d1: { id: 'd1', tripId, sheetId: 's1', createdAt: now, updatedAt: now } };
      draft.entries = {
        e1: {
          id: 'e1',
          tripId,
          cardId,
          dayId: 'd1',
          startMin: 540,
          durationMin: 60,
          createdAt: now,
          updatedAt: now,
        },
      };
    });

    // An unrelated trip must survive untouched.
    const otherId = store().addTrip('부산');

    store().deleteTrip(tripId);

    expect(ws().trips[tripId]).toBeUndefined();
    expect(Object.values(ws().columns).some((c) => c.tripId === tripId)).toBe(false);
    expect(ws().cards[cardId]).toBeUndefined();
    expect(ws().sheets.s1).toBeUndefined();
    expect(ws().days.d1).toBeUndefined();
    expect(ws().entries.e1).toBeUndefined();

    expect(ws().trips[otherId]).toBeDefined();
    expect(columnIds(otherId)).toHaveLength(5);

    const buried = ws().tombstones;
    // 1 trip + 5 columns + 1 card + 1 sheet + 1 day + 1 entry.
    expect(buried).toHaveLength(10);
    expect(buried.filter((t) => t.entity === 'column')).toHaveLength(5);
    expect(buried.find((t) => t.entity === 'trip')?.id).toBe(tripId);
    expect(buried.map((t) => t.entity).sort()).toEqual(
      ['card', 'column', 'column', 'column', 'column', 'column', 'day', 'entry', 'sheet', 'trip'],
    );
    expect(buried.every((t) => typeof t.deletedAt === 'number')).toBe(true);
  });

  it('ignores an unknown trip id', () => {
    store().deleteTrip('nope');
    expect(ws().tombstones).toHaveLength(0);
  });
});

describe('deleteColumn', () => {
  it('moves the cards to the first remaining column', () => {
    const tripId = store().addTrip('여행');
    const [first, second] = columnIds(tripId);
    const a = store().addCard(tripId, second, { title: 'A' })!;
    const b = store().addCard(tripId, second, { title: 'B' })!;
    const keeper = store().addCard(tripId, first, { title: '기존' })!;

    expect(store().deleteColumn(second)).toBe(true);

    expect(ws().columns[second]).toBeUndefined();
    expect(columnIds(tripId)).toHaveLength(4);
    expect(columnIds(tripId)).not.toContain(second);
    // Cards keep their relative order, appended after what was already there.
    expect(ws().columns[first].cardOrder).toEqual([keeper, a, b]);
    expect(ws().cards[a].columnId).toBe(first);
    expect(ws().cards[b].columnId).toBe(first);
    expect(ws().tombstones).toEqual([
      expect.objectContaining({ id: second, entity: 'column' }),
    ]);
  });

  it('refuses to delete the last column and changes nothing', () => {
    const tripId = store().addTrip('여행');
    const ids = [...columnIds(tripId)];
    for (const id of ids.slice(1)) expect(store().deleteColumn(id)).toBe(true);

    const before = ws();
    expect(store().deleteColumn(ids[0])).toBe(false);
    expect(ws()).toBe(before);
    expect(columnIds(tripId)).toEqual([ids[0]]);
  });

  it('returns false for an unknown column', () => {
    expect(store().deleteColumn('nope')).toBe(false);
  });
});

describe('deleteCard', () => {
  it('unlinks from the column and cascade-deletes timeline entries', () => {
    const tripId = store().addTrip('여행');
    const [first] = columnIds(tripId);
    const cardId = store().addCard(tripId, first, { title: 'A' })!;
    const now = Date.now();
    store().mutate((draft) => {
      draft.entries = {
        e1: {
          id: 'e1',
          tripId,
          cardId,
          dayId: 'd1',
          startMin: 0,
          durationMin: 30,
          createdAt: now,
          updatedAt: now,
        },
        e2: {
          id: 'e2',
          tripId,
          cardId: 'other',
          dayId: 'd1',
          startMin: 0,
          durationMin: 30,
          createdAt: now,
          updatedAt: now,
        },
      };
    });

    store().deleteCard(cardId);

    expect(ws().cards[cardId]).toBeUndefined();
    expect(ws().columns[first].cardOrder).toEqual([]);
    expect(ws().entries.e1).toBeUndefined();
    expect(ws().entries.e2).toBeDefined();
    expect(ws().tombstones.map((t) => t.entity).sort()).toEqual(['card', 'entry']);
  });
});

describe('moveCard', () => {
  const setup = () => {
    const tripId = store().addTrip('여행');
    const [first, second] = columnIds(tripId);
    const a = store().addCard(tripId, first, { title: 'A' })!;
    const b = store().addCard(tripId, first, { title: 'B' })!;
    const c = store().addCard(tripId, first, { title: 'C' })!;
    return { tripId, first, second, a, b, c };
  };

  it('reorders within a column (arrayMove semantics)', () => {
    const { first, a, b, c } = setup();

    store().moveCard(a, first, 2);
    expect(ws().columns[first].cardOrder).toEqual([b, c, a]);

    store().moveCard(a, first, 0);
    expect(ws().columns[first].cardOrder).toEqual([a, b, c]);
    expect(ws().cards[a].columnId).toBe(first);
  });

  it('clamps an out-of-range index', () => {
    const { first, a, b, c } = setup();
    store().moveCard(a, first, 99);
    expect(ws().columns[first].cardOrder).toEqual([b, c, a]);
    store().moveCard(a, first, -5);
    expect(ws().columns[first].cardOrder).toEqual([a, b, c]);
  });

  it('moves across columns and rewrites the card columnId', () => {
    const { tripId, first, second, a, b, c } = setup();
    const existing = store().addCard(tripId, second, { title: '기존' })!;

    store().moveCard(b, second, 0);

    expect(ws().columns[first].cardOrder).toEqual([a, c]);
    expect(ws().columns[second].cardOrder).toEqual([b, existing]);
    expect(ws().cards[b].columnId).toBe(second);
  });

  it('appends when the index is past the end of the target column', () => {
    const { second, a } = setup();
    store().moveCard(a, second, 10);
    expect(ws().columns[second].cardOrder).toEqual([a]);
  });

  it('ignores a no-op reorder and unknown ids', () => {
    const { first, a } = setup();
    const before = ws();
    store().moveCard(a, first, 0);
    expect(ws()).toBe(before);
    store().moveCard('nope', first, 0);
    expect(ws()).toBe(before);
  });
});

describe('updateCard / updateColumn / updateTrip', () => {
  it('patches fields and bumps updatedAt', async () => {
    const tripId = store().addTrip('여행');
    const [first] = columnIds(tripId);
    const cardId = store().addCard(tripId, first, { title: 'A', budget: 1000 })!;
    const createdAt = ws().cards[cardId].createdAt;

    await new Promise((resolve) => setTimeout(resolve, 2));
    store().updateCard(cardId, { title: 'A+', memo: '메모', budget: undefined });

    const card = ws().cards[cardId];
    expect(card.title).toBe('A+');
    expect(card.memo).toBe('메모');
    expect(card.budget).toBeUndefined();
    expect(card.createdAt).toBe(createdAt);
    expect(card.updatedAt).toBeGreaterThan(createdAt);

    store().updateColumn(first, { name: '탈것', color: 'teal' });
    expect(ws().columns[first]).toMatchObject({ name: '탈것', color: 'teal', icon: '🚗' });

    store().updateTrip(tripId, { title: '여행 2' });
    expect(ws().trips[tripId].title).toBe('여행 2');
  });
});

/* ------------------------------------------------------------------ *
 * 일정 (timeline) — M2a
 * ------------------------------------------------------------------ */

/** Trip + one card + one sheet with two days — the timeline fixture. */
const timelineSetup = () => {
  const tripId = store().addTrip('교토');
  const [first] = columnIds(tripId);
  const cardId = store().addCard(tripId, first, { title: '기요미즈데라' })!;
  const sheetId = store().addSheet(tripId, '본편')!;
  const dayA = store().addDay(sheetId, { date: '2026-04-01' })!;
  const dayB = store().addDay(sheetId, { label: '둘째 날' })!;
  return { tripId, cardId, sheetId, dayA, dayB };
};

describe('addSheet / updateSheet', () => {
  it('appends to the trip sheetOrder', () => {
    const tripId = store().addTrip('여행');
    expect(ws().trips[tripId].sheetOrder).toEqual([]);

    const first = store().addSheet(tripId, '본편')!;
    const second = store().addSheet(tripId, '   ')!;

    expect(ws().trips[tripId].sheetOrder).toEqual([first, second]);
    expect(ws().sheets[first]).toMatchObject({ tripId, name: '본편', dayOrder: [] });
    // Blank names fall back, like every other create in the store.
    expect(ws().sheets[second].name).toBe('새 일정');

    store().updateSheet(first, { name: '플랜 B' });
    expect(ws().sheets[first].name).toBe('플랜 B');
  });

  it('returns null for an unknown trip', () => {
    expect(store().addSheet('nope', '본편')).toBeNull();
    expect(ws().tombstones).toHaveLength(0);
  });
});

describe('deleteSheet', () => {
  it('cascades to days and entries, and unlinks from the trip', () => {
    const { tripId, cardId, sheetId, dayA, dayB } = timelineSetup();
    const entryA = store().scheduleCard(cardId, dayA, 540)!;
    const entryB = store().scheduleCard(cardId, dayB, 600)!;

    // A second sheet must survive untouched.
    const keeper = store().addSheet(tripId, '남는 시트')!;
    const keeperDay = store().addDay(keeper)!;
    const keeperEntry = store().scheduleCard(cardId, keeperDay, 660)!;

    store().deleteSheet(sheetId);

    expect(ws().sheets[sheetId]).toBeUndefined();
    expect(ws().days[dayA]).toBeUndefined();
    expect(ws().days[dayB]).toBeUndefined();
    expect(ws().entries[entryA]).toBeUndefined();
    expect(ws().entries[entryB]).toBeUndefined();
    expect(ws().trips[tripId].sheetOrder).toEqual([keeper]);

    expect(ws().sheets[keeper]).toBeDefined();
    expect(ws().days[keeperDay]).toBeDefined();
    expect(ws().entries[keeperEntry]).toBeDefined();
    // The card itself is board data and stays put.
    expect(ws().cards[cardId]).toBeDefined();

    expect(ws().tombstones.map((t) => t.entity).sort()).toEqual([
      'day',
      'day',
      'entry',
      'entry',
      'sheet',
    ]);
  });

  it('ignores an unknown sheet id', () => {
    const before = ws();
    store().deleteSheet('nope');
    expect(ws()).toBe(before);
  });
});

describe('addDay / updateDay / deleteDay', () => {
  it('appends to dayOrder and inherits the sheet tripId', () => {
    const { tripId, sheetId, dayA, dayB } = timelineSetup();
    expect(ws().sheets[sheetId].dayOrder).toEqual([dayA, dayB]);
    expect(ws().days[dayA]).toMatchObject({ tripId, sheetId, date: '2026-04-01' });
    expect(ws().days[dayB]).toMatchObject({ label: '둘째 날' });
    expect(ws().days[dayB].date).toBeUndefined();

    store().updateDay(dayB, { date: '2026-04-02', label: undefined });
    expect(ws().days[dayB].date).toBe('2026-04-02');
    expect(ws().days[dayB].label).toBeUndefined();
  });

  it('deletes its entries and unlinks from the sheet', () => {
    const { cardId, sheetId, dayA, dayB } = timelineSetup();
    const doomed = store().scheduleCard(cardId, dayA, 540)!;
    const survivor = store().scheduleCard(cardId, dayB, 540)!;

    store().deleteDay(dayA);

    expect(ws().days[dayA]).toBeUndefined();
    expect(ws().entries[doomed]).toBeUndefined();
    expect(ws().entries[survivor]).toBeDefined();
    expect(ws().sheets[sheetId].dayOrder).toEqual([dayB]);
    expect(ws().tombstones.map((t) => t.entity).sort()).toEqual(['day', 'entry']);
  });

  it('returns null / no-ops for unknown ids', () => {
    expect(store().addDay('nope')).toBeNull();
    const before = ws();
    store().deleteDay('nope');
    expect(ws()).toBe(before);
  });
});

describe('scheduleCard', () => {
  it('defaults the duration to the card, then to 60 minutes', () => {
    const { tripId, cardId, dayA } = timelineSetup();
    const plain = store().scheduleCard(cardId, dayA, 540)!;
    expect(ws().entries[plain]).toMatchObject({
      tripId,
      cardId,
      dayId: dayA,
      startMin: 540,
      durationMin: 60,
    });

    store().updateCard(cardId, { defaultDurationMin: 90 });
    const fromCard = store().scheduleCard(cardId, dayA, 600)!;
    expect(ws().entries[fromCard].durationMin).toBe(90);

    const explicit = store().scheduleCard(cardId, dayA, 600, 45)!;
    expect(ws().entries[explicit].durationMin).toBe(45);
  });

  it('snaps the start to the 15-minute grid', () => {
    const { cardId, dayA } = timelineSetup();
    const id = store().scheduleCard(cardId, dayA, 607)!;
    expect(ws().entries[id].startMin).toBe(600);
    const later = store().scheduleCard(cardId, dayA, 613)!;
    expect(ws().entries[later].startMin).toBe(615);
  });

  it('keeps the entry inside the day', () => {
    const { cardId, dayA } = timelineSetup();
    const early = store().scheduleCard(cardId, dayA, -120)!;
    expect(ws().entries[early].startMin).toBe(0);

    // 23:30 + 60 would spill past midnight, so the duration shrinks.
    const late = store().scheduleCard(cardId, dayA, 1410)!;
    expect(ws().entries[late]).toMatchObject({ startMin: 1410, durationMin: 30 });

    const past = store().scheduleCard(cardId, dayA, 3000)!;
    expect(ws().entries[past]).toMatchObject({ startMin: 1425, durationMin: 15 });
  });

  it('refuses unknown ids and cross-trip drops', () => {
    const { cardId, dayA } = timelineSetup();
    const otherTrip = store().addTrip('부산');
    const otherSheet = store().addSheet(otherTrip, '본편')!;
    const otherDay = store().addDay(otherSheet)!;

    expect(store().scheduleCard('nope', dayA, 540)).toBeNull();
    expect(store().scheduleCard(cardId, 'nope', 540)).toBeNull();
    expect(store().scheduleCard(cardId, otherDay, 540)).toBeNull();
    expect(Object.keys(ws().entries)).toHaveLength(0);
  });
});

describe('moveEntry', () => {
  it('moves an entry to another day, snapping the start', () => {
    const { cardId, dayA, dayB } = timelineSetup();
    const entryId = store().scheduleCard(cardId, dayA, 540, 90)!;

    store().moveEntry(entryId, dayB, 622);

    expect(ws().entries[entryId]).toMatchObject({
      dayId: dayB,
      startMin: 615,
      durationMin: 90,
    });
  });

  it('shortens rather than overflows at the end of the day', () => {
    const { cardId, dayA } = timelineSetup();
    const entryId = store().scheduleCard(cardId, dayA, 540, 120)!;
    store().moveEntry(entryId, dayA, 1400);
    expect(ws().entries[entryId]).toMatchObject({ startMin: 1395, durationMin: 45 });
  });

  it('ignores a no-op move and unknown / cross-trip targets', () => {
    const { cardId, dayA } = timelineSetup();
    const entryId = store().scheduleCard(cardId, dayA, 540, 60)!;

    const before = ws();
    store().moveEntry(entryId, dayA, 542); // snaps back onto 540
    expect(ws()).toBe(before);
    store().moveEntry('nope', dayA, 600);
    expect(ws()).toBe(before);
    store().moveEntry(entryId, 'nope', 600);
    expect(ws()).toBe(before);
  });
});

describe('resizeEntry / updateEntry / deleteEntry', () => {
  it('clamps the length between 15 minutes and midnight', () => {
    const { cardId, dayA } = timelineSetup();
    const entryId = store().scheduleCard(cardId, dayA, 1380, 30)!;

    store().resizeEntry(entryId, 5);
    expect(ws().entries[entryId].durationMin).toBe(15);

    store().resizeEntry(entryId, 999);
    expect(ws().entries[entryId].durationMin).toBe(60); // 23:00 → 24:00

    const before = ws();
    store().resizeEntry(entryId, 60);
    expect(ws()).toBe(before);
  });

  it('patches the note and buries a deleted entry', () => {
    const { cardId, dayA } = timelineSetup();
    const entryId = store().scheduleCard(cardId, dayA, 540)!;

    store().updateEntry(entryId, { note: '표 미리 예매' });
    expect(ws().entries[entryId].note).toBe('표 미리 예매');

    store().deleteEntry(entryId);
    expect(ws().entries[entryId]).toBeUndefined();
    expect(ws().tombstones).toEqual([expect.objectContaining({ id: entryId, entity: 'entry' })]);

    const before = ws();
    store().deleteEntry(entryId);
    expect(ws()).toBe(before);
  });
});

describe('addColumn / addCard guards', () => {
  it('appends a column to columnOrder', () => {
    const tripId = store().addTrip('여행');
    const id = store().addColumn(tripId, '쇼핑', 'orange', '🛍️')!;
    expect(columnIds(tripId)).toHaveLength(6);
    expect(columnIds(tripId)[5]).toBe(id);
    expect(ws().columns[id]).toMatchObject({ name: '쇼핑', color: 'orange', icon: '🛍️' });
  });

  it('returns null for an unknown trip or a mismatched column', () => {
    const tripId = store().addTrip('여행');
    const [first] = columnIds(tripId);
    expect(store().addColumn('nope', 'x', 'sky', '📌')).toBeNull();
    expect(store().addCard('nope', first, { title: 'A' })).toBeNull();
    expect(store().addCard(tripId, 'nope', { title: 'A' })).toBeNull();
  });
});
