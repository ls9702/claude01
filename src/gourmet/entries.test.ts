import { afterEach, describe, expect, it } from 'vitest';
import { GOURMET_ENTRIES } from '../data/gourmet';
import { gourmetEntries } from './entries';

interface Scope {
  __tripBoardGourmetEntries?: unknown;
}

afterEach(() => {
  delete (globalThis as Scope).__tripBoardGourmetEntries;
});

describe('큐레이션 목록 이음매', () => {
  it('아무것도 심지 않았으면 조사 배열 그대로', () => {
    expect(gourmetEntries()).toBe(GOURMET_ENTRIES);
  });

  it('심어 둔 것이 있으면 그것을 쓴다 — 스펙이 자기 목록을 들고 온다', () => {
    const seeded = [
      {
        id: 'spec-a',
        name: '스펙 한 곳',
        localName: 'スペック',
        genre: 'ramen' as const,
        city: 'osaka' as const,
        area: '난바',
        tabelog: 3.5,
        reservable: false,
        surveyedAt: '2026-08',
      },
    ];
    (globalThis as Scope).__tripBoardGourmetEntries = seeded;
    expect(gourmetEntries()).toBe(seeded);
  });

  it('배열이 아닌 것은 무시한다 — 이상한 값 하나가 목록을 비우지 않는다', () => {
    for (const junk of [null, 'nope', 7, { id: 'x' }]) {
      (globalThis as Scope).__tripBoardGourmetEntries = junk;
      expect(gourmetEntries()).toBe(GOURMET_ENTRIES);
    }
  });

  it('호출 시점에 읽는다 — 나중에 심어도 잡힌다', () => {
    expect(gourmetEntries()).toBe(GOURMET_ENTRIES);
    (globalThis as Scope).__tripBoardGourmetEntries = [];
    expect(gourmetEntries()).toEqual([]);
  });
});
