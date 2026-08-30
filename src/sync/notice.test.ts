import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  NOTICE_DISMISSED_KEY,
  clearDismissedNotice,
  loadDismissedNotice,
  saveDismissedNotice,
  shouldShowNotice,
} from './notice';

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

describe('shouldShowNotice', () => {
  it('공지가 없으면 아무것도 뜨지 않는다', () => {
    expect(shouldShowNotice(null, null)).toBe(false);
    expect(shouldShowNotice(undefined, null)).toBe(false);
    // 「내리기」가 도달하는 모습: 빈 글은 공지가 아니다.
    expect(shouldShowNotice({ text: '   ', at: 1 }, null)).toBe(false);
  });

  it('닫지 않았으면 뜬다', () => {
    expect(shouldShowNotice({ text: '내일 서버 점검', at: 1 }, null)).toBe(true);
  });

  it('같은 글은 다시 뜨지 않는다 — 시각이 바뀌어도', () => {
    // 폰이 꺼져 있어서 같은 공지가 다시 올라오는 것은 새 소식이 아니다.
    const dismissed = '내일 서버 점검';
    expect(shouldShowNotice({ text: dismissed, at: 1 }, dismissed)).toBe(false);
    expect(shouldShowNotice({ text: dismissed, at: 999 }, dismissed)).toBe(false);
  });

  it('글이 바뀌면 다시 뜬다', () => {
    expect(shouldShowNotice({ text: '점검 끝났어요', at: 2 }, '내일 서버 점검')).toBe(true);
  });

  it('앞뒤 공백은 같은 글로 친다', () => {
    expect(shouldShowNotice({ text: '  점검  ', at: 1 }, '점검')).toBe(false);
  });
});

describe('닫음 기억', () => {
  it('적고 읽고 지운다', () => {
    expect(loadDismissedNotice()).toBeNull();
    saveDismissedNotice('내일 서버 점검');
    expect(store.raw.get(NOTICE_DISMISSED_KEY)).toBe('내일 서버 점검');
    expect(loadDismissedNotice()).toBe('내일 서버 점검');
    clearDismissedNotice();
    expect(loadDismissedNotice()).toBeNull();
  });

  it('localStorage가 없어도 터지지 않는다', () => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
    expect(loadDismissedNotice()).toBeNull();
    expect(() => saveDismissedNotice('x')).not.toThrow();
  });
});
