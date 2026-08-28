/**
 * 실제 경로 한 다리 — 구글 **Routes API v2** `computeRoutes` (M42).
 *
 * 지도의 동선은 M6부터 지금까지 **직선**이었다. 두 핀을 잇는 선은 「이 다음에
 * 저기」라는 순서를 말할 뿐, 「거기까지 어떻게, 얼마나」는 말하지 못한다. 오사카
 * 지하철 두 정거장과 강 건너 40분은 지도 위에서 같은 길이의 선이었다.
 *
 * 그래서 **일자별로 한 날을 골라 보고 있을 때만** 그 날의 다리마다 구글에 한 번씩
 * 묻는다: 대중교통으로 어떻게 가고, 몇 분 걸리나. 답이 오면 그 다리의 직선을
 * 진짜 경로선으로 바꿔 그리고 가운데에 「23분」을 붙인다.
 *
 * ## 왜 이렇게 아끼는가
 *
 * 이 호출은 **한 번마다 돈이다**(무료 한도 안이긴 하다). 그래서 규칙이 셋이다:
 *
 * 1. 구글 시트 + 일자별 **한 날**을 고른 순간에만 — 전체·OSM·전체 아이템은 절대.
 * 2. 한 날 = 다리 N-1개, **순차**로. 화면 하나가 구글에 열 개씩 동시에 묻지 않는다.
 * 3. (출발, 도착, 이동수단)마다 **이 세션 동안 기억한다** — 같은 날을 다시 골라도,
 *    리렌더가 백 번 돌아도 두 번 묻지 않는다.
 *
 * ## TRANSIT → WALK
 *
 * 대중교통이 없는 다리(같은 동네 200m, 시골, 심야)는 Routes가 **빈 답**
 * (`{}`)을 준다 — 오류가 아니다. 그때 한 번 더, 걷는 길로 묻는다. 그것도 비면
 * 그 다리는 직선 점선으로 남는다. 조용히.
 *
 * ## 이음매
 *
 * e2e는 `routes.googleapis.com`에 닿을 수 없다(키·네트워크·비결정성). 그래서
 * `map/googleLoader.ts`와 **같은 철학**의 이음매를 하나 둔다: 부르기 직전에
 * `window.__tripBoardFakeRoutes`를 보고, 있으면 그 함수에 **우리가 만든 요청
 * 그대로**를 넘긴다. 번들에 들어가는 것은 「있으면 쓴다」 세 줄이고, 덕분에 스펙이
 * 확인하는 것은 가짜가 아니라 진짜 배선이다 — 어떤 필드마스크로, 어떤 본문으로,
 * 어떤 순서로 물었는가.
 *
 * 폴리라인 디코더는 손으로 적었다(아래 {@link decodePolyline}). npm 의존성 0은
 * 이 마일스톤에서도 지킨다 — 알고리즘 30줄이 패키지 하나보다 정직하다.
 */

import { formatDuration } from '../utils/time';
import type { RouteStop } from '../timeline/route';
import { haversineKm } from './refine';

/** 지도가 다루는 점 하나. */
export interface RoutePoint {
  lat: number;
  lng: number;
}

/** 이 앱이 구글에 묻는 두 가지 이동수단. */
export type RouteTravelMode = 'TRANSIT' | 'WALK';

/** 엔드포인트. 스펙이 통째로 맞춰 볼 수 있게 상수로. */
export const ROUTES_ENDPOINT = 'https://routes.googleapis.com/directions/v2:computeRoutes';

/**
 * 값을 치르는 필드 셋 — 그리는 선, 붙이는 시간, 그리고 거리.
 *
 * Routes v2는 필드마스크가 **필수**다(없으면 400). 그리고 그 목록이 곧 요금
 * 등급이라, 여기 한 줄이 늘어나면 청구서가 늘어난다.
 */
export const ROUTES_FIELD_MASK =
  'routes.polyline.encodedPolyline,routes.duration,routes.distanceMeters';

/** 한 다리의 답. */
export interface RouteLegResult {
  /** 실제로 답을 준 이동수단 — 대중교통이 없어 걷는 길로 받은 다리도 있다. */
  mode: RouteTravelMode;
  /** 디코드된 경로선. 점 두 개 미만이면 답으로 치지 않는다. */
  path: RoutePoint[];
  /** 초. 「23분」은 여기서 나온다. */
  durationSec: number;
  /** 미터. 지금은 화면에 쓰지 않지만 답의 일부이므로 같이 들고 있는다. */
  distanceMeters: number;
}

/** 이음매가 받는 것 — 우리가 진짜로 보낼 요청 그대로. */
export interface FakeRoutesRequest {
  endpoint: string;
  fieldMask: string;
  apiKey: string;
  mode: RouteTravelMode;
  body: Record<string, unknown>;
}

interface RoutesWindow {
  __tripBoardFakeRoutes?: (request: FakeRoutesRequest) => unknown;
}

/**
 * e2e가 심어 둔 가짜, 있으면. 호출 **시점에** 읽는다 (로더와 같은 이유).
 *
 * 브라우저에서 `globalThis`는 곧 `window`라 `addInitScript`가 심은 값이 그대로
 * 잡히고, 창이 없는 단위 테스트에서도 같은 이음매를 쓸 수 있다.
 */
function fakeRoutes(): ((request: FakeRoutesRequest) => unknown) | null {
  const fake = (globalThis as unknown as RoutesWindow).__tripBoardFakeRoutes;
  return typeof fake === 'function' ? fake : null;
}

/* ------------------------------------------------------------------ *
 * 폴리라인 디코더
 * ------------------------------------------------------------------ */

/** 구글 인코딩의 고정 정밀도 — 좌표는 1e-5 단위 정수로 실린다. */
const POLYLINE_PRECISION = 1e5;

/**
 * 구글 encoded polyline → 점 목록 (순수).
 *
 * 알고리즘은 하나다: 값 하나를 5비트씩 쪼개 `0x20` 연속 표시를 달고 63을 더해
 * 아스키로 적은 것. 읽을 때는 그 반대로 모으고, 홀수면 음수로 되돌리고
 * (지그재그), 앞 점과의 **차이**이므로 계속 더해 간다.
 *
 * 망가진 문자열은 던지지 않고 **거기까지 읽은 만큼**을 준다 — 이 값은 화면에
 * 선을 하나 그리는 데 쓰이고, 그리다 만 선보다 나쁜 것은 터진 지도다.
 */
export function decodePolyline(encoded: string): RoutePoint[] {
  const points: RoutePoint[] = [];
  if (typeof encoded !== 'string' || encoded.length === 0) return points;

  let index = 0;
  let lat = 0;
  let lng = 0;

  /** 값 하나를 읽는다. 문자열이 도중에 끊기면 `null`. */
  const readValue = (): number | null => {
    let result = 0;
    let shift = 0;
    let byte = 0;
    do {
      if (index >= encoded.length) return null;
      byte = encoded.charCodeAt(index) - 63;
      index += 1;
      if (byte < 0) return null;
      result |= (byte & 0x1f) << shift;
      shift += 5;
      // 32비트 정수 자리를 넘어가는 입력은 이미 폴리라인이 아니다.
      if (shift > 30) return null;
    } while (byte >= 0x20);
    // 지그재그: 마지막 비트가 부호다.
    return result & 1 ? ~(result >> 1) : result >> 1;
  };

  while (index < encoded.length) {
    const dLat = readValue();
    if (dLat === null) break;
    const dLng = readValue();
    if (dLng === null) break;
    lat += dLat;
    lng += dLng;
    points.push({ lat: lat / POLYLINE_PRECISION, lng: lng / POLYLINE_PRECISION });
  }

  return points;
}

/* ------------------------------------------------------------------ *
 * 요청과 응답
 * ------------------------------------------------------------------ */

/** `{lat,lng}` → Routes v2가 읽는 자리 하나. */
const waypoint = (point: RoutePoint) => ({
  location: { latLng: { latitude: point.lat, longitude: point.lng } },
});

/**
 * 한 다리의 요청 본문.
 *
 * 일부러 최소한이다. `routingPreference`는 **넣지 않는다** — 그 필드는 DRIVE
 * 계열 전용이라 TRANSIT/WALK에 붙이면 구글이 400으로 거절한다. 출발 시각도
 * 넣지 않는다: 넣으면 「그 시각의」 시간표가 되어 매번 답이 달라지고, 이 화면이
 * 답해야 하는 질문은 「대충 몇 분 거리인가」다.
 */
export function buildRouteRequest(
  from: RoutePoint,
  to: RoutePoint,
  mode: RouteTravelMode,
): Record<string, unknown> {
  return {
    origin: waypoint(from),
    destination: waypoint(to),
    travelMode: mode,
    computeAlternativeRoutes: false,
    languageCode: 'ko-KR',
    units: 'METRIC',
    polylineQuality: 'OVERVIEW',
  };
}

/** `"1234s"` · `"1234.5s"` · `1234` → 초. 못 읽으면 `null`. */
export function parseRouteDuration(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== 'string') return null;
  const match = /^(-?\d+(?:\.\d+)?)s$/.exec(raw.trim());
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

/**
 * 응답 하나를 이 앱의 답으로. 길이 없으면 `null`.
 *
 * 「길이 없다」는 오류가 아니다 — Routes는 경로를 못 찾으면 `{}`를 준다. 그
 * 경우와 통신 실패와 이상한 JSON이 여기서 전부 같은 `null`로 접히고, 호출부는
 * 그 하나만 다루면 된다.
 */
export function parseRouteAnswer(raw: unknown, mode: RouteTravelMode): RouteLegResult | null {
  if (!raw || typeof raw !== 'object') return null;
  const routes = (raw as { routes?: unknown }).routes;
  if (!Array.isArray(routes) || routes.length === 0) return null;

  const first = routes[0] as
    | { polyline?: { encodedPolyline?: unknown }; duration?: unknown; distanceMeters?: unknown }
    | undefined;
  const encoded = first?.polyline?.encodedPolyline;
  if (typeof encoded !== 'string') return null;

  const path = decodePolyline(encoded);
  // 점 하나짜리 「경로」는 그릴 것이 없다.
  if (path.length < 2) return null;

  const durationSec = parseRouteDuration(first?.duration);
  const distance = first?.distanceMeters;

  return {
    mode,
    path,
    durationSec: durationSec ?? 0,
    distanceMeters: typeof distance === 'number' && Number.isFinite(distance) ? distance : 0,
  };
}

/* ------------------------------------------------------------------ *
 * 부르기 · 기억하기
 * ------------------------------------------------------------------ */

/** 좌표를 이 자릿수까지만 보고 같은 다리로 친다 (약 10cm). */
const KEY_DECIMALS = 6;

const keyPoint = (point: RoutePoint): string =>
  `${point.lat.toFixed(KEY_DECIMALS)},${point.lng.toFixed(KEY_DECIMALS)}`;

/** (출발, 도착, 이동수단) 하나의 이름. */
export function routeCacheKey(from: RoutePoint, to: RoutePoint, mode: RouteTravelMode): string {
  return `${mode}|${keyPoint(from)}|${keyPoint(to)}`;
}

/**
 * 이 창이 사는 동안의 기억. `null`도 기억한다 — 「물어봤고 길이 없었다」는
 * 사실이야말로 다시 묻지 않아야 하는 답이다.
 */
const legCache = new Map<string, RouteLegResult | null>();

/** 테스트 전용 — 한 창짜리 기억을 지운다. */
export function resetRouteCacheForTests(): void {
  legCache.clear();
}

/** 지금까지 기억한 다리 수 — 스펙이 「두 번 묻지 않았다」를 확인하는 창구. */
export function routeCacheSize(): number {
  return legCache.size;
}

/** 한 이동수단으로 한 번 묻는다. 실패·빈 답은 전부 `null`. */
async function callComputeRoutes(
  apiKey: string,
  from: RoutePoint,
  to: RoutePoint,
  mode: RouteTravelMode,
): Promise<RouteLegResult | null> {
  const body = buildRouteRequest(from, to, mode);
  const fake = fakeRoutes();

  if (fake) {
    try {
      const answer = await fake({
        endpoint: ROUTES_ENDPOINT,
        fieldMask: ROUTES_FIELD_MASK,
        apiKey,
        mode,
        body,
      });
      return parseRouteAnswer(answer, mode);
    } catch {
      return null;
    }
  }

  try {
    const response = await fetch(ROUTES_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': ROUTES_FIELD_MASK,
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) return null;
    return parseRouteAnswer(await response.json(), mode);
  } catch {
    return null;
  }
}

/**
 * 도보 폴백이 허락되는 최대 **직선** 거리, km.
 *
 * 구글은 일본의 전철·버스 경로를 API로 내주지 않는다(소비자 앱에만 있다 —
 * 철도 데이터 라이선스). 그래서 이 여행의 다리 대부분은 TRANSIT이 빈손으로
 * 오는데, 그때마다 걷는 길을 그리면 간사이공항→난바 같은 전철 구간이
 * 「도보 12시간, 고베 경유」로 그려진다 — 실사용 신고 그대로다. 걷기는 걸을
 * 만한 거리에서만 정직하고, 그보다 먼 다리는 점선 직선이 낫다(길찾기 버튼이
 * 구글맵 앱을 열면 거기엔 전철 경로가 제대로 있다).
 */
export const WALK_FALLBACK_MAX_KM = 3;

/**
 * 한 다리의 실제 경로 — 대중교통으로, 없으면 **걸을 만한 거리에 한해** 걸어서,
 * 그것도 없으면 `null`(점선 직선).
 *
 * 캐시는 (출발, 도착, 이동수단)마다다. 그래서 대중교통이 빈 답이었던 다리는 다음
 * 번에도 대중교통을 묻지 않고 바로 걷는 길의 기억으로 간다.
 */
export async function routeLeg(
  apiKey: string,
  from: RoutePoint,
  to: RoutePoint,
): Promise<RouteLegResult | null> {
  if (!apiKey) return null;

  const transitKey = routeCacheKey(from, to, 'TRANSIT');
  let transit: RouteLegResult | null;
  if (legCache.has(transitKey)) {
    transit = legCache.get(transitKey) ?? null;
  } else {
    transit = await callComputeRoutes(apiKey, from, to, 'TRANSIT');
    legCache.set(transitKey, transit);
  }
  if (transit) return transit;

  // 직선으로도 걸을 거리가 아니면 도보를 묻지도 않는다 — 요청 하나 아끼고,
  // 오해를 하나 막는다.
  if (haversineKm(from, to) > WALK_FALLBACK_MAX_KM) return null;

  const walkKey = routeCacheKey(from, to, 'WALK');
  if (legCache.has(walkKey)) return legCache.get(walkKey) ?? null;
  const walk = await callComputeRoutes(apiKey, from, to, 'WALK');
  legCache.set(walkKey, walk);
  return walk;
}

/* ------------------------------------------------------------------ *
 * 그리기 전에 정해지는 것들 (순수)
 * ------------------------------------------------------------------ */

/** 그릴 다리 하나 — 어느 두 정거장 사이인가. */
export interface RoutePair {
  fromCardId: string;
  toCardId: string;
  from: RoutePoint;
  to: RoutePoint;
}

/**
 * 그 날의 정거장들을 이웃끼리 짝지어 다리로 (순수).
 *
 * 같은 자리에 선 두 정거장은 짝에서 빠진다 — 길이 0인 다리를 구글에 물어 봐야
 * 「0분」이 돌아오고, 그건 지도 위의 잡음일 뿐 돈을 쓸 이유가 없다.
 */
export function routeLegPairs(stops: readonly RouteStop[]): RoutePair[] {
  const pairs: RoutePair[] = [];
  for (let i = 0; i + 1 < stops.length; i += 1) {
    const from = stops[i];
    const to = stops[i + 1];
    if (from.lat === to.lat && from.lng === to.lng) continue;
    pairs.push({
      fromCardId: from.cardId,
      toCardId: to.cardId,
      from: { lat: from.lat, lng: from.lng },
      to: { lat: to.lat, lng: to.lng },
    });
  }
  return pairs;
}

/**
 * 「이 날의 이 정거장들」의 지문 (순수).
 *
 * 이 문자열이 그대로면 물어볼 것도 그대로다. 렌더가 백 번 돌아도, 필터를 껐다
 * 켜도, 같은 지문이면 한 번도 더 묻지 않는다.
 */
export function routeDayFingerprint(dayId: string, stops: readonly RouteStop[]): string {
  return `${dayId}|${stops.map((stop) => `${stop.cardId}@${keyPoint(stop)}`).join('>')}`;
}

/**
 * 경로선의 **중간 지점** — 「23분」 칩이 앉는 자리 (순수).
 *
 * 점 개수의 절반이 아니라 **길이의 절반**이다: 지하철 경로는 역 근처에 점이
 * 촘촘하고 역 사이는 성기게 오므로, 인덱스 가운데를 집으면 칩이 출발역 앞에
 * 붙는다. 위도에 따른 경도 압축(`cos φ`)까지 셈하는 평면 근사로 충분하다 —
 * 여기서 정하는 것은 아이콘 하나의 자리다.
 */
export function pathMidpoint(path: readonly RoutePoint[]): RoutePoint | null {
  if (path.length === 0) return null;
  if (path.length === 1) return path[0];

  const RAD = Math.PI / 180;
  const spans: number[] = [];
  let total = 0;
  for (let i = 0; i + 1 < path.length; i += 1) {
    const a = path[i];
    const b = path[i + 1];
    const midLat = ((a.lat + b.lat) / 2) * RAD;
    const dx = (b.lng - a.lng) * Math.cos(midLat);
    const dy = b.lat - a.lat;
    const span = Math.sqrt(dx * dx + dy * dy);
    spans.push(span);
    total += span;
  }
  if (total === 0) return path[0];

  let remaining = total / 2;
  for (let i = 0; i < spans.length; i += 1) {
    if (remaining <= spans[i]) {
      const ratio = spans[i] === 0 ? 0 : remaining / spans[i];
      const a = path[i];
      const b = path[i + 1];
      return { lat: a.lat + (b.lat - a.lat) * ratio, lng: a.lng + (b.lng - a.lng) * ratio };
    }
    remaining -= spans[i];
  }
  return path[path.length - 1];
}

/**
 * 초 → 「23분」·「1시간 5분」.
 *
 * 30초짜리 다리도 「0분」이 아니라 「1분」이다: 0분은 시간이 안 걸린다는 뜻이
 * 아니라 값을 못 읽었다는 뜻으로 읽힌다. 표기 자체는 앱 전체가 쓰는
 * {@link formatDuration} 하나를 그대로 빌린다.
 */
export function formatRouteDuration(durationSec: number): string {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return '';
  return formatDuration(Math.max(1, Math.round(durationSec / 60)));
}
