import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  GOOGLE_MAP_ID,
  googleMarkerLibrary,
  googlePlacesLibrary,
  latLngValue,
  loadGoogleMaps,
  resetGoogleLoaderForTests,
  type GoogleMapsApi,
} from './googleLoader';

/** 우리가 만지는 표면만 든 최소한의 가짜 — e2e의 그것과 같은 계약. */
function fakeMaps(extra: Partial<GoogleMapsApi> = {}): GoogleMapsApi {
  return {
    Map: class {
      fitBounds() {}
      setCenter() {}
      setZoom() {}
    } as unknown as GoogleMapsApi['Map'],
    Polyline: class {
      setMap() {}
    } as unknown as GoogleMapsApi['Polyline'],
    LatLngBounds: class {
      extend() {
        return this;
      }
    } as unknown as GoogleMapsApi['LatLngBounds'],
    ...extra,
  };
}

beforeEach(() => {
  resetGoogleLoaderForTests();
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  resetGoogleLoaderForTests();
});

describe('latLngValue', () => {
  it('구글의 두 가지 좌표 모양을 다 읽는다', () => {
    expect(latLngValue(35.6)).toBe(35.6);
    expect(latLngValue(() => 35.6)).toBe(35.6);
    expect(Number.isNaN(latLngValue(undefined))).toBe(true);
  });
});

describe('loadGoogleMaps', () => {
  it('창에 가짜가 심겨 있으면 그것을 쓴다 — e2e가 서는 이음매', async () => {
    const maps = fakeMaps();
    (globalThis as { window?: unknown }).window = { __tripBoardFakeGoogle: { maps } };
    await expect(loadGoogleMaps('any-key')).resolves.toBe(maps);
  });

  it('가짜가 있으면 키가 비어 있어도 상관없다 — 스크립트를 부르지 않으니까', async () => {
    const maps = fakeMaps();
    (globalThis as { window?: unknown }).window = { __tripBoardFakeGoogle: { maps } };
    await expect(loadGoogleMaps('')).resolves.toBe(maps);
  });

  it('키가 없으면 거절한다 — 화면은 OSM으로 돌아간다', async () => {
    await expect(loadGoogleMaps('   ')).rejects.toThrow();
  });

  it('document가 없는 곳(서버·테스트)에서는 조용히 거절한다', async () => {
    await expect(loadGoogleMaps('some-key')).rejects.toThrow();
  });
});

describe('라이브러리 집기', () => {
  it('importLibrary가 있으면 그걸 쓴다', async () => {
    const marker = { AdvancedMarkerElement: class {} };
    const places = { Place: { searchByText: () => Promise.resolve({ places: [] }) } };
    const maps = fakeMaps({
      importLibrary: (name: string) =>
        Promise.resolve(name === 'marker' ? marker : name === 'places' ? places : {}),
    });
    expect(await googleMarkerLibrary(maps)).toBe(marker);
    expect(await googlePlacesLibrary(maps)).toBe(places);
  });

  it('importLibrary가 없으면 네임스페이스에서 집는다', async () => {
    const marker = { AdvancedMarkerElement: class {} } as never;
    const places = { Place: { searchByText: () => Promise.resolve({ places: [] }) } };
    const maps = fakeMaps({ marker, places });
    expect(await googleMarkerLibrary(maps)).toBe(marker);
    expect(await googlePlacesLibrary(maps)).toBe(places);
  });

  it('둘 다 없으면 실패한다', async () => {
    const maps = fakeMaps();
    await expect(googleMarkerLibrary(maps)).rejects.toThrow();
    await expect(googlePlacesLibrary(maps)).rejects.toThrow();
  });
});

describe('GOOGLE_MAP_ID', () => {
  it('AdvancedMarker가 붙을 수 있는 map id를 들고 있다', () => {
    // 이 상수가 빈 문자열이 되면 핀이 통째로 사라진다 — 조용히.
    expect(GOOGLE_MAP_ID.length).toBeGreaterThan(0);
  });
});
