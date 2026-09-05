import { describe, expect, it } from 'vitest';
import type { DrawElement, DrawPage } from '../types/models';
import {
  PNG_EMPTY_SIZE,
  PNG_MARGIN,
  PNG_MAX_EDGE,
  PNG_SCALE,
  backgroundRect,
  exportBounds,
  exportScale,
  pngFileName,
} from './png';
import { DRAW_PAGE_SIZE } from './tools';

const sticker = (id: string, x: number, y: number, size = 48): DrawElement => ({
  id,
  updatedAt: 1,
  type: 'sticker',
  x,
  y,
  emoji: '📍',
  size,
});

const page = (elements: DrawElement[], over: Partial<DrawPage> = {}): DrawPage => ({
  id: 'p1',
  tripId: 't1',
  title: '난바 밤',
  elements: Object.fromEntries(elements.map((element) => [element.id, element])),
  elementOrder: elements.map((element) => element.id),
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

describe('backgroundRect', () => {
  it('페이지 한가운데에 원본 비율로 들어간다 (contain)', () => {
    const box = backgroundRect(1600, 1200);
    expect(box.w).toBe(DRAW_PAGE_SIZE);
    expect(box.h).toBe(3000);
    expect(box.x).toBe(0);
    expect(box.y).toBe((DRAW_PAGE_SIZE - 3000) / 2);
  });

  it('세로 사진은 높이가 페이지를 채운다', () => {
    const box = backgroundRect(600, 1200);
    expect(box.h).toBe(DRAW_PAGE_SIZE);
    expect(box.w).toBe(2000);
    expect(box.y).toBe(0);
  });

  it('말이 안 되는 크기도 상자를 잃지 않는다', () => {
    expect(backgroundRect(0, 0).w).toBe(DRAW_PAGE_SIZE);
  });
});

describe('exportBounds', () => {
  it('요소들을 감싸고 여백을 두른다', () => {
    // 스티커의 x·y는 가운데다 — 48짜리 하나는 (76,76)~(124,124).
    const box = exportBounds(page([sticker('a', 100, 100)]));
    expect(box.x).toBe(76 - PNG_MARGIN);
    expect(box.w).toBe(48 + PNG_MARGIN * 2);
  });

  it('배경이 있으면 배경까지 감싼다', () => {
    const bg = backgroundRect(1000, 1000);
    const box = exportBounds(page([sticker('a', 100, 100)]), bg);
    expect(box.x).toBeLessThanOrEqual(76 - PNG_MARGIN);
    expect(box.x + box.w).toBeGreaterThanOrEqual(bg.x + bg.w);
  });

  it('지운 요소는 그림에 없다', () => {
    const alive = sticker('a', 100, 100);
    const gone = { ...sticker('b', 3000, 3000), deletedAt: 5 };
    const box = exportBounds(page([alive, gone]));
    expect(box.x + box.w).toBeLessThan(1000);
  });

  it('빈 페이지도 파일 하나를 만든다 — 한가운데의 기본 크기', () => {
    const box = exportBounds(page([]));
    expect(box.w).toBe(PNG_EMPTY_SIZE.w);
    expect(box.h).toBe(PNG_EMPTY_SIZE.h);
    expect(box.x + box.w / 2).toBe(DRAW_PAGE_SIZE / 2);
  });
});

describe('exportScale', () => {
  it('작은 그림은 2x 그대로다', () => {
    expect(exportScale({ x: 0, y: 0, w: 400, h: 300 })).toBe(PNG_SCALE);
  });

  it('배경을 깐 페이지(4080px)는 긴 변 상한에 맞춰 줄어든다', () => {
    const bounds = exportBounds(page([]), backgroundRect(1600, 1600));
    const scale = exportScale(bounds);
    expect(Math.max(bounds.w, bounds.h) * scale).toBeLessThanOrEqual(PNG_MAX_EDGE + 1);
    expect(scale).toBeLessThan(PNG_SCALE);
  });

  it('늘리지는 않는다', () => {
    expect(exportScale({ x: 0, y: 0, w: 10, h: 10 })).toBe(PNG_SCALE);
  });
});

describe('pngFileName', () => {
  it('페이지 제목이 파일 이름이 된다', () => {
    expect(pngFileName('난바 밤')).toBe('난바 밤.png');
  });

  it('파일 이름에 쓸 수 없는 글자는 걷힌다', () => {
    expect(pngFileName('a/b:c*?"<>|')).toBe('abc.png');
    expect(pngFileName('오'.repeat(200))).toHaveLength('오'.repeat(60).length + 4);
  });

  it('이름이 없으면 기본 이름을 쓴다', () => {
    expect(pngFileName('   ')).toBe('드로우.png');
    expect(pngFileName('///')).toBe('드로우.png');
  });
});
