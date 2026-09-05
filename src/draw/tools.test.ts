import { describe, expect, it } from 'vitest';
import {
  DRAW_BG_DEFAULT_OPACITY,
  DRAW_BG_MIN_OPACITY,
  DRAW_COLORS,
  DRAW_ERASER_SIZES,
  DRAW_GRID,
  DRAW_PAGE_SIZE,
  DRAW_PALETTE,
  DRAW_PAPER_CELL,
  DRAW_TEXT_MAX,
  DRAW_WIDTHS,
  centeredView,
  clampOpacity,
  eraserRadius,
  normalizeHex,
} from './tools';

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

/* ------------------------------------------------------------------ *
 * 컬러 보드 (M53-2)
 * ------------------------------------------------------------------ */

describe('normalizeHex', () => {
  it('소문자 #rrggbb로 떨어진다 — 대소문자 두 벌이면 「최근 색」이 같은 색을 둘로 센다', () => {
    expect(normalizeHex('#FF00AA')).toBe('#ff00aa');
    expect(normalizeHex('  #2F74D0 ')).toBe('#2f74d0');
    expect(normalizeHex('2f74d0')).toBe('#2f74d0');
  });

  it('세 자리는 여섯 자리로 편다', () => {
    expect(normalizeHex('#f0a')).toBe('#ff00aa');
    expect(normalizeHex('#000')).toBe('#000000');
  });

  it('색이 아닌 것은 null이다 — 기본색을 돌려주면 부르는 쪽이 기본을 못 고른다', () => {
    expect(normalizeHex('red')).toBeNull();
    expect(normalizeHex('#12345')).toBeNull();
    expect(normalizeHex('#gggggg')).toBeNull();
    expect(normalizeHex('')).toBeNull();
    expect(normalizeHex(undefined)).toBeNull();
    expect(normalizeHex(null)).toBeNull();
  });
});

describe('DRAW_PALETTE', () => {
  it('12색조 × 3명도 + 무채색 5 = 41색이다', () => {
    expect(DRAW_PALETTE).toHaveLength(41);
  });

  it('전부 정규화된 값이고 겹치지 않는다', () => {
    for (const swatch of DRAW_PALETTE) {
      expect(normalizeHex(swatch.value)).toBe(swatch.value);
      expect(swatch.label.length).toBeGreaterThan(0);
    }
    expect(new Set(DRAW_PALETTE.map((swatch) => swatch.value)).size).toBe(DRAW_PALETTE.length);
  });

  it('도구 바의 여섯 색이 **같은 값으로** 이 안에 있다', () => {
    // 같은 빨강이 두 값이면 선택 표시와 「최근 색」이 서로 어긋난다.
    const values = new Set(DRAW_PALETTE.map((swatch) => swatch.value));
    for (const swatch of DRAW_COLORS) expect(values.has(swatch.value)).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * 격자 · 지우개 (M53-2)
 * ------------------------------------------------------------------ */

describe('격자와 종이', () => {
  it('종이 한 칸은 격자 넷이다 — 8px 무늬는 4000×4000에서 잿빛이 된다', () => {
    expect(DRAW_GRID).toBe(8);
    expect(DRAW_PAPER_CELL).toBe(DRAW_GRID * 4);
  });
});

describe('eraserRadius (#11)', () => {
  it('굵기 세 단이 지우개 크기 세 단으로 읽힌다', () => {
    expect(DRAW_ERASER_SIZES.map((step) => step.width)).toEqual(
      DRAW_WIDTHS.map((step) => step.value),
    );
    expect(eraserRadius(2)).toBe(6);
    expect(eraserRadius(4)).toBe(14);
    expect(eraserRadius(8)).toBe(28);
  });

  it('모르는 굵기는 가운데 단이다', () => {
    expect(eraserRadius(3)).toBe(14);
    expect(eraserRadius(Number.NaN)).toBe(14);
  });
});

/* ------------------------------------------------------------------ *
 * 새 페이지가 여는 자리 (M53-fix ①)
 * ------------------------------------------------------------------ */

describe('centeredView (M53-fix ①)', () => {
  it('페이지의 한가운데가 화면의 한가운데에 오는 원점을 준다', () => {
    expect(centeredView(1280, 554)).toEqual({ x: 2000 - 640, y: 2000 - 277, scale: 1 });
    expect(centeredView(390, 700)).toEqual({ x: 2000 - 195, y: 2000 - 350, scale: 1 });
  });

  it('구석(0,0)은 답이 아니다 — 4000×4000의 왼쪽 위에는 아무것도 없다', () => {
    const view = centeredView(1280, 554);
    expect(view.x).toBeGreaterThan(0);
    expect(view.y).toBeGreaterThan(0);
  });

  it('화면 크기를 아직 모르면 페이지의 한가운데다', () => {
    expect(centeredView(0, 0)).toEqual({ x: DRAW_PAGE_SIZE / 2, y: DRAW_PAGE_SIZE / 2, scale: 1 });
    expect(centeredView(Number.NaN, -10)).toEqual({
      x: DRAW_PAGE_SIZE / 2,
      y: DRAW_PAGE_SIZE / 2,
      scale: 1,
    });
  });
});
