import { describe, expect, it } from 'vitest';
import { emptyWorkspace, type Card, type Id, type Workspace } from '../types/models';
import {
  cardCommentCount,
  cardSpent,
  daySpend,
  emptySpend,
  hasSpend,
  sheetSpend,
  tripCardIds,
  tripSpend,
  unplacedSpend,
} from './spend';

const AT = 1_760_000_000_000;

/** Workspace with one trip, one column, one sheet and `dayCount` days. */
function scaffold(dayCount = 2): Workspace {
  const ws = emptyWorkspace();
  ws.trips.t1 = {
    id: 't1',
    title: '오사카',
    currency: 'KRW',
    columnOrder: ['c1'],
    sheetOrder: ['s1'],
    createdAt: AT,
    updatedAt: AT,
  };
  ws.columns.c1 = {
    id: 'c1',
    tripId: 't1',
    name: '볼거리',
    color: 'emerald',
    icon: '🎡',
    cardOrder: [],
    createdAt: AT,
    updatedAt: AT,
  };
  ws.sheets.s1 = {
    id: 's1',
    tripId: 't1',
    name: '일정 1',
    dayOrder: [],
    createdAt: AT,
    updatedAt: AT,
  };
  for (let i = 1; i <= dayCount; i += 1) {
    const dayId = `d${i}`;
    ws.days[dayId] = {
      id: dayId,
      tripId: 't1',
      sheetId: 's1',
      label: `${i}일차`,
      createdAt: AT,
      updatedAt: AT,
    };
    ws.sheets.s1.dayOrder.push(dayId);
  }
  return ws;
}

/** Adds a card, optionally with a budget and a list of expense amounts. */
function addCard(
  ws: Workspace,
  id: Id,
  opts: { budget?: number; expenses?: number[]; comments?: number } = {},
): Card {
  const card: Card = {
    id,
    tripId: 't1',
    columnId: 'c1',
    title: id,
    budget: opts.budget,
    expenses: opts.expenses?.map((amount, index) => ({
      id: `${id}-x${index}`,
      amount,
      at: AT + index,
    })),
    comments: Array.from({ length: opts.comments ?? 0 }, (_, index) => ({
      id: `${id}-c${index}`,
      text: `코멘트 ${index}`,
      at: AT + index,
    })),
    createdAt: AT,
    updatedAt: AT,
  };
  if ((opts.comments ?? 0) === 0) card.comments = undefined;
  ws.cards[id] = card;
  ws.columns.c1.cardOrder.push(id);
  return card;
}

/** Places `cardId` on `dayId`; the entry id keeps every placement distinct. */
function place(ws: Workspace, entryId: Id, cardId: Id, dayId: Id, startMin = 600): void {
  ws.entries[entryId] = {
    id: entryId,
    tripId: 't1',
    cardId,
    dayId,
    startMin,
    durationMin: 60,
    createdAt: AT,
    updatedAt: AT,
  };
}

describe('cardSpent', () => {
  it('sums the card expenses', () => {
    const ws = scaffold();
    expect(cardSpent(addCard(ws, 'k1', { expenses: [12000, 3000, 500] }))).toBe(15500);
  });

  it('reads a card with no expenses (pre-M6 data) as 0', () => {
    const ws = scaffold();
    expect(cardSpent(addCard(ws, 'k1'))).toBe(0);
    expect(cardSpent(addCard(ws, 'k2', { expenses: [] }))).toBe(0);
    expect(cardSpent(undefined)).toBe(0);
  });

  it('skips garbled amounts instead of returning NaN', () => {
    const ws = scaffold();
    expect(cardSpent(addCard(ws, 'k1', { expenses: [1000, Number.NaN, 2000] }))).toBe(3000);
  });
});

describe('cardCommentCount', () => {
  it('counts the thread, missing field included', () => {
    const ws = scaffold();
    expect(cardCommentCount(addCard(ws, 'k1', { comments: 3 }))).toBe(3);
    expect(cardCommentCount(addCard(ws, 'k2'))).toBe(0);
    expect(cardCommentCount(undefined)).toBe(0);
  });
});

describe('daySpend', () => {
  it('adds up 예산/지출 of the cards scheduled on the day', () => {
    const ws = scaffold();
    addCard(ws, 'k1', { budget: 10000, expenses: [12000] });
    addCard(ws, 'k2', { budget: 5000, expenses: [1000, 500] });
    place(ws, 'e1', 'k1', 'd1');
    place(ws, 'e2', 'k2', 'd1', 720);

    expect(daySpend(ws, 'd1')).toEqual({ budget: 15000, spent: 13500 });
  });

  it('counts a card scheduled twice on the same day only once', () => {
    const ws = scaffold();
    addCard(ws, 'k1', { budget: 10000, expenses: [12000] });
    place(ws, 'e1', 'k1', 'd1', 540);
    place(ws, 'e2', 'k1', 'd1', 1200);

    expect(daySpend(ws, 'd1')).toEqual({ budget: 10000, spent: 12000 });
  });

  it('keeps other days out of it', () => {
    const ws = scaffold();
    addCard(ws, 'k1', { budget: 10000, expenses: [12000] });
    addCard(ws, 'k2', { budget: 7000, expenses: [800] });
    place(ws, 'e1', 'k1', 'd1');
    place(ws, 'e2', 'k2', 'd2');

    expect(daySpend(ws, 'd1')).toEqual({ budget: 10000, spent: 12000 });
    expect(daySpend(ws, 'd2')).toEqual({ budget: 7000, spent: 800 });
  });

  it('is zero for an empty or unknown day', () => {
    const ws = scaffold();
    expect(daySpend(ws, 'd1')).toEqual(emptySpend());
    expect(daySpend(ws, 'nope')).toEqual({ budget: 0, spent: 0 });
  });

  it('ignores an entry whose card has gone', () => {
    const ws = scaffold();
    place(ws, 'e1', 'ghost', 'd1');
    expect(daySpend(ws, 'd1')).toEqual({ budget: 0, spent: 0 });
  });
});

describe('sheetSpend', () => {
  it('adds the sheet up across its days', () => {
    const ws = scaffold();
    addCard(ws, 'k1', { budget: 10000, expenses: [12000] });
    addCard(ws, 'k2', { budget: 7000, expenses: [800] });
    place(ws, 'e1', 'k1', 'd1');
    place(ws, 'e2', 'k2', 'd2');

    expect(sheetSpend(ws, 's1')).toEqual({ budget: 17000, spent: 12800 });
  });

  it('counts a card placed on two days of one sheet only once', () => {
    const ws = scaffold();
    addCard(ws, 'k1', { budget: 10000, expenses: [12000] });
    place(ws, 'e1', 'k1', 'd1');
    place(ws, 'e2', 'k1', 'd2');

    // The two days each report the card…
    expect(daySpend(ws, 'd1')).toEqual({ budget: 10000, spent: 12000 });
    expect(daySpend(ws, 'd2')).toEqual({ budget: 10000, spent: 12000 });
    // …but the sheet is not their sum.
    expect(sheetSpend(ws, 's1')).toEqual({ budget: 10000, spent: 12000 });
  });

  it('picks up a day that fell out of dayOrder', () => {
    const ws = scaffold();
    addCard(ws, 'k1', { expenses: [500] });
    place(ws, 'e1', 'k1', 'd2');
    ws.sheets.s1.dayOrder = ['d1'];

    expect(sheetSpend(ws, 's1')).toEqual({ budget: 0, spent: 500 });
  });

  it('is zero for an unknown sheet', () => {
    expect(sheetSpend(scaffold(), 'nope')).toEqual({ budget: 0, spent: 0 });
  });
});

describe('tripSpend', () => {
  /** Adds a second sheet with one day (`d9`) to the scaffold. */
  function withSecondSheet(ws: Workspace): Workspace {
    ws.sheets.s2 = {
      id: 's2',
      tripId: 't1',
      name: '플랜 B',
      dayOrder: ['d9'],
      createdAt: AT,
      updatedAt: AT,
    };
    ws.days.d9 = {
      id: 'd9',
      tripId: 't1',
      sheetId: 's2',
      label: '1일차',
      createdAt: AT,
      updatedAt: AT,
    };
    ws.trips.t1.sheetOrder.push('s2');
    return ws;
  }

  it('adds the whole trip up across its sheets', () => {
    const ws = withSecondSheet(scaffold());
    addCard(ws, 'k1', { budget: 10000, expenses: [12000] });
    addCard(ws, 'k2', { budget: 7000, expenses: [800] });
    place(ws, 'e1', 'k1', 'd1');
    place(ws, 'e2', 'k2', 'd9');

    expect(tripSpend(ws, 't1')).toEqual({ budget: 17000, spent: 12800 });
  });

  it('counts a card placed on two different sheets only once', () => {
    const ws = withSecondSheet(scaffold());
    addCard(ws, 'k1', { budget: 10000, expenses: [12000] });
    place(ws, 'e1', 'k1', 'd1');
    place(ws, 'e2', 'k1', 'd9');

    // Each sheet reports the card…
    expect(sheetSpend(ws, 's1')).toEqual({ budget: 10000, spent: 12000 });
    expect(sheetSpend(ws, 's2')).toEqual({ budget: 10000, spent: 12000 });
    // …and the trip is not their sum.
    expect(tripSpend(ws, 't1')).toEqual({ budget: 10000, spent: 12000 });
  });

  it('leaves an unscheduled card out, the way the day/sheet chips do', () => {
    const ws = scaffold();
    addCard(ws, 'k1', { budget: 10000, expenses: [12000] });
    addCard(ws, 'idea', { budget: 999, expenses: [999] });
    place(ws, 'e1', 'k1', 'd1');

    expect(tripSpend(ws, 't1')).toEqual({ budget: 10000, spent: 12000 });
  });

  it('keeps another trip out of it', () => {
    const ws = scaffold();
    addCard(ws, 'k1', { budget: 10000, expenses: [12000] });
    place(ws, 'e1', 'k1', 'd1');

    ws.trips.t2 = { ...ws.trips.t1, id: 't2', sheetOrder: [] };
    ws.days.dx = { ...ws.days.d1, id: 'dx', tripId: 't2' };
    ws.cards.k9 = { ...ws.cards.k1, id: 'k9', tripId: 't2', budget: 500 };
    place(ws, 'e9', 'k9', 'dx');

    expect(tripSpend(ws, 't1')).toEqual({ budget: 10000, spent: 12000 });
    expect(tripSpend(ws, 't2')).toEqual({ budget: 500, spent: 12000 });
  });

  it('is zero for an unknown trip', () => {
    expect(tripSpend(scaffold(), 'nope')).toEqual({ budget: 0, spent: 0 });
  });
});

describe('tripCardIds', () => {
  it('lists each counted card exactly once, skipping dangling entries', () => {
    const ws = scaffold();
    addCard(ws, 'k1', { expenses: [100] });
    addCard(ws, 'k2', { expenses: [200] });
    place(ws, 'e1', 'k1', 'd1');
    place(ws, 'e2', 'k1', 'd2');
    place(ws, 'e3', 'k2', 'd2');
    place(ws, 'e4', 'ghost', 'd2');

    expect(tripCardIds(ws, 't1').sort()).toEqual(['k1', 'k2']);
    expect(tripCardIds(ws, 'nope')).toEqual([]);
  });
});

describe('hasSpend', () => {
  it('is true as soon as either half is non-zero', () => {
    expect(hasSpend({ budget: 0, spent: 0 })).toBe(false);
    expect(hasSpend({ budget: 1, spent: 0 })).toBe(true);
    expect(hasSpend({ budget: 0, spent: 1 })).toBe(true);
  });
});

describe('unplacedSpend (B14)', () => {
  it('adds up the cards no timeline in the trip has picked up', () => {
    const ws = scaffold();
    addCard(ws, 'placed', { budget: 10_000, expenses: [4_000] });
    addCard(ws, 'idea', { budget: 20_000, expenses: [1_000, 500] });
    addCard(ws, 'wishlist', { budget: 5_000 });
    place(ws, 'e1', 'placed', 'd1');

    expect(unplacedSpend(ws, 't1')).toEqual({ budget: 25_000, spent: 1_500, count: 2 });
    // …and it is exactly what the 결산 left out.
    expect(tripSpend(ws, 't1')).toEqual({ budget: 10_000, spent: 4_000 });
  });

  it('counts only the 미배치 cards that actually carry money', () => {
    const ws = scaffold();
    addCard(ws, 'blank');
    addCard(ws, 'zero', { budget: 0 });
    addCard(ws, 'real', { expenses: [700] });

    expect(unplacedSpend(ws, 't1')).toEqual({ budget: 0, spent: 700, count: 1 });
  });

  it('is silent when every card is on the timeline', () => {
    const ws = scaffold();
    addCard(ws, 'k1', { budget: 10_000 });
    place(ws, 'e1', 'k1', 'd1');

    expect(unplacedSpend(ws, 't1')).toEqual({ budget: 0, spent: 0, count: 0 });
  });

  it('counts a card placed on any sheet of the trip as placed', () => {
    const ws = scaffold();
    ws.sheets.s2 = {
      id: 's2',
      tripId: 't1',
      name: '플랜 B',
      dayOrder: ['d9'],
      createdAt: AT,
      updatedAt: AT,
    };
    ws.days.d9 = { id: 'd9', tripId: 't1', sheetId: 's2', createdAt: AT, updatedAt: AT };
    addCard(ws, 'k1', { budget: 10_000 });
    place(ws, 'e1', 'k1', 'd9');

    expect(unplacedSpend(ws, 't1').count).toBe(0);
  });

  it('is empty for an unknown trip', () => {
    expect(unplacedSpend(scaffold(), 'nope')).toEqual({ budget: 0, spent: 0, count: 0 });
  });
});
