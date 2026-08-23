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

/* ------------------------------------------------------------------ *
 * 시트 마법사 (M2b)
 * ------------------------------------------------------------------ */

const OUTBOUND = {
  date: '2026-05-03',
  depTime: '10:00',
  arrTime: '12:30',
  from: 'ICN',
  to: 'KIX',
  flightNo: 'OZ112',
};
const INBOUND = { date: '2026-05-07', depTime: '18:00', arrTime: '20:30' };

/** The sheet's days, in `dayOrder`. */
const daysOf = (sheetId: Id) => ws().sheets[sheetId].dayOrder.map((id) => ws().days[id]);
/** Every entry sitting on `sheetId`, earliest first. */
const entriesOf = (sheetId: Id) =>
  Object.values(ws().entries)
    .filter((entry) => ws().days[entry.dayId]?.sheetId === sheetId)
    .sort((a, b) => a.startMin - b.startMin);
/** Cards of the trip's 이동수단 column. */
const flightCards = (tripId: Id) => {
  const column = ws().trips[tripId].columnOrder
    .map((id) => ws().columns[id])
    .find((c) => c.name === '이동수단')!;
  return column.cardOrder.map((id) => ws().cards[id]);
};

describe('createSheetFromFlights', () => {
  it('spans outbound departure → inbound arrival and labels every day', () => {
    const tripId = store().addTrip('오사카');
    const { sheetId } = store().createSheetFromFlights(tripId, '본 일정', {
      outbound: OUTBOUND,
      inbound: INBOUND,
    })!;

    expect(ws().trips[tripId].sheetOrder).toEqual([sheetId]);
    expect(ws().sheets[sheetId]).toMatchObject({
      name: '본 일정',
      outboundFlight: OUTBOUND,
      inboundFlight: INBOUND,
    });

    const days = daysOf(sheetId);
    expect(days.map((day) => day.date)).toEqual([
      '2026-05-03',
      '2026-05-04',
      '2026-05-05',
      '2026-05-06',
      '2026-05-07',
    ]);
    expect(days.map((day) => day.label)).toEqual([
      '1일차',
      '2일차',
      '3일차',
      '4일차',
      '5일차',
    ]);
    expect(days.every((day) => day.tripId === tripId && day.sheetId === sheetId)).toBe(true);
  });

  it('counts the extra day of an overnight return leg', () => {
    const tripId = store().addTrip('하와이');
    const { sheetId } = store().createSheetFromFlights(tripId, '본 일정', {
      outbound: OUTBOUND,
      inbound: { ...INBOUND, depTime: '23:30', arrTime: '05:10', arrNextDay: true },
    })!;

    const days = daysOf(sheetId);
    expect(days).toHaveLength(6);
    expect(days.at(-1)?.date).toBe('2026-05-08');
  });

  it('creates one ✈️ card + entry per leg, at the right day and time', () => {
    const tripId = store().addTrip('오사카');
    const { sheetId } = store().createSheetFromFlights(tripId, '본 일정', {
      outbound: OUTBOUND,
      inbound: INBOUND,
    })!;

    const cards = flightCards(tripId);
    expect(cards.map((card) => card.title)).toEqual(['✈️ ICN→KIX OZ112', '✈️ 귀국편']);
    expect(cards.map((card) => card.defaultDurationMin)).toEqual([150, 150]);

    const days = daysOf(sheetId);
    const entries = entriesOf(sheetId);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      dayId: days[0].id,
      startMin: 600, // 10:00
      durationMin: 150,
      cardId: cards[0].id,
    });
    expect(entries[1]).toMatchObject({
      dayId: days[4].id,
      startMin: 1080, // 18:00
      durationMin: 150,
      cardId: cards[1].id,
    });
  });

  it('clamps a red-eye inside its own day rather than spilling over', () => {
    const tripId = store().addTrip('밤비행기');
    const { sheetId } = store().createSheetFromFlights(tripId, '본 일정', {
      outbound: { date: '2026-05-03', depTime: '23:30', arrTime: '05:10', arrNextDay: true },
      inbound: INBOUND,
    })!;

    const firstDayId = daysOf(sheetId)[0].id;
    const entry = entriesOf(sheetId).find((item) => item.dayId === firstDayId)!;
    expect(entry.startMin).toBe(1410);
    expect(entry.durationMin).toBe(30); // 23:30 → 24:00, per clampEntry
  });

  it('creates dateless days from dayCount alone, with no flight cards', () => {
    const tripId = store().addTrip('미정 여행');
    const { sheetId } = store().createSheetFromFlights(tripId, '초안', { dayCount: 3 })!;

    const days = daysOf(sheetId);
    expect(days).toHaveLength(3);
    expect(days.every((day) => day.date === undefined)).toBe(true);
    expect(days.map((day) => day.label)).toEqual(['1일차', '2일차', '3일차']);
    expect(entriesOf(sheetId)).toHaveLength(0);
    expect(flightCards(tripId)).toHaveLength(0);
    expect(ws().sheets[sheetId].outboundFlight).toBeUndefined();
  });

  it('files the flight cards in the first column when 이동수단 is gone', () => {
    const tripId = store().addTrip('오사카');
    const [movement] = columnIds(tripId);
    store().deleteColumn(movement);

    const { sheetId } = store().createSheetFromFlights(tripId, '본 일정', {
      outbound: OUTBOUND,
    })!;

    const firstColumnId = columnIds(tripId)[0];
    expect(ws().columns[firstColumnId].cardOrder).toHaveLength(1);
    expect(entriesOf(sheetId)).toHaveLength(1);
  });

  it('returns null for an unknown trip', () => {
    const before = ws();
    expect(store().createSheetFromFlights('nope', '본 일정', { dayCount: 2 })).toBeNull();
    expect(ws()).toBe(before);
  });
});

describe('updateSheetFlights', () => {
  /** A 5-day flight sheet with one hand-placed card on day 2. */
  const flightSheetSetup = () => {
    const tripId = store().addTrip('오사카');
    const [, todo] = columnIds(tripId);
    const cardId = store().addCard(tripId, todo, { title: '유니버설' })!;
    const { sheetId } = store().createSheetFromFlights(tripId, '본 일정', {
      outbound: OUTBOUND,
      inbound: INBOUND,
    })!;
    const days = daysOf(sheetId);
    const entryId = store().scheduleCard(cardId, days[1].id, 600)!;
    return { tripId, cardId, sheetId, entryId, dayIds: days.map((day) => day.id) };
  };

  it('shifts every day by the delta and keeps their entries', () => {
    const { sheetId, entryId, dayIds } = flightSheetSetup();

    store().updateSheetFlights(sheetId, {
      outbound: { ...OUTBOUND, date: '2026-05-04' },
      inbound: { ...INBOUND, date: '2026-05-08' },
    });

    const days = daysOf(sheetId);
    // Same day rows, one calendar day later.
    expect(days.map((day) => day.id)).toEqual(dayIds);
    expect(days.map((day) => day.date)).toEqual([
      '2026-05-04',
      '2026-05-05',
      '2026-05-06',
      '2026-05-07',
      '2026-05-08',
    ]);
    expect(ws().entries[entryId]).toMatchObject({ dayId: dayIds[1], startMin: 600 });
    expect(ws().sheets[sheetId].outboundFlight?.date).toBe('2026-05-04');
  });

  it('drops the days that fall outside a shorter range, tombstoning their entries', () => {
    const { cardId, sheetId, dayIds } = flightSheetSetup();
    // A second hand-placed entry, on the day that is about to disappear.
    const doomed = store().scheduleCard(cardId, dayIds[4], 540)!;

    store().updateSheetFlights(sheetId, {
      outbound: OUTBOUND,
      inbound: { ...INBOUND, date: '2026-05-05' },
    });

    const days = daysOf(sheetId);
    expect(days.map((day) => day.id)).toEqual(dayIds.slice(0, 3));
    expect(ws().days[dayIds[3]]).toBeUndefined();
    expect(ws().days[dayIds[4]]).toBeUndefined();
    expect(ws().entries[doomed]).toBeUndefined();
    expect(ws().tombstones).toContainEqual(
      expect.objectContaining({ id: doomed, entity: 'entry' }),
    );
    // The card itself survives and is 미배치 again.
    expect(ws().cards[cardId]).toBeDefined();
    // The return leg now lands on the new last day.
    const flight = entriesOf(sheetId).at(-1)!;
    expect(flight.dayId).toBe(days.at(-1)!.id);
    expect(flight.startMin).toBe(1080);
    expect(ws().cards[flight.cardId].title).toBe('✈️ 귀국편');
  });

  it('appends days when the range grows', () => {
    const { sheetId, dayIds } = flightSheetSetup();

    store().updateSheetFlights(sheetId, {
      outbound: OUTBOUND,
      inbound: { ...INBOUND, date: '2026-05-09' },
    });

    const days = daysOf(sheetId);
    expect(days).toHaveLength(7);
    expect(days.slice(0, 5).map((day) => day.id)).toEqual(dayIds);
    expect(days.map((day) => day.date).slice(5)).toEqual(['2026-05-08', '2026-05-09']);
    expect(days.at(-1)?.label).toBe('7일차');
  });

  it('recreates the flight cards instead of leaving stale ones behind', () => {
    const { tripId, sheetId } = flightSheetSetup();
    expect(flightCards(tripId)).toHaveLength(2);

    store().updateSheetFlights(sheetId, {
      outbound: { ...OUTBOUND, flightNo: 'KE723' },
      inbound: INBOUND,
    });

    const cards = flightCards(tripId);
    expect(cards).toHaveLength(2);
    expect(cards[0].title).toBe('✈️ ICN→KIX KE723');
    expect(entriesOf(sheetId).filter((entry) => ws().cards[entry.cardId].title.startsWith('✈️')))
      .toHaveLength(2);
  });

  it('clears the flights, and their cards, when neither leg is given', () => {
    const { tripId, sheetId, entryId, dayIds } = flightSheetSetup();

    store().updateSheetFlights(sheetId, {});

    expect(ws().sheets[sheetId].outboundFlight).toBeUndefined();
    expect(ws().sheets[sheetId].inboundFlight).toBeUndefined();
    expect(flightCards(tripId)).toHaveLength(0);
    // The days — and the user's own entry — are left exactly as they were.
    expect(daysOf(sheetId).map((day) => day.id)).toEqual(dayIds);
    expect(ws().entries[entryId]).toBeDefined();
  });

  it('ignores an unknown sheet id', () => {
    const before = ws();
    store().updateSheetFlights('nope', { outbound: OUTBOUND });
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

describe('addExpense / removeExpense (M6)', () => {
  /** A trip with one card, ready to spend money on. */
  const cardSetup = (): Id => {
    const tripId = store().addTrip('오사카');
    return store().addCard(tripId, columnIds(tripId)[4], { title: '츠텐카쿠', budget: 10_000 })!;
  };

  it('appends expenses oldest first and stamps them', () => {
    const cardId = cardSetup();
    const first = store().addExpense(cardId, 12_000, '점심')!;
    const second = store().addExpense(cardId, 3_000)!;

    const expenses = ws().cards[cardId].expenses!;
    expect(expenses.map((item) => item.id)).toEqual([first, second]);
    expect(expenses[0]).toMatchObject({ amount: 12_000, label: '점심' });
    // A blank label is dropped rather than stored as ''.
    expect(expenses[1].label).toBeUndefined();
    expect(expenses[0].at).toBeGreaterThan(0);
    // The card is what changed, so the card's own stamp moves.
    expect(ws().cards[cardId].updatedAt).toBeGreaterThanOrEqual(expenses[1].at);
    expect(store().dirty).toBe(true);
  });

  it('leaves the rest of the card alone', () => {
    const cardId = cardSetup();
    store().addExpense(cardId, 500, '  ');
    expect(ws().cards[cardId]).toMatchObject({ title: '츠텐카쿠', budget: 10_000 });
    expect(ws().cards[cardId].expenses![0].label).toBeUndefined();
  });

  it('returns null for an unknown card or a non-finite amount', () => {
    const cardId = cardSetup();
    expect(store().addExpense('nope', 1_000)).toBeNull();
    expect(store().addExpense(cardId, Number.NaN)).toBeNull();
    expect(store().addExpense(cardId, Number.POSITIVE_INFINITY)).toBeNull();
    expect(ws().cards[cardId].expenses).toBeUndefined();
  });

  it('removes one expense and clears the field once the list empties', () => {
    const cardId = cardSetup();
    const first = store().addExpense(cardId, 12_000, '점심')!;
    const second = store().addExpense(cardId, 3_000)!;

    store().removeExpense(cardId, first);
    expect(ws().cards[cardId].expenses!.map((item) => item.id)).toEqual([second]);

    store().removeExpense(cardId, second);
    // Back to exactly the shape a pre-M6 card has.
    expect(ws().cards[cardId].expenses).toBeUndefined();
  });

  it('is a no-op for an unknown card or expense', () => {
    const cardId = cardSetup();
    store().addExpense(cardId, 100);
    const before = ws();
    store().removeExpense(cardId, 'nope');
    store().removeExpense('nope', 'nope');
    expect(ws()).toBe(before);
  });
});

describe('addComment / removeComment (M6)', () => {
  const cardSetup = (): Id => {
    const tripId = store().addTrip('오사카');
    return store().addCard(tripId, columnIds(tripId)[4], { title: '츠텐카쿠' })!;
  };

  it('appends comments oldest first, trimmed', () => {
    const cardId = cardSetup();
    const first = store().addComment(cardId, '  줄 서야 함  ')!;
    const second = store().addComment(cardId, '야경이 좋아요')!;

    const comments = ws().cards[cardId].comments!;
    expect(comments.map((item) => item.id)).toEqual([first, second]);
    expect(comments[0].text).toBe('줄 서야 함');
    expect(comments[1].at).toBeGreaterThan(0);
  });

  it('refuses blank text and unknown cards', () => {
    const cardId = cardSetup();
    expect(store().addComment(cardId, '   ')).toBeNull();
    expect(store().addComment('nope', '있음')).toBeNull();
    expect(ws().cards[cardId].comments).toBeUndefined();
  });

  it('removes one comment and clears the field once the thread empties', () => {
    const cardId = cardSetup();
    const first = store().addComment(cardId, '하나')!;
    const second = store().addComment(cardId, '둘')!;

    store().removeComment(cardId, first);
    expect(ws().cards[cardId].comments!.map((item) => item.text)).toEqual(['둘']);

    store().removeComment(cardId, second);
    expect(ws().cards[cardId].comments).toBeUndefined();

    const before = ws();
    store().removeComment(cardId, 'nope');
    expect(ws()).toBe(before);
  });

  it('keeps 지출 and 코멘트 apart on the same card', () => {
    const cardId = cardSetup();
    store().addExpense(cardId, 1_500, '입장료');
    store().addComment(cardId, '현금만 받아요');

    expect(ws().cards[cardId].expenses).toHaveLength(1);
    expect(ws().cards[cardId].comments).toHaveLength(1);
  });

  it('cascade-deletes with the card, ledger and all', () => {
    const cardId = cardSetup();
    store().addExpense(cardId, 1_500);
    store().addComment(cardId, '메모');

    store().deleteCard(cardId);
    expect(ws().cards[cardId]).toBeUndefined();
  });
});
