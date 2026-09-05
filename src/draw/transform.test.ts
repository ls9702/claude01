import { describe, expect, it } from 'vitest';
import type {
  DrawBox,
  DrawElement,
  DrawImage,
  DrawSegment,
  DrawSticker,
  DrawStroke,
  DrawText,
} from '../types/models';
import { elementBounds } from './geometry';
import {
  ALL_HANDLES,
  CORNER_HANDLES,
  DRAW_MIN_SIZE,
  DRAW_PASTE_OFFSET,
  boxIntersects,
  handlePoint,
  handlesFor,
  marqueeHits,
  pasteElements,
  pickHandle,
  resizeBox,
  resizeElementPatch,
  unionBounds,
  uniformOnly,
} from './transform';

const stroke = (over: Partial<DrawStroke> = {}): DrawElement => ({
  id: 's1',
  updatedAt: 1,
  type: 'stroke',
  points: [0, 0, 100, 50],
  color: '#000',
  width: 4,
  kind: 'pen',
  ...over,
});

const rect = (over: Partial<DrawBox> = {}): DrawElement => ({
  id: 'r1',
  updatedAt: 1,
  type: 'rect',
  x: 0,
  y: 0,
  w: 100,
  h: 50,
  color: '#000',
  width: 2,
  ...over,
});

const arrow = (over: Partial<DrawSegment> = {}): DrawElement => ({
  id: 'a1',
  updatedAt: 1,
  type: 'arrow',
  x1: 0,
  y1: 0,
  x2: 100,
  y2: 100,
  color: '#000',
  width: 2,
  ...over,
});

const text = (over: Partial<DrawText> = {}): DrawElement => ({
  id: 't1',
  updatedAt: 1,
  type: 'text',
  x: 100,
  y: 100,
  text: '난바',
  color: '#000',
  size: 24,
  ...over,
});

const sticker = (over: Partial<DrawSticker> = {}): DrawElement => ({
  id: 'k1',
  updatedAt: 1,
  type: 'sticker',
  x: 100,
  y: 100,
  emoji: '📍',
  size: 48,
  ...over,
});

const BOX = { x: 0, y: 0, w: 100, h: 50 };

/* ------------------------------------------------------------------ *
 * 핸들
 * ------------------------------------------------------------------ */

describe('handlePoint / pickHandle', () => {
  it('여덟 핸들이 상자의 둘레에 앉는다', () => {
    expect(handlePoint(BOX, 'nw')).toEqual({ x: 0, y: 0 });
    expect(handlePoint(BOX, 'se')).toEqual({ x: 100, y: 50 });
    expect(handlePoint(BOX, 'n')).toEqual({ x: 50, y: 0 });
    expect(handlePoint(BOX, 'w')).toEqual({ x: 0, y: 25 });
  });

  it('여유 안이면 맞고, 밖이면 안 맞는다', () => {
    expect(pickHandle(BOX, 104, 52, 8)).toBe('se');
    expect(pickHandle(BOX, 120, 50, 8)).toBeNull();
  });

  it('둘이 겹치면 가까운 쪽이 이긴다', () => {
    // 위쪽 변의 왼쪽 끝 — `nw`와 `n` 둘 다 여유 안이지만 `nw`가 더 가깝다.
    expect(pickHandle(BOX, 6, 0, 60)).toBe('nw');
  });

  it('주지 않은 핸들은 맞지 않는다 (글자·스티커는 모서리 넷뿐)', () => {
    expect(pickHandle(BOX, 50, 0, 8, CORNER_HANDLES)).toBeNull();
    expect(pickHandle(BOX, 0, 0, 8, CORNER_HANDLES)).toBe('nw');
  });

  it('상자의 한가운데는 어느 핸들도 아니다 — 그 자리는 이동이다', () => {
    expect(pickHandle(BOX, 50, 25, 16)).toBeNull();
  });
});

describe('handlesFor / uniformOnly', () => {
  it('글자와 스티커만 균등 전용이다', () => {
    expect(uniformOnly(text())).toBe(true);
    expect(uniformOnly(sticker())).toBe(true);
    expect(uniformOnly(rect())).toBe(false);
  });

  it('하나라도 섞이면 묶음 전체가 모서리 넷이 된다', () => {
    expect(handlesFor([rect(), stroke()])).toEqual(ALL_HANDLES);
    expect(handlesFor([rect(), text()])).toEqual(CORNER_HANDLES);
  });
});

/* ------------------------------------------------------------------ *
 * 상자 끌기
 * ------------------------------------------------------------------ */

describe('resizeBox', () => {
  it('맞은편 변은 제자리에 있다', () => {
    const box = resizeBox(BOX, 'se', 20, 10);
    expect(box).toEqual({ x: 0, y: 0, w: 120, h: 60 });

    const west = resizeBox(BOX, 'nw', 20, 10);
    expect(west).toEqual({ x: 20, y: 10, w: 80, h: 40 });
  });

  it('한 변 핸들은 그 축만 움직인다', () => {
    expect(resizeBox(BOX, 'e', 30, 999)).toEqual({ x: 0, y: 0, w: 130, h: 50 });
    expect(resizeBox(BOX, 'n', 999, 10)).toEqual({ x: 0, y: 10, w: 100, h: 40 });
  });

  it('반대편으로 넘기면 상자가 뒤집힌다 — 부호는 normalizeBox가 먹는다', () => {
    const box = resizeBox(BOX, 'e', -160, 0);
    expect(box.x).toBeLessThan(0);
    expect(box.w).toBeGreaterThan(0);
  });

  it('최소 크기 아래로는 내려가지 않는다 (0으로 눌러 붙지 않는다)', () => {
    const box = resizeBox(BOX, 'se', -97, -48);
    expect(box.w).toBe(DRAW_MIN_SIZE);
    expect(box.h).toBe(DRAW_MIN_SIZE);
    // 고정점(왼쪽 위)은 그대로다.
    expect(box.x).toBe(0);
    expect(box.y).toBe(0);
  });

  it('원래 두께가 0인 축은 0으로 남는다 (가로선의 높이)', () => {
    const flat = { x: 0, y: 100, w: 200, h: 0 };
    const box = resizeBox(flat, 'e', 50, 0);
    expect(box.h).toBe(0);
    expect(box.w).toBe(250);
  });

  it('균등이면 두 축이 같은 배율로 간다', () => {
    const box = resizeBox(BOX, 'se', 100, 0, true);
    // 가로가 2배로 갔으니 세로도 2배다.
    expect(box.w / BOX.w).toBeCloseTo(2);
    expect(box.h / BOX.h).toBeCloseTo(2);
  });
});

/* ------------------------------------------------------------------ *
 * 요소 변형
 * ------------------------------------------------------------------ */

describe('resizeElementPatch', () => {
  it('획의 점은 아핀으로 옮겨지고 굵기는 그대로다', () => {
    const element = stroke({ points: [0, 0, 100, 50] });
    const from = elementBounds(element);
    const to = { x: from.x, y: from.y, w: from.w * 2, h: from.h * 2 };
    const patch = resizeElementPatch(element, from, to) as Partial<DrawStroke>;

    expect(patch.width).toBeUndefined();
    expect(patch.points).toHaveLength(4);
    // 첫 점은 상자의 왼쪽 위 여백만큼 안쪽에 있었고, 그 여백도 함께 두 배가 된다.
    expect(patch.points![2] - patch.points![0]).toBe(200);
    expect(patch.points![3] - patch.points![1]).toBe(100);
    expect(Number.isInteger(patch.points![0])).toBe(true);
  });

  it('사각형은 상자 그 자체가 된다', () => {
    const element = rect();
    const to = { x: 10, y: 20, w: 200, h: 100 };
    expect(resizeElementPatch(element, elementBounds(element), to)).toEqual({
      x: 10,
      y: 20,
      w: 200,
      h: 100,
    });
  });

  it('화살표는 두 끝점이 각각 따라간다 (방향은 그대로)', () => {
    const element = arrow();
    const from = elementBounds(element);
    const patch = resizeElementPatch(element, from, {
      x: 0,
      y: 0,
      w: from.w / 2,
      h: from.h,
    }) as Partial<DrawSegment>;
    expect(patch.x1).toBe(0);
    expect(patch.x2).toBe(50);
    expect(patch.y2).toBe(100);
  });

  it('글자·스티커는 크기가 균등하게 자란다', () => {
    const element = text({ size: 24 });
    const from = elementBounds(element);
    const patch = resizeElementPatch(element, from, {
      x: from.x,
      y: from.y,
      w: from.w * 2,
      h: from.h * 2,
    }) as Partial<DrawText>;
    expect(patch.size).toBe(48);

    const emoji = sticker({ size: 48 });
    const box = elementBounds(emoji);
    const half = resizeElementPatch(emoji, box, {
      x: box.x,
      y: box.y,
      w: box.w / 2,
      h: box.h / 2,
    }) as Partial<DrawSticker>;
    expect(half.size).toBe(24);
  });

  it('크기가 최소치 아래로 내려가지 않는다', () => {
    const emoji = sticker({ size: 48 });
    const box = elementBounds(emoji);
    const patch = resizeElementPatch(emoji, box, {
      x: box.x,
      y: box.y,
      w: 1,
      h: 1,
    }) as Partial<DrawSticker>;
    expect(patch.size).toBe(DRAW_MIN_SIZE);
  });

  it('묶음 상자로 부르면 각자 제 비율로 따라간다', () => {
    const a = rect({ id: 'a', x: 0, y: 0, w: 100, h: 100 });
    const b = rect({ id: 'b', x: 100, y: 0, w: 100, h: 100 });
    const from = unionBounds([a, b])!;
    const to = { x: 0, y: 0, w: from.w * 2, h: from.h };

    expect(resizeElementPatch(a, from, to)).toMatchObject({ x: 0, w: 200 });
    expect(resizeElementPatch(b, from, to)).toMatchObject({ x: 200, w: 200 });
  });

  it('두께 0인 축에서도 죽지 않는다 (0으로 나누지 않는다)', () => {
    const flat = stroke({ points: [0, 100, 200, 100] });
    const from = { x: 0, y: 100, w: 200, h: 0 };
    const patch = resizeElementPatch(flat, from, { x: 0, y: 100, w: 100, h: 0 }) as Partial<DrawStroke>;
    expect(patch.points).toEqual([0, 100, 100, 100]);
  });

  it('모르는 타입은 아무 일도 일어나지 않는다 (블록 2의 새 요소 대비)', () => {
    // `'image'`는 M53-2에서 진짜 타입이 됐다 — 낯선 이름은 다음 후보로 옮긴다.
    const alien = { id: 'x', updatedAt: 1, type: 'card' } as unknown as DrawElement;
    expect(resizeElementPatch(alien, BOX, { x: 0, y: 0, w: 10, h: 10 })).toEqual({});
  });
});

/* ------------------------------------------------------------------ *
 * 묶음과 마퀴
 * ------------------------------------------------------------------ */

describe('unionBounds / boxIntersects', () => {
  it('여럿을 다 감싼다', () => {
    expect(unionBounds([rect({ x: 0, y: 0, w: 10, h: 10 }), rect({ x: 90, y: 40, w: 10, h: 10 })])).toEqual(
      { x: 0, y: 0, w: 100, h: 50 },
    );
  });

  it('아무것도 없으면 상자가 없다', () => {
    expect(unionBounds([])).toBeNull();
  });

  it('스치기만 해도 만난 것이다', () => {
    expect(boxIntersects(BOX, { x: 100, y: 50, w: 10, h: 10 })).toBe(true);
    expect(boxIntersects(BOX, { x: 101, y: 50, w: 10, h: 10 })).toBe(false);
  });
});

describe('marqueeHits', () => {
  const a = rect({ id: 'a', x: 0, y: 0, w: 50, h: 50 });
  const b = rect({ id: 'b', x: 200, y: 200, w: 50, h: 50 });
  const gone = { ...rect({ id: 'c', x: 10, y: 10, w: 10, h: 10 }), deletedAt: 5 };
  const elements = { a, b, c: gone };
  const order = ['a', 'c', 'b'];

  it('상자에 걸린 것만, 그리는 순서대로 준다', () => {
    expect(marqueeHits(elements, order, { x: -10, y: -10, w: 400, h: 400 })).toEqual(['a', 'b']);
  });

  it('스치기만 해도 잡힌다 (폰에서 통째로 감싸기는 어렵다)', () => {
    expect(marqueeHits(elements, order, { x: 40, y: 40, w: 20, h: 20 })).toEqual(['a']);
  });

  it('빈 자리를 끌면 아무도 안 잡힌다', () => {
    expect(marqueeHits(elements, order, { x: 100, y: 100, w: 20, h: 20 })).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * 클립보드
 * ------------------------------------------------------------------ */

describe('pasteElements', () => {
  it('id·시각·삭제 도장을 떼고 계단만큼 내려놓는다', () => {
    const source = { ...rect({ x: 10, y: 20 }), deletedAt: 3 };
    const [copy] = pasteElements([source], DRAW_PASTE_OFFSET, DRAW_PASTE_OFFSET);

    expect(copy).not.toHaveProperty('id');
    expect(copy).not.toHaveProperty('updatedAt');
    expect(copy).not.toHaveProperty('deletedAt');
    expect(copy).toMatchObject({ type: 'rect', x: 10 + DRAW_PASTE_OFFSET, y: 20 + DRAW_PASTE_OFFSET });
  });

  it('획은 점 전부가 함께 내려간다', () => {
    const [copy] = pasteElements([stroke({ points: [0, 0, 10, 10] })], 16, 16) as {
      points: number[];
    }[];
    expect(copy.points).toEqual([16, 16, 26, 26]);
  });

  it('연타는 계단이 된다 — 같은 자리에 겹쳐 쌓이지 않는다', () => {
    const one = pasteElements([rect({ x: 0, y: 0 })], DRAW_PASTE_OFFSET, DRAW_PASTE_OFFSET);
    const two = pasteElements([rect({ x: 0, y: 0 })], DRAW_PASTE_OFFSET * 2, DRAW_PASTE_OFFSET * 2);
    expect((one[0] as { x: number }).x).toBe(16);
    expect((two[0] as { x: number }).x).toBe(32);
  });

  it('원본은 손대지 않는다', () => {
    const source = rect({ x: 10, y: 20 });
    pasteElements([source], 16, 16);
    expect(source).toMatchObject({ x: 10, y: 20 });
  });
});

/* ------------------------------------------------------------------ *
 * M53-2 — 붙인 사진 · 잠금
 * ------------------------------------------------------------------ */

const image = (over: Partial<DrawImage> = {}): DrawElement => ({
  id: 'i1',
  updatedAt: 1,
  type: 'image',
  x: 0,
  y: 0,
  w: 100,
  h: 50,
  photoId: 'ph1',
  ...over,
});

describe('붙인 사진의 리사이즈 (B2)', () => {
  it('도형과 같은 규칙이다 — 네 수를 그대로 매핑한다', () => {
    const patch = resizeElementPatch(image(), { x: 0, y: 0, w: 100, h: 50 }, {
      x: 10,
      y: 20,
      w: 200,
      h: 50,
    }) as Partial<DrawImage>;
    expect(patch).toEqual({ x: 10, y: 20, w: 200, h: 50 });
  });

  it('여덟 핸들을 받는다 — 비균등으로 늘릴 수 있다(글자·스티커와 다른 점)', () => {
    expect(uniformOnly(image())).toBe(false);
    expect(handlesFor([image()])).toEqual(ALL_HANDLES);
  });

  it('묶음 상자로 줄이면 제 비율로 따라간다', () => {
    const patch = resizeElementPatch(
      image({ x: 100, y: 0, w: 100, h: 50 }),
      { x: 0, y: 0, w: 200, h: 50 },
      { x: 0, y: 0, w: 100, h: 50 },
    ) as Partial<DrawImage>;
    expect(patch).toEqual({ x: 50, y: 0, w: 50, h: 50 });
  });
});

describe('잠금과 마퀴 (#10)', () => {
  it('잠긴 것은 상자에 걸려도 잡히지 않는다', () => {
    const elements = {
      a: rect({ id: 'a', x: 0, y: 0, w: 50, h: 50 }),
      b: image({ id: 'b', x: 0, y: 0, w: 50, h: 50, locked: true }),
    };
    expect(marqueeHits(elements, ['a', 'b'], { x: -5, y: -5, w: 100, h: 100 })).toEqual(['a']);
  });
});

describe('붙여넣은 사진 (B2)', () => {
  it('photoId를 그대로 나눠 쓴다 — 블롭은 불변이라 안전하다', () => {
    const [copy] = pasteElements([image({ x: 10, y: 10 })], 16, 16) as Partial<DrawImage>[];
    expect(copy.photoId).toBe('ph1');
    expect(copy).toMatchObject({ x: 26, y: 26, w: 100, h: 50 });
    // id·시각은 떼어 낸다(그것이 붙여넣기와 「다시 저장」의 차이다).
    expect('id' in copy).toBe(false);
    expect('updatedAt' in copy).toBe(false);
  });
});
