import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyWorkspace, type Id } from '../types/models';
import { useProfileStore } from '../profile/profile';
import { MAX_PHOTOS_PER_CARD, SEED_COLUMNS, useWorkspaceStore } from './workspaceStore';

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

  it('seeds 할일 as a checklist category and nothing else (M29)', () => {
    const tripId = store().addTrip('오사카');
    const columns = ws().trips[tripId].columnOrder.map((id) => ws().columns[id]);

    expect(columns.map((c) => c.todo)).toEqual([undefined, true, undefined, undefined, undefined]);
    // A plain column carries **no** key — the shape every pre-M29 device reads.
    expect(columns.filter((c) => 'todo' in c).map((c) => c.name)).toEqual(['할일']);
    expect(SEED_COLUMNS.filter((s) => s.todo).map((s) => s.name)).toEqual(['할일']);
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

describe('setColumnTodo', () => {
  it('turns a plain column into a checklist one', () => {
    const tripId = store().addTrip('여행');
    const [movement] = columnIds(tripId);
    expect(ws().columns[movement].todo).toBeUndefined();

    store().setColumnTodo(movement, true);
    expect(ws().columns[movement].todo).toBe(true);
    expect(ws().columns[movement].updatedAt).toBeGreaterThan(0);
  });

  it('writes an explicit false when turned off, rather than dropping the flag', () => {
    const tripId = store().addTrip('여행');
    const [, todo] = columnIds(tripId);
    expect(ws().columns[todo].todo).toBe(true);

    store().setColumnTodo(todo, false);
    expect(ws().columns[todo].todo).toBe(false);
    expect('todo' in ws().columns[todo]).toBe(true);
  });

  it('changes nothing when the value already matches', () => {
    const tripId = store().addTrip('여행');
    const [, todo] = columnIds(tripId);
    const before = ws();
    store().setColumnTodo(todo, true);
    expect(ws()).toBe(before);
  });

  it('ignores an unknown column', () => {
    const before = ws();
    store().setColumnTodo('nope', true);
    expect(ws()).toBe(before);
  });
});

describe('toggleCardDone', () => {
  it('stamps doneAt on the way in', () => {
    const tripId = store().addTrip('여행');
    const [, todo] = columnIds(tripId);
    const cardId = store().addCard(tripId, todo, { title: '환전' })!;
    expect(ws().cards[cardId].doneAt).toBeUndefined();

    store().toggleCardDone(cardId);
    const done = ws().cards[cardId];
    expect(typeof done.doneAt).toBe('number');
    expect(done.doneAt).toBeGreaterThan(0);
    expect(done.updatedAt).toBe(done.doneAt);
  });

  it('removes the field entirely on the way out', () => {
    const tripId = store().addTrip('여행');
    const [, todo] = columnIds(tripId);
    const cardId = store().addCard(tripId, todo, { title: '유심' })!;

    store().toggleCardDone(cardId);
    store().toggleCardDone(cardId);

    const card = ws().cards[cardId];
    // Not `undefined` — the key itself must be gone, so what syncs is exactly
    // the shape a pre-M29 card has.
    expect('doneAt' in card).toBe(false);
    expect(JSON.parse(JSON.stringify(card))).not.toHaveProperty('doneAt');
  });

  it('keeps the rest of the card intact across a round trip', () => {
    const tripId = store().addTrip('여행');
    const [, todo] = columnIds(tripId);
    const cardId = store().addCard(tripId, todo, {
      title: '예약하기',
      memo: '9시 전에',
      budget: 30000,
    })!;
    store().addComment(cardId, '링크 확인');

    store().toggleCardDone(cardId);
    store().toggleCardDone(cardId);

    const card = ws().cards[cardId];
    expect(card.title).toBe('예약하기');
    expect(card.memo).toBe('9시 전에');
    expect(card.budget).toBe(30000);
    expect(card.comments).toHaveLength(1);
    expect(card.columnId).toBe(todo);
  });

  it('does not care whether the column is a checklist', () => {
    const tripId = store().addTrip('여행');
    const [movement] = columnIds(tripId);
    const cardId = store().addCard(tripId, movement, { title: '렌터카' })!;

    store().toggleCardDone(cardId);
    expect(ws().cards[cardId].doneAt).toBeGreaterThan(0);
  });

  it('ignores an unknown card', () => {
    const before = ws();
    store().toggleCardDone('nope');
    expect(ws()).toBe(before);
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

  it('sets and clears a trip 목적지 (M12)', () => {
    const tripId = store().addTrip('오사카');
    expect(ws().trips[tripId].destination).toBeUndefined();

    store().updateTrip(tripId, {
      destination: { lat: 34.69, lng: 135.5, address: '오사카시, 오사카부, 일본' },
    });
    expect(ws().trips[tripId].destination).toEqual({
      lat: 34.69,
      lng: 135.5,
      address: '오사카시, 오사카부, 일본',
    });

    // A destination is not part of the trip's identity — renaming keeps it.
    store().updateTrip(tripId, { title: '오사카 3박' });
    expect(ws().trips[tripId].destination?.lat).toBe(34.69);

    store().updateTrip(tripId, { destination: undefined });
    expect(ws().trips[tripId].destination).toBeUndefined();
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
/** One card's entries inside a sheet, in the sheet's own day order. */
const piecesOf = (sheetId: Id, cardId: Id) => {
  const order = new Map(ws().sheets[sheetId].dayOrder.map((dayId, index) => [dayId, index]));
  return entriesOf(sheetId)
    .filter((entry) => entry.cardId === cardId)
    .sort((a, b) => (order.get(a.dayId) ?? 0) - (order.get(b.dayId) ?? 0));
};
/** Cards of the trip's 이동수단 column. */
const flightCards = (tripId: Id) => {
  const column = ws().trips[tripId].columnOrder
    .map((id) => ws().columns[id])
    .find((c) => c.name === '이동수단')!;
  return column.cardOrder.map((id) => ws().cards[id]);
};

describe('createSheetFromFlights', () => {
  it('spans outbound departure → inbound arrival and stores no positional label', () => {
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
    // `N일차` is a position, not a fact about the day — the header derives it
    // so an insert/delete can never leave `2일차 · 3일차 · 3일차` behind (B12).
    expect(days.map((day) => day.label)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
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

  it('splits a 심야 출발편 across the two days it actually touches', () => {
    const tripId = store().addTrip('밤비행기');
    const { sheetId } = store().createSheetFromFlights(tripId, '본 일정', {
      outbound: { date: '2026-05-03', depTime: '23:40', arrTime: '06:20', arrNextDay: true },
      inbound: INBOUND,
    })!;

    const days = daysOf(sheetId);
    const [outboundCard] = flightCards(tripId);
    const pieces = piecesOf(sheetId, outboundCard.id);

    // Two entries, one card: the tail of 5/3 and the head of 5/4 (B10).
    expect(pieces).toHaveLength(2);
    expect(pieces[0]).toMatchObject({ dayId: days[0].id, startMin: 1425, durationMin: 15 });
    expect(pieces[1]).toMatchObject({ dayId: days[1].id, startMin: 0, durationMin: 375 });
    // The card still states the whole 6시간 40분 flight.
    expect(outboundCard.defaultDurationMin).toBe(400);
  });

  it('splits a 심야 귀국편 onto the extra arrival day it created', () => {
    const tripId = store().addTrip('밤귀국');
    const { sheetId } = store().createSheetFromFlights(tripId, '본 일정', {
      outbound: OUTBOUND,
      inbound: { ...INBOUND, depTime: '23:30', arrTime: '05:10', arrNextDay: true },
    })!;

    const days = daysOf(sheetId);
    expect(days).toHaveLength(6); // 5/3 … 5/8
    const inboundCard = flightCards(tripId).at(-1)!;
    const pieces = piecesOf(sheetId, inboundCard.id);

    expect(pieces).toHaveLength(2);
    expect(pieces[0]).toMatchObject({ dayId: days[4].id, startMin: 1410, durationMin: 30 });
    expect(pieces[1]).toMatchObject({ dayId: days[5].id, startMin: 0, durationMin: 315 });
  });

  it('leaves a same-day leg as the single entry it always was', () => {
    const tripId = store().addTrip('낮비행기');
    const { sheetId } = store().createSheetFromFlights(tripId, '본 일정', {
      outbound: OUTBOUND,
      inbound: INBOUND,
    })!;

    const days = daysOf(sheetId);
    const [outboundCard] = flightCards(tripId);
    expect(entriesOf(sheetId)).toHaveLength(2);
    expect(piecesOf(sheetId, outboundCard.id)).toEqual([
      expect.objectContaining({ dayId: days[0].id, startMin: 600, durationMin: 150 }),
    ]);
  });

  it('creates dateless days from dayCount alone, with no flight cards', () => {
    const tripId = store().addTrip('미정 여행');
    const { sheetId } = store().createSheetFromFlights(tripId, '초안', { dayCount: 3 })!;

    const days = daysOf(sheetId);
    expect(days).toHaveLength(3);
    expect(days.every((day) => day.date === undefined)).toBe(true);
    expect(days.every((day) => day.label === undefined)).toBe(true);
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
    expect(days.at(-1)?.label).toBeUndefined();
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

  it('re-lays both halves of a 심야 leg without leaving a stray entry', () => {
    const { tripId, sheetId } = flightSheetSetup();

    store().updateSheetFlights(sheetId, {
      outbound: { ...OUTBOUND, depTime: '23:40', arrTime: '06:20', arrNextDay: true },
      inbound: INBOUND,
    });

    // Two cards, three flight entries: the split outbound plus the day-time
    // return. The delete-and-recreate path clears by card, so both halves go.
    const cards = flightCards(tripId);
    expect(cards).toHaveLength(2);
    expect(piecesOf(sheetId, cards[0].id)).toHaveLength(2);
    expect(piecesOf(sheetId, cards[1].id)).toHaveLength(1);

    store().updateSheetFlights(sheetId, { outbound: OUTBOUND, inbound: INBOUND });
    expect(flightCards(tripId)).toHaveLength(2);
    expect(
      entriesOf(sheetId).filter((entry) => ws().cards[entry.cardId].title.startsWith('✈️')),
    ).toHaveLength(2);
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

/* ------------------------------------------------------------------ *
 * 시트 복제 (M40)
 * ------------------------------------------------------------------ */

describe('duplicateSheet', () => {
  it('deep-copies days, entries and notes into a sibling sheet', () => {
    const { tripId, cardId, sheetId, dayA, dayB } = timelineSetup();
    const entryA = store().scheduleCard(cardId, dayA, 540, 90)!;
    const entryB = store().scheduleCard(cardId, dayB, 600)!;
    store().updateEntryNote(entryA, '예약 확인함');

    const copyId = store().duplicateSheet(sheetId)!;
    expect(copyId).not.toBe(sheetId);

    const copy = ws().sheets[copyId];
    expect(copy.tripId).toBe(tripId);
    expect(copy.name).toBe('본편 (복사)');
    expect(ws().trips[tripId].sheetOrder).toEqual([sheetId, copyId]);

    // 일자: 새 id, 같은 날짜·라벨, 같은 순서.
    expect(copy.dayOrder).toHaveLength(2);
    expect(copy.dayOrder).not.toContain(dayA);
    expect(copy.dayOrder).not.toContain(dayB);
    expect(daysOf(copyId).map((day) => day.date)).toEqual(['2026-04-01', undefined]);
    expect(daysOf(copyId).map((day) => day.label)).toEqual([undefined, '둘째 날']);
    expect(daysOf(copyId).every((day) => day.sheetId === copyId && day.tripId === tripId)).toBe(
      true,
    );

    // 배치: 새 id, 새 dayId, 같은 카드·시각·길이·메모.
    const copied = entriesOf(copyId);
    expect(copied).toHaveLength(2);
    expect(copied.map((entry) => entry.cardId)).toEqual([cardId, cardId]);
    expect(copied.map((entry) => entry.startMin)).toEqual([540, 600]);
    expect(copied.map((entry) => entry.durationMin)).toEqual([90, 60]);
    expect(copied[0].note).toBe('예약 확인함');
    // 메모가 없던 배치는 사본에서도 키가 없다.
    expect('note' in copied[1]).toBe(false);
    expect(copied.map((entry) => entry.id)).not.toContain(entryA);
    expect(copied.map((entry) => entry.id)).not.toContain(entryB);

    // 원본은 그대로. 카드/칸은 애초에 복사 대상이 아니다.
    expect(entriesOf(sheetId)).toHaveLength(2);
    expect(Object.keys(ws().cards)).toHaveLength(1);
    expect(ws().trips[tripId].columnOrder).toHaveLength(5);
    // 복제는 아무것도 지우지 않는다.
    expect(ws().tombstones).toHaveLength(0);
  });

  it('leaves the original alone when the copy is edited or deleted', () => {
    const { cardId, sheetId, dayA } = timelineSetup();
    const original = store().scheduleCard(cardId, dayA, 540)!;
    store().updateEntryNote(original, '원본 메모');

    const copyId = store().duplicateSheet(sheetId)!;
    const [copied] = entriesOf(copyId);

    store().moveEntry(copied.id, copied.dayId, 780);
    store().resizeEntry(copied.id, 30);
    store().updateEntryNote(copied.id, '사본 메모');

    expect(ws().entries[original]).toMatchObject({
      startMin: 540,
      durationMin: 60,
      note: '원본 메모',
    });

    // 사본을 통째로 지워도 원본의 일자·배치는 남는다.
    store().deleteSheet(copyId);
    expect(ws().sheets[copyId]).toBeUndefined();
    expect(ws().days[dayA]).toBeDefined();
    expect(ws().entries[original]).toBeDefined();
    expect(ws().cards[cardId]).toBeDefined();
  });

  it('copies the flights and points the ✈️ placements at the same cards', () => {
    const tripId = store().addTrip('오사카');
    const { sheetId } = store().createSheetFromFlights(tripId, '본 일정', {
      outbound: OUTBOUND,
      inbound: INBOUND,
    })!;
    expect(flightCards(tripId)).toHaveLength(2);

    const copyId = store().duplicateSheet(sheetId)!;
    const copy = ws().sheets[copyId];

    expect(copy.outboundFlight).toEqual(OUTBOUND);
    expect(copy.inboundFlight).toEqual(INBOUND);
    // 다리 객체는 따로 산다 — 한쪽 시트의 항공편이 다른 쪽을 흔들지 않는다.
    expect(copy.outboundFlight).not.toBe(ws().sheets[sheetId].outboundFlight);
    expect(daysOf(copyId)).toHaveLength(5);

    // 카드는 여행 것이라 그대로 둘이다. 사본의 배치는 그 같은 카드를 가리킨다.
    expect(flightCards(tripId)).toHaveLength(2);
    const originalCards = entriesOf(sheetId).map((entry) => entry.cardId);
    expect(entriesOf(copyId).map((entry) => entry.cardId)).toEqual(originalCards);

    // 그리고 그 공유가 항공편 수정을 망가뜨리지 않는다: 사본을 다시 계획해도
    // 원본의 카드와 배치는 살아남는다 (`clearFlightPlacements`는 어디에도 배치가
    // 남지 않은 카드만 지운다).
    store().updateSheetFlights(copyId, { outbound: { ...OUTBOUND, date: '2026-06-01' } });
    expect(entriesOf(sheetId)).toHaveLength(2);
    expect(entriesOf(sheetId).map((entry) => ws().cards[entry.cardId])).not.toContain(undefined);
  });

  it('numbers repeated copies instead of colliding', () => {
    const { sheetId } = timelineSetup();
    const first = store().duplicateSheet(sheetId)!;
    const second = store().duplicateSheet(sheetId)!;
    const third = store().duplicateSheet(first)!;

    expect(ws().sheets[first].name).toBe('본편 (복사)');
    expect(ws().sheets[second].name).toBe('본편 (복사 2)');
    // 사본의 사본도 꼬리를 겹치지 않는다.
    expect(ws().sheets[third].name).toBe('본편 (복사 3)');
  });

  it('copies an empty sheet as an empty sheet', () => {
    const tripId = store().addTrip('여행');
    const sheetId = store().addSheet(tripId, '빈 시트')!;
    const copyId = store().duplicateSheet(sheetId)!;

    expect(ws().sheets[copyId].dayOrder).toEqual([]);
    expect(ws().sheets[copyId].name).toBe('빈 시트 (복사)');
    expect(Object.keys(ws().days)).toHaveLength(0);
  });

  it('returns null for an unknown sheet id and changes nothing', () => {
    const before = ws();
    expect(store().duplicateSheet('nope')).toBeNull();
    expect(ws()).toBe(before);
  });

  /* --- M41 — 사본의 지도 엔진 ---------------------------------------- */

  it('인자를 안 주면 원본의 지도 엔진을 그대로 따라간다', () => {
    const tripId = store().addTrip('여행');
    const osmId = store().addSheet(tripId, 'OSM 시트')!;
    const googleId = store().addSheet(tripId, '구글 시트')!;
    store().updateSheet(googleId, { mapEngine: 'google' });

    // OSM 시트의 사본에는 필드가 아예 없다 — M41 이전 시트와 같은 모양.
    const osmCopyId = store().duplicateSheet(osmId)!;
    expect('mapEngine' in ws().sheets[osmCopyId]).toBe(false);

    const googleCopyId = store().duplicateSheet(googleId)!;
    expect(ws().sheets[googleCopyId].mapEngine).toBe('google');
  });

  it('사본의 지도를 골라서 바꿀 수 있고, 원본은 그대로다', () => {
    const tripId = store().addTrip('여행');
    const osmId = store().addSheet(tripId, 'OSM 시트')!;
    store().updateSheet(osmId, { name: 'OSM 시트' });

    const googleCopyId = store().duplicateSheet(osmId, 'google')!;
    expect(ws().sheets[googleCopyId].mapEngine).toBe('google');
    expect('mapEngine' in ws().sheets[osmId]).toBe(false);

    const backToOsmId = store().duplicateSheet(googleCopyId, 'osm')!;
    expect('mapEngine' in ws().sheets[backToOsmId]).toBe(false);
    expect(ws().sheets[googleCopyId].mapEngine).toBe('google');
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

describe('updateEntryNote (M39)', () => {
  it('writes the note and stamps updatedAt', () => {
    const { cardId, dayA } = timelineSetup();
    const entryId = store().scheduleCard(cardId, dayA, 540)!;
    expect(ws().entries[entryId].note).toBeUndefined();

    store().updateEntryNote(entryId, '개장 30분 전 도착');

    expect(ws().entries[entryId].note).toBe('개장 30분 전 도착');
    expect(useWorkspaceStore.getState().dirty).toBe(true);
  });

  it('trims, and keeps the line breaks inside', () => {
    const { cardId, dayA } = timelineSetup();
    const entryId = store().scheduleCard(cardId, dayA, 540)!;

    store().updateEntryNote(entryId, '  개장 30분 전 도착\n짐은 호텔에  \n');
    expect(ws().entries[entryId].note).toBe('개장 30분 전 도착\n짐은 호텔에');
  });

  it('removes the field entirely when the note is blanked', () => {
    const { cardId, dayA } = timelineSetup();
    const entryId = store().scheduleCard(cardId, dayA, 540, 90)!;

    store().updateEntryNote(entryId, '메모');
    store().updateEntryNote(entryId, '   \n  ');

    const entry = ws().entries[entryId];
    // Not `undefined` — the key itself must be gone, so what syncs is exactly
    // the shape an entry that never had a note has.
    expect('note' in entry).toBe(false);
    expect(JSON.parse(JSON.stringify(entry))).not.toHaveProperty('note');
    // 나머지는 그대로다.
    expect(entry.startMin).toBe(540);
    expect(entry.durationMin).toBe(90);
    expect(entry.dayId).toBe(dayA);
  });

  it('no-ops when the trimmed text is unchanged', () => {
    const { cardId, dayA } = timelineSetup();
    const entryId = store().scheduleCard(cardId, dayA, 540)!;
    store().updateEntryNote(entryId, '표 미리 예매');
    useWorkspaceStore.setState({ dirty: false });
    const before = ws();

    store().updateEntryNote(entryId, '  표 미리 예매  ');

    expect(ws()).toBe(before);
    expect(useWorkspaceStore.getState().dirty).toBe(false);
  });

  it('no-ops on a blank note for an entry that never had one', () => {
    const { cardId, dayA } = timelineSetup();
    const entryId = store().scheduleCard(cardId, dayA, 540)!;
    useWorkspaceStore.setState({ dirty: false });
    const before = ws();

    store().updateEntryNote(entryId, '   ');

    expect(ws()).toBe(before);
    expect(useWorkspaceStore.getState().dirty).toBe(false);
  });

  it('no-ops for an unknown id', () => {
    timelineSetup();
    const before = ws();
    store().updateEntryNote('nope', '메모');
    expect(ws()).toBe(before);
  });

  it('메모는 배치마다 따로다 — 같은 카드를 두 번 놓으면 메모도 둘이다', () => {
    const { cardId, dayA, dayB } = timelineSetup();
    const morning = store().scheduleCard(cardId, dayA, 540)!;
    const evening = store().scheduleCard(cardId, dayB, 1140)!;

    store().updateEntryNote(morning, '아침엔 줄이 짧아요');

    expect(ws().entries[morning].note).toBe('아침엔 줄이 짧아요');
    expect(ws().entries[evening].note).toBeUndefined();
    // 카드 자체는 손대지 않는다 — 보드의 메모와는 다른 것이다.
    expect(ws().cards[cardId].memo).toBeUndefined();

    store().updateEntryNote(evening, '저녁엔 예약 필수');
    expect(ws().entries[morning].note).toBe('아침엔 줄이 짧아요');
    expect(ws().entries[evening].note).toBe('저녁엔 예약 필수');
  });

  it('메모가 붙은 배치도 삭제는 그대로 톰스톤 하나다', () => {
    const { cardId, dayA } = timelineSetup();
    const entryId = store().scheduleCard(cardId, dayA, 540)!;
    store().updateEntryNote(entryId, '표 미리 예매');

    store().deleteEntry(entryId);

    expect(ws().entries[entryId]).toBeUndefined();
    expect(ws().tombstones).toEqual([expect.objectContaining({ id: entryId, entity: 'entry' })]);
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

describe('addPhoto / removePhoto (M10)', () => {
  const cardSetup = (): Id => {
    const tripId = store().addTrip('오사카');
    return store().addCard(tripId, columnIds(tripId)[4], { title: '츠텐카쿠' })!;
  };

  /** The caller owns the id — the blob is written under it *before* this. */
  const meta = (id: string, over: Partial<{ w: number; h: number; bytes: number }> = {}) => ({
    id,
    w: 1_600,
    h: 1_200,
    bytes: 240_000,
    ...over,
  });

  it('appends photos oldest first and stamps them', () => {
    const cardId = cardSetup();
    expect(store().addPhoto(cardId, meta('p1'))).toBe('p1');
    expect(store().addPhoto(cardId, meta('p2', { w: 900, h: 1_600 }))).toBe('p2');

    const photos = ws().cards[cardId].photos!;
    expect(photos.map((item) => item.id)).toEqual(['p1', 'p2']);
    expect(photos[0]).toMatchObject({ w: 1_600, h: 1_200, bytes: 240_000 });
    expect(photos[1]).toMatchObject({ w: 900, h: 1_600 });
    expect(photos[0].createdAt).toBeGreaterThan(0);
    expect(store().dirty).toBe(true);
  });

  it('bumps the card stamp — the card is what changed', () => {
    const cardId = cardSetup();
    const before = ws().cards[cardId].updatedAt;
    store().addPhoto(cardId, meta('p1'));
    const after = ws().cards[cardId];
    expect(after.updatedAt).toBeGreaterThanOrEqual(before);
    expect(after.updatedAt).toBeGreaterThanOrEqual(after.photos![0].createdAt);
    // Nothing else on the card moved.
    expect(after).toMatchObject({ title: '츠텐카쿠' });
  });

  it('refuses an unknown card or dimensions that cannot be drawn', () => {
    const cardId = cardSetup();
    expect(store().addPhoto('nope', meta('p1'))).toBeNull();
    expect(store().addPhoto(cardId, meta('p1', { w: 0 }))).toBeNull();
    expect(store().addPhoto(cardId, meta('p1', { h: -3 }))).toBeNull();
    expect(store().addPhoto(cardId, meta('p1', { w: Number.NaN }))).toBeNull();
    expect(ws().cards[cardId].photos).toBeUndefined();
  });

  it('records a garbled size as 0 rather than NaN', () => {
    const cardId = cardSetup();
    store().addPhoto(cardId, meta('p1', { bytes: Number.NaN }));
    expect(ws().cards[cardId].photos![0].bytes).toBe(0);
  });

  it('stops at the cap and says so by returning null', () => {
    const cardId = cardSetup();
    for (let index = 0; index < MAX_PHOTOS_PER_CARD; index += 1) {
      expect(store().addPhoto(cardId, meta(`p${index}`))).toBe(`p${index}`);
    }
    expect(ws().cards[cardId].photos).toHaveLength(MAX_PHOTOS_PER_CARD);

    const before = ws();
    expect(store().addPhoto(cardId, meta('one-too-many'))).toBeNull();
    // A refused mutation leaves the store completely untouched.
    expect(ws()).toBe(before);
  });

  it('removes one photo and clears the field once the strip empties', () => {
    const cardId = cardSetup();
    store().addPhoto(cardId, meta('p1'));
    store().addPhoto(cardId, meta('p2'));

    store().removePhoto(cardId, 'p1');
    expect(ws().cards[cardId].photos!.map((item) => item.id)).toEqual(['p2']);

    store().removePhoto(cardId, 'p2');
    // Back to exactly the shape a pre-M10 card has.
    expect(ws().cards[cardId].photos).toBeUndefined();
  });

  it('is a no-op for an unknown card or photo', () => {
    const cardId = cardSetup();
    store().addPhoto(cardId, meta('p1'));
    const before = ws();
    store().removePhoto(cardId, 'nope');
    store().removePhoto('nope', 'p1');
    expect(ws()).toBe(before);
  });

  it('keeps 사진 apart from 지출 and 코멘트 on the same card', () => {
    const cardId = cardSetup();
    store().addExpense(cardId, 1_500, '입장료');
    store().addComment(cardId, '현금만 받아요');
    store().addPhoto(cardId, meta('p1'));

    expect(ws().cards[cardId].expenses).toHaveLength(1);
    expect(ws().cards[cardId].comments).toHaveLength(1);
    expect(ws().cards[cardId].photos).toHaveLength(1);
  });

  it('cascade-deletes with the card', () => {
    const cardId = cardSetup();
    store().addPhoto(cardId, meta('p1'));
    store().deleteCard(cardId);
    expect(ws().cards[cardId]).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ *
 * 프로필 스탬프 + 누가 봤는지 (M13)
 * ------------------------------------------------------------------ */

describe('작성자 스탬프 (M13)', () => {
  /** A trip with one card, made by whoever the profile store currently says. */
  const cardSetup = (): Id => {
    const tripId = store().addTrip('오사카');
    return store().addCard(tripId, columnIds(tripId)[4], { title: '츠텐카쿠' })!;
  };

  beforeEach(() => {
    useProfileStore.setState({ profileId: null });
  });

  it('카드·코멘트·지출에 지금 프로필을 찍는다', () => {
    useProfileStore.setState({ profileId: 'hoyabom' });
    const cardId = cardSetup();
    store().addComment(cardId, '줄 길대요');
    store().addExpense(cardId, 900, '입장료');

    expect(ws().cards[cardId].createdBy).toBe('hoyabom');
    expect(ws().cards[cardId].comments![0].by).toBe('hoyabom');
    expect(ws().cards[cardId].expenses![0].by).toBe('hoyabom');
  });

  it('전환 후에 쓴 것만 새 이름이 붙는다 — 이미 쓴 것은 그대로다', () => {
    useProfileStore.setState({ profileId: 'hoyabom' });
    const cardId = cardSetup();
    store().addComment(cardId, '내가 먼저');

    useProfileStore.setState({ profileId: 'song' });
    store().addComment(cardId, '나도');
    store().updateCard(cardId, { title: '츠텐카쿠 전망대' });

    const card = ws().cards[cardId];
    expect(card.comments!.map((c) => c.by)).toEqual(['hoyabom', 'song']);
    // createdBy는 "누가 만들었나"이지 "누가 마지막에 만졌나"가 아니다.
    expect(card.createdBy).toBe('hoyabom');
  });

  it('프로필이 없으면 필드 자체가 생기지 않는다 (M13 이전과 같은 모양)', () => {
    const cardId = cardSetup();
    store().addComment(cardId, '익명');
    store().addExpense(cardId, 900);

    const card = ws().cards[cardId];
    expect(card.createdBy).toBeUndefined();
    expect('createdBy' in card).toBe(false);
    expect('by' in card.comments![0]).toBe(false);
    expect('by' in card.expenses![0]).toBe(false);
  });
});

describe('markSeen (M13)', () => {
  it('프로필별 마지막 접속 시각을 남기고 dirty로 만든다', () => {
    const before = Date.now();
    store().markSeen('song');

    const at = ws().seenBy!.song;
    expect(at).toBeGreaterThanOrEqual(before);
    expect(store().dirty).toBe(true);
  });

  it('두 사람의 기록이 서로를 덮지 않는다', () => {
    store().markSeen('song');
    const songAt = ws().seenBy!.song;
    store().markSeen('hoyabom');

    expect(ws().seenBy!.song).toBe(songAt);
    expect(ws().seenBy!.hoyabom).toBeGreaterThanOrEqual(songAt);
  });

  it('같은 프로필을 다시 찍으면 최신 시각으로 덮어쓴다', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_000_000);
      store().markSeen('song');
      expect(ws().seenBy!.song).toBe(1_000_000);

      vi.setSystemTime(1_060_000);
      store().markSeen('song');
      expect(ws().seenBy!.song).toBe(1_060_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('빈 id는 아무 것도 하지 않는다 — 워크스페이스도 그대로다', () => {
    const before = ws();
    store().markSeen('');
    store().markSeen('   ');
    expect(ws()).toBe(before);
    expect(ws().seenBy).toBeUndefined();
  });

  it('기존 기록이 있는 워크스페이스에서도 다른 키를 지우지 않는다', () => {
    useWorkspaceStore.setState({
      workspace: { ...emptyWorkspace(), seenBy: { hoyabom: 1_000 } },
      dirty: false,
    });
    store().markSeen('song');

    expect(ws().seenBy!.hoyabom).toBe(1_000);
    expect(typeof ws().seenBy!.song).toBe('number');
  });
});

describe('markRead (M24)', () => {
  const KEY = 'memo:t1:song';

  it('읽은 지점을 남기고 dirty로 만든다', () => {
    store().markRead(KEY, 1_000);

    expect(ws().seenBy![KEY]).toBe(1_000);
    expect(store().dirty).toBe(true);
  });

  it('앞으로만 간다 — 더 작은 값은 워크스페이스를 건드리지 않는다', () => {
    store().markRead(KEY, 2_000);
    useWorkspaceStore.setState({ dirty: false });
    const before = ws();

    store().markRead(KEY, 1_000);

    expect(ws()).toBe(before);
    expect(ws().seenBy![KEY]).toBe(2_000);
    // 이게 없으면 스레드를 보는 내내 쓸데없는 푸시가 튀어 나간다.
    expect(store().dirty).toBe(false);
  });

  it('같은 값을 다시 찍어도 아무 일도 없다', () => {
    store().markRead(KEY, 2_000);
    useWorkspaceStore.setState({ dirty: false });
    const before = ws();

    store().markRead(KEY, 2_000);

    expect(ws()).toBe(before);
    expect(store().dirty).toBe(false);
  });

  it('더 큰 값은 덮어쓴다', () => {
    store().markRead(KEY, 1_000);
    store().markRead(KEY, 3_000);
    expect(ws().seenBy![KEY]).toBe(3_000);
  });

  it('빈 키와 쓸 수 없는 시각은 아무 것도 하지 않는다', () => {
    const before = ws();
    store().markRead('', 1_000);
    store().markRead('   ', 1_000);
    store().markRead(KEY, 0);
    store().markRead(KEY, -1);
    store().markRead(KEY, Number.NaN);

    expect(ws()).toBe(before);
    expect(ws().seenBy).toBeUndefined();
  });

  it('M13의 프로필 키와 이름공간이 갈린다 — 서로를 덮지 않는다', () => {
    store().markSeen('song');
    const seenAt = ws().seenBy!.song;

    store().markRead('memo:t1:song', 1_000);
    store().markRead('card:k1:song', 2_000);

    expect(ws().seenBy!.song).toBe(seenAt);
    expect(ws().seenBy!['memo:t1:song']).toBe(1_000);
    expect(ws().seenBy!['card:k1:song']).toBe(2_000);
  });
});

describe('addMemoMessage / removeMemoMessage (M21)', () => {
  const photo = (id: string) => ({ id, w: 1_600, h: 1_200, bytes: 240_000, createdAt: 1 });

  beforeEach(() => {
    useProfileStore.setState({ profileId: null });
  });

  it('메시지를 만들고 여행에 매단다', () => {
    const tripId = store().addTrip('오사카');
    const id = store().addMemoMessage(tripId, { text: '  내일 우메다 어때?  ' })!;

    const memo = ws().memos![id];
    expect(memo).toMatchObject({ id, tripId, text: '내일 우메다 어때?' });
    expect(memo.createdAt).toBeGreaterThan(0);
    expect(memo.updatedAt).toBe(memo.createdAt);
    expect(store().dirty).toBe(true);
  });

  it('사진만 있는 메시지도 메시지다', () => {
    const tripId = store().addTrip('오사카');
    const id = store().addMemoMessage(tripId, { photos: [photo('p1')] })!;

    expect(ws().memos![id].photos!.map((item) => item.id)).toEqual(['p1']);
    expect(ws().memos![id].text).toBeUndefined();
  });

  it('빈 메시지와 없는 여행은 거절한다 — 워크스페이스도 그대로다', () => {
    const tripId = store().addTrip('오사카');
    const before = ws();
    expect(store().addMemoMessage(tripId, { text: '   ' })).toBeNull();
    expect(store().addMemoMessage(tripId, {})).toBeNull();
    expect(store().addMemoMessage(tripId, { text: '', photos: [] })).toBeNull();
    expect(store().addMemoMessage('nope', { text: '있음' })).toBeNull();
    expect(ws()).toBe(before);
    expect(ws().memos).toBeUndefined();
  });

  it('지금 프로필을 찍고, 프로필이 없으면 필드 자체가 없다', () => {
    const tripId = store().addTrip('오사카');
    const anonymous = store().addMemoMessage(tripId, { text: '익명' })!;
    expect('by' in ws().memos![anonymous]).toBe(false);

    useProfileStore.setState({ profileId: 'hoyabom' });
    const mine = store().addMemoMessage(tripId, { text: '나야' })!;
    expect(ws().memos![mine].by).toBe('hoyabom');
    // 전환은 이미 쓴 것을 고쳐 쓰지 않는다.
    expect('by' in ws().memos![anonymous]).toBe(false);
  });

  it('삭제는 톰스톤이 아니라 소프트 삭제다 — 본문과 사진만 사라진다', () => {
    useProfileStore.setState({ profileId: 'song' });
    const tripId = store().addTrip('오사카');
    const id = store().addMemoMessage(tripId, { text: '오타났다', photos: [photo('p1')] })!;
    const created = ws().memos![id].createdAt;

    store().removeMemoMessage(id);

    const memo = ws().memos![id];
    expect(memo.removedAt).toBeGreaterThanOrEqual(created);
    expect(memo.updatedAt).toBe(memo.removedAt);
    expect(memo.createdAt).toBe(created);
    // 누가 썼는지는 남는다(빈칸의 자리를 잡아 준다). 내용과 사진은 남지 않는다.
    expect(memo.by).toBe('song');
    expect('text' in memo).toBe(false);
    expect('photos' in memo).toBe(false);
    // 톰스톤은 하나도 생기지 않는다 — 구버전 클라이언트의 병합이 깨지지 않는다.
    expect(ws().tombstones).toEqual([]);
  });

  it('없는 메시지, 이미 지운 메시지는 아무 것도 하지 않는다', () => {
    const tripId = store().addTrip('오사카');
    const id = store().addMemoMessage(tripId, { text: '하나' })!;
    store().removeMemoMessage(id);

    const before = ws();
    store().removeMemoMessage(id);
    store().removeMemoMessage('nope');
    expect(ws()).toBe(before);
  });

  it('여행을 지우면 그 스레드도 같이 사라진다 (톰스톤 없이)', () => {
    const kept = store().addTrip('삿포로');
    const doomed = store().addTrip('오사카');
    const keptId = store().addMemoMessage(kept, { text: '남는다' })!;
    store().addMemoMessage(doomed, { text: '사라진다' });

    store().deleteTrip(doomed);

    expect(Object.keys(ws().memos!)).toEqual([keptId]);
    expect(ws().tombstones.some((tomb) => tomb.entity === ('memo' as never))).toBe(false);
  });

  it('마지막 스레드가 비면 memos 키 자체가 없어진다 (M21 이전과 같은 모양)', () => {
    const tripId = store().addTrip('오사카');
    store().addMemoMessage(tripId, { text: '하나' });
    store().deleteTrip(tripId);

    expect(ws().memos).toBeUndefined();
  });
});
