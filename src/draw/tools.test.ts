import { describe, expect, it } from 'vitest';
import { DRAW_BG_DEFAULT_OPACITY, DRAW_BG_MIN_OPACITY, DRAW_TEXT_MAX, clampOpacity } from './tools';

describe('clampOpacity (M52b)', () => {
  it('0.2~1 사이로 갇힌다 — 0으로 내려가면 되돌릴 손잡이가 없다', () => {
    expect(clampOpacity(0)).toBe(DRAW_BG_MIN_OPACITY);
    expect(clampOpacity(-3)).toBe(DRAW_BG_MIN_OPACITY);
    expect(clampOpacity(5)).toBe(1);
    expect(clampOpacity(0.55)).toBe(0.55);
  });

  it('소수 셋째 자리는 버린다 — 슬라이더가 만든 부동소수는 데이터가 아니다', () => {
    expect(clampOpacity(0.30000000000000004)).toBe(0.3);
  });

  it('값이 없으면 기본값이다', () => {
    expect(clampOpacity(undefined)).toBe(DRAW_BG_DEFAULT_OPACITY);
    expect(clampOpacity(Number.NaN)).toBe(DRAW_BG_DEFAULT_OPACITY);
  });
});

describe('DRAW_TEXT_MAX', () => {
  it('글자 하나의 상한은 500자다', () => {
    expect(DRAW_TEXT_MAX).toBe(500);
  });
});
