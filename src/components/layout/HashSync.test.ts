import { describe, expect, it } from 'vitest';
import { hashFor, parseDrawPageId, parseHash } from './HashSync';

describe('parseHash', () => {
  it('탭 이름을 읽는다', () => {
    expect(parseHash('#/board')).toBe('board');
    expect(parseHash('#/draw')).toBe('draw');
  });

  it('두 번째 칸이 있어도 탭은 첫 칸이다 (M52a 딥링크)', () => {
    expect(parseHash('#/draw/abc123')).toBe('draw');
  });

  it('모르는 해시는 undefined', () => {
    expect(parseHash('#/nope')).toBeUndefined();
    expect(parseHash('')).toBeUndefined();
  });
});

describe('parseDrawPageId', () => {
  it('드로우 해시의 두 번째 칸만 읽는다', () => {
    expect(parseDrawPageId('#/draw/abc123')).toBe('abc123');
    expect(parseDrawPageId('#/draw')).toBeUndefined();
    expect(parseDrawPageId('#/draw/')).toBeUndefined();
  });

  it('다른 탭의 두 번째 칸은 읽지 않는다', () => {
    expect(parseDrawPageId('#/board/abc123')).toBeUndefined();
  });

  it('물음표 뒤는 버린다', () => {
    expect(parseDrawPageId('#/draw/abc123?x=1')).toBe('abc123');
  });

  it('터무니없이 긴 값은 무시한다', () => {
    expect(parseDrawPageId(`#/draw/${'a'.repeat(200)}`)).toBeUndefined();
  });

  it('%가 섞인 값도 원래 글자로 돌려준다', () => {
    expect(parseDrawPageId(`#/draw/${encodeURIComponent('a b')}`)).toBe('a b');
  });
});

describe('hashFor', () => {
  it('보통 탭은 한 칸이다', () => {
    expect(hashFor('memo')).toBe('#/memo');
    // 드로우여도 열린 페이지가 없으면 한 칸이다.
    expect(hashFor('draw')).toBe('#/draw');
    // 다른 탭에서는 페이지 id를 싣지 않는다 — 그 주소는 그 탭의 것이 아니다.
    expect(hashFor('map', 'abc123')).toBe('#/map');
  });

  it('드로우 + 페이지는 두 칸이다', () => {
    expect(hashFor('draw', 'abc123')).toBe('#/draw/abc123');
  });

  it('왕복한다', () => {
    expect(parseDrawPageId(hashFor('draw', 'xyz'))).toBe('xyz');
  });
});
