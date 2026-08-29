import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  GOURMET_CACHE_KEY,
  GOURMET_CACHE_VERSION,
  cacheKeyFor,
  clearGourmetCache,
  loadGourmetCache,
  normalizeResolved,
  saveGourmetResolved,
} from './cache';

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

const raw = (): Record<string, unknown> =>
  JSON.parse(store.getItem(GOURMET_CACHE_KEY) ?? '{}') as Record<string, unknown>;

describe('한 줄 정규화', () => {
  it('좌표가 없으면 줄이 아니다 — 이 캐시가 있는 이유가 좌표다', () => {
    expect(normalizeResolved({ address: '오사카' })).toBeNull();
    expect(normalizeResolved({ lat: 34.6, lng: 'x' })).toBeNull();
    expect(normalizeResolved(null)).toBeNull();
    expect(normalizeResolved([1, 2])).toBeNull();
    expect(normalizeResolved('34.6,135.5')).toBeNull();
  });

  it('아는 것만 남기고 나머지는 버린다', () => {
    expect(
      normalizeResolved({
        lat: 34.6,
        lng: 135.5,
        address: '  오사카시  ',
        googleRating: 4.6,
        googleRatingCount: 1200,
        reservable: true,
        placeId: 'p1',
        cachedAt: '2026-08-29T00:00:00.000Z',
        junk: '버려짐',
      }),
    ).toEqual({
      lat: 34.6,
      lng: 135.5,
      address: '오사카시',
      googleRating: 4.6,
      googleRatingCount: 1200,
      reservable: true,
      placeId: 'p1',
      cachedAt: '2026-08-29T00:00:00.000Z',
    });
  });

  it('평점·예약·주소를 모르는 줄도 좌표만 있으면 줄이다', () => {
    expect(normalizeResolved({ lat: 1, lng: 2 })).toEqual({ lat: 1, lng: 2, cachedAt: '' });
  });
});

describe('읽고 쓰기', () => {
  it('적은 것을 엔트리 id로 되읽는다', () => {
    saveGourmetResolved('ichiran-dotonbori', {
      lat: 34.6687,
      lng: 135.5013,
      googleRating: 4.4,
      placeId: 'p-ichiran',
      cachedAt: '2026-08-29T00:00:00.000Z',
    });
    const cache = loadGourmetCache();
    expect(cache['ichiran-dotonbori'].placeId).toBe('p-ichiran');
    // 키에 판 번호가 들어 있다.
    expect(Object.keys(raw())).toEqual([cacheKeyFor('ichiran-dotonbori')]);
  });

  it('옛 판의 줄은 읽히지 않고, 다음 저장에서 치워진다', () => {
    store.setItem(
      GOURMET_CACHE_KEY,
      JSON.stringify({
        [`${GOURMET_CACHE_VERSION - 1}:old-entry`]: { lat: 1, lng: 2, cachedAt: '' },
        [cacheKeyFor('kept')]: { lat: 3, lng: 4, cachedAt: '' },
      }),
    );
    expect(Object.keys(loadGourmetCache())).toEqual(['kept']);

    saveGourmetResolved('fresh', { lat: 5, lng: 6, cachedAt: '' });
    expect(Object.keys(raw()).sort()).toEqual([cacheKeyFor('fresh'), cacheKeyFor('kept')].sort());
  });

  it('깨진 JSON도, 이상한 줄도 지도를 세우지 못한다', () => {
    store.setItem(GOURMET_CACHE_KEY, '{not json');
    expect(loadGourmetCache()).toEqual({});

    store.setItem(GOURMET_CACHE_KEY, JSON.stringify([1, 2, 3]));
    expect(loadGourmetCache()).toEqual({});

    store.setItem(GOURMET_CACHE_KEY, JSON.stringify({ [cacheKeyFor('x')]: 'nope' }));
    expect(loadGourmetCache()).toEqual({});
  });

  it('버리면 빈다', () => {
    saveGourmetResolved('a', { lat: 1, lng: 2, cachedAt: '' });
    clearGourmetCache();
    expect(loadGourmetCache()).toEqual({});
  });

  it('`localStorage`가 없어도 던지지 않는다', () => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
    expect(loadGourmetCache()).toEqual({});
    expect(() => saveGourmetResolved('a', { lat: 1, lng: 2, cachedAt: '' })).not.toThrow();
    expect(() => clearGourmetCache()).not.toThrow();
  });
});
