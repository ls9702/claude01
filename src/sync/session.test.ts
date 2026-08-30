import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  BASE_WORKSPACE_KEY,
  DEFAULT_SESSION_ID,
  SESSION_KEY,
  clearServerSession,
  isValidSessionId,
  loadServerSession,
  normalizeSessionId,
  saveServerSession,
  workspaceStorageKey,
} from './session';

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

describe('isValidSessionId', () => {
  it('서버가 경로로 쓸 수 있는 것만 통과시킨다', () => {
    expect(isValidSessionId('default')).toBe(true);
    expect(isValidSessionId('osaka-2026')).toBe(true);
    expect(isValidSessionId('a')).toBe(true);
    expect(isValidSessionId('9lives')).toBe(true);
  });

  it('경로가 될 수 있는 글자는 하나도 통과시키지 않는다', () => {
    // 이 목록이 이 기능의 보안 경계다 — `..`도 `/`도 만들 수 없어야 한다.
    expect(isValidSessionId('..')).toBe(false);
    expect(isValidSessionId('../etc')).toBe(false);
    expect(isValidSessionId('a/b')).toBe(false);
    expect(isValidSessionId('a.b')).toBe(false);
    expect(isValidSessionId('Osaka')).toBe(false);
    expect(isValidSessionId('-lead')).toBe(false);
    expect(isValidSessionId('')).toBe(false);
    expect(isValidSessionId('x'.repeat(33))).toBe(false);
    expect(isValidSessionId(null)).toBe(false);
    expect(isValidSessionId(7)).toBe(false);
  });
});

describe('normalizeSessionId', () => {
  it('무해한 실수(대문자·앞뒤 공백)는 고쳐 준다', () => {
    expect(normalizeSessionId('  Osaka-2026 ')).toBe('osaka-2026');
    expect(normalizeSessionId('DEFAULT')).toBe('default');
  });

  it('가운데 공백처럼 못 고치는 것은 거절한다', () => {
    expect(normalizeSessionId('osaka 2026')).toBeNull();
    expect(normalizeSessionId('오사카')).toBeNull();
    expect(normalizeSessionId('')).toBeNull();
    expect(normalizeSessionId(undefined)).toBeNull();
  });
});

describe('workspaceStorageKey', () => {
  it('default는 예전 키 그대로다 — 이행할 것이 없다', () => {
    // M46 이전의 모든 기기가 이 키 아래에 데이터를 갖고 있다. 이 한 줄이
    // 「최초 이행」 코드를 통째로 없애 준다.
    expect(workspaceStorageKey(DEFAULT_SESSION_ID)).toBe(BASE_WORKSPACE_KEY);
    expect(workspaceStorageKey('default')).toBe('trip-board/workspace');
  });

  it('다른 세션은 자기 이름공간을 갖는다', () => {
    expect(workspaceStorageKey('osaka-2026')).toBe('trip-board/workspace:osaka-2026');
  });

  it('쓸 수 없는 id는 default로 접는다 — 아무도 안 보는 칸에 데이터를 두지 않는다', () => {
    expect(workspaceStorageKey('../etc')).toBe(BASE_WORKSPACE_KEY);
    expect(workspaceStorageKey('')).toBe(BASE_WORKSPACE_KEY);
  });
});

describe('loadServerSession / saveServerSession', () => {
  it('아무것도 적혀 있지 않으면 default다', () => {
    expect(loadServerSession()).toBe('default');
  });

  it('적어 둔 것을 그대로 읽는다', () => {
    saveServerSession('osaka-2026');
    expect(store.raw.get(SESSION_KEY)).toBe('osaka-2026');
    expect(loadServerSession()).toBe('osaka-2026');
  });

  it('쓸 수 없는 값은 아예 적지 않는다', () => {
    saveServerSession('../etc');
    expect(store.raw.has(SESSION_KEY)).toBe(false);
  });

  it('손으로 망가뜨린 값은 default로 읽는다', () => {
    store.setItem(SESSION_KEY, '../etc');
    expect(loadServerSession()).toBe('default');
  });

  it('지우면 default로 돌아간다', () => {
    saveServerSession('osaka-2026');
    clearServerSession();
    expect(loadServerSession()).toBe('default');
  });

  it('localStorage가 없어도 터지지 않는다', () => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
    expect(loadServerSession()).toBe('default');
    expect(() => saveServerSession('osaka-2026')).not.toThrow();
    expect(() => clearServerSession()).not.toThrow();
  });
});
