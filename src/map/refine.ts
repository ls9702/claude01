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
 *
 * ## 두 번째 계단: 주소 경유 (M37)
 *
 * 위의 규칙에는 구멍이 하나 있었다. **OSM에 그 가게가 없으면** 이름으로 아무리
 * 물어도 답이 없고, 그러면 규칙 2에 따라 모델의 기억 좌표가 표시 없이 살아남는다.
 * 사용자의 신고가 정확히 그 구멍이었다: *「잇푸도 난바점이 구글 지도와 많이 다르다.
 * 뭔가 못 찾는 것 같다.」* 작은 체인점은 OSM의 POI 색인에 없다.
 *
 * 그래서 이름 스냅이 빗나간 후보에게 한 계단을 더 준다:
 *
 *  1. AI에게 **좌표가 아니라 주소**를 묻는다(`ai/aiPlaces.aiPlaceAddress`, 검색을
 *     붙인 grounded 호출 한 번). 좌표를 다시 물으면 같은 기억이 또 나오지만,
 *     번지는 검색이 아는 사실이다.
 *  2. 그 **주소 문자열**을 Nominatim에 넣는다. 가게가 색인에 없어도 그 가게가 든
 *     건물·블록은 색인에 있다.
 *  3. 나온 자리가 여전히 {@link REFINE_RADIUS_KM} 안이면 그때만 스냅한다 —
 *     규칙 1과 같은 반경, 같은 판단이다.
 *
 * 이 계단은 **비싸다**(grounded 호출은 느리고 분당 퓨즈를 나눠 쓴다). 그래서 앞의
 * {@link ADDRESS_FALLBACK_CANDIDATES}개 후보에만, 후보당 한 번만 오른다. 실패는
 * 규칙 3 그대로 — 조용히 AI 좌표를 남긴다.
 */

import type { PlaceCandidate, RefinedBy } from '../ai/aiPlaces';
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

/**
 * 주소 경유 스냅(M37)을 시도할 후보 수 — 목록 앞에서부터 이만큼만.
 *
 * 이 계단의 값은 grounded AI 호출 한 번이다: 2~8초가 걸리고, 분당 20건짜리 퓨즈를
 * 다른 기능과 나눠 쓴다. 다섯 후보 전부에 붙이면 검색 한 번이 30초가 되고 퓨즈는
 * 한 검색으로 넘어간다. 사람이 실제로 고르는 줄은 거의 언제나 앞의 한둘이므로,
 * 비싼 확인은 거기에만 쓴다.
 */
export const ADDRESS_FALLBACK_CANDIDATES = 2;

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
  /**
   * 이름 스냅이 빗나갔을 때 그 후보의 정식 주소를 한 번 되묻는다 (M37).
   *
   * 실제로는 `ai/aiPlaces.aiPlaceAddress`(grounded 호출)가 들어온다. 넘기지 않으면
   * 주소 경유 계단 자체가 없다 — M35 그대로의 동작이다.
   */
  askAddress?: (candidate: PlaceCandidate) => Promise<string | null>;
  /** 검색 화면의 취소 신호 — 보정도 같이 멈춘다. */
  signal?: AbortSignal;
  radiusKm?: number;
  maxQueries?: number;
  /** 주소 경유를 시도할 후보 수. 기본 {@link ADDRESS_FALLBACK_CANDIDATES}. */
  maxAddressCandidates?: number;
}

/** 좌표 두 칸만 갈아끼운 새 후보 — 이름·지역·주소는 손대지 않는다. */
const snapped = (
  candidate: PlaceCandidate,
  point: { lat: number; lng: number },
  by: RefinedBy,
): PlaceCandidate => ({
  ...candidate,
  lat: point.lat,
  lng: point.lng,
  refined: true,
  refinedBy: by,
});

const isAbortError = (failure: unknown): boolean =>
  failure instanceof DOMException && failure.name === 'AbortError';

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
  const maxAddress = options.maxAddressCandidates ?? ADDRESS_FALLBACK_CANDIDATES;
  let budget = options.maxQueries ?? MAX_REFINE_QUERIES;

  /** 이번 검색 안에서만 사는 캐시 — 같은 검색어를 두 번 묻지 않는다. */
  const asked = new Map<string, GeoPoint[]>();
  const out: PlaceCandidate[] = [];
  /** Nominatim이 한 번 넘어지면 나머지도 넘어진다. 줄줄이 기다릴 이유가 없다. */
  let broken = false;
  /** AI 쪽도 마찬가지다 — 429 하나에 후보마다 8초씩 기다릴 이유가 없다 (M37). */
  let addressBroken = false;

  /**
   * Nominatim 한 번 — 캐시·예산·고장을 여기 한곳에서 다룬다.
   *
   * `null`은 「물어보지 못했다」는 뜻이다(예산이 없거나 방금 넘어졌거나). 빈 배열과
   * 구분되는 것이 중요하다: 빈 배열은 「물어봤는데 없다」이고, 그때는 다음 검색어로
   * 넘어갈 이유가 있다.
   */
  const askOsm = async (query: string): Promise<GeoPoint[] | null> => {
    const cached = asked.get(query);
    if (cached !== undefined) return cached;
    if (budget <= 0) return null;
    budget -= 1;

    let hits: GeoPoint[];
    try {
      hits = await options.osmSearch(query, options.signal);
    } catch (failure) {
      if (isAbortError(failure)) throw failure;
      broken = true;
      return null;
    }
    asked.set(query, hits);
    return hits;
  };

  for (const [index, candidate] of candidates.entries()) {
    if (broken || budget <= 0) {
      out.push(candidate);
      continue;
    }

    let refined = candidate;
    for (const query of refineQueries(candidate)) {
      const hits = await askOsm(query);
      if (hits === null) break;

      const near = nearestWithin(candidate, hits, radiusKm);
      if (near) {
        refined = snapped(candidate, near, 'name');
        break;
      }
    }

    // 이름으로는 못 찾았다 — OSM에 없는 가게일 수 있으니 주소로 한 계단 더 (M37).
    // 앞의 몇 후보에만, 후보당 한 번만, 그리고 지오코딩할 예산이 남아 있을 때만
    // 오른다. 느린 호출을 해 놓고 그 답을 못 쓰는 것이 가장 나쁜 경우다.
    if (
      refined === candidate &&
      options.askAddress &&
      !broken &&
      !addressBroken &&
      index < maxAddress &&
      budget > 0 &&
      options.signal?.aborted !== true
    ) {
      let address: string | null = null;
      try {
        address = await options.askAddress(candidate);
      } catch (failure) {
        if (isAbortError(failure)) throw failure;
        addressBroken = true;
      }

      if (address !== null && address.trim() !== '') {
        const hits = await askOsm(address.trim());
        const near = hits ? nearestWithin(candidate, hits, radiusKm) : null;
        if (near) refined = snapped(candidate, near, 'address');
      }
    }

    out.push(refined);
  }

  return out;
}
