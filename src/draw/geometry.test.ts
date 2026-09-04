import { describe, expect, it } from 'vitest';
import type { DrawBox, DrawElement, DrawStroke } from '../types/models';
import {
  arrowHead,
  boxHit,
  distanceToPolyline,
  distanceToSegment,
  elementBounds,
  hitTest,
  moveElementPatch,
  normalizeBox,
  pickTopElement,
} from './geometry';

const stroke = (over: Partial<DrawStroke> = {}): DrawElement => ({
  id: 's1',
  updatedAt: 1,
  type: 'stroke',
  points: [0, 0, 100, 0],
  color: '#000',
  width: 4,
  kind: 'pen',
  ...over,
});

const rect = (over: Partial<DrawBox> = {}): DrawElement => ({
  id: 'r1',
  updatedAt: 1,
  type: 'rect',
  x: 10,
  y: 20,
  w: 100,
  h: 50,
  color: '#000',
  width: 2,
  ...over,
});

describe('normalizeBox', () => {
  it('어느 방향으로 끌어도 폭·높이가 양수다', () => {
    expect(normalizeBox(100, 100, 40, 60)).toEqual({ x: 40, y: 60, w: 60, h: 40 });
    expect(normalizeBox(40, 60, 100, 100)).toEqual({ x: 40, y: 60, w: 60, h: 40 });
  });
});

describe('distanceToSegment', () => {
  it('선분 밖의 점은 끝점까지의 거리다 (직선이 아니다)', () => {
    expect(distanceToSegment(20, 0, 0, 0, 10, 0)).toBe(10);
    expect(distanceToSegment(5, 3, 0, 0, 10, 0)).toBe(3);
  });

  it('길이 0인 선분은 그 점이다', () => {
    expect(distanceToSegment(3, 4, 0, 0, 0, 0)).toBe(5);
  });
});

describe('distanceToPolyline', () => {
  it('가장 가까운 마디까지의 거리다', () => {
    expect(distanceToPolyline([0, 0, 10, 0, 10, 10], 12, 5)).toBe(2);
  });

  it('빈 획은 Infinity — 절대 맞지 않는다', () => {
    expect(distanceToPolyline([], 0, 0)).toBe(Infinity);
  });
});

describe('arrowHead', () => {
  it('촉의 두 날개가 **진행 방향의 뒤쪽**에 선다', () => {
    const wings = arrowHead(0, 0, 100, 0, 4);
    expect(wings).toHaveLength(2);
    for (const wing of wings) expect(wing.x).toBeLessThan(100);
    // 축을 사이에 두고 갈라진다.
    expect(Math.sign(wings[0].y) * Math.sign(wings[1].y)).toBe(-1);
  });

  it('반대 방향으로 그으면 촉도 반대로 돈다', () => {
    const wings = arrowHead(100, 0, 0, 0, 4);
    for (const wing of wings) expect(wing.x).toBeGreaterThan(0);
  });

  it('길이가 0이면 촉을 그리지 않는다 (방향이 없다)', () => {
    expect(arrowHead(5, 5, 5, 5, 4)).toEqual([]);
  });

  it('짧은 화살표에서 촉이 선분보다 길어지지 않는다', () => {
    const wings = arrowHead(0, 0, 6, 0, 8);
    for (const wing of wings) expect(wing.x).toBeGreaterThanOrEqual(0);
  });
});

describe('elementBounds', () => {
  it('획은 굵기의 절반만큼 넉넉하다', () => {
    expect(elementBounds(stroke({ points: [10, 10, 30, 40], width: 4 }))).toEqual({
      x: 8,
      y: 8,
      w: 24,
      h: 34,
    });
  });

  it('스티커의 좌표는 가운데다', () => {
    expect(
      elementBounds({ id: 'k', updatedAt: 1, type: 'sticker', x: 100, y: 100, emoji: '📍', size: 48 }),
    ).toEqual({ x: 76, y: 76, w: 48, h: 48 });
  });

  it('직선의 상자는 방향과 무관하다', () => {
    const a = elementBounds({
      id: 'l',
      updatedAt: 1,
      type: 'line',
      x1: 50,
      y1: 60,
      x2: 10,
      y2: 20,
      color: '#000',
      width: 2,
    });
    expect(a).toEqual({ x: 10, y: 20, w: 40, h: 40 });
  });
});

describe('hitTest', () => {
  it('획은 획 자신에 닿아야 맞은 것이다 — 경계 상자가 아니다', () => {
    const bent = stroke({ points: [0, 0, 100, 0, 100, 100] });
    expect(hitTest(bent, 50, 2)).toBe(true);
    // 상자 안이지만 획에서 멀다.
    expect(hitTest(bent, 20, 80)).toBe(false);
  });

  it('테두리만 있는 사각형의 한가운데는 그 사각형이 아니다', () => {
    expect(hitTest(rect(), 60, 45)).toBe(false);
    expect(hitTest(rect(), 10, 45)).toBe(true);
  });

  it('채운 사각형은 안쪽까지 맞힘이다', () => {
    expect(hitTest(rect({ fill: '#eee' }), 60, 45)).toBe(true);
  });

  it('글자와 스티커는 상자로 판정한다', () => {
    const sticker: DrawElement = {
      id: 'k',
      updatedAt: 1,
      type: 'sticker',
      x: 100,
      y: 100,
      emoji: '⭐',
      size: 48,
    };
    expect(hitTest(sticker, 100, 100)).toBe(true);
    expect(hitTest(sticker, 200, 100)).toBe(false);
  });
});

describe('pickTopElement', () => {
  const under = stroke({ id: 'under', points: [0, 0, 100, 0] });
  const over = stroke({ id: 'over', points: [0, 0, 100, 0] });
  const elements = { under, over };

  it('겹친 자리에서는 나중에 그린 것을 준다', () => {
    expect(pickTopElement(elements, ['under', 'over'], 50, 0)?.id).toBe('over');
    expect(pickTopElement(elements, ['over', 'under'], 50, 0)?.id).toBe('under');
  });

  it('지운 요소는 후보가 아니다', () => {
    const withDeleted = { under, over: { ...over, deletedAt: 5 } };
    expect(pickTopElement(withDeleted, ['under', 'over'], 50, 0)?.id).toBe('under');
  });

  it('아무것도 없으면 null', () => {
    expect(pickTopElement(elements, ['under', 'over'], 500, 500)).toBeNull();
  });
});

describe('moveElementPatch', () => {
  it('획은 모든 점이 함께 옮겨지고 정수로 떨어진다', () => {
    const patch = moveElementPatch(stroke({ points: [0, 0, 10, 10] }), 5.4, -2.6);
    expect(patch).toEqual({ points: [5, -3, 15, 7] });
  });

  it('도형은 왼쪽 위 모서리만 옮긴다 (크기는 그대로)', () => {
    expect(moveElementPatch(rect(), 10, 10)).toEqual({ x: 20, y: 30 });
  });

  it('선분은 두 끝점이 같이 간다', () => {
    const patch = moveElementPatch(
      { id: 'l', updatedAt: 1, type: 'arrow', x1: 0, y1: 0, x2: 10, y2: 10, color: '#000', width: 2 },
      3,
      4,
    );
    expect(patch).toEqual({ x1: 3, y1: 4, x2: 13, y2: 14 });
  });
});

describe('boxHit', () => {
  it('여유를 준 만큼 넓어진다', () => {
    const box = { x: 0, y: 0, w: 10, h: 10 };
    expect(boxHit(box, 12, 5)).toBe(false);
    expect(boxHit(box, 12, 5, 3)).toBe(true);
  });
});
