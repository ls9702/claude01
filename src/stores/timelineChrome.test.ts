import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  loadTimelineChrome,
  normalizeChrome,
  saveTimelineChrome,
} from './timelineChrome';

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

const KEY = 'trip-board/timeline-chrome';

let store: ReturnType<typeof fakeStorage>;

beforeEach(() => {
  store = fakeStorage();
  (globalThis as { localStorage?: unknown }).localStorage = store;
});

afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

describe('normalizeChrome', () => {
  it('collapsed === true 만 접힘으로 본다', () => {
    expect(normalizeChrome({ collapsed: true })).toEqual({ collapsed: true });
    expect(normalizeChrome({ collapsed: 'true' })).toEqual({ collapsed: false });
    expect(normalizeChrome({ collapsed: 1 })).toEqual({ collapsed: false });
  });

  it('객체가 아니면 펼침', () => {
    expect(normalizeChrome(null)).toEqual({ collapsed: false });
    expect(normalizeChrome('collapsed')).toEqual({ collapsed: false });
    expect(normalizeChrome(true)).toEqual({ collapsed: false });
  });
});

describe('load/saveTimelineChrome', () => {
  it('접은 상태를 그대로 되읽는다', () => {
    saveTimelineChrome({ collapsed: true });
    expect(loadTimelineChrome()).toEqual({ collapsed: true });
  });

  it('다시 펴면 키 자체를 지운다', () => {
    saveTimelineChrome({ collapsed: true });
    saveTimelineChrome({ collapsed: false });
    expect(store.raw.has(KEY)).toBe(false);
    expect(loadTimelineChrome()).toEqual({ collapsed: false });
  });

  it('아무것도 저장된 적 없으면 펼침이 기본값이다', () => {
    expect(loadTimelineChrome()).toEqual({ collapsed: false });
  });

  it('깨진 JSON은 펼침으로 읽는다', () => {
    store.setItem(KEY, '{nope');
    expect(loadTimelineChrome()).toEqual({ collapsed: false });
  });

  it('localStorage가 없어도 던지지 않는다', () => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
    expect(loadTimelineChrome()).toEqual({ collapsed: false });
    expect(saveTimelineChrome({ collapsed: true })).toEqual({ collapsed: true });
  });
});
