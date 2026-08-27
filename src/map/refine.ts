/**
 * AI가 낸 좌표를 OpenStreetMap에 맞춰 조이기 (M35).
 *
 * M28의 AI 검색은 이름을 옮기는 데는 뛰어나지만(「츠텐카쿠」→通天閣), 좌표는
 * 모델의 기억에서 나온다. 기억은 동네까지는 맞고 **블록은 자주 틀린다** — 사용자가
 * 신고한 「히요리 호텔」이 구글 지도와 두 블록 어긋난 것이 그 증상이다.
 *
 * 그래서 후보를 화면에 뿌리기 전에 한 단계를 더 둔다: 후보의 **현지 표기**로
 * Nominatim에 한 번 물어보고, 답이 AI가 말한 자리에서 {@link REFINE_RADIUS_KM} 안에
 * 있으면 좌표만 OSM 것으로 바꾼다. 같은 장소를 가리키는 두 출처가 겹칠 때만
 * 갈아끼우는 셈이라, 잘못 짚어도 **한 블록** 차이지 다른 도시로 날아가지 않는다.
 *
 * 이 파일의 규칙은 세 줄이다:
 *
 *  1. 반경 안에 답이 있으면 그중 **가장 가까운** 것으로 좌표를 바꾸고 표시를 남긴다.
 *  2. 반경 밖이거나 답이 없으면 **AI 좌표를 그대로 둔다**. 한 블록 틀린 편이
 *     엉뚱한 도시보다 언제나 낫다.
 *  3. Nominatim이 넘어지면 조용히 포기한다. 이건 보정이지 검색이 아니다 —
 *     여기서 오류를 띄우면 멀쩡한 결과 화면이 오류 화면이 된다.
 *
 * 이름·지역·주소는 손대지 않는다. 사용자가 「츠텐카쿠」를 찾았으면 줄에는 계속
 * 「통천각」이 있어야 하고, 저장되는 주소도 그대로다 — 바뀌는 것은 좌표 두 칸뿐.
 */

import type { PlaceCandidate } from '../ai/aiPlaces';
import type { GeoPoint } from '../types/models';

/**
 * OSM 답을 「같은 장소」로 인정하는 반경(km).
 *
 * 3km는 도시 하나보다 작고 동네 하나보다 크다. 모델의 좌표는 보통 이 안에서
 * 어긋나고, 동명이지(同名異地)는 보통 이 밖에 있다.
 */
export const REFINE_RADIUS_KM = 3;

/**
 * 검색 한 번이 보정에 쓸 수 있는 Nominatim 요청 수의 상한.
 *
 * 후보 하나에 최대 2건, 후보는 최대 5개라 그대로 두면 10건이 순차로 나간다.
 * OSM 정책(초당 1건)에도, 검색 버튼을 누르고 기다리는 사람에게도 과하다.
 * 상한에 닿으면 남은 후보는 AI 좌표 그대로 나간다 — 보정은 있으면 좋은 것이지
 * 없으면 안 되는 것이 아니다.
 */
export const MAX_REFINE_QUERIES = 6;

/** 지구 반지름(km, IUGG 평균). */
const EARTH_RADIUS_KM = 6371.0088;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/** 위경도 두 점 사이의 대권 거리(km). */
export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * `origin`에서 `radiusKm` 안에 있는 점 중 가장 가까운 것. 없으면 `null`.
 *
 * Nominatim은 관련도 순으로 5건까지 주는데, 그 1등이 늘 우리가 찾던 곳은 아니다
 * (「신세카이」는 오사카에도 있고 다른 데도 있다). 이미 AI가 대강의 자리를
 * 알려 준 상황이라면, 그 자리에 **가장 가까운** 줄이 답이다.
 */
export function nearestWithin(
  origin: { lat: number; lng: number },
  points: readonly GeoPoint[],
  radiusKm: number = REFINE_RADIUS_KM,
): GeoPoint | null {
  let best: GeoPoint | null = null;
  let bestKm = Infinity;
  for (const point of points) {
    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) continue;
    const km = haversineKm(origin, point);
    if (km <= radiusKm && km < bestKm) {
      best = point;
      bestKm = km;
    }
  }
  return best;
}

/**
 * 후보 하나를 OSM에 물어볼 때 쓰는 검색어들 — 앞의 것이 맞으면 뒤는 묻지 않는다.
 *
 *  1. **현지 표기**가 첫 번째다. Nominatim의 색인은 그 나라 말로 되어 있어서
 *     `通天閣`은 한 방에 맞고 `통천각`은 자주 빗나간다.
 *  2. 두 번째는 하나뿐이다. 지역명(오사카)이 있으면 그걸 붙여 동명이지를 풀고,
 *     없으면 한국어 표기로 한 번 더 해 본다. 셋째는 없다 — 요청 수는 예산이다.
 */
export function refineQueries(candidate: PlaceCandidate): string[] {
  const local = candidate.localName?.trim() ?? '';
  const name = candidate.name?.trim() ?? '';
  const locality = candidate.locality?.trim() ?? '';

  const primary = local || name;
  if (primary === '') return [];

  const backup = locality !== '' ? `${primary}, ${locality}` : name !== primary ? name : '';
  return backup !== '' && backup !== primary ? [primary, backup] : [primary];
}

/** {@link refineCandidates}가 받는 것. */
export interface RefineOptions {
  /** Nominatim 한 번. 실제로는 `utils/geo.searchPlaces`가 들어온다. */
  osmSearch: (query: string, signal?: AbortSignal) => Promise<GeoPoint[]>;
  /** 검색 화면의 취소 신호 — 보정도 같이 멈춘다. */
  signal?: AbortSignal;
  radiusKm?: number;
  maxQueries?: number;
}

/**
 * 후보 목록의 좌표를 OSM에 맞춰 조인다. **순서와 개수는 그대로**다.
 *
 * 순차로 도는 것은 일부러다: Nominatim에 동시에 다섯 발을 쏘는 것은 무료 서비스에
 * 대한 예의가 아니고, 어차피 대부분의 후보는 첫 질의에서 끝난다.
 *
 * 던지는 것은 `AbortError` 하나뿐이다 — 그건 사용자가 검색을 취소했다는 뜻이라
 * 화면도 이미 이 결과를 버릴 참이다. 그 밖의 실패는 그 자리에서 보정을 접고
 * 남은 후보를 AI 좌표 그대로 돌려준다.
 */
export async function refineCandidates(
  candidates: readonly PlaceCandidate[],
  options: RefineOptions,
): Promise<PlaceCandidate[]> {
  const radiusKm = options.radiusKm ?? REFINE_RADIUS_KM;
  let budget = options.maxQueries ?? MAX_REFINE_QUERIES;

  /** 이번 검색 안에서만 사는 캐시 — 같은 검색어를 두 번 묻지 않는다. */
  const asked = new Map<string, GeoPoint[]>();
  const out: PlaceCandidate[] = [];
  /** Nominatim이 한 번 넘어지면 나머지도 넘어진다. 줄줄이 기다릴 이유가 없다. */
  let broken = false;

  for (const candidate of candidates) {
    if (broken || budget <= 0) {
      out.push(candidate);
      continue;
    }

    let refined = candidate;
    for (const query of refineQueries(candidate)) {
      let hits = asked.get(query);
      if (hits === undefined) {
        if (budget <= 0) break;
        budget -= 1;
        try {
          hits = await options.osmSearch(query, options.signal);
        } catch (failure) {
          if (failure instanceof DOMException && failure.name === 'AbortError') throw failure;
          broken = true;
          break;
        }
        asked.set(query, hits);
      }

      const near = nearestWithin(candidate, hits, radiusKm);
      if (near) {
        refined = { ...candidate, lat: near.lat, lng: near.lng, refined: true };
        break;
      }
    }
    out.push(refined);
  }

  return out;
}
