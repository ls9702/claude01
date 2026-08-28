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
}

/** 스펙이 심는 canned 결과 한 줄. */
export interface FakePlace {
  displayName: string;
  formattedAddress?: string;
  lat: number;
  lng: number;
}

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
  };

  /** 스펙이 미리 심어 두는 검색 결과. 없으면 「못 찾음」. */
  if (!scope.__tripBoardFakeGooglePlaces) scope.__tripBoardFakeGooglePlaces = [];

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
    constructor(element: HTMLElement, options: Record<string, unknown> = {}) {
      this.element = element;
      this.options = options;
      element.setAttribute('data-fake-google-map', 'true');
      state.maps.push({ options });
    }
    fitBounds(bounds: FakeBounds) {
      state.fits.push({ points: bounds.points.slice() });
    }
    setCenter() {}
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

  const places = {
    Place: {
      searchByText: (request: Record<string, unknown>) => {
        const bias = request.locationBias as { center?: { lat: number; lng: number } } | undefined;
        state.searches.push({
          textQuery: String(request.textQuery ?? ''),
          fields: (request.fields as string[] | undefined) ?? [],
          bias: bias?.center,
        });
        const canned = (scope.__tripBoardFakeGooglePlaces ?? []) as {
          displayName: string;
          formattedAddress?: string;
          lat: number;
          lng: number;
        }[];
        return Promise.resolve({
          places: canned.map((place) => ({
            displayName: place.displayName,
            formattedAddress: place.formattedAddress,
            // 진짜 구글은 좌표를 **메서드**로 준다 — 앱이 그 모양까지 받아
            // 내는지가 이 가짜가 지켜야 하는 계약의 일부다.
            location: { lat: () => place.lat, lng: () => place.lng },
          })),
        });
      },
    },
  };

  const marker = { AdvancedMarkerElement: FakeMarker };

  scope.__tripBoardFakeGoogle = {
    state,
    maps: {
      Map: FakeMap,
      Polyline: FakePolyline,
      LatLngBounds: FakeBounds,
      SymbolPath: { FORWARD_CLOSED_ARROW: 'arrow' },
      importLibrary: (name: string) =>
        Promise.resolve(name === 'places' ? places : name === 'marker' ? marker : {}),
      marker,
      places,
    },
  };
}
