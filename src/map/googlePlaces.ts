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
