import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_TIMELINE_EDIT,
  loadTimelineEdit,
  normalizeTimelineEdit,
  saveTimelineEdit,
} from './timelineEdit';

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

const KEY = 'trip-board/timeline-edit';

let store: ReturnType<typeof fakeStorage>;

beforeEach(() => {
  store = fakeStorage();
  (globalThis as { localStorage?: unknown }).localStorage = store;
});

afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

describe('normalizeTimelineEdit', () => {
  it('on === true 만 켜짐으로 본다', () => {
    expect(normalizeTimelineEdit({ on: true })).toEqual({ on: true });
    expect(normalizeTimelineEdit({ on: 'true' })).toEqual({ on: false });
    expect(normalizeTimelineEdit({ on: 1 })).toEqual({ on: false });
  });

  it('객체가 아니면 꺼짐', () => {
    expect(normalizeTimelineEdit(null)).toEqual({ on: false });
    expect(normalizeTimelineEdit('on')).toEqual({ on: false });
    expect(normalizeTimelineEdit(true)).toEqual({ on: false });
    expect(normalizeTimelineEdit([true])).toEqual({ on: false });
  });
});

describe('load/saveTimelineEdit', () => {
  it('기본값은 꺼짐이다 — 처음 여는 사람에게 사고가 나지 않는다', () => {
    expect(DEFAULT_TIMELINE_EDIT).toEqual({ on: false });
    expect(loadTimelineEdit()).toEqual({ on: false });
  });

  it('켠 상태를 그대로 되읽는다', () => {
    saveTimelineEdit({ on: true });
    expect(loadTimelineEdit()).toEqual({ on: true });
  });

  it('다시 끄면 키 자체를 지운다', () => {
    saveTimelineEdit({ on: true });
    saveTimelineEdit({ on: false });
    expect(store.raw.has(KEY)).toBe(false);
    expect(loadTimelineEdit()).toEqual({ on: false });
  });

  it('깨진 JSON은 꺼짐으로 읽는다', () => {
    store.setItem(KEY, '{nope');
    expect(loadTimelineEdit()).toEqual({ on: false });
  });

  it('localStorage가 없어도 던지지 않는다', () => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
    expect(loadTimelineEdit()).toEqual({ on: false });
    expect(saveTimelineEdit({ on: true })).toEqual({ on: true });
  });
});
