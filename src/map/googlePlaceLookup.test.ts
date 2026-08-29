import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GMAPS_KEY_STORAGE } from './gmapsKey';
import { googlePlaceSearch, hasGoogleLookup, toGoogleCandidate } from './googlePlaceLookup';

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

describe('hasGoogleLookup', () => {
  it('키 하나가 전부다', () => {
    expect(hasGoogleLookup()).toBe(false);
    store.setItem(GMAPS_KEY_STORAGE, 'test-key');
    expect(hasGoogleLookup()).toBe(true);
  });

  it('빈 문자열은 키가 아니다', () => {
    store.setItem(GMAPS_KEY_STORAGE, '   ');
    expect(hasGoogleLookup()).toBe(false);
  });
});

describe('toGoogleCandidate', () => {
  it('주소를 `locality`에 실어 카드 주소가 되게 한다', () => {
    expect(
      toGoogleCandidate({
        name: '마루하치 슈퍼 난바점',
        lat: 34.6641,
        lng: 135.5017,
        address: '일본 오사카부 오사카시 나니와구',
      }),
    ).toEqual({
      name: '마루하치 슈퍼 난바점',
      lat: 34.6641,
      lng: 135.5017,
      address: '일본 오사카부 오사카시 나니와구',
      locality: '일본 오사카부 오사카시 나니와구',
      refined: true,
      refinedBy: 'google',
    });
  });

  it('주소가 없으면 이름만 남고, 그래도 확인된 좌표다', () => {
    const candidate = toGoogleCandidate({ name: '난바역', lat: 34.66, lng: 135.5 });
    expect(candidate.address).toBeUndefined();
    expect(candidate.locality).toBeUndefined();
    expect(candidate.refined).toBe(true);
    expect(candidate.refinedBy).toBe('google');
  });

  it('이름조차 없으면 좌표가 이름이 된다', () => {
    expect(toGoogleCandidate({ name: '', lat: 1, lng: 2 }).name).toBe('1, 2');
  });
});

describe('googlePlaceSearch', () => {
  it('키가 없으면 아무것도 부르지 않고 빈 배열이다', async () => {
    await expect(googlePlaceSearch('난바')).resolves.toEqual([]);
  });
});
