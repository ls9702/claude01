import { describe, expect, it } from 'vitest';
import type { DrawBox, DrawElement, DrawImage, DrawStroke, DrawText } from '../types/models';
import {
  arrowHead,
  boxHit,
  dashArray,
  distanceToPolyline,
  distanceToSegment,
  elementBounds,
  hitTest,
  moveElementPatch,
  normalizeBox,
  pickTopElement,
  snapPoint,
  strokePath,
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

/* ------------------------------------------------------------------ *
 * 글자 상자 — 한글은 한 칸을 다 먹는다 (M52a-fix ④)
 * ------------------------------------------------------------------ */

describe('글자 요소의 상자', () => {
  const text = (value: string, size = 24): DrawText => ({
    id: 't1',
    updatedAt: 1,
    type: 'text',
    x: 0,
    y: 100,
    text: value,
    color: '#000',
    size,
  });

  it('「오」 스무 자는 영문 스무 자보다 훨씬 넓다 (전각 1.0em vs 0.62em)', () => {
    const korean = elementBounds(text('오'.repeat(20)));
    const latin = elementBounds(text('a'.repeat(20)));
    expect(korean.w).toBeCloseTo(20 * 24, 5);
    expect(latin.w).toBeCloseTo(20 * 24 * 0.62, 5);
    expect(korean.w).toBeGreaterThan(latin.w * 1.5);
  });

  it('한글 줄의 오른쪽 끝을 짚어도 맞는다 — 62%짜리 상자였던 자리', () => {
    const element = text('오사카 어디 갈까');
    const box = elementBounds(element);
    // 예전 어림(0.62em 고정)이면 상자가 여기까지 오지 못했다.
    const rightEdge = box.x + box.w - 2;
    expect(rightEdge).toBeGreaterThan(element.text.length * 24 * 0.62);
    expect(hitTest(element, rightEdge, element.y - 4)).toBe(true);
  });

  it('이모지는 한 글자로 세고 전각으로 친다', () => {
    expect(elementBounds(text('👍')).w).toBeCloseTo(24, 5);
  });

  it('여러 줄은 가장 긴 줄이 폭이고 줄 수가 높이다', () => {
    const box = elementBounds(text('가나다\nab'));
    expect(box.w).toBeCloseTo(3 * 24, 5);
    expect(box.h).toBeCloseTo(24 * 1.35 * 2, 5);
  });

  it('빈 글자도 상자를 잃지 않는다 (한 글자 폭이 하한)', () => {
    expect(elementBounds(text('')).w).toBe(24);
  });
});

describe('모르는 요소 타입 (M53-1) — 안 보이고 안 맞는다', () => {
  // 다음 회차가 요소 타입을 하나 늘린다. 그 요소가 든 워크스페이스가 이 빌드에
  // 닿았을 때 화면이 죽지 않는 것이 여기서 지켜진다.
  //
  // M53-2에서 `'image'`가 **진짜 타입이 되면서** 이 자리의 낯선 이름을 백로그의
  // 다음 후보(`'card'`, 보드 카드 미리보기)로 옮겼다 — 이 시험이 지키는 것은
  // 특정 이름이 아니라 「모르는 이름」이라는 성질이다.
  const alien = { id: 'x1', updatedAt: 1, type: 'card', x: 0, y: 0 } as unknown as DrawElement;

  it('경계 상자는 0이다', () => {
    expect(elementBounds(alien)).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });

  it('아무것도 맞히지 못한다', () => {
    expect(hitTest(alien, 0, 0)).toBe(false);
    expect(pickTopElement({ x1: alien }, ['x1'], 0, 0)).toBeNull();
  });

  it('움직이지 않는다 (빈 패치)', () => {
    expect(moveElementPatch(alien, 10, 10)).toEqual({});
  });
});

/* ------------------------------------------------------------------ *
 * M53-2 — 붙인 사진 · 잠금 · 스냅 · 점선 · 스무딩
 * ------------------------------------------------------------------ */

const image = (over: Partial<DrawImage> = {}): DrawElement => ({
  id: 'i1',
  updatedAt: 1,
  type: 'image',
  x: 100,
  y: 100,
  w: 200,
  h: 120,
  photoId: 'ph1',
  ...over,
});

describe('붙인 사진 요소 (B2)', () => {
  it('경계 상자는 네 수 그대로다', () => {
    expect(elementBounds(image())).toEqual({ x: 100, y: 100, w: 200, h: 120 });
  });

  it('안쪽까지 맞는다 — 사진은 채워진 것이다', () => {
    expect(hitTest(image(), 200, 160)).toBe(true);
    expect(hitTest(image(), 101, 101)).toBe(true);
    // 여유를 더 주지 않는다: 사진은 대개 크고, 여유가 넓으면 옆의 획을 못 짚는다.
    expect(hitTest(image(), 320, 160)).toBe(false);
  });

  it('옮기면 x·y만 바뀐다 (크기는 그대로)', () => {
    expect(moveElementPatch(image(), 12.4, -3.2)).toEqual({ x: 112, y: 97 });
  });
});

describe('잠금 (#10)', () => {
  it('잠긴 것은 없는 것처럼 통과한다 — Shift+클릭만 예외다', () => {
    const locked = image({ id: 'lock1', locked: true });
    const under = rect({ id: 'under', x: 100, y: 100, w: 200, h: 120, fill: '#eee' });
    const elements = { under, lock1: locked };
    const order = ['under', 'lock1'];

    // 위에 있는 것은 잠긴 사진인데, 집히는 것은 밑의 도형이다.
    expect(pickTopElement(elements, order, 200, 160)?.id).toBe('under');
    // Shift는 그것을 본다 — 그 한 가지가 없으면 잠근 것을 못 푼다.
    expect(pickTopElement(elements, order, 200, 160, 8, true)?.id).toBe('lock1');
  });
});

describe('snapPoint (#5)', () => {
  it('가까운 격자선에 붙는다 (내림이 아니라 반올림)', () => {
    expect(snapPoint(11, 13, 8)).toEqual({ x: 8, y: 16 });
    expect(snapPoint(-3, -5, 8)).toEqual({ x: -0, y: -8 });
  });

  it('꺼져 있거나 격자가 없으면 그대로다', () => {
    expect(snapPoint(11, 13, 8, false)).toEqual({ x: 11, y: 13 });
    expect(snapPoint(11, 13, 0)).toEqual({ x: 11, y: 13 });
  });
});

describe('dashArray (#4)', () => {
  it('굵기를 따라간다 — 고정 픽셀은 굵은 선에서 「이가 빠진 선」이 된다', () => {
    expect(dashArray(4, true)).toBe('10 8');
    expect(dashArray(8, true)).toBe('20 16');
  });

  it('실선은 속성 자체가 없다 (PNG에 쓸데없는 속성을 싣지 않는다)', () => {
    expect(dashArray(4)).toBeUndefined();
    expect(dashArray(4, false)).toBeUndefined();
  });
});

describe('strokePath (#7) — 렌더만 바꾼다', () => {
  it('첫 점에서 시작해 마지막 점에서 끝난다', () => {
    const d = strokePath([0, 0, 10, 10, 20, 0]);
    expect(d.startsWith('M 0 0')).toBe(true);
    expect(d.endsWith('20 0')).toBe(true);
    // 점 셋이면 곡선 구간은 둘이다.
    expect(d.match(/C/g)).toHaveLength(2);
  });

  it('점 하나는 점으로 남는다 (선이 아니다)', () => {
    expect(strokePath([5, 7])).toBe('M 5 7 L 5 7');
  });

  it('빈 획은 빈 문자열이다', () => {
    expect(strokePath([])).toBe('');
  });
});
