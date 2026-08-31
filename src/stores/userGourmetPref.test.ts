import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_USER_GOURMET_FILTER } from '../gourmet/userSpots';
import {
  loadUserGourmetFilter,
  loadUserGourmetPanelCollapsed,
  normalizeUserGourmetFilter,
  saveUserGourmetFilter,
  saveUserGourmetPanelCollapsed,
} from './userGourmetPref';

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
    expect(normalizeUserGourmetFilter(null)).toEqual(DEFAULT_USER_GOURMET_FILTER);
    expect(normalizeUserGourmetFilter('sushi')).toEqual(DEFAULT_USER_GOURMET_FILTER);
    expect(normalizeUserGourmetFilter([])).toEqual(DEFAULT_USER_GOURMET_FILTER);
  });

  it('모르는 갈래는 버리고, 정해진 순서로 접는다', () => {
    expect(
      normalizeUserGourmetFilter({ genres: ['bar', 'yakiniku', 'sushi'], includeNone: true }),
    ).toEqual({ genres: ['sushi', 'bar'], includeNone: true });
  });

  it('「장르 없음」 키가 없던 옛 줄은 보여 주는 쪽으로 읽는다', () => {
    expect(normalizeUserGourmetFilter({ genres: ['cafe'] })).toEqual({
      genres: ['cafe'],
      includeNone: true,
    });
    expect(normalizeUserGourmetFilter({ genres: [], includeNone: false }).includeNone).toBe(
      false,
    );
  });
});

describe('저장과 불러오기', () => {
  it('고른 것이 없으면 기본값', () => {
    expect(loadUserGourmetFilter()).toEqual(DEFAULT_USER_GOURMET_FILTER);
  });

  it('저장한 것이 그대로 돌아온다', () => {
    saveUserGourmetFilter({ genres: ['cafe', 'ramen'], includeNone: false });
    expect(loadUserGourmetFilter()).toEqual({
      genres: ['ramen', 'cafe'],
      includeNone: false,
    });
  });

  it('저장은 정규화한 값을 돌려준다 — 호출부가 그대로 상태로 삼는다', () => {
    expect(
      saveUserGourmetFilter({
        genres: ['bar', 'nope'] as never,
        includeNone: true,
      }),
    ).toEqual({ genres: ['bar'], includeNone: true });
  });

  it('망가진 줄은 조용히 기본값으로', () => {
    store.raw.set('trip-board/usergourmet-filter', '{{{');
    expect(loadUserGourmetFilter()).toEqual(DEFAULT_USER_GOURMET_FILTER);
  });

  it('localStorage가 없어도 터지지 않는다', () => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
    expect(loadUserGourmetFilter()).toEqual(DEFAULT_USER_GOURMET_FILTER);
    expect(saveUserGourmetFilter({ genres: ['bar'], includeNone: true })).toEqual({
      genres: ['bar'],
      includeNone: true,
    });
  });
});

describe('패널 접기', () => {
  it('기본은 펼침이고, 접으면 기억한다', () => {
    expect(loadUserGourmetPanelCollapsed()).toBe(false);
    saveUserGourmetPanelCollapsed(true);
    expect(loadUserGourmetPanelCollapsed()).toBe(true);
  });

  it('펼침은 키를 지운다 — 기본값을 적어 두지 않는다', () => {
    saveUserGourmetPanelCollapsed(true);
    saveUserGourmetPanelCollapsed(false);
    expect(store.raw.has('trip-board/usergourmet-panel')).toBe(false);
  });

  it('M43의 키와 섞이지 않는다', () => {
    saveUserGourmetPanelCollapsed(true);
    expect(store.raw.has('trip-board/gourmet-panel')).toBe(false);
  });
});
