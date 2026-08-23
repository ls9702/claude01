import { describe, expect, it } from 'vitest';
import { emptyWorkspace, type Id, type Workspace } from '../types/models';
import { summarizeSchedule } from './scheduleSummary';

/** Hand-built workspace: one trip, two sheets, one card placed three times. */
function fixture(): { ws: Workspace; tripId: Id; cardId: Id; sheetA: Id; sheetB: Id } {
  const ws = emptyWorkspace();
  const now = 0;
  const tripId = 'trip';
  const cardId = 'card';
  const sheetA = 'sheetA';
  const sheetB = 'sheetB';

  ws.trips[tripId] = {
    id: tripId,
    title: '오사카',
    currency: 'KRW',
    columnOrder: [],
    sheetOrder: [sheetA, sheetB],
    createdAt: now,
    updatedAt: now,
  };
  for (const [id, name] of [
    [sheetA, '일정 1'],
    [sheetB, '플랜 B'],
  ] as const) {
    ws.sheets[id] = { id, tripId, name, dayOrder: [], createdAt: now, updatedAt: now };
  }
  for (const [dayId, sheetId] of [
    ['d1', sheetA],
    ['d2', sheetA],
    ['d3', sheetB],
  ] as const) {
    ws.days[dayId] = { id: dayId, tripId, sheetId, createdAt: now, updatedAt: now };
    ws.sheets[sheetId].dayOrder.push(dayId);
  }
  for (const [entryId, dayId] of [
    ['e1', 'd1'],
    ['e2', 'd2'],
    ['e3', 'd3'],
  ] as const) {
    ws.entries[entryId] = {
      id: entryId,
      tripId,
      cardId,
      dayId,
      startMin: 600,
      durationMin: 60,
      createdAt: now,
      updatedAt: now,
    };
  }
  return { ws, tripId, cardId, sheetA, sheetB };
}

describe('summarizeSchedule', () => {
  it('totals a card and splits it per sheet, in sheetOrder', () => {
    const { ws, tripId, cardId, sheetA, sheetB } = fixture();
    const summary = summarizeSchedule(ws, tripId);

    expect(summary.counts[cardId]).toBe(3);
    expect(summary.bySheet[cardId]).toEqual([
      { sheetId: sheetA, sheetName: '일정 1', count: 2 },
      { sheetId: sheetB, sheetName: '플랜 B', count: 1 },
    ]);
  });

  it('ignores other trips and cards with no entries', () => {
    const { ws, cardId } = fixture();
    ws.entries.other = {
      id: 'other',
      tripId: 'elsewhere',
      cardId: 'stranger',
      dayId: 'd1',
      startMin: 0,
      durationMin: 60,
      createdAt: 0,
      updatedAt: 0,
    };

    const summary = summarizeSchedule(ws, 'trip');
    expect(Object.keys(summary.counts)).toEqual([cardId]);
    expect(summary.bySheet.stranger).toBeUndefined();
  });

  it('still counts an entry whose day has gone missing', () => {
    const { ws, cardId } = fixture();
    delete ws.days.d3;

    const summary = summarizeSchedule(ws, 'trip');
    expect(summary.counts[cardId]).toBe(3);
    expect(summary.bySheet[cardId]).toEqual([
      { sheetId: 'sheetA', sheetName: '일정 1', count: 2 },
    ]);
  });
});
