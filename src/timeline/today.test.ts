import { describe, expect, it } from 'vitest';
import { emptyWorkspace, type Card, type Id, type Workspace } from '../types/models';
import { currentAndNext, nowMin, todayDayId, todayIso } from './today';

const AT = 1_760_000_000_000;

/** One trip, one sheet, and the days the caller asks for (by date). */
function scaffold(dates: (string | undefined)[]): Workspace {
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
  dates.forEach((date, index) => {
    const dayId = `d${index + 1}`;
    ws.days[dayId] = {
      id: dayId,
      tripId: 't1',
      sheetId: 's1',
      date,
      createdAt: AT,
      updatedAt: AT,
    };
    ws.sheets.s1.dayOrder.push(dayId);
  });
  return ws;
}

const card = (id: Id): Card => ({
  id,
  tripId: 't1',
  columnId: 'c1',
  title: id,
  createdAt: AT,
  updatedAt: AT,
});

/** An entry of `d1`, with an explicit id so the assertions can name it. */
const entry = (id: Id, cardId: Id, startMin: number, durationMin = 60) => ({
  id,
  tripId: 't1',
  cardId,
  dayId: 'd1',
  startMin,
  durationMin,
  createdAt: AT,
  updatedAt: AT,
});

const CARDS: Record<Id, Card> = { k1: card('k1'), k2: card('k2'), k3: card('k3') };

describe('todayIso', () => {
  it('reads the local calendar day, zero-padded', () => {
    expect(todayIso(new Date(2026, 7, 23, 14, 5))).toBe('2026-08-23');
    expect(todayIso(new Date(2026, 0, 2, 0, 0))).toBe('2026-01-02');
    // 23:59 local is still that local day, whatever UTC thinks.
    expect(todayIso(new Date(2026, 4, 3, 23, 59))).toBe('2026-05-03');
  });

  it('is empty for an invalid date', () => {
    expect(todayIso(new Date(Number.NaN))).toBe('');
  });
});

describe('nowMin', () => {
  it('counts minutes from local midnight', () => {
    expect(nowMin(new Date(2026, 4, 3, 0, 0))).toBe(0);
    expect(nowMin(new Date(2026, 4, 3, 9, 30))).toBe(570);
    expect(nowMin(new Date(2026, 4, 3, 23, 59))).toBe(1439);
  });

  it('is 0 for an invalid date', () => {
    expect(nowMin(new Date(Number.NaN))).toBe(0);
  });
});

describe('todayDayId', () => {
  it('finds the day of the active sheet carrying today', () => {
    const ws = scaffold(['2026-05-03', '2026-05-04', '2026-05-05']);
    expect(todayDayId(ws, 's1', '2026-05-04')).toBe('d2');
  });

  it('is null when no day matches, or the sheet has no dates', () => {
    const ws = scaffold(['2026-05-03', '2026-05-04']);
    expect(todayDayId(ws, 's1', '2026-05-09')).toBeNull();
    expect(todayDayId(scaffold([undefined, undefined]), 's1', '2026-05-03')).toBeNull();
  });

  it('is null for an unknown sheet, no sheet, or a garbled date', () => {
    const ws = scaffold(['2026-05-03']);
    expect(todayDayId(ws, 'nope', '2026-05-03')).toBeNull();
    expect(todayDayId(ws, undefined, '2026-05-03')).toBeNull();
    expect(todayDayId(ws, 's1', '오늘')).toBeNull();
  });

  it('ignores a day of another sheet', () => {
    const ws = scaffold(['2026-05-03']);
    ws.sheets.s2 = { ...ws.sheets.s1, id: 's2', name: '플랜 B', dayOrder: ['d9'] };
    ws.days.d9 = { ...ws.days.d1, id: 'd9', sheetId: 's2', date: '2026-05-09' };
    expect(todayDayId(ws, 's1', '2026-05-09')).toBeNull();
    expect(todayDayId(ws, 's2', '2026-05-09')).toBe('d9');
  });
});

describe('currentAndNext', () => {
  const entries = [
    entry('e1', 'k1', 540), // 09:00–10:00
    entry('e2', 'k2', 660), // 11:00–12:00
    entry('e3', 'k3', 900), // 15:00–16:00
  ];

  it('names the entry the clock is inside, and the one after it', () => {
    const result = currentAndNext(entries, CARDS, 570); // 09:30
    expect(result.current?.id).toBe('e1');
    expect(result.next?.id).toBe('e2');
    expect(result.gapMin).toBe(90);
  });

  it('leaves 지금 empty in a gap, and counts the minutes to 다음', () => {
    const result = currentAndNext(entries, CARDS, 630); // 10:30, between e1 and e2
    expect(result.current).toBeUndefined();
    expect(result.next?.id).toBe('e2');
    expect(result.gapMin).toBe(30);
  });

  it('treats the minute an entry starts as 지금, not 다음', () => {
    const result = currentAndNext(entries, CARDS, 660);
    expect(result.current?.id).toBe('e2');
    expect(result.next?.id).toBe('e3');
  });

  it('treats the minute an entry ends as over', () => {
    const result = currentAndNext(entries, CARDS, 600); // e1 ends at 10:00
    expect(result.current).toBeUndefined();
    expect(result.next?.id).toBe('e2');
  });

  it('has no 다음 once the day is done', () => {
    const result = currentAndNext(entries, CARDS, 1_000); // 16:40
    expect(result.current).toBeUndefined();
    expect(result.next).toBeUndefined();
    expect(result.gapMin).toBeUndefined();
  });

  it('sorts before it looks, and skips entries whose card is gone', () => {
    const shuffled = [entry('e3', 'k3', 900), entry('ghost', 'gone', 545), entry('e1', 'k1', 540)];
    const result = currentAndNext(shuffled, CARDS, 550);
    expect(result.current?.id).toBe('e1');
    expect(result.next?.id).toBe('e3');
  });

  it('is empty for an empty day, and survives a garbled clock', () => {
    expect(currentAndNext([], CARDS, 600)).toEqual({});
    expect(currentAndNext(entries, CARDS, Number.NaN).next?.id).toBe('e1');
  });
});
