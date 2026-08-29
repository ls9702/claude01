/**
 * 구글 Places **Text Search (New)** 한 번 (M41).
 *
 * 쓰임새는 하나뿐이다: 카드를 구글 시트에 놓는 순간, 그 카드 제목으로 구글에
 * 「이 이름의 장소가 어디죠」를 한 번 묻는다. 답이 오면 {@link decidePlaceFix}가
 * 보여 줄지 말지를 정한다.
 *
 * 옛 `PlacesService`(text search)는 지도 인스턴스를 요구하고 콜백을 쓴다. 새
 * `Place.searchByText`는 정적 메서드에 약속을 돌려주고, **필드를 명시**해야
 * 한다 — 그 목록이 곧 구글에 내는 요금이므로 셋만 받는다.
 *
 * 실패·빈 결과·예외는 전부 `null` 하나로 접힌다. 이 기능은 사용자가 부탁한 적
 * 없는 일이라, 안 되면 아무 일도 없었던 것이어야 한다.
 */

import {
  googlePlacesLibrary,
  latLngValue,
  type GoogleMapsApi,
  type GooglePlaceResult,
} from './googleLoader';
import type { PlacePoint, PlaceSuggestion } from './placeFix';

/** 검색을 이 반경 안으로 기울인다 — 도시 하나만 한 크기. */
export const PLACE_BIAS_RADIUS_M = 30_000;

/** 우리가 값을 치르는 필드 셋. */
const FIELDS = ['displayName', 'location', 'formattedAddress'];

/** 구글의 한 줄을 이 앱의 제안 하나로. 좌표가 없으면 `null`. */
export function toSuggestion(place: GooglePlaceResult | undefined): PlaceSuggestion | null {
  if (!place?.location) return null;
  const lat = latLngValue(place.location.lat);
  const lng = latLngValue(place.location.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const name = typeof place.displayName === 'string' ? place.displayName.trim() : '';
  const address =
    typeof place.formattedAddress === 'string' && place.formattedAddress.trim().length > 0
      ? place.formattedAddress.trim()
      : undefined;

  return { name, lat, lng, ...(address ? { address } : {}) };
}

/**
 * 이름 하나로 한 곳을 찾는다. 못 찾거나 실패하면 `null`.
 *
 * `bias`는 카드의 현재 좌표(없으면 여행 목적지)다 — 「이치란」이 세계 어디의
 * 이치란인지를 가르는 유일한 단서라, 없으면 전 세계 검색이 된다.
 */
export async function searchPlaceByText(
  maps: GoogleMapsApi,
  query: string,
  bias?: PlacePoint,
): Promise<PlaceSuggestion | null> {
  const textQuery = query.trim();
  if (!textQuery) return null;

  try {
    const places = await googlePlacesLibrary(maps);
    const answer = await places.Place.searchByText({
      textQuery,
      fields: FIELDS,
      maxResultCount: 1,
      language: 'ko',
      ...(bias
        ? { locationBias: { center: { lat: bias.lat, lng: bias.lng }, radius: PLACE_BIAS_RADIUS_M } }
        : {}),
    });
    return toSuggestion(answer?.places?.[0]);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * 「주변 맛집」이 쓰는 두 갈래 (M43)
 * ------------------------------------------------------------------ */

/**
 * 맛집 조회가 값을 치르는 필드 셋.
 *
 * M41의 {@link FIELDS} 셋에 넷을 더한다: 평점(문턱을 넘는지), 평점 수(4.9(3명)와
 * 4.4(2천명)를 가르는 값), 장소 id(그 가게의 구글 지도 페이지를 여는 열쇠),
 * 타입(결과의 갈래를 되읽는 값).
 *
 * `reservable`은 **여기 없다**. 그 필드는 더 비싼 등급에 속하고, 큐레이션 목록은
 * 예약 여부를 이미 손으로 조사해 들고 있다(`data/gourmet.ts`). 구글 쪽 결과는
 * 예약 여부를 「모른다」로 두는 편이 낫다 — 모르는 것을 아는 척하는 값에 돈을
 * 치를 이유가 없다.
 */
export const GOURMET_FIELDS = [
  'displayName',
  'location',
  'formattedAddress',
  'rating',
  'userRatingCount',
  'id',
  'types',
];

/** 구글 한 줄을 「주변 맛집」이 읽는 모양으로. 좌표가 없으면 `null`. */
export interface GourmetPlace {
  name: string;
  lat: number;
  lng: number;
  address?: string;
  rating?: number;
  ratingCount?: number;
  reservable?: boolean;
  placeId?: string;
  types?: string[];
}

/** 숫자가 유한할 때만. */
const finite = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/** 답 한 줄 → {@link GourmetPlace}. 좌표가 없으면 `null`. */
export function toGourmetPlace(place: GooglePlaceResult | undefined): GourmetPlace | null {
  if (!place?.location) return null;
  const lat = latLngValue(place.location.lat);
  const lng = latLngValue(place.location.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const address =
    typeof place.formattedAddress === 'string' && place.formattedAddress.trim().length > 0
      ? place.formattedAddress.trim()
      : undefined;
  const placeId = typeof place.id === 'string' && place.id.trim().length > 0 ? place.id.trim() : undefined;
  // 요청 필드는 `reservable`, SDK 속성은 `isReservable` — 둘 다 받는다.
  const reservable =
    typeof place.reservable === 'boolean'
      ? place.reservable
      : typeof place.isReservable === 'boolean'
        ? place.isReservable
        : undefined;

  return {
    name: typeof place.displayName === 'string' ? place.displayName.trim() : '',
    lat,
    lng,
    ...(address ? { address } : {}),
    ...(finite(place.rating) !== undefined ? { rating: finite(place.rating)! } : {}),
    ...(finite(place.userRatingCount) !== undefined
      ? { ratingCount: finite(place.userRatingCount)! }
      : {}),
    ...(reservable !== undefined ? { reservable } : {}),
    ...(placeId ? { placeId } : {}),
    ...(Array.isArray(place.types) ? { types: place.types.filter((t) => typeof t === 'string') } : {}),
  };
}

/**
 * 이름 하나로 한 집을 찾되 **평점과 장소 id까지** 받아 온다 (M43).
 *
 * {@link searchPlaceByText}를 고치지 않고 형제를 하나 두는 이유: 저쪽은 배치
 * 보정이 쓰는 길이고 필드 셋이 곧 요금이라, 그쪽 호출까지 비싸질 이유가 없다.
 *
 * 이 함수가 불리는 때는 **큐레이션 한 집당 평생 한 번**이다(그 뒤로는
 * `gourmet/cache.ts`가 답한다).
 */
export async function searchGourmetPlace(
  maps: GoogleMapsApi,
  query: string,
  bias?: PlacePoint,
  options: { minRating?: number; maxResultCount?: number } = {},
): Promise<GourmetPlace | null> {
  const list = await searchGourmetPlaces(maps, query, bias, {
    ...options,
    maxResultCount: options.maxResultCount ?? 1,
  });
  return list[0] ?? null;
}

/** 같은 질문의 여러 줄 판 — 키워드로 동네를 훑을 때 (M43). */
export async function searchGourmetPlaces(
  maps: GoogleMapsApi,
  query: string,
  bias?: PlacePoint,
  options: { minRating?: number; maxResultCount?: number } = {},
): Promise<GourmetPlace[]> {
  const textQuery = query.trim();
  if (!textQuery) return [];

  try {
    const places = await googlePlacesLibrary(maps);
    const answer = await places.Place.searchByText({
      textQuery,
      fields: GOURMET_FIELDS,
      maxResultCount: options.maxResultCount ?? 20,
      language: 'ko',
      ...(typeof options.minRating === 'number' ? { minRating: options.minRating } : {}),
      ...(bias
        ? { locationBias: { center: { lat: bias.lat, lng: bias.lng }, radius: PLACE_BIAS_RADIUS_M } }
        : {}),
    });
    return (answer?.places ?? [])
      .map(toGourmetPlace)
      .filter((place): place is GourmetPlace => place !== null);
  } catch {
    return [];
  }
}

/**
 * 화면 한가운데 반경 안의 맛집들 — Places (New) `searchNearby` (M43).
 *
 * 실패(라이브러리 없음·타입 이름 거절·네트워크)는 **던진다**. 호출부가 그때
 * 키워드 검색으로 한 계단 내려갈 수 있어야 하기 때문이다 — 조용한 `[]`는
 * 「이 동네에 초밥집이 없다」와 구별되지 않는다.
 *
 * `rankPreference`를 싣지 않는다: 기본값(인기순)이면 충분하고, 화면에 세우는
 * 순서는 어차피 우리가 평점으로 다시 정한다.
 */
export async function searchNearbyGourmet(
  maps: GoogleMapsApi,
  center: PlacePoint,
  includedTypes: readonly string[],
  options: { radius: number; maxResultCount: number },
): Promise<GourmetPlace[]> {
  if (includedTypes.length === 0) return [];

  const places = await googlePlacesLibrary(maps);
  const searchNearby = places.Place.searchNearby;
  if (typeof searchNearby !== 'function') throw new Error('searchNearby unavailable');

  const answer = await searchNearby({
    fields: GOURMET_FIELDS,
    locationRestriction: {
      center: { lat: center.lat, lng: center.lng },
      radius: options.radius,
    },
    includedTypes: [...includedTypes],
    maxResultCount: options.maxResultCount,
    language: 'ko',
  });

  return (answer?.places ?? [])
    .map(toGourmetPlace)
    .filter((place): place is GourmetPlace => place !== null);
}
