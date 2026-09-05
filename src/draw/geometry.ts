/**
 * 드로우 도형의 기하 — 순수 함수뿐 (M52a).
 *
 * 그리는 컴포넌트가 이 파일을 부르고, 이 파일은 React도 SVG도 모른다. 그래서
 * 「화살촉이 어디에 붙나」·「지우개가 이 획을 맞혔나」 같은, 실제로 틀리기 쉬운
 * 것들이 브라우저 없이 시험된다.
 *
 * 좌표계는 언제나 **페이지 로컬 px**다 — 화면 좌표는 캔버스가 뷰 변환으로
 * 옮겨 준 뒤에 들어온다.
 */

import type { DrawElement } from '../types/models';

/** 축에 나란한 상자. `w`/`h`는 언제나 0 이상이다. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 끌기의 두 점을 상자로 — 어느 방향으로 끌든 `w`/`h`가 양수다.
 *
 * 오른쪽 아래로만 끌라고 요구할 수는 없고, 음수 폭을 그대로 저장하면 그 뒤의
 * 모든 계산(맞힘 판정·경계 상자·이동)이 각자 부호를 다시 다뤄야 한다. 부호는
 * 태어나는 자리에서 한 번만 없앤다.
 */
export function normalizeBox(x0: number, y0: number, x1: number, y1: number): Box {
  return {
    x: Math.min(x0, x1),
    y: Math.min(y0, y1),
    w: Math.abs(x1 - x0),
    h: Math.abs(y1 - y0),
  };
}

/** 점에서 **선분**까지의 거리 (무한 직선이 아니다 — 맞힘 판정의 자). */
export function distanceToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** 평탄 점 배열에서 한 점까지의 최단 거리. 빈 획은 `Infinity`. */
export function distanceToPolyline(points: readonly number[], px: number, py: number): number {
  const count = Math.floor(points.length / 2);
  if (count === 0) return Infinity;
  if (count === 1) return Math.hypot(px - points[0], py - points[1]);

  let best = Infinity;
  for (let i = 0; i + 1 < count; i += 1) {
    const distance = distanceToSegment(
      px,
      py,
      points[i * 2],
      points[i * 2 + 1],
      points[i * 2 + 2],
      points[i * 2 + 3],
    );
    if (distance < best) best = distance;
  }
  return best;
}

/**
 * 화살촉의 두 날개 끝 (M52a).
 *
 * SVG `marker`를 쓰지 않는 이유는 시험 때문이다: 마커는 브라우저 안에서만
 * 존재해서, 「화살표가 진행 방향을 가리키나」를 확인할 방법이 스크린샷밖에
 * 없어진다. 두 점을 직접 계산하면 그 질문이 숫자 두 쌍의 질문이 된다.
 *
 * 머리 크기는 선 굵기를 따라간다(굵은 선에 작은 촉은 촉으로 보이지 않는다),
 * 다만 선분 자체보다 커지지는 않는다 — 짧은 화살표가 촉만 남는 것을 막는다.
 */
export function arrowHead(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  width: number,
): { x: number; y: number }[] {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy);
  // 길이 0이면 방향이 없다 — 촉을 임의 방향으로 세우느니 그리지 않는다.
  if (length === 0) return [];

  const size = Math.min(Math.max(width * 3.5, 8), length);
  const angle = Math.atan2(dy, dx);
  const spread = Math.PI / 7;

  return [
    { x: x2 - size * Math.cos(angle - spread), y: y2 - size * Math.sin(angle - spread) },
    { x: x2 - size * Math.cos(angle + spread), y: y2 - size * Math.sin(angle + spread) },
  ];
}

/** 글자 요소의 줄 간격 — 렌더러(`DrawElementView`)와 같은 값을 쓴다. */
export const LINE_HEIGHT = 1.35;

/** 글자 요소를 줄로 — 저장된 `\n`을 그대로 따른다(빈 줄도 한 줄이다). */
export const textLines = (text: string): string[] => text.split('\n');

/**
 * CJK·전각 문자인가 — 한글(자모·완성형), 한자, 가나, 전각 문장부호.
 *
 * 이모지도 여기 든다(대부분의 글꼴에서 전각 한 칸을 먹는다). 코드포인트 하나가
 * 아니라 **문자 하나**로 세기 위해 부르는 쪽이 `[...text]`로 돈다 — `'👍'.length`는
 * 2이고, 그 둘을 각각 세면 이모지 하나가 두 칸이 된다.
 */
const WIDE = /[\u1100-\u115F\u2E80-\u303E\u3041-\u33FF\u3400-\u4DBF\u4E00-\u9FFF\uA000-\uA4CF\uA960-\uA97F\uAC00-\uD7A3\uF900-\uFAFF\uFE10-\uFE19\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]|[\u{1F000}-\u{1FAFF}]|[\u{20000}-\u{3FFFD}]/u;

/** 문자 하나의 어림 폭(em). */
export const charWidthEm = (ch: string): number => (WIDE.test(ch) ? 1 : 0.62);

/** 한 줄의 어림 폭(em) — 문자마다 따로 센다. */
export function textWidthEm(text: string): number {
  let width = 0;
  for (const ch of text) width += charWidthEm(ch);
  return width;
}

/** 요소를 감싸는 상자 — 선택 테두리와 맞힘 판정의 1차 관문. */
export function elementBounds(element: DrawElement): Box {
  switch (element.type) {
    case 'stroke': {
      const count = Math.floor(element.points.length / 2);
      if (count === 0) return { x: 0, y: 0, w: 0, h: 0 };
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (let i = 0; i < count; i += 1) {
        const x = element.points[i * 2];
        const y = element.points[i * 2 + 1];
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
      const pad = element.width / 2;
      return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
    }
    case 'rect':
    case 'ellipse':
      return { x: element.x, y: element.y, w: element.w, h: element.h };
    case 'line':
    case 'arrow':
      return normalizeBox(element.x1, element.y1, element.x2, element.y2);
    case 'text': {
      // 글자 폭은 글꼴이 정하므로 정확히 잴 수는 없다. 그래도 **글자마다 다르게**
      // 어림해야 한다 (M52a-fix ④): 한 글자 0.62em으로 뭉뚱그리면 한글은 실제
      // 폭의 62%짜리 상자를 갖고, 「오사카 어디 갈까」의 오른쪽 절반은 지우개도
      // 선택도 닿지 않는 죽은 자리가 된다(실측 62%). 한글·한자·가나·전각은
      // 1.0em, 그 밖(라틴·숫자·공백)은 0.62em이다.
      //
      // 여러 줄이면 가장 긴 줄이 폭이고 줄 수가 높이다 — `y`는 첫 줄의
      // baseline이라 상자는 그 위로 한 줄만 올라간다.
      const lines = textLines(element.text);
      const widest = Math.max(...lines.map((line) => textWidthEm(line)), 0);
      return {
        x: element.x,
        y: element.y - element.size,
        w: Math.max(element.size, widest * element.size),
        h: element.size * LINE_HEIGHT * lines.length,
      };
    }
    case 'image':
      // 붙인 사진 (M53-2) — 도형과 같은 네 수다. 「같은 규칙을 다시 쓴다」가
      // 이 요소 타입을 고른 이유이기도 하다.
      return { x: element.x, y: element.y, w: element.w, h: element.h };
    case 'sticker':
      // 스티커의 `x`/`y`는 **가운데**다 — 붙이는 손가락이 가리키는 곳이 가운데다.
      return {
        x: element.x - element.size / 2,
        y: element.y - element.size / 2,
        w: element.size,
        h: element.size,
      };
    default:
      // 모르는 타입은 **자리를 차지하지 않는다** (M53-1). 이 `default`가 필요한
      // 이유는 다음 회차가 요소 타입을 하나 늘리기 때문이다: 그 요소가 든
      // 워크스페이스가 옛 빌드에 닿았을 때 여기가 `undefined`를 돌려주면 다음 줄이
      // `.x`를 읽다 죽는다. 「모르는 요소는 안 보이고 안 맞는다」가 최선의 결말이고,
      // 그것은 `DrawElementBase`가 톰스톤을 쓰지 않는 이유와 같은 논증이다.
      return { x: 0, y: 0, w: 0, h: 0 };
  }
}

/** 상자 안에 점이 있나 — `pad`만큼 넉넉하게. */
export const boxHit = (box: Box, x: number, y: number, pad = 0): boolean =>
  x >= box.x - pad && x <= box.x + box.w + pad && y >= box.y - pad && y <= box.y + box.h + pad;

/**
 * 이 요소를 (x, y)로 맞혔나 — 지우개와 선택이 함께 쓰는 하나의 규칙.
 *
 * 획과 선은 **획 자신**에 닿아야 맞은 것이고(경계 상자로 판정하면 크게 휜 획
 * 하나가 페이지의 절반을 먹는다), 도형·글자·스티커는 상자로 판정한다. 채운
 * 도형만 안쪽까지 맞힘으로 치는 것도 같은 결이다 — 비어 있는 사각형의 한가운데는
 * 그 사각형이 아니라 배경이다.
 */
export function hitTest(element: DrawElement, x: number, y: number, tolerance = 8): boolean {
  switch (element.type) {
    case 'stroke':
      return distanceToPolyline(element.points, x, y) <= tolerance + element.width / 2;
    case 'line':
    case 'arrow':
      return (
        distanceToSegment(x, y, element.x1, element.y1, element.x2, element.y2) <=
        tolerance + element.width / 2
      );
    case 'rect':
    case 'ellipse': {
      const box = elementBounds(element);
      if (element.fill) return boxHit(box, x, y, tolerance);
      if (!boxHit(box, x, y, tolerance)) return false;
      // 테두리만 있는 도형: 상자 **안쪽**으로 충분히 들어갔으면 빗나간 것이다.
      const inner = {
        x: box.x + tolerance + element.width / 2,
        y: box.y + tolerance + element.width / 2,
        w: Math.max(0, box.w - (tolerance + element.width / 2) * 2),
        h: Math.max(0, box.h - (tolerance + element.width / 2) * 2),
      };
      return !(inner.w > 0 && inner.h > 0 && boxHit(inner, x, y));
    }
    case 'image':
      // 사진은 **채워진 것**이라 안쪽도 맞은 것이다 — 여백을 더 주지 않는 이유는
      // 사진이 대개 크고, 여유가 넓으면 옆의 획을 짚을 수 없기 때문이다.
      return boxHit(elementBounds(element), x, y, 0);
    case 'text':
    case 'sticker':
      return boxHit(elementBounds(element), x, y, tolerance / 2);
    default:
      // 모르는 타입은 아무것도 맞히지 못한다 (M53-1) — `elementBounds`의 그 이유.
      return false;
  }
}

/**
 * `elementOrder`를 뒤에서부터 훑어 맨 **위**에 있는 것을 고른다.
 *
 * 순서 배열의 뒤가 위에 그려지므로, 겹친 자리에서 사람이 가리킨 것은 언제나
 * 마지막에 그려진 것이다. 지운 요소는 화면에 없으니 후보도 아니다.
 */
export function pickTopElement(
  elements: Record<string, DrawElement>,
  order: readonly string[],
  x: number,
  y: number,
  tolerance = 8,
  includeLocked = false,
): DrawElement | null {
  for (let i = order.length - 1; i >= 0; i -= 1) {
    const element = elements[order[i]];
    if (!element || element.deletedAt) continue;
    // 잠긴 것은 **없는 것처럼** 통과한다 (M53-2): 그것이 잠금의 뜻이고, 그래서
    // 잠긴 사진 위에 그은 획을 지우개가 제대로 집는다. `includeLocked`는 **다시 풀
    // 길**을 위해서만 있다 — 컴퓨터의 Shift+클릭과, 폰에서 잠긴 것을 탭했을 때 뜨는
    // 한 줄(M53-fix ②). 둘 다 없으면 한 번 잠근 것은 영영 잠긴 채다.
    if (element.locked && !includeLocked) continue;
    if (hitTest(element, x, y, tolerance)) return element;
  }
  return null;
}

/**
 * 요소를 (dx, dy)만큼 옮긴 **패치**를 준다 — 요소를 통째로 다시 만들지 않는다.
 *
 * 스토어의 `updateDrawElement`가 이 패치를 그대로 얹는다. 좌표는 저장 직전에
 * 정수로 떨어진다(모든 좌표는 정수라는 것이 이 모델의 약속이다).
 */
export function moveElementPatch(
  element: DrawElement,
  dx: number,
  dy: number,
): Partial<DrawElement> {
  const round = Math.round;
  switch (element.type) {
    case 'stroke': {
      const points = element.points.map((value, index) =>
        index % 2 === 0 ? round(value + dx) : round(value + dy),
      );
      return { points } as Partial<DrawElement>;
    }
    case 'rect':
    case 'ellipse':
    case 'image':
      return { x: round(element.x + dx), y: round(element.y + dy) } as Partial<DrawElement>;
    case 'line':
    case 'arrow':
      return {
        x1: round(element.x1 + dx),
        y1: round(element.y1 + dy),
        x2: round(element.x2 + dx),
        y2: round(element.y2 + dy),
      } as Partial<DrawElement>;
    case 'text':
    case 'sticker':
      return { x: round(element.x + dx), y: round(element.y + dy) } as Partial<DrawElement>;
    default:
      // 모르는 타입은 움직이지 않는다 (M53-1) — 빈 패치는 「아무 일도 없었다」다.
      return {};
  }
}


/* ------------------------------------------------------------------ *
 * 격자 스냅 · 선 스타일 · 손글씨 스무딩 (M53-2)
 * ------------------------------------------------------------------ */

/**
 * 격자에 붙인 점 (#5) — 켜져 있지 않으면 원래 자리 그대로.
 *
 * 반올림인 이유는 내림이 언제나 왼쪽 위로 끌기 때문이다: 사람은 격자의 **가까운**
 * 선에 붙기를 기대하고, 내림은 칸의 오른쪽 끝을 짚었을 때 한 칸을 되돌린다.
 * `grid`가 0 이하면 스냅은 없는 것이다(0으로 나누지 않는다).
 */
export function snapPoint(
  x: number,
  y: number,
  grid: number,
  on = true,
): { x: number; y: number } {
  if (!on || !Number.isFinite(grid) || grid <= 0) return { x, y };
  return { x: Math.round(x / grid) * grid, y: Math.round(y / grid) * grid };
}

/**
 * 점선의 `stroke-dasharray` — 굵기를 따라간다.
 *
 * 고정 픽셀 값(`8 6`)을 쓰지 않는 이유는 굵기 8짜리 선에서 그것이 점선이 아니라
 * 「이가 빠진 선」으로 보이기 때문이다. 실선이면 `undefined`를 준다 —
 * `stroke-dasharray="none"`을 쓰면 PNG로 나갈 때 속성이 하나 더 붙는다.
 */
export const dashArray = (width: number, dash?: boolean): string | undefined =>
  dash ? `${Math.max(2, width * 2.5)} ${Math.max(2, width * 2)}` : undefined;

/**
 * 손글씨 한 획을 **매끄러운 path**로 (#7) — Catmull-Rom을 3차 베지에로 옮긴 것.
 *
 * **렌더만 바꾼다.** 저장되는 것은 여전히 점 배열이고, 맞힘 판정도 PNG도 그
 * 배열을 본다. 그래서 이 함수가 틀려도 잃는 것은 「보기 좋음」뿐이고, 이미 그린
 * 그림의 데이터는 한 바이트도 달라지지 않는다 — 화질을 올리는 가장 싼 자리가
 * 정확히 여기다.
 *
 * 장력 1/6은 표준 Catmull-Rom(균일 매개변수)의 값이다. 끝점은 자기 자신을 이웃으로
 * 삼아(복제) 곡선이 밖으로 튀지 않게 한다.
 */
export function strokePath(points: readonly number[]): string {
  const count = Math.floor(points.length / 2);
  if (count === 0) return '';
  const at = (i: number): { x: number; y: number } => {
    const clamped = Math.min(count - 1, Math.max(0, i));
    return { x: points[clamped * 2], y: points[clamped * 2 + 1] };
  };
  if (count === 1) {
    const only = at(0);
    // 점 하나는 선이 아니다 — 길이 0짜리 선분이 `stroke-linecap="round"`로 점이 된다.
    return `M ${only.x} ${only.y} L ${only.x} ${only.y}`;
  }

  let d = `M ${at(0).x} ${at(0).y}`;
  for (let i = 0; i + 1 < count; i += 1) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${round2(c1x)} ${round2(c1y)} ${round2(c2x)} ${round2(c2y)} ${p2.x} ${p2.y}`;
  }
  return d;
}

/** path 문자열이 쓸데없이 길어지지 않게 — 소수 둘째 자리면 눈이 못 본다. */
const round2 = (value: number): number => Math.round(value * 100) / 100;
