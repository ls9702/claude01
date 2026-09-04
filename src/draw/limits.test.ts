import { describe, expect, it } from 'vitest';
import type { DrawPage, Id } from '../types/models';
import { DRAW_WARN_BYTES, drawBytes, drawSizeWarning, formatBytes, utf8Length } from './limits';

const page = (id: Id, elements = 0): DrawPage => ({
  id,
  tripId: 't1',
  title: `페이지 ${id}`,
  elements: Object.fromEntries(
    Array.from({ length: elements }, (_, index) => [
      `e${index}`,
      {
        id: `e${index}`,
        updatedAt: 1,
        type: 'stroke' as const,
        points: Array.from({ length: 200 }, (_, n) => n),
        color: '#3d3a36',
        width: 4,
        kind: 'pen' as const,
      },
    ]),
  ),
  elementOrder: Array.from({ length: elements }, (_, index) => `e${index}`),
  createdAt: 1,
  updatedAt: 1,
});

describe('utf8Length', () => {
  it('ASCII는 한 글자 1바이트', () => {
    expect(utf8Length('abc')).toBe(3);
  });

  it('한글은 3바이트, 이모지는 4바이트', () => {
    expect(utf8Length('가')).toBe(3);
    expect(utf8Length('📍')).toBe(4);
    expect(utf8Length('페이지📍')).toBe(3 * 3 + 4);
  });

  it('빈 문자열은 0', () => {
    expect(utf8Length('')).toBe(0);
  });
});

describe('drawBytes', () => {
  it('드로우가 없으면 0 — 워크스페이스 전체를 훑지 않는다', () => {
    expect(drawBytes(undefined)).toBe(0);
    expect(drawBytes({})).toBe(2); // `{}`
  });

  it('페이지가 늘면 커진다', () => {
    const one = drawBytes({ p1: page('p1', 1) });
    const two = drawBytes({ p1: page('p1', 1), p2: page('p2', 1) });
    expect(two).toBeGreaterThan(one);
  });

  it('한글 제목을 3바이트로 센다 (문자 수가 아니다)', () => {
    const bytes = drawBytes({ p1: page('p1') });
    expect(bytes).toBe(utf8Length(JSON.stringify({ p1: page('p1') })));
    expect(bytes).toBeGreaterThan(JSON.stringify({ p1: page('p1') }).length);
  });
});

describe('drawSizeWarning', () => {
  it('한도 아래에서는 아무 말도 하지 않는다', () => {
    expect(drawSizeWarning(0)).toBeNull();
    expect(drawSizeWarning(DRAW_WARN_BYTES)).toBeNull();
  });

  it('넘으면 크기를 사람 말로 담은 한 줄을 준다', () => {
    const text = drawSizeWarning(DRAW_WARN_BYTES + 1);
    expect(text).toContain('1.5MB');
    // 막는 말이 아니라 권하는 말이다.
    expect(text).toContain('지우면');
  });

  it('한도는 인자로 바꿀 수 있다 (상수 하나가 기본값)', () => {
    expect(drawSizeWarning(500, 400)).not.toBeNull();
    expect(drawSizeWarning(500, 600)).toBeNull();
  });
});

describe('formatBytes', () => {
  it('MB / KB / B', () => {
    expect(formatBytes(2_400_000)).toBe('2.4MB');
    expect(formatBytes(640_000)).toBe('640KB');
    expect(formatBytes(512)).toBe('512B');
  });
});
