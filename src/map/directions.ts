/**
 * 「구글맵으로 길찾기」 링크 한 줄 (M42).
 *
 * 이 앱이 아무리 경로를 잘 그려도, 실제로 그 길을 **따라 걷는** 일은 구글 지도
 * 앱이 한다 — 실시간 환승, 다음 열차, 걷는 방향. 그래서 지도의 핀 팝업과 일정
 * 상세에 나가는 문을 하나 둔다. 이 링크는 값을 치르지 않는다: 구글 Maps URLs는
 * 공개 규격이고 API 키도, 호출량도 없다.
 *
 * 폰에서는 이 주소가 설치된 구글 지도 앱으로 넘어가고(안드로이드·iOS 둘 다),
 * 데스크톱에서는 새 탭의 웹 지도가 된다. 그래서 한 가지 주소만 만든다 — 기기를
 * 감지해 갈래를 치는 순간 둘 중 하나는 반드시 틀린다.
 *
 * 순수 함수 하나뿐이라 호출부는 어디서든 같은 답을 얻는다.
 */

/** 링크가 가리키는 점 하나. */
export interface DirectionsPoint {
  lat: number;
  lng: number;
}

/** 구글 Maps URLs의 길찾기 주소. */
export const DIRECTIONS_BASE = 'https://www.google.com/maps/dir/';

/**
 * 좌표 한 쌍을 주소에 실을 모양으로.
 *
 * 소수점 여섯 자리(약 10cm)면 지구 위 어떤 가게도 지목한다. `URLSearchParams`를
 * 쓰지 않는 이유는 쉼표 때문이다 — 그쪽은 `,`를 `%2C`로 적고, 구글도 그것을
 * 알아듣긴 하지만 사람이 읽는 주소가 아니게 된다.
 */
const coord = (point: DirectionsPoint): string =>
  `${Number(point.lat.toFixed(6))},${Number(point.lng.toFixed(6))}`;

/** 좌표로 쓸 수 있는 점인가. */
const usable = (point: DirectionsPoint | null | undefined): point is DirectionsPoint =>
  Boolean(point) && Number.isFinite(point!.lat) && Number.isFinite(point!.lng);

/**
 * 「여기로 가는 길」 주소. 도착지가 쓸 수 없는 좌표면 `null`.
 *
 * `origin`은 **있으면** 싣는다: 일정에서 그 앞 장소를 아는 자리(일정 상세)는
 * 「점심 먹은 데서 여기까지」를 물을 수 있고, 지도의 핀 팝업처럼 앞이 없는
 * 자리는 도착지만 실어 구글이 **현재 위치**에서 길을 찾게 둔다. 둘 다 맞는
 * 답이라, 없는 출발지를 지어내지 않는다.
 *
 * `travelmode=transit`인 이유는 이 여행이 대중교통 여행이기 때문이다(오사카·
 * 도쿄). 구글 지도는 그 모드로 열되 사용자가 그 자리에서 걷기·차로 바꿀 수 있다.
 */
export function directionsUrl(
  destination: DirectionsPoint | null | undefined,
  origin?: DirectionsPoint | null,
): string | null {
  if (!usable(destination)) return null;

  const parts = ['api=1'];
  if (usable(origin)) parts.push(`origin=${coord(origin)}`);
  parts.push(`destination=${coord(destination)}`);
  parts.push('travelmode=transit');
  return `${DIRECTIONS_BASE}?${parts.join('&')}`;
}

/** 버튼에 적히는 말 — 세 자리에서 같은 한 마디여야 한다. */
export const DIRECTIONS_LABEL = '길찾기';

/* ------------------------------------------------------------------ *
 * 장소 페이지 링크 (M43)
 * ------------------------------------------------------------------ */

/** 구글 Maps URLs의 장소 검색 주소. */
export const PLACE_SEARCH_BASE = 'https://www.google.com/maps/search/';

/** 버튼에 적히는 말. */
export const PLACE_PAGE_LABEL = '구글 지도 앱에서 보기';

/**
 * 「그 가게의 구글 지도 페이지」로 가는 링크 (M43).
 *
 * 길찾기와 다른 문이다: 사용자가 맛집 핀을 눌렀을 때 가장 자주 묻는 것은
 * 「어떻게 가지」가 아니라 **「여기 어떤 집이지」**다 — 사진, 영업시간, 리뷰,
 * 메뉴. 그건 우리가 흉내 낼 것이 아니라 구글 지도 앱이 이미 잘하는 일이다.
 *
 * `query_place_id`가 있으면 앱은 **그 가게의 시트**를 바로 연다. 좌표만 넘기면
 * 「그 지점에 무엇이 있나」를 앱이 다시 추측하게 되고, 골목 안 가게는 옆집이
 * 열리기도 한다. 그래서 캐시가 `placeId`를 들고 다닌다.
 *
 * `query`는 place id가 있어도 **필수**다(구글 규격) — 현지 상호를 싣는다.
 * id가 없으면 이름과 좌표를 함께 실어 그 자리 근처의 그 이름을 찾게 한다.
 */
export function placePageUrl(
  name: string | undefined,
  point?: DirectionsPoint | null,
  placeId?: string,
): string | null {
  const label = (name ?? '').trim();
  const hasPoint = usable(point);
  if (!label && !hasPoint) return null;

  const query = label && hasPoint && !placeId ? `${label} ${coord(point!)}` : label || coord(point!);

  const parts = ['api=1', `query=${encodeURIComponent(query)}`];
  if (placeId) parts.push(`query_place_id=${encodeURIComponent(placeId)}`);
  return `${PLACE_SEARCH_BASE}?${parts.join('&')}`;
}

/** 「그 날의 정거장들」 한 줄 — `timeline/route`의 `RouteStop`이 그대로 들어맞는다. */
interface StopLike {
  cardId: string;
  lat: number;
  lng: number;
}

/**
 * 카드 → **그 앞 정거장** (순수).
 *
 * 「길찾기」가 출발지를 실을 수 있는 경우는 하나뿐이다: 지금 화면이 **한 날의
 * 동선**을 보고 있고, 그 날 안에서 이 장소 앞에 다른 장소가 있을 때. 그러면
 * 링크는 「점심 먹은 데서 여기까지」가 된다.
 *
 * 여러 날을 한 번에 보는 화면에서는 부르지 않는다 — 같은 카드가 두 날에 놓여
 * 있으면 「앞 장소」가 둘이 되고, 둘 중 하나를 고르는 순간 그 링크는 절반의
 * 확률로 거짓말이 된다. 그래서 그 화면에서는 도착지만 싣는다.
 *
 * 같은 카드가 한 날에 두 번 나오면 **처음** 것을 남긴다: 그 날 그 카드로 가는
 * 첫 걸음이 사람이 물을 법한 그 길이다.
 */
export function previousStopMap(
  stopLists: readonly (readonly StopLike[])[],
): Map<string, DirectionsPoint> {
  const previous = new Map<string, DirectionsPoint>();
  for (const stops of stopLists) {
    for (let i = 1; i < stops.length; i += 1) {
      const stop = stops[i];
      if (previous.has(stop.cardId)) continue;
      previous.set(stop.cardId, { lat: stops[i - 1].lat, lng: stops[i - 1].lng });
    }
  }
  return previous;
}
