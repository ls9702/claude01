import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  loadCollapsedColumns,
  normalizeCollapsed,
  saveCollapsedColumns,
  toggledCollapsed,
} from './collapsedColumns';

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

describe('normalizeCollapsed', () => {
  it('빈 문자열·비문자열·중복을 걷어낸다', () => {
    expect(normalizeCollapsed(['a', 'a', '', 1, null, 'b'])).toEqual(['a', 'b']);
  });

  it('배열이 아니면 빈 목록', () => {
    expect(normalizeCollapsed(null)).toEqual([]);
    expect(normalizeCollapsed({ a: 1 })).toEqual([]);
    expect(normalizeCollapsed('a,b')).toEqual([]);
  });
});

describe('toggledCollapsed', () => {
  it('없으면 넣고 있으면 뺀다', () => {
    expect(toggledCollapsed([], 'c1')).toEqual(['c1']);
    expect(toggledCollapsed(['c1'], 'c1')).toEqual([]);
    expect(toggledCollapsed(['c1'], 'c2')).toEqual(['c1', 'c2']);
  });
});

describe('load/saveCollapsedColumns', () => {
  it('저장한 목록을 그대로 되읽는다', () => {
    saveCollapsedColumns(['c1', 'c2']);
    expect(loadCollapsedColumns()).toEqual(['c1', 'c2']);
  });

  it('비우면 키 자체를 지운다', () => {
    saveCollapsedColumns(['c1']);
    saveCollapsedColumns([]);
    expect(store.raw.has('trip-board/collapsed')).toBe(false);
    expect(loadCollapsedColumns()).toEqual([]);
  });

  it('깨진 JSON은 "아무것도 접지 않음"으로 읽는다', () => {
    store.setItem('trip-board/collapsed', '{nope');
    expect(loadCollapsedColumns()).toEqual([]);
  });

  it('쓰레기 값이 섞여 있어도 id만 살린다', () => {
    store.setItem('trip-board/collapsed', JSON.stringify(['c1', 3, '', 'c1']));
    expect(loadCollapsedColumns()).toEqual(['c1']);
  });

  it('localStorage가 없어도 던지지 않는다', () => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
    expect(loadCollapsedColumns()).toEqual([]);
    expect(saveCollapsedColumns(['c1'])).toEqual(['c1']);
  });
});
