import { describe, expect, it } from 'vitest';
import { emptyWorkspace, type GeoPoint, type Id, type Workspace } from '../types/models';
import { dayGaps } from './gap';

const AT = 1_760_000_000_000;

/** 오사카-ish coordinates: `NAMBA` → `UMEDA` is roughly 3.4km apart. */
const NAMBA: GeoPoint = { lat: 34.6659, lng: 135.5011 };
const UMEDA: GeoPoint = { lat: 34.7025, lng: 135.4959 };
/** ~330m from 난바 — a walk, not a problem. */
const NEXT_DOOR: GeoPoint = { lat: 34.6689, lng: 135.5011 };

/** One trip with a 이동수단 (`c-move`) and a 볼거리 (`c-see`) column, one day. */
function scaffold(): Workspace {
  const ws = emptyWorkspace();
  ws.trips.t1 = {
    id: 't1',
    title: '오사카',
    currency: 'KRW',
    columnOrder: ['c-move', 'c-see'],
    sheetOrder: ['s1'],
    createdAt: AT,
    updatedAt: AT,
  };
  ws.columns['c-move'] = {
    id: 'c-move',
    tripId: 't1',
    name: '이동수단',
    color: 'sky',
    icon: '🚗',
    cardOrder: [],
    createdAt: AT,
    updatedAt: AT,
  };
  ws.columns['c-see'] = {
    id: 'c-see',
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
    dayOrder: ['d1'],
    createdAt: AT,
    updatedAt: AT,
  };
  ws.days.d1 = {
    id: 'd1',
    tripId: 't1',
    sheetId: 's1',
    label: '1일차',
    createdAt: AT,
    updatedAt: AT,
  };
  return ws;
}

function addCard(ws: Workspace, id: Id, columnId: Id, location?: GeoPoint): void {
  ws.cards[id] = {
    id,
    tripId: 't1',
    columnId,
    title: id,
    location,
    createdAt: AT,
    updatedAt: AT,
  };
  ws.columns[columnId].cardOrder.push(id);
}

function place(
  ws: Workspace,
  entryId: Id,
  cardId: Id,
  startMin: number,
  durationMin = 60,
): void {
  ws.entries[entryId] = {
    id: entryId,
    tripId: 't1',
    cardId,
    dayId: 'd1',
    startMin,
    durationMin,
    createdAt: AT,
    updatedAt: AT,
  };
}

describe('dayGaps', () => {
  it('measures the straight line between two consecutive located stops', () => {
    const ws = scaffold();
    addCard(ws, 'namba', 'c-see', NAMBA);
    addCard(ws, 'umeda', 'c-see', UMEDA);
    place(ws, 'e1', 'namba', 600); // 10:00–11:00
    place(ws, 'e2', 'umeda', 720); // 12:00–13:00

    const [gap, ...rest] = dayGaps(ws, 'd1');
    expect(rest).toEqual([]);
    expect(gap.afterEntryId).toBe('e1');
    expect(gap.gapMin).toBe(60);
    expect(gap.distanceKm).toBeGreaterThan(3);
    expect(gap.distanceKm).toBeLessThan(4.5);
    expect(gap.impossible).toBe(false);
  });

  it('flags a back-to-back pair more than 1km apart as 시간이 부족', () => {
    const ws = scaffold();
    addCard(ws, 'namba', 'c-see', NAMBA);
    addCard(ws, 'umeda', 'c-see', UMEDA);
    place(ws, 'e1', 'namba', 600); // 10:00–11:00
    place(ws, 'e2', 'umeda', 660); // 11:00–12:00 — no minute in between

    const [gap] = dayGaps(ws, 'd1');
    expect(gap.gapMin).toBe(0);
    expect(gap.impossible).toBe(true);
  });

  it('does not flag a short hop, however tight the schedule', () => {
    const ws = scaffold();
    addCard(ws, 'namba', 'c-see', NAMBA);
    addCard(ws, 'shop', 'c-see', NEXT_DOOR);
    place(ws, 'e1', 'namba', 600);
    place(ws, 'e2', 'shop', 660);

    const [gap] = dayGaps(ws, 'd1');
    expect(gap.distanceKm).toBeLessThan(1);
    expect(gap.impossible).toBe(false);
  });

  it('stays quiet when a 이동수단 card already fills the gap', () => {
    const ws = scaffold();
    addCard(ws, 'namba', 'c-see', NAMBA);
    addCard(ws, 'subway', 'c-move'); // no location → a ride, not a stop
    addCard(ws, 'umeda', 'c-see', UMEDA);
    place(ws, 'e1', 'namba', 600);
    place(ws, 'e2', 'subway', 660);
    place(ws, 'e3', 'umeda', 700);

    expect(dayGaps(ws, 'd1')).toEqual([]);
  });

  it('reports the hops around a ride that only covers one of them', () => {
    const ws = scaffold();
    addCard(ws, 'namba', 'c-see', NAMBA);
    addCard(ws, 'subway', 'c-move');
    addCard(ws, 'umeda', 'c-see', UMEDA);
    addCard(ws, 'shop', 'c-see', NEXT_DOOR);
    place(ws, 'e1', 'namba', 540);
    place(ws, 'e2', 'subway', 600);
    place(ws, 'e3', 'umeda', 660);
    place(ws, 'e4', 'shop', 780);

    const gaps = dayGaps(ws, 'd1');
    expect(gaps.map((gap) => gap.afterEntryId)).toEqual(['e3']);
  });

  it('needs both ends located', () => {
    const ws = scaffold();
    addCard(ws, 'namba', 'c-see', NAMBA);
    addCard(ws, 'lunch', 'c-see'); // no location at all
    place(ws, 'e1', 'namba', 600);
    place(ws, 'e2', 'lunch', 660);

    expect(dayGaps(ws, 'd1')).toEqual([]);
  });

  it('reads a negative gap for overlapping entries without clamping it', () => {
    const ws = scaffold();
    addCard(ws, 'namba', 'c-see', NAMBA);
    addCard(ws, 'umeda', 'c-see', UMEDA);
    place(ws, 'e1', 'namba', 600, 120); // 10:00–12:00
    place(ws, 'e2', 'umeda', 660); // starts inside it

    const [gap] = dayGaps(ws, 'd1');
    expect(gap.gapMin).toBe(-60);
    expect(gap.impossible).toBe(true);
  });

  it('maps a card placed twice on the day onto the right entries', () => {
    const ws = scaffold();
    addCard(ws, 'hotel', 'c-see', NAMBA);
    addCard(ws, 'umeda', 'c-see', UMEDA);
    place(ws, 'e1', 'hotel', 540); // 09:00–10:00
    place(ws, 'e2', 'umeda', 660); // 11:00–12:00
    place(ws, 'e3', 'hotel', 1_200); // 20:00 — the same card, again

    const gaps = dayGaps(ws, 'd1');
    expect(gaps.map((gap) => gap.afterEntryId)).toEqual(['e1', 'e2']);
    expect(gaps[0].gapMin).toBe(60);
    expect(gaps[1].gapMin).toBe(480);
  });

  it('is empty for one stop, an unknown day, and an empty day', () => {
    const ws = scaffold();
    addCard(ws, 'namba', 'c-see', NAMBA);
    place(ws, 'e1', 'namba', 600);
    expect(dayGaps(ws, 'd1')).toEqual([]);
    expect(dayGaps(ws, 'nope')).toEqual([]);
    expect(dayGaps(scaffold(), 'd1')).toEqual([]);
  });
});
