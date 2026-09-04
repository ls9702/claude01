/**
 * 손그림 한 획을 저장할 수 있는 크기로 줄인다 (M52a) — 순수 함수뿐.
 *
 * 포인터 이벤트는 60~120Hz로 온다. 화면을 가로지르는 획 하나가 400점이 되고,
 * 그 400점이 소수점 셋까지 붙은 실수라면 획 하나가 10KB다. 워크스페이스는
 * **통째로** 직렬화되어 idb에 앉고 NAS로 밀려가므로, 그 10KB는 그 뒤의 모든
 * 저장·모든 푸시·모든 백업 파일에 그대로 실린다.
 *
 * 그래서 두 가지를 한다. 하나는 **정수 양자화**(사람은 0.37px를 보지 않는다),
 * 다른 하나는 **RDP 단순화**(직선에 가까운 구간의 중간 점은 그 직선이 이미 다
 * 말하고 있다). 둘 다 pointerup에서 딱 한 번 돌고, 그 결과가 요소 하나로
 * 저장된다 — 그리는 동안에는 스토어를 건드리지 않는다.
 *
 * 두 함수 모두 입력을 바꾸지 않고 같은 입력에 같은 답을 준다. 그래서 두 기기가
 * 같은 획을 각자 저장해도 같은 숫자가 나오고, 테스트가 브라우저 없이 돈다.
 */

/**
 * RDP 허용오차(페이지 로컬 px). **이 상수 하나가 「얼마나 거칠게 줄일까」다.**
 *
 * 1.2px는 실측으로 고른 값이다: 손으로 그린 곡선에서 점 수가 1/4~1/6로 줄고,
 * 그러면서 원본과 겹쳐 그려도 어긋난 곳이 눈에 띄지 않는다. 키우면 파일이 더
 * 작아지는 대신 곡선이 각져 보이고, 줄이면 그 반대다.
 */
export const DRAW_SIMPLIFY_TOLERANCE = 1.2;

/** 평탄 배열의 점 개수 — 홀수로 잘린 꼬리는 세지 않는다. */
export const pointCount = (points: readonly number[]): number => Math.floor(points.length / 2);

/** 한 좌표를 정수로. 그리는 좌표계가 CSS px라 반올림이 곧 「눈에 같은 자리」다. */
export const quantize = (value: number): number => Math.round(value);

/**
 * 평탄 배열을 통째로 정수로 만들고, **곧바로 이어지는 같은 점**을 접는다.
 *
 * 양자화 자체가 중복을 만든다 — 천천히 그은 획은 한 픽셀 안에 점 열 개를
 * 남기고, 반올림하면 그 열 개가 같은 좌표가 된다. 접지 않으면 RDP가 그 열
 * 개를 전부 「거리 0」으로 살려 둔다.
 */
export function quantizePoints(points: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < points.length; i += 2) {
    const x = quantize(points[i]);
    const y = quantize(points[i + 1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const n = out.length;
    if (n >= 2 && out[n - 2] === x && out[n - 1] === y) continue;
    out.push(x, y);
  }
  return out;
}

/** 점에서 (a→b)가 만드는 **무한 직선**까지의 거리 — RDP의 판정 자다. */
export function perpendicularDistance(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay);
  // 직선 위의 최근접점 — 선분이 아니라 직선이라 t를 [0,1]로 자르지 않는다.
  const t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * Ramer–Douglas–Peucker. 첫 점과 끝 점은 언제나 남는다.
 *
 * 재귀가 아니라 **명시적 스택**이다: 획 하나가 수천 점이 될 수 있고, 최악의
 * 모양(한 방향으로 균일하게 휘는 곡선)에서 재귀 깊이는 점 수에 비례한다.
 */
export function simplifyPoints(
  points: readonly number[],
  tolerance: number = DRAW_SIMPLIFY_TOLERANCE,
): number[] {
  const count = pointCount(points);
  if (count <= 2) return points.slice(0, count * 2);

  const keep = new Array<boolean>(count).fill(false);
  keep[0] = true;
  keep[count - 1] = true;

  const stack: [number, number][] = [[0, count - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    if (last - first < 2) continue;

    const ax = points[first * 2];
    const ay = points[first * 2 + 1];
    const bx = points[last * 2];
    const by = points[last * 2 + 1];

    let farthest = -1;
    let farthestDistance = 0;
    for (let i = first + 1; i < last; i += 1) {
      const distance = perpendicularDistance(points[i * 2], points[i * 2 + 1], ax, ay, bx, by);
      if (distance > farthestDistance) {
        farthestDistance = distance;
        farthest = i;
      }
    }

    if (farthest < 0 || farthestDistance <= tolerance) continue;
    keep[farthest] = true;
    stack.push([first, farthest], [farthest, last]);
  }

  const out: number[] = [];
  for (let i = 0; i < count; i += 1) {
    if (!keep[i]) continue;
    out.push(points[i * 2], points[i * 2 + 1]);
  }
  return out;
}

/**
 * pointerup에서 한 번 도는 마무리 — 양자화 → 단순화 → 다시 양자화.
 *
 * 마지막 양자화가 한 번 더 있는 이유는 없다(RDP는 점을 **고르기만** 하지 만들지
 * 않는다) — 대신 단순화가 끝난 뒤 같은 점이 붙는 경우를 다시 접는다.
 *
 * 점 하나짜리 획(콕 찍은 점)은 **두 점으로 늘린다**: 폴리라인은 점 하나로는
 * 아무것도 그리지 않는데, 둥근 캡을 가진 길이 0의 선은 정확히 「점」으로 보인다.
 * 빈 입력만 빈 배열로 돌아간다.
 */
export function finishStroke(
  points: readonly number[],
  tolerance: number = DRAW_SIMPLIFY_TOLERANCE,
): number[] {
  const quantized = quantizePoints(points);
  if (quantized.length === 0) return [];
  if (quantized.length === 2) return [quantized[0], quantized[1], quantized[0], quantized[1]];
  return quantizePoints(simplifyPoints(quantized, tolerance));
}
