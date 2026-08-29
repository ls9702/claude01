/**
 * 구글 Places를 **카드 위치 검색의 1순위**로 (M44).
 *
 * ## 왜
 *
 * M28~M37이 쌓아 올린 검색은 이랬다: AI에게 물어 후보를 얻고(현지 표기까지),
 * 그 표기를 Nominatim에 되물어 좌표를 조이고(M35), 이름으로 못 찾으면 정식
 * 주소를 되물어 다시 조인다(M37). 정교하지만 마지막 계단이 늘 같은 곳에서
 * 무너졌다 — **OSM 색인에 없는 가게**다. 「마루하치 슈퍼 난바점」처럼 동네
 * 사람만 아는 상호는 Nominatim이 모르고, 그러면 모델의 기억 좌표가 아무 표시
 * 없이 남는다. 그래서 같은 카드를 두 번 찾으면 두 번 다른 자리에 꽂혔다.
 *
 * M41에서 이 앱에 구글 지도 키가 들어왔다(`map/gmapsKey.ts`). Places는 바로 그
 * 색인을 가지고 있다 — 그 가게가 실제로 영업 중이면 구글은 안다. 그래서 좌표의
 * **원천**을 바꾼다: 키가 있으면 구글에게 먼저 묻고, 그 답은 조일 필요가 없다.
 * 구글 좌표가 곧 원본이기 때문이다.
 *
 * ## 무엇을 건드리지 않나
 *
 * - **키가 없는 기기**(GitHub Pages, 부트스트랩 없는 배포)는 한 글자도 달라지지
 *   않는다. AI → OSM → 보정, M37까지의 그 길 그대로다.
 * - **좌표 붙여넣기·손 핀**(M37)은 애초에 엔진을 건너뛰는 길이라 무관하다.
 * - **시트의 지도 엔진**(M41)과도 무관하다. OSM 시트를 보고 있어도 검색은 이
 *   기기가 가진 가장 좋은 색인을 쓴다 — 어떤 타일 위에 그리느냐와 어디에
 *   찍히느냐는 다른 질문이다.
 * - 배치 보정 팝업(M41)도 그대로다. 검색이 정확해지면 그 팝업이 뜰 일이 줄어들
 *   뿐, 규칙이 바뀌지는 않는다.
 */

import type { PlaceCandidate } from '../ai/aiPlaces';
import type { GeoPoint } from '../types/models';
import { loadGoogleMapsKey } from './gmapsKey';
import { loadGoogleMaps } from './googleLoader';
import { PLACE_SEARCH_MAX_RESULTS, searchPlaceSuggestions } from './googlePlaces';
import type { PlaceSuggestion } from './placeFix';

/** 이 기기가 구글에게 물을 수 있는가 — 키 하나가 전부다 (M41의 그 판정). */
export function hasGoogleLookup(): boolean {
  return loadGoogleMapsKey() !== null;
}

/**
 * 구글 한 줄을 검색 결과 한 줄로.
 *
 * `locality`에 **정식 주소**를 싣는다. 화면의 그 자리는 「이 장소가 어디쯤인가」를
 * 말하는 줄이고(AI 경로에서는 「오사카」가 들어온다), 저장할 때
 * `aiPlaces.toGeoPoint`가 `이름, locality`를 이어 카드의 주소로 만든다 — 구글이
 * 준 주소보다 그 자리에 어울리는 문자열은 없다.
 *
 * `refined: true`인 이유: 그 표시(「✓ 지도 확인됨」)가 뜻하는 것은 「이 좌표는
 * 모델의 기억이 아니라 지도가 아는 자리」다. 구글 Places의 답이 바로 그것이다.
 */
export function toGoogleCandidate(place: PlaceSuggestion): PlaceCandidate {
  const address = place.address?.trim();
  return {
    name: place.name || (address ?? `${place.lat}, ${place.lng}`),
    lat: place.lat,
    lng: place.lng,
    ...(address ? { address, locality: address } : {}),
    refined: true,
    refinedBy: 'google',
  };
}

/**
 * 구글에게 후보를 묻는다. **키가 없으면 곧장 빈 배열**(부르지 않는다).
 *
 * 던지는 것: 로더 실패·API 실패. 부르는 쪽이 「못 찾았다」와 「못 물었다」를
 * 구별해 서로 다른 한 줄로 말해야 하기 때문이다(`map/placeSearch.ts`).
 */
export async function googlePlaceSearch(
  query: string,
  bias?: GeoPoint,
  max: number = PLACE_SEARCH_MAX_RESULTS,
): Promise<PlaceCandidate[]> {
  const key = loadGoogleMapsKey();
  if (!key) return [];

  const maps = await loadGoogleMaps(key);
  const found = await searchPlaceSuggestions(
    maps,
    query,
    bias && Number.isFinite(bias.lat) && Number.isFinite(bias.lng)
      ? { lat: bias.lat, lng: bias.lng }
      : undefined,
    max,
  );
  return found.map(toGoogleCandidate);
}
