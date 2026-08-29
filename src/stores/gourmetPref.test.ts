import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_GOURMET_FILTER } from '../gourmet/filter';
import {
  loadGourmetFilter,
  loadGourmetPanelCollapsed,
  normalizeGourmetFilter,
  saveGourmetFilter,
  saveGourmetPanelCollapsed,
} from './gourmetPref';

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

describe('정규화', () => {
  it('무엇이 들어와도 한 모양이 된다', () => {
    expect(normalizeGourmetFilter(null)).toEqual(DEFAULT_GOURMET_FILTER);
    expect(normalizeGourmetFilter('sushi')).toEqual(DEFAULT_GOURMET_FILTER);
    expect(normalizeGourmetFilter([])).toEqual(DEFAULT_GOURMET_FILTER);
  });

  it('모르는 장르·칩 값은 버린다', () => {
    expect(
      normalizeGourmetFilter({ genres: ['sushi', 'pizza', 7], reservable: 'maybe', source: 'x' }),
    ).toEqual({ genres: ['sushi'], reservable: 'all', source: 'all' });
  });

  it('장르는 표시 순서로 정렬된다 — 고른 순서는 시야를 바꾸지 않는다', () => {
    expect(normalizeGourmetFilter({ genres: ['dessert', 'sushi'] }).genres).toEqual([
      'sushi',
      'dessert',
    ]);
  });
});

describe('기기 기억', () => {
  it('적은 것을 되읽는다', () => {
    saveGourmetFilter({ genres: ['ramen'], reservable: 'yes', source: 'curated' });
    expect(loadGourmetFilter()).toEqual({
      genres: ['ramen'],
      reservable: 'yes',
      source: 'curated',
    });
  });

  it('고른 적이 없으면 기본값', () => {
    expect(loadGourmetFilter()).toEqual(DEFAULT_GOURMET_FILTER);
  });

  it('깨진 값도 지도를 세우지 못한다', () => {
    store.setItem('trip-board/gourmet-filter', '{not json');
    expect(loadGourmetFilter()).toEqual(DEFAULT_GOURMET_FILTER);
  });

  it('`localStorage`가 없어도 던지지 않는다', () => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
    expect(loadGourmetFilter()).toEqual(DEFAULT_GOURMET_FILTER);
    expect(saveGourmetFilter({ genres: ['sushi'], reservable: 'no', source: 'google' })).toEqual({
      genres: ['sushi'],
      reservable: 'no',
      source: 'google',
    });
  });
});

describe('패널 접기 (M45)', () => {
  const KEY = 'trip-board/gourmet-panel';

  it('기본값은 펼침 — 처음 켠 사람이 칩을 발견할 수 있어야 한다', () => {
    expect(loadGourmetPanelCollapsed()).toBe(false);
  });

  it('접으면 기억하고, 펴면 키를 지운다', () => {
    expect(saveGourmetPanelCollapsed(true)).toBe(true);
    expect(loadGourmetPanelCollapsed()).toBe(true);

    expect(saveGourmetPanelCollapsed(false)).toBe(false);
    expect(store.raw.has(KEY)).toBe(false);
    expect(loadGourmetPanelCollapsed()).toBe(false);
  });

  it('모르는 값은 펼침으로 읽는다', () => {
    store.setItem(KEY, 'yes');
    expect(loadGourmetPanelCollapsed()).toBe(false);
  });

  it('접힘은 필터 선택과 섞이지 않는다', () => {
    saveGourmetFilter({ genres: ['ramen'], reservable: 'yes', source: 'curated' });
    saveGourmetPanelCollapsed(true);
    expect(loadGourmetFilter()).toEqual({
      genres: ['ramen'],
      reservable: 'yes',
      source: 'curated',
    });
    expect(loadGourmetPanelCollapsed()).toBe(true);
  });

  it('`localStorage`가 없어도 던지지 않는다', () => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
    expect(loadGourmetPanelCollapsed()).toBe(false);
    expect(saveGourmetPanelCollapsed(true)).toBe(true);
  });
});
