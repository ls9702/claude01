import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  GMAPS_KEY_STORAGE,
  hasGoogleMapsKey,
  loadGoogleMapsKey,
  normalizeGoogleMapsKey,
  saveGoogleMapsKey,
  useGoogleMapsKeyStore,
} from './gmapsKey';

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
  useGoogleMapsKeyStore.setState({ key: null });
});

afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

describe('normalizeGoogleMapsKey', () => {
  it('공백을 걷어낸 문자열만 키로 인정한다', () => {
    expect(normalizeGoogleMapsKey('  AIza-abc  ')).toBe('AIza-abc');
    expect(normalizeGoogleMapsKey('')).toBeNull();
    expect(normalizeGoogleMapsKey('   ')).toBeNull();
    expect(normalizeGoogleMapsKey(undefined)).toBeNull();
    expect(normalizeGoogleMapsKey(123)).toBeNull();
    expect(normalizeGoogleMapsKey({ key: 'x' })).toBeNull();
  });

  it('모양은 검사하지 않는다 — 구글이 발급하는 형식은 구글 사정이다', () => {
    expect(normalizeGoogleMapsKey('아무거나')).toBe('아무거나');
  });
});

describe('저장과 읽기', () => {
  it('적고 읽는다', () => {
    expect(saveGoogleMapsKey('AIza-abc')).toBe('AIza-abc');
    expect(store.raw.get(GMAPS_KEY_STORAGE)).toBe('AIza-abc');
    expect(loadGoogleMapsKey()).toBe('AIza-abc');
  });

  it('null을 주면 지운다', () => {
    saveGoogleMapsKey('AIza-abc');
    expect(saveGoogleMapsKey(null)).toBeNull();
    expect(store.raw.has(GMAPS_KEY_STORAGE)).toBe(false);
    expect(loadGoogleMapsKey()).toBeNull();
  });

  it('쓰레기가 적혀 있으면 없는 것으로 읽는다', () => {
    store.raw.set(GMAPS_KEY_STORAGE, '   ');
    expect(loadGoogleMapsKey()).toBeNull();
  });

  it('localStorage가 없어도 던지지 않는다', () => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
    expect(loadGoogleMapsKey()).toBeNull();
    expect(saveGoogleMapsKey('AIza-abc')).toBe('AIza-abc');
  });
});

describe('hasGoogleMapsKey', () => {
  it('스토어의 키 유무를 그대로 말한다', () => {
    expect(hasGoogleMapsKey()).toBe(false);
    useGoogleMapsKeyStore.getState().setKey('AIza-abc');
    expect(hasGoogleMapsKey()).toBe(true);
    expect(store.raw.get(GMAPS_KEY_STORAGE)).toBe('AIza-abc');
    useGoogleMapsKeyStore.getState().setKey('  ');
    expect(hasGoogleMapsKey()).toBe(false);
  });
});
