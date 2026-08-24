import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadRouteChoice, saveRouteChoice, storedDayId } from './mapRoutePref';

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

describe('storedDayId', () => {
  it('`day:` 접두사가 붙은 값에서만 일자 id를 꺼낸다', () => {
    expect(storedDayId('day:d1')).toBe('d1');
    expect(storedDayId('all')).toBeUndefined();
    expect(storedDayId('off')).toBeUndefined();
    expect(storedDayId('day:')).toBeUndefined();
    expect(storedDayId(undefined)).toBeUndefined();
  });
});

describe('load/saveRouteChoice', () => {
  it('여행마다 따로 기억한다', () => {
    saveRouteChoice('t1', 'all');
    saveRouteChoice('t2', 'day:d9');
    expect(loadRouteChoice('t1')).toBe('all');
    expect(loadRouteChoice('t2')).toBe('day:d9');
    expect(loadRouteChoice('t3')).toBeUndefined();
  });

  it('같은 여행을 다시 고르면 덮어쓴다', () => {
    saveRouteChoice('t1', 'all');
    saveRouteChoice('t1', 'off');
    expect(loadRouteChoice('t1')).toBe('off');
  });

  it('여행 id가 없으면 아무것도 하지 않는다', () => {
    saveRouteChoice(undefined, 'all');
    expect(store.raw.size).toBe(0);
    expect(loadRouteChoice(undefined)).toBeUndefined();
  });

  it('깨진 JSON·배열은 "기억 없음"으로 읽는다', () => {
    store.setItem('trip-board/map-route', '{nope');
    expect(loadRouteChoice('t1')).toBeUndefined();
    store.setItem('trip-board/map-route', '["all"]');
    expect(loadRouteChoice('t1')).toBeUndefined();
  });

  it('문자열이 아닌 값은 버린다', () => {
    store.setItem('trip-board/map-route', JSON.stringify({ t1: 3, t2: 'all' }));
    expect(loadRouteChoice('t1')).toBeUndefined();
    expect(loadRouteChoice('t2')).toBe('all');
  });

  it('localStorage가 없어도 던지지 않는다', () => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
    expect(() => saveRouteChoice('t1', 'all')).not.toThrow();
    expect(loadRouteChoice('t1')).toBeUndefined();
  });
});
