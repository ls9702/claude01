/**
 * 구글 지도 자바스크립트를 script 태그 하나로 데려온다 (M41).
 *
 * **npm 의존성은 없다.** `@googlemaps/js-api-loader`도, `@types/google.maps`도
 * 넣지 않는다 — 이 앱이 실제로 쓰는 것은 클래스 넷(Map·Polyline·LatLngBounds·
 * AdvancedMarkerElement)과 함수 하나(Place.searchByText)뿐이고, 그만큼의 타입은
 * 아래 인터페이스가 구조적으로 적어 두는 편이 4MB짜리 타입 패키지를 잠그는 것
 * 보다 정직하다. 타입이 틀리면 그건 이 파일 한 곳에서 틀린다.
 *
 * ## 왜 「로더가 이음매(seam)」인가
 *
 * e2e는 구글 스크립트를 부를 수 없다(네트워크·키·비결정성 셋 다 안 된다). 그래서
 * 이 모듈은 부르기 **직전에** `window.__tripBoardFakeGoogle`을 한 번 본다. 있으면
 * 그것을 쓰고, 없으면 진짜를 부른다. `__tripBoardPollNow`·`__tripBoardSweepPhotos`
 * 와 같은 철학이다: 번들에 들어가는 것은 「있으면 쓴다」 세 줄뿐이고, 가짜 구현
 * 자체는 e2e 쪽에만 산다. 그 세 줄 덕분에 테스트가 검증하는 것은 가짜가 아니라
 * **진짜 배선**이다 — 컴포넌트가 정말로 Polyline을 화살표 옵션과 함께 만드는지,
 * 정말로 필터가 바뀔 때 fitBounds를 부르는지.
 *
 * ## 실패는 조용하다
 *
 * 키가 잘못됐든, 네트워크가 막혔든, 결과는 하나다: 약속이 거절되고 화면은
 * OSM으로 되돌아간다(`GoogleMapView` → `MapView`의 `onFail`). 구글의 인증 실패는
 * script의 `onerror`가 아니라 `window.gm_authFailure` 콜백으로 오므로 그쪽도
 * 받아 둔다.
 */

/** 구글 지도가 우리에게 돌려주는 좌표 — 메서드형과 값형이 둘 다 돌아다닌다. */
export interface GoogleLatLngLike {
  lat: number | (() => number);
  lng: number | (() => number);
}

/** `35.6` 또는 `() => 35.6` 어느 쪽이든 숫자로. */
export function latLngValue(value: number | (() => number) | undefined): number {
  if (typeof value === 'function') return value();
  return typeof value === 'number' ? value : Number.NaN;
}

/** 우리가 쓰는 만큼의 `google.maps.LatLngBounds`. */
export interface GoogleBounds {
  extend: (point: { lat: number; lng: number }) => unknown;
}

/** 우리가 쓰는 만큼의 `google.maps.Map`. */
export interface GoogleMap {
  fitBounds: (bounds: GoogleBounds, padding?: number | Record<string, number>) => void;
  setCenter: (point: { lat: number; lng: number }) => void;
  setZoom: (zoom: number) => void;
}

/** 우리가 쓰는 만큼의 `google.maps.Polyline`. */
export interface GooglePolyline {
  setMap: (map: GoogleMap | null) => void;
}

/**
 * 우리가 쓰는 만큼의 `google.maps.Circle` (M42) — 「내 위치」의 정확도 원.
 *
 * `Polyline`과 같은 계약이라 다루는 법도 같다: 만들 때 지도에 얹고, `setMap(null)`
 * 로 뗀다. 선택적인 이유는 이것 하나가 없다고 지도가 서지 못할 이유는 없기
 * 때문이다 — 원이 없으면 파란 점만 선다.
 */
export interface GoogleCircle {
  setMap: (map: GoogleMap | null) => void;
}

/** 우리가 쓰는 만큼의 `google.maps.marker.AdvancedMarkerElement`. */
export interface GoogleMarker {
  map: GoogleMap | null;
}

/** `importLibrary('marker')`가 주는 것. */
export interface GoogleMarkerLibrary {
  AdvancedMarkerElement: new (options: Record<string, unknown>) => GoogleMarker;
}

/** `searchByText`의 답 한 줄. */
export interface GooglePlaceResult {
  displayName?: string;
  formattedAddress?: string;
  location?: GoogleLatLngLike | null;
}

/** `importLibrary('places')`가 주는 것 중 우리가 쓰는 부분. */
export interface GooglePlacesLibrary {
  Place: {
    searchByText: (request: Record<string, unknown>) => Promise<{ places?: GooglePlaceResult[] }>;
  };
}

/** `google.maps` 자체 — 이 앱이 만지는 표면 전부. */
export interface GoogleMapsApi {
  Map: new (element: HTMLElement, options?: Record<string, unknown>) => GoogleMap;
  Polyline: new (options?: Record<string, unknown>) => GooglePolyline;
  LatLngBounds: new () => GoogleBounds;
  /** 「내 위치」의 정확도 원 (M42) — 없으면 원 없이 점만 선다. */
  Circle?: new (options?: Record<string, unknown>) => GoogleCircle;
  SymbolPath?: Record<string, unknown>;
  importLibrary?: (name: string) => Promise<unknown>;
  /** `libraries=marker`로 실은 경우의 자리 — `importLibrary`가 없을 때의 대비. */
  marker?: GoogleMarkerLibrary;
  places?: GooglePlacesLibrary;
}

/**
 * AdvancedMarkerElement는 **map id가 있는 지도에만** 붙는다 (구글 문서).
 *
 * 사용자의 클라우드 프로젝트에는 아직 스타일 맵 ID가 없고, 만들어 달라고 하는
 * 것은 이 마일스톤이 요구할 일이 아니다. `DEMO_MAP_ID`는 구글이 바로 그 상황을
 * 위해 문서화한 값으로 **어떤 키로도 동작한다** — 대신 콘솔에 「데모용」 경고가
 * 한 줄 뜨고 커스텀 스타일은 적용되지 않는다(기본 스타일 그대로). 나중에 클라우드
 * 콘솔에서 지도 스타일을 만들면 이 상수 하나만 그 ID로 바꾸면 된다.
 */
export const GOOGLE_MAP_ID = 'DEMO_MAP_ID';

/** 스크립트 태그의 id — 두 번 실으면 구글이 콘솔에서 경고한다. */
const SCRIPT_ID = 'trip-board-gmaps';

/** 한국어 라벨, 주간 채널, 그리고 우리가 쓰는 두 라이브러리. */
const SCRIPT_PARAMS = 'v=weekly&language=ko&region=KR&libraries=marker,places&loading=async';

/** 이 창에서 진행 중이거나 끝난 로드. 두 번째 호출부터는 같은 약속을 나눠 쓴다. */
let pending: Promise<GoogleMapsApi> | null = null;

interface GoogleWindow {
  google?: { maps?: GoogleMapsApi };
  __tripBoardFakeGoogle?: { maps?: GoogleMapsApi };
  __tripBoardGmapsReady?: () => void;
  gm_authFailure?: () => void;
}

/**
 * e2e가 심어 둔 가짜 구현, 있으면.
 *
 * 호출 **시점에** 읽는다 — 모듈이 평가되는 시각과 `addInitScript`가 도는 시각의
 * 순서에 기대지 않기 위해서다.
 */
function fakeMaps(): GoogleMapsApi | null {
  if (typeof window === 'undefined') return null;
  const fake = (window as unknown as GoogleWindow).__tripBoardFakeGoogle;
  return fake?.maps ?? null;
}

/** 이미 실린 진짜 구글, 있으면 (다른 탭에서 온 캐시나 두 번째 마운트). */
function realMaps(): GoogleMapsApi | null {
  if (typeof window === 'undefined') return null;
  const maps = (window as unknown as GoogleWindow).google?.maps;
  return maps && typeof maps.Map === 'function' ? maps : null;
}

/**
 * 구글 지도 API를 손에 넣는다. 실패하면 거절 — 호출부는 OSM으로 되돌아간다.
 *
 * 같은 키로 여러 번 불러도 스크립트는 한 번만 실린다.
 */
export function loadGoogleMaps(apiKey: string): Promise<GoogleMapsApi> {
  const fake = fakeMaps();
  if (fake) return Promise.resolve(fake);

  if (pending) return pending;

  const key = apiKey.trim();
  if (!key) return Promise.reject(new Error('no google maps key'));
  if (typeof document === 'undefined') return Promise.reject(new Error('no document'));

  const already = realMaps();
  if (already) {
    pending = Promise.resolve(already);
    return pending;
  }

  pending = new Promise<GoogleMapsApi>((resolve, reject) => {
    const scope = window as unknown as GoogleWindow;

    const settle = () => {
      const maps = realMaps();
      if (maps) resolve(maps);
      else fail(new Error('google maps loaded without a maps namespace'));
    };

    const fail = (error: Error) => {
      // 다음 마운트가 다시 시도할 수 있게 비운다 — 키가 아니라 네트워크가
      // 문제였다면 두 번째 시도는 성공할 수 있다.
      pending = null;
      reject(error);
    };

    scope.__tripBoardGmapsReady = settle;
    // 인증 실패(잘못된 키·리퍼러 거절)는 script의 onerror로 오지 않는다.
    scope.gm_authFailure = () => fail(new Error('google maps auth failure'));

    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.async = true;
    script.src =
      `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}` +
      `&${SCRIPT_PARAMS}&callback=__tripBoardGmapsReady`;
    script.onerror = () => {
      script.remove();
      fail(new Error('google maps script failed to load'));
    };
    document.head.appendChild(script);
  });

  return pending;
}

/**
 * `importLibrary('marker')` — 없으면 네임스페이스에서 직접 집는다.
 *
 * `loading=async` 부트스트랩은 `importLibrary`를 함께 실어 주지만, 그 함수가
 * 없는 조합(구버전 캐시, 가짜 구현의 최소 형태)에서도 `libraries=marker`로 실은
 * `google.maps.marker`가 남는다. 둘 다 없으면 그때가 실패다.
 */
export async function googleMarkerLibrary(maps: GoogleMapsApi): Promise<GoogleMarkerLibrary> {
  if (typeof maps.importLibrary === 'function') {
    const library = (await maps.importLibrary('marker')) as GoogleMarkerLibrary | undefined;
    if (library?.AdvancedMarkerElement) return library;
  }
  if (maps.marker?.AdvancedMarkerElement) return maps.marker;
  throw new Error('google maps marker library unavailable');
}

/** 같은 이야기의 places 판. */
export async function googlePlacesLibrary(maps: GoogleMapsApi): Promise<GooglePlacesLibrary> {
  if (typeof maps.importLibrary === 'function') {
    const library = (await maps.importLibrary('places')) as GooglePlacesLibrary | undefined;
    if (library?.Place?.searchByText) return library;
  }
  if (maps.places?.Place?.searchByText) return maps.places;
  throw new Error('google maps places library unavailable');
}

/** 테스트 전용 — 이 모듈의 한 창짜리 기억을 지운다. */
export function resetGoogleLoaderForTests(): void {
  pending = null;
}
