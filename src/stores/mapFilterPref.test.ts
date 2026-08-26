import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_MAP_FILTER_PREF,
  loadMapFilter,
  normalizeFilterPref,
  saveMapFilter,
} from './mapFilterPref';

/** vitest는 node 환경이라 `localStorage`가 없다 — 최소한만 흉내 낸다. */
function fakeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, String(value)),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
    key: (index: number) => [...map.keys()][index] ?? null,
    get length() {
      return map.size;
    },
    raw: map,
  };
}

let store: ReturnType<typeof fakeStorage>;

beforeEach(() => {
  store = fakeStorage();
  (globalThis as { localStorage?: unknown }).localStorage = store;
});

afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

describe('normalizeFilterPref', () => {
  it('모르는 값은 전부 기본값으로 접는다', () => {
    expect(normalizeFilterPref(undefined)).toEqual(DEFAULT_MAP_FILTER_PREF);
    expect(normalizeFilterPref('all')).toEqual(DEFAULT_MAP_FILTER_PREF);
    expect(normalizeFilterPref(['day'])).toEqual(DEFAULT_MAP_FILTER_PREF);
    expect(normalizeFilterPref({ scope: '내일' })).toEqual(DEFAULT_MAP_FILTER_PREF);
  });

  it('아는 범위·일자·카테고리만 살린다', () => {
    expect(normalizeFilterPref({ scope: 'day', dayId: 'd1', muted: ['c1', 2, ''] })).toEqual({
      scope: 'day',
      dayId: 'd1',
      muted: ['c1'],
    });
    expect(normalizeFilterPref({ scope: 'unscheduled', dayId: '', muted: 'c1' })).toEqual({
      scope: 'unscheduled',
      muted: [],
    });
  });
});

describe('load/saveMapFilter', () => {
  it('여행마다 따로 기억한다', () => {
    saveMapFilter('t1', { scope: 'day', dayId: 'd2', muted: ['c1'] });
    saveMapFilter('t2', { scope: 'unscheduled', muted: [] });
    expect(loadMapFilter('t1')).toEqual({ scope: 'day', dayId: 'd2', muted: ['c1'] });
    expect(loadMapFilter('t2')).toEqual({ scope: 'unscheduled', muted: [] });
    expect(loadMapFilter('t3')).toEqual(DEFAULT_MAP_FILTER_PREF);
  });

  it('같은 여행을 다시 고르면 덮어쓴다', () => {
    saveMapFilter('t1', { scope: 'sheet', muted: ['c1'] });
    saveMapFilter('t1', { scope: 'all', muted: [] });
    expect(loadMapFilter('t1')).toEqual({ scope: 'all', muted: [] });
  });

  it('여행 id가 없으면 아무것도 쓰지 않는다', () => {
    saveMapFilter(undefined, { scope: 'sheet', muted: [] });
    expect(store.raw.size).toBe(0);
    expect(loadMapFilter(undefined)).toEqual(DEFAULT_MAP_FILTER_PREF);
  });

  it('깨진 JSON·배열은 "기억 없음"으로 읽는다', () => {
    store.setItem('trip-board/map-filter', '{nope');
    expect(loadMapFilter('t1')).toEqual(DEFAULT_MAP_FILTER_PREF);
    store.setItem('trip-board/map-filter', '["day"]');
    expect(loadMapFilter('t1')).toEqual(DEFAULT_MAP_FILTER_PREF);
  });

  it('저장한 값을 정규화해서 돌려준다', () => {
    const saved = saveMapFilter('t1', {
      scope: 'day',
      dayId: 'd1',
      muted: ['c1', 'c1'],
    });
    expect(saved.scope).toBe('day');
    expect(saved.dayId).toBe('d1');
  });

  it('localStorage가 없어도 던지지 않는다', () => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
    expect(() => saveMapFilter('t1', { scope: 'sheet', muted: [] })).not.toThrow();
    expect(loadMapFilter('t1')).toEqual(DEFAULT_MAP_FILTER_PREF);
  });
});
