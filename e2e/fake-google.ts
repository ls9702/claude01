/**
 * 가짜 `google.maps` — e2e 전용 (M41).
 *
 * 진짜 구글 자바스크립트는 CI에서 절대 뜰 수 없다: 네트워크가 필요하고, 키가
 * 필요하고, 무엇보다 그 위에서 벌어지는 일이 결정적이지 않다(타일·폰트·A/B).
 * 그래서 `src/map/googleLoader.ts`에 이음매를 하나 두었다 — 부르기 직전에
 * `window.__tripBoardFakeGoogle`을 한 번 보고, 있으면 그것을 쓴다.
 *
 * 그 이음매 덕분에 여기서 검증되는 것은 **앱의 진짜 배선**이다: 컴포넌트가 정말
 * `AdvancedMarkerElement`를 카드마다 하나씩 만드는지, 정말 `Polyline`을 그 날의
 * 색과 화살표 옵션으로 만드는지, 정말 필터가 바뀔 때 `fitBounds`를 부르는지,
 * 정말 `Place.searchByText`에 카드 제목을 넣는지. 가짜가 하는 일은 그 호출을
 * **받아 적는 것**뿐이다 — 그림을 그리지 않는다.
 *
 * 번들에는 이 파일의 한 글자도 들어가지 않는다.
 */

/** 가짜가 받아 적는 것들 — 스펙이 읽는 유일한 창구. */
export interface FakeGoogleState {
  maps: { options: Record<string, unknown> }[];
  markers: { lat: number; lng: number; title: string; testId: string | null }[];
  polylines: {
    path: { lat: number; lng: number }[];
    strokeColor?: string;
    strokeOpacity?: number;
    arrows: number;
    repeat?: string;
  }[];
  fits: { points: { lat: number; lng: number }[] }[];
  searches: { textQuery: string; fields: string[]; bias?: { lat: number; lng: number } }[];
  /** `setCenter`로 옮겨 간 자리들 — 「내 위치」가 지도를 데려갔는가 (M42). */
  centers: { lat: number; lng: number }[];
  /** 그려진 원 — 「내 위치」의 정확도 (M42). */
  circles: { lat: number; lng: number; radius: number }[];
  /** `searchNearby` 요청들 — 「주변 맛집」이 무엇을 물었나 (M43). */
  nearby: {
    center?: { lat: number; lng: number };
    radius?: number;
    includedTypes: string[];
    fields: string[];
    maxResultCount?: number;
  }[];
}

/**
 * 스펙이 심는 canned 결과 한 줄.
 *
 * M41은 이름·주소·좌표 셋이면 됐다. M43의 「주변 맛집」은 평점으로 거르고 장소
 * 페이지로 넘기므로 넷이 더 붙었다 — 전부 **선택적**이라 M41·M42의 스펙은 한
 * 글자도 바뀌지 않는다.
 */
export interface FakePlace {
  displayName: string;
  formattedAddress?: string;
  lat: number;
  lng: number;
  /** 구글 평점 (M43) — 4.3 문턱을 넘는지를 정하는 값. */
  rating?: number;
  userRatingCount?: number;
  /** 장소 id (M43) — 「구글 지도 앱에서 보기」의 열쇠. */
  id?: string;
  /** Places 타입들 (M43) — 결과의 갈래를 되읽는 값. */
  types?: string[];
}

/**
 * 질의별 canned 답 (M43).
 *
 * `__tripBoardFakeGooglePlacesByQuery`에 심으면 `searchByText`가 **질의에 그
 * 열쇠가 들어 있을 때** 그 목록으로 답한다. 맛집 조회는 집마다 다른 질의를
 * 내므로(「一蘭 道頓堀店 도톤보리」) 하나의 배열로는 흉내 낼 수 없다.
 *
 * 맞는 열쇠가 없으면 지금까지처럼 `__tripBoardFakeGooglePlaces` 배열로 답한다 —
 * M41·M42의 스펙이 그 자리에 그대로 있다.
 */
export type FakePlacesByQuery = Record<string, FakePlace[]>;

/**
 * `page.addInitScript(installFakeGoogle)`로 심는다.
 *
 * **이 함수 안은 페이지 안에서 돈다** — 바깥 스코프를 하나도 참조하지 않는다.
 */
export function installFakeGoogle(): void {
  const scope = window as unknown as Record<string, unknown>;
  if (scope.__tripBoardFakeGoogle) return;

  const state = {
    maps: [] as unknown[],
    markers: [] as unknown[],
    polylines: [] as unknown[],
    fits: [] as unknown[],
    searches: [] as unknown[],
    centers: [] as unknown[],
    circles: [] as unknown[],
    nearby: [] as unknown[],
  };

  /** 스펙이 미리 심어 두는 검색 결과. 없으면 「못 찾음」. */
  if (!scope.__tripBoardFakeGooglePlaces) scope.__tripBoardFakeGooglePlaces = [];
  /** 질의별 답 (M43). 없으면 위의 한 배열로만 답한다. */
  if (!scope.__tripBoardFakeGooglePlacesByQuery) scope.__tripBoardFakeGooglePlacesByQuery = {};
  /** `searchNearby`가 돌려줄 줄들 (M43). */
  if (!scope.__tripBoardFakeGoogleNearby) scope.__tripBoardFakeGoogleNearby = [];

  /**
   * 답을 이만큼 늦춘다 (M43, 기본 0).
   *
   * 「맛집 정보 불러오는 중 3/11」처럼 **순차 진행 중에만 존재하는 화면**은
   * 답이 즉시 오면 볼 수 없다. 기본이 0이라 M41·M42의 스펙은 지금까지처럼
   * 한 틱에 끝난다.
   */
  const settle = <T,>(value: T): Promise<T> => {
    const ms = Number(scope.__tripBoardFakeGoogleDelayMs ?? 0);
    if (!(ms > 0)) return Promise.resolve(value);
    return new Promise((resolve) => setTimeout(() => resolve(value), ms));
  };

  class FakeBounds {
    points: { lat: number; lng: number }[] = [];
    extend(point: { lat: number; lng: number }) {
      this.points.push({ lat: point.lat, lng: point.lng });
      return this;
    }
  }

  class FakeMap {
    element: HTMLElement;
    options: Record<string, unknown>;
    /** 지금 화면 한가운데 — 진짜 지도처럼 `fitBounds`·`setCenter`를 따라 움직인다. */
    center: { lat: number; lng: number };
    constructor(element: HTMLElement, options: Record<string, unknown> = {}) {
      this.element = element;
      this.options = options;
      this.center = (options.center as { lat: number; lng: number } | undefined) ?? {
        lat: 0,
        lng: 0,
      };
      element.setAttribute('data-fake-google-map', 'true');
      state.maps.push({ options });
    }
    fitBounds(bounds: FakeBounds) {
      state.fits.push({ points: bounds.points.slice() });
      // 맞춘 범위의 한가운데로 — 「이 지역에서 다시 검색」이 읽는 값이다 (M43).
      if (bounds.points.length > 0) {
        const sum = bounds.points.reduce(
          (acc, point) => ({ lat: acc.lat + point.lat, lng: acc.lng + point.lng }),
          { lat: 0, lng: 0 },
        );
        this.center = {
          lat: sum.lat / bounds.points.length,
          lng: sum.lng / bounds.points.length,
        };
      }
    }
    /** M42 — 「내 위치」가 지도를 데려갔는지는 이 한 줄로만 확인할 수 있다. */
    setCenter(point: { lat: number; lng: number }) {
      this.center = { lat: point.lat, lng: point.lng };
      state.centers.push({ lat: point.lat, lng: point.lng });
    }
    /** M43 — 진짜 구글처럼 좌표를 **메서드**로 준다. */
    getCenter() {
      const center = this.center;
      return { lat: () => center.lat, lng: () => center.lng };
    }
    setZoom() {}
  }

  class FakeMarker {
    position: { lat: number; lng: number };
    content: HTMLElement | null;
    title: string;
    private current: FakeMap | null = null;
    constructor(options: Record<string, unknown>) {
      const position = (options.position ?? { lat: 0, lng: 0 }) as { lat: number; lng: number };
      this.position = position;
      this.content = (options.content as HTMLElement | undefined) ?? null;
      this.title = String(options.title ?? '');
      state.markers.push({
        lat: position.lat,
        lng: position.lng,
        title: this.title,
        testId: this.content?.getAttribute('data-testid') ?? null,
      });
      this.map = (options.map as FakeMap | undefined) ?? null;
    }
    get map(): FakeMap | null {
      return this.current;
    }
    /** 진짜와 같은 계약: `map`에 지도를 넣으면 붙고, `null`을 넣으면 떨어진다. */
    set map(next: FakeMap | null) {
      this.current = next;
      if (!this.content) return;
      if (next) next.element.appendChild(this.content);
      else this.content.remove();
    }
  }

  class FakePolyline {
    options: Record<string, unknown>;
    constructor(options: Record<string, unknown> = {}) {
      this.options = options;
      const icons = (options.icons as { repeat?: string }[] | undefined) ?? [];
      state.polylines.push({
        path: ((options.path as { lat: number; lng: number }[] | undefined) ?? []).map((point) => ({
          lat: point.lat,
          lng: point.lng,
        })),
        strokeColor: options.strokeColor as string | undefined,
        strokeOpacity: options.strokeOpacity as number | undefined,
        arrows: icons.length,
        repeat: icons[0]?.repeat,
      });
    }
    setMap() {}
  }

  /** 정확도 원 하나 (M42). 그리지 않고 받아 적기만 한다. */
  class FakeCircle {
    constructor(options: Record<string, unknown> = {}) {
      const center = (options.center ?? { lat: 0, lng: 0 }) as { lat: number; lng: number };
      state.circles.push({
        lat: center.lat,
        lng: center.lng,
        radius: Number(options.radius ?? 0),
      });
    }
    setMap() {}
  }

  interface Canned {
    displayName: string;
    formattedAddress?: string;
    lat: number;
    lng: number;
    rating?: number;
    userRatingCount?: number;
    id?: string;
    types?: string[];
  }

  /** 진짜 구글이 주는 모양으로 — 좌표는 **메서드**다. */
  const toPlace = (place: Canned) => ({
    displayName: place.displayName,
    formattedAddress: place.formattedAddress,
    // 앱이 그 모양까지 받아 내는지가 이 가짜가 지켜야 하는 계약의 일부다.
    location: { lat: () => place.lat, lng: () => place.lng },
    ...(place.rating === undefined ? {} : { rating: place.rating }),
    ...(place.userRatingCount === undefined ? {} : { userRatingCount: place.userRatingCount }),
    ...(place.id === undefined ? {} : { id: place.id }),
    ...(place.types === undefined ? {} : { types: place.types }),
  });

  const places = {
    Place: {
      searchByText: (request: Record<string, unknown>) => {
        const bias = request.locationBias as { center?: { lat: number; lng: number } } | undefined;
        const textQuery = String(request.textQuery ?? '');
        state.searches.push({
          textQuery,
          fields: (request.fields as string[] | undefined) ?? [],
          bias: bias?.center,
        });

        // 질의별 답이 먼저다 (M43) — 열쇠가 질의 안에 들어 있으면 그 목록.
        const byQuery = (scope.__tripBoardFakeGooglePlacesByQuery ?? {}) as Record<
          string,
          Canned[]
        >;
        const hit = Object.keys(byQuery).find((key) => key !== '' && textQuery.includes(key));
        const canned = hit ? byQuery[hit] : ((scope.__tripBoardFakeGooglePlaces ?? []) as Canned[]);

        // `minRating`은 진짜 구글이 서버에서 거른다 — 가짜도 그렇게 한다.
        const minRating = typeof request.minRating === 'number' ? request.minRating : null;
        const filtered =
          minRating === null
            ? canned
            : canned.filter((place) => (place.rating ?? 0) >= minRating);

        return settle({ places: filtered.map(toPlace) });
      },

      /** 화면 근처 검색 (M43) — 받아 적고, 심어 둔 줄들을 돌려준다. */
      searchNearby: (request: Record<string, unknown>) => {
        const restriction = request.locationRestriction as
          | { center?: { lat: number; lng: number }; radius?: number }
          | undefined;
        state.nearby.push({
          center: restriction?.center,
          radius: restriction?.radius,
          includedTypes: (request.includedTypes as string[] | undefined) ?? [],
          fields: (request.fields as string[] | undefined) ?? [],
          maxResultCount: request.maxResultCount as number | undefined,
        });
        const canned = (scope.__tripBoardFakeGoogleNearby ?? []) as Canned[];
        return settle({ places: canned.map(toPlace) });
      },
    },
  };

  const marker = { AdvancedMarkerElement: FakeMarker };

  scope.__tripBoardFakeGoogle = {
    state,
    maps: {
      Map: FakeMap,
      Polyline: FakePolyline,
      Circle: FakeCircle,
      LatLngBounds: FakeBounds,
      SymbolPath: { FORWARD_CLOSED_ARROW: 'arrow' },
      importLibrary: (name: string) =>
        Promise.resolve(name === 'places' ? places : name === 'marker' ? marker : {}),
      marker,
      places,
    },
  };
}
