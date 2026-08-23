import { describe, expect, it } from 'vitest';
import { emptyWorkspace, type Workspace } from '../types/models';
import { validActiveIds } from './uiPersist';

const AT = 1_760_000_000_000;

/** A workspace with one trip and one sheet inside it, plus a stranger's sheet. */
function scaffold(): Workspace {
  const ws = emptyWorkspace();
  ws.trips.t1 = {
    id: 't1',
    title: '오사카',
    currency: 'KRW',
    columnOrder: [],
    sheetOrder: ['s1'],
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
  ws.sheets.other = {
    id: 'other',
    tripId: 't2',
    name: '남의 시트',
    dayOrder: [],
    createdAt: AT,
    updatedAt: AT,
  };
  return ws;
}

describe('validActiveIds (B15)', () => {
  it('keeps a pair the workspace still backs', () => {
    expect(validActiveIds({ activeTripId: 't1', activeSheetId: 's1' }, scaffold())).toEqual({
      activeTripId: 't1',
      activeSheetId: 's1',
    });
  });

  it('drops both ids when the trip is gone', () => {
    expect(validActiveIds({ activeTripId: 'ghost', activeSheetId: 's1' }, scaffold())).toEqual({
      activeTripId: undefined,
      activeSheetId: undefined,
    });
  });

  it('drops a sheet that is gone, or belongs to another trip', () => {
    const ws = scaffold();
    expect(validActiveIds({ activeTripId: 't1', activeSheetId: 'ghost' }, ws)).toEqual({
      activeTripId: 't1',
      activeSheetId: undefined,
    });
    expect(validActiveIds({ activeTripId: 't1', activeSheetId: 'other' }, ws)).toEqual({
      activeTripId: 't1',
      activeSheetId: undefined,
    });
  });

  it('always names both keys, so a shallow merge really clears them', () => {
    const result = validActiveIds({ activeTripId: 'ghost' }, scaffold());
    expect(Object.keys(result).sort()).toEqual(['activeSheetId', 'activeTripId']);
  });

  it('has nothing to say about an empty pair', () => {
    expect(validActiveIds({}, scaffold())).toEqual({
      activeTripId: undefined,
      activeSheetId: undefined,
    });
  });
});
