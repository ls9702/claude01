import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LATEST_PATCH_ID, PATCH_NOTES } from '../patchNotes';
import {
  PATCH_SEEN_KEY,
  hasUnseenPatch,
  loadPatchSeen,
  normalizePatchSeen,
  savePatchSeen,
} from './patchSeen';

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

describe('normalizePatchSeen', () => {
  it('문자열 하나만 살리고 나머지는 「본 적 없음」이다', () => {
    expect(normalizePatchSeen('v3')).toBe('v3');
    expect(normalizePatchSeen('  v3  ')).toBe('v3');
    expect(normalizePatchSeen('')).toBeNull();
    expect(normalizePatchSeen('   ')).toBeNull();
    expect(normalizePatchSeen(null)).toBeNull();
    expect(normalizePatchSeen(undefined)).toBeNull();
    expect(normalizePatchSeen(9)).toBeNull();
    expect(normalizePatchSeen({ id: 'v3' })).toBeNull();
    expect(normalizePatchSeen(['v3'])).toBeNull();
  });
});

describe('loadPatchSeen / savePatchSeen', () => {
  it('적은 것을 그대로 돌려준다', () => {
    expect(loadPatchSeen()).toBeNull();
    savePatchSeen('v3');
    expect(store.raw.get(PATCH_SEEN_KEY)).toBe('v3');
    expect(loadPatchSeen()).toBe('v3');
  });

  it('손으로 고친 값은 「본 적 없음」으로 접는다', () => {
    store.raw.set(PATCH_SEEN_KEY, '   ');
    expect(loadPatchSeen()).toBeNull();
  });

  it('빈 값은 적지 않는다 — 「봤음」을 지우는 길이 아니다', () => {
    savePatchSeen('v3');
    savePatchSeen('   ');
    expect(loadPatchSeen()).toBe('v3');
  });

  it('localStorage가 없으면 조용히 아무것도 안 한다', () => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
    expect(loadPatchSeen()).toBeNull();
    expect(() => savePatchSeen('v3')).not.toThrow();
  });
});

describe('hasUnseenPatch', () => {
  it('본 적 없으면 배지를 켠다', () => {
    expect(hasUnseenPatch(null)).toBe(true);
    expect(hasUnseenPatch('')).toBe(true);
  });

  it('최신 회차를 봤으면 끈다', () => {
    expect(hasUnseenPatch(LATEST_PATCH_ID)).toBe(false);
    expect(hasUnseenPatch(`  ${LATEST_PATCH_ID}  `)).toBe(false);
  });

  it('옛 회차만 봤으면 다시 켠다', () => {
    expect(hasUnseenPatch(PATCH_NOTES[PATCH_NOTES.length - 1].id)).toBe(true);
    // 모르는 값도 「최신과 다르다」이므로 켠다 — 조용히 감추지 않는다.
    expect(hasUnseenPatch('v999')).toBe(true);
  });

  it('최신 id를 직접 받아 판단할 수도 있다', () => {
    expect(hasUnseenPatch('v2', 'v2')).toBe(false);
    expect(hasUnseenPatch('v2', 'v3')).toBe(true);
  });
});

describe('PATCH_NOTES', () => {
  it('비어 있지 않고 LATEST_PATCH_ID가 맨 앞이다', () => {
    expect(PATCH_NOTES.length).toBeGreaterThan(0);
    expect(LATEST_PATCH_ID).toBe(PATCH_NOTES[0].id);
  });

  it('id는 겹치지 않고 v+숫자로 내림차순이다', () => {
    const ids = PATCH_NOTES.map((note) => note.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => /^v\d+$/.test(id))).toBe(true);

    const numbers = ids.map((id) => Number(id.slice(1)));
    const descending = [...numbers].sort((a, b) => b - a);
    expect(numbers).toEqual(descending);
  });

  it('최신이 맨 앞 — 날짜도 내림차순이다', () => {
    const dates = PATCH_NOTES.map((note) => note.date);
    expect(dates.every((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))).toBe(true);
    expect(dates).toEqual([...dates].sort().reverse());
  });

  it('회차마다 제목과 한 줄 이상의 내용이 있다', () => {
    for (const note of PATCH_NOTES) {
      expect(note.title.trim().length).toBeGreaterThan(0);
      expect(note.items.length).toBeGreaterThan(0);
      expect(note.items.every((item) => item.trim().length > 0)).toBe(true);
    }
  });
});
