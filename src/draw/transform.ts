/**
 * 선택한 것을 바꾸는 순수 계산 (M53-1) — `geometry.ts`의 자매.
 *
 * `moveElementPatch`(이동)가 `geometry.ts`에 있는 것과 같은 이유로 여기 있는 것들도
 * 브라우저를 모른다: 「모서리를 이만큼 끌면 이 획의 점들이 어디로 가나」·「손가락이
 * 이 핸들을 맞혔나」·「마퀴 상자에 뭐가 걸렸나」는 전부 숫자의 질문이고, 스크린샷
 * 없이 답이 나와야 다음 회차가 이 자리를 겁내지 않는다.
 *
 * 좌표계는 `geometry.ts`와 똑같이 **페이지 로컬 px**다.
 */

import { elementBounds, moveElementPatch, normalizeBox, type Box } from './geometry';
import type { DrawElement, Id } from '../types/models';

/**
 * 리사이즈가 만들 수 있는 가장 작은 변 (로컬 px).
 *
 * 0으로 내려가면 요소가 점이 되어 다시 잡을 손잡이가 사라진다 — 「사라진 배경은
 * 되돌릴 손잡이가 없다」(`tools.clampOpacity`)와 같은 결의 하한이다.
 */
export const DRAW_MIN_SIZE = 8;

/** 상자 둘레의 여덟 자리. 이름은 나침반이다(`nw` = 왼쪽 위). */
export type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

/** 여덟 핸들 — 비균등 스케일이 가능한 요소만 이걸 받는다. */
export const ALL_HANDLES: readonly HandleId[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** 모서리 넷 — 균등 스케일만 되는 것들(글자·스티커)의 핸들. */
export const CORNER_HANDLES: readonly HandleId[] = ['nw', 'ne', 'se', 'sw'];

/** 핸들 하나가 앉는 자리. */
export function handlePoint(box: Box, handle: HandleId): { x: number; y: number } {
  const west = handle.includes('w');
  const east = handle.includes('e');
  const north = handle.includes('n');
  const south = handle.includes('s');
  return {
    x: west ? box.x : east ? box.x + box.w : box.x + box.w / 2,
    y: north ? box.y : south ? box.y + box.h : box.y + box.h / 2,
  };
}

/**
 * 이 요소는 **균등 스케일만** 되나 — 글자와 스티커가 그렇다.
 *
 * 둘 다 크기가 `size` 하나뿐이라(가로 따로·세로 따로가 없다) 비균등으로 끌 방법이
 * 없다. 글자 폭은 애초에 어림값이고(`geometry.textWidthEm`) 스티커는 글꼴이 그리는
 * 이모지 한 글자다.
 */
export const uniformOnly = (element: DrawElement): boolean =>
  element.type === 'text' || element.type === 'sticker';

/**
 * 이 선택에 붙일 핸들 — 하나라도 균등 전용이 섞이면 모서리 넷이다.
 *
 * 섞인 묶음에서 여덟 핸들을 주면 「가로만 늘렸는데 글자는 안 늘어난다」가 되어
 * 선택 상자와 그 안의 그림이 어긋난다. 넷으로 줄이면 무엇을 골랐든 상자와 내용이
 * 같은 비율로 움직인다.
 */
export const handlesFor = (elements: readonly DrawElement[]): readonly HandleId[] =>
  elements.some(uniformOnly) ? CORNER_HANDLES : ALL_HANDLES;

/**
 * 이 점이 어느 핸들을 맞혔나 — SVG가 아니라 순수 함수가 답한다.
 *
 * `hitTest`가 그런 것과 같은 이유다(`geometry.ts`): 10px짜리 사각형을 손가락으로
 * 정확히 짚으라는 것은 폰에서 불가능한 요구라, 화면의 크기(10)와 맞힘의 여유(24)가
 * 따로 있어야 한다. 여유는 정사각형이다 — 핸들이 정사각형이므로.
 */
export function pickHandle(
  box: Box,
  x: number,
  y: number,
  pad: number,
  handles: readonly HandleId[] = ALL_HANDLES,
): HandleId | null {
  let best: HandleId | null = null;
  let bestDistance = Infinity;
  for (const handle of handles) {
    const point = handlePoint(box, handle);
    const distance = Math.max(Math.abs(point.x - x), Math.abs(point.y - y));
    if (distance <= pad && distance < bestDistance) {
      bestDistance = distance;
      best = handle;
    }
  }
  return best;
}

/**
 * 핸들을 (dx, dy)만큼 끈 뒤의 상자.
 *
 * 규칙 셋이 전부다.
 * 1. **맞은편이 고정점**이다 — 서쪽 핸들을 끌면 동쪽 변이 제자리에 있어야 한다.
 * 2. **뒤집힘은 새 규칙을 만들지 않는다** — 핸들을 반대편으로 넘기면 `normalizeBox`가
 *    부호를 흡수한다(그 함수가 태어난 이유 그대로).
 * 3. **원래 두께가 0인 축은 0으로 남긴다** — 가로선의 높이에 최소 8을 강제하면
 *    선이 이유 없이 4px 내려앉는다.
 */
export function resizeBox(
  from: Box,
  handle: HandleId,
  dx: number,
  dy: number,
  uniform = false,
): Box {
  const west = handle.includes('w');
  const east = handle.includes('e');
  const north = handle.includes('n');
  const south = handle.includes('s');

  // 고정점 = 끄는 변의 맞은편. 손대지 않는 축에서는 상자의 시작점 그대로다.
  const anchorX = west ? from.x + from.w : from.x;
  const anchorY = north ? from.y + from.h : from.y;

  // 고정점에서 끄는 변까지의 **부호 있는** 거리 — 음수면 뒤집힌 것이다.
  let spanX = west || east ? from.w + (west ? -dx : dx) : from.w;
  let spanY = north || south ? from.h + (north ? -dy : dy) : from.h;

  if (uniform && (west || east) && (north || south) && from.w > 0 && from.h > 0) {
    // 모서리를 끌 때의 균등 스케일: 두 축 중 **많이 움직인 쪽**이 배율을 정한다.
    // 대각선 투영이 아니라 최댓값인 이유는 손이 예측하기 쉬워서다 — 어느 쪽으로
    // 끌든 끈 만큼 커진다.
    const sx = spanX / from.w;
    const sy = spanY / from.h;
    const scale = Math.max(Math.abs(sx), Math.abs(sy));
    spanX = (sx < 0 ? -scale : scale) * from.w;
    spanY = (sy < 0 ? -scale : scale) * from.h;
  }

  const minW = from.w > 0 ? DRAW_MIN_SIZE : 0;
  const minH = from.h > 0 ? DRAW_MIN_SIZE : 0;
  if (Math.abs(spanX) < minW) spanX = spanX < 0 ? -minW : minW;
  if (Math.abs(spanY) < minH) spanY = spanY < 0 ? -minH : minH;

  return normalizeBox(
    anchorX,
    anchorY,
    west ? anchorX - spanX : anchorX + spanX,
    north ? anchorY - spanY : anchorY + spanY,
  );
}

/**
 * 상자 `from`에 있던 요소를 상자 `to`로 옮긴 **패치** (M53-1).
 *
 * `moveElementPatch`와 같은 약속을 지킨다: 요소를 다시 만들지 않고 바뀐 필드만
 * 주며, 좌표는 정수로 떨어진다. 묶음 리사이즈도 같은 함수 하나가 답한다 —
 * `from`/`to`에 묶음 전체의 상자를 주면 각 요소가 제 비율로 따라간다.
 *
 * | 타입 | 규칙 |
 * |---|---|
 * | `stroke` | 점 배열을 아핀 스케일. **`width`는 건드리지 않는다** |
 * | `rect`/`ellipse`/`image` | 네 수를 그대로 매핑(요소 하나면 `to` 대입과 같은 값) |
 * | `line`/`arrow` | 두 끝점을 각각 매핑 — 화살촉은 `arrowHead`가 알아서 따라온다 |
 * | `text`/`sticker` | `size`만 균등 스케일 + 자리 이동 |
 *
 * **`width`를 스케일하지 않는 이유**는 굵기가 그림이 아니라 **자**이기 때문이다:
 * `hitTest`가 `width/2`를 여유로 더하고(`geometry.ts`), 형광펜의 굵기 배수도 저장된
 * 값이다(`tools.HIGHLIGHT_WIDTH_FACTOR`). 스케일하면 축소→확대 왕복에서 정수
 * 반올림으로 원래 굵기가 돌아오지 않는다. 「굵기도 같이」는 옵션의 자리다.
 *
 * 모르는 타입은 **빈 패치**를 받는다 — 옛 빌드에 새 요소 타입이 닿았을 때의 최선의
 * 결말은 「그 요소만 아무 일도 일어나지 않는 것」이다(`DrawElementBase` 주석의
 * 톰스톤 논증과 같은 결).
 */
export function resizeElementPatch(
  element: DrawElement,
  from: Box,
  to: Box,
): Partial<DrawElement> {
  const round = Math.round;
  // 0으로 나누지 않는다 — 두께 0인 축(가로선의 높이)은 배율 1로 두고 자리만 옮긴다.
  const sx = from.w > 0 ? to.w / from.w : 1;
  const sy = from.h > 0 ? to.h / from.h : 1;
  const mapX = (x: number): number => to.x + (x - from.x) * sx;
  const mapY = (y: number): number => to.y + (y - from.y) * sy;
  /** 균등 배율 — 두 축의 가운데. 균등 핸들에서는 둘이 이미 같다. */
  const uniformScale = (sx + sy) / 2;

  switch (element.type) {
    case 'stroke': {
      const points = element.points.map((value, index) =>
        index % 2 === 0 ? round(mapX(value)) : round(mapY(value)),
      );
      return { points } as Partial<DrawElement>;
    }
    case 'rect':
    case 'ellipse':
    case 'image': {
      const box = normalizeBox(
        mapX(element.x),
        mapY(element.y),
        mapX(element.x + element.w),
        mapY(element.y + element.h),
      );
      return {
        x: round(box.x),
        y: round(box.y),
        w: round(box.w),
        h: round(box.h),
      } as Partial<DrawElement>;
    }
    case 'line':
    case 'arrow':
      return {
        x1: round(mapX(element.x1)),
        y1: round(mapY(element.y1)),
        x2: round(mapX(element.x2)),
        y2: round(mapY(element.y2)),
      } as Partial<DrawElement>;
    case 'text':
    case 'sticker':
      return {
        x: round(mapX(element.x)),
        y: round(mapY(element.y)),
        size: Math.max(DRAW_MIN_SIZE, round(element.size * uniformScale)),
      } as Partial<DrawElement>;
    default:
      return {};
  }
}

/** 여럿을 한꺼번에 감싸는 상자 — 아무것도 없으면 `null`(상자가 없는 것과 0×0은 다르다). */
export function unionBounds(elements: readonly DrawElement[]): Box | null {
  if (elements.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const element of elements) {
    const box = elementBounds(element);
    if (box.x < minX) minX = box.x;
    if (box.y < minY) minY = box.y;
    if (box.x + box.w > maxX) maxX = box.x + box.w;
    if (box.y + box.h > maxY) maxY = box.y + box.h;
  }
  if (!Number.isFinite(minX)) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** 두 상자가 스치기라도 하나 (닿기만 해도 참). */
export const boxIntersects = (a: Box, b: Box): boolean =>
  a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;

/**
 * 마퀴 상자에 걸린 요소들 — 화면에 그려지는 **순서 그대로** 돌려준다.
 *
 * 「완전히 품은 것만」이 아니라 **스치기만 해도** 잡히는 이유는 폰이다: 손가락으로
 * 획 하나를 통째로 감싸려면 페이지를 축소해야 하고, 그렇게까지 하고도 삐져나온
 * 꼬리 하나 때문에 아무것도 안 잡히면 그 도구는 쓰이지 않는다.
 */
export function marqueeHits(
  elements: Record<Id, DrawElement>,
  order: readonly Id[],
  box: Box,
): Id[] {
  const hits: Id[] = [];
  for (const id of order) {
    const element = elements[id];
    if (!element || element.deletedAt) continue;
    // 잠긴 것은 상자에 걸려도 잡히지 않는다 (M53-2) — 종이처럼 깔아 둔 사진이
    // 마퀴마다 함께 잡히면 잠근 보람이 없다.
    if (element.locked) continue;
    if (boxIntersects(elementBounds(element), box)) hits.push(id);
  }
  return hits;
}

/* ------------------------------------------------------------------ *
 * 복사·붙여넣기 (B1)
 * ------------------------------------------------------------------ */

/**
 * 붙여넣기 한 번의 계단 간격 (로컬 px).
 *
 * 0이면 붙여넣은 것이 원본 **정확히 위에** 앉아 「아무 일도 안 일어난 것」처럼
 * 보이고, 연타하면 그 자리에 열 개가 쌓인다. 페이지 복제가 이름 뒤에 「(복사)」를
 * 붙이는 것과 같은 자리의 배려다.
 */
export const DRAW_PASTE_OFFSET = 16;

/**
 * 스토어가 채우는 셋을 뺀 요소 — `workspaceStore.NewDrawElement`와 같은 모양이다.
 *
 * 같은 타입을 두 번 적는 대신 스토어를 import하지 않는 이유는 방향이다: `draw/`는
 * 순수 계산이고 스토어를 모른다(그래서 브라우저 없이 시험된다). 구조가 같으므로
 * 스토어의 인자 자리에 그대로 들어간다.
 */
export type DrawElementDraft = DrawElement extends infer T
  ? T extends DrawElement
    ? Omit<T, 'id' | 'updatedAt' | 'deletedAt'>
    : never
  : never;

/**
 * 클립보드의 요소들을 (dx, dy)만큼 옮겨 **새로 만들 것**으로.
 *
 * id·시각·삭제 도장을 떼는 것이 이 함수의 절반이다: 그것들을 달고 가면 붙여넣기가
 * 「같은 요소를 다시 저장하기」가 되어 원본이 사라진다. 나머지 절반은 이동인데,
 * 그건 이미 있는 `moveElementPatch`가 한다 — 붙여넣기는 새 규칙이 아니다.
 */
/**
 * 붙여넣은 사진은 **같은 `photoId`를 나눠 쓴다** (M53-2).
 *
 * 블롭이 불변이라 안전하고, 페이지 복제(`duplicateDrawPage`)가 배경에서 이미 그렇게
 * 한다. 그 대신 GC의 참조 수집이 **요소까지 훑어야** 한다
 * (`utils/photos.referencedPhotoIds`, `sync/exportImport`) — 원본을 지우고 사본만
 * 남았을 때 바이트가 사라지지 않는 것은 그 두 곳이 지켜 주는 일이다.
 */
export function pasteElements(
  elements: readonly DrawElement[],
  dx: number,
  dy: number,
): DrawElementDraft[] {
  return elements.map((element) => {
    const { id: _id, updatedAt: _updatedAt, deletedAt: _deletedAt, ...rest } = element;
    return { ...rest, ...moveElementPatch(element, dx, dy) } as DrawElementDraft;
  });
}
