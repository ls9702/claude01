import { describe, expect, it } from 'vitest';
import {
  GOURMET_FIELDS,
  PLACE_BIAS_RADIUS_M,
  PLACE_SEARCH_MAX_RESULTS,
  searchPlaceSuggestions,
  searchGourmetPlace,
  searchGourmetPlaces,
  searchNearbyGourmet,
  searchPlaceByText,
  toGourmetPlace,
  toSuggestion,
} from './googlePlaces';
import type { GoogleMapsApi } from './googleLoader';

/** 구글이 답하는 모양 — 좌표는 **메서드**로 온다. */
const rawPlace = (lat: number, lng: number, extra: Record<string, unknown> = {}) => ({
  displayName: '이치란 난바점',
  formattedAddress: '일본 오사카부 오사카시',
  location: { lat: () => lat, lng: () => lng },
  ...extra,
});

/** `searchByText` 하나만 든 최소한의 가짜 + 받아 적은 요청. */
function fakeMaps(answer: unknown, log: Record<string, unknown>[] = []) {
  return {
    maps: {
      importLibrary: (name: string) =>
        Promise.resolve(
          name === 'places'
            ? {
                Place: {
                  searchByText: (request: Record<string, unknown>) => {
                    log.push(request);
                    return Promise.resolve(answer);
                  },
                },
              }
            : {},
        ),
    } as unknown as GoogleMapsApi,
    log,
  };
}

describe('toSuggestion', () => {
  it('구글의 한 줄을 제안 하나로 옮긴다', () => {
    expect(toSuggestion(rawPlace(34.6659, 135.5013))).toEqual({
      name: '이치란 난바점',
      lat: 34.6659,
      lng: 135.5013,
      address: '일본 오사카부 오사카시',
    });
  });

  it('좌표가 값으로 와도 읽는다', () => {
    const place = { displayName: 'x', location: { lat: 1, lng: 2 } };
    expect(toSuggestion(place)).toMatchObject({ lat: 1, lng: 2 });
  });

  it('좌표가 없거나 망가졌으면 제안이 아니다', () => {
    expect(toSuggestion(undefined)).toBeNull();
    expect(toSuggestion({ displayName: 'x' })).toBeNull();
    expect(toSuggestion({ displayName: 'x', location: { lat: () => Number.NaN, lng: () => 1 } })).toBeNull();
  });

  it('빈 주소는 키째로 없앤다', () => {
    const suggestion = toSuggestion(rawPlace(1, 2, { formattedAddress: '   ' }));
    expect(suggestion && 'address' in suggestion).toBe(false);
  });
});

describe('searchPlaceByText', () => {
  it('제목·필드·편향을 실어 한 번 묻고 첫 결과를 돌려준다', async () => {
    const { maps, log } = fakeMaps({ places: [rawPlace(34.6659, 135.5013)] });
    const found = await searchPlaceByText(maps, '  이치란  ', { lat: 34.69, lng: 135.5 });

    expect(found).toMatchObject({ lat: 34.6659, lng: 135.5013 });
    expect(log).toHaveLength(1);
    expect(log[0].textQuery).toBe('이치란');
    expect(log[0].fields).toEqual(['displayName', 'location', 'formattedAddress']);
    expect(log[0].maxResultCount).toBe(1);
    expect(log[0].locationBias).toEqual({
      center: { lat: 34.69, lng: 135.5 },
      radius: PLACE_BIAS_RADIUS_M,
    });
  });

  it('편향점이 없으면 편향 없이 묻는다', async () => {
    const { maps, log } = fakeMaps({ places: [rawPlace(1, 2)] });
    await searchPlaceByText(maps, '이치란');
    expect('locationBias' in log[0]).toBe(false);
  });

  it('빈 질의는 묻지도 않는다', async () => {
    const { maps, log } = fakeMaps({ places: [rawPlace(1, 2)] });
    expect(await searchPlaceByText(maps, '   ')).toBeNull();
    expect(log).toHaveLength(0);
  });

  it('빈 결과·예외는 전부 조용한 null이다', async () => {
    const empty = fakeMaps({ places: [] });
    expect(await searchPlaceByText(empty.maps, '이치란')).toBeNull();

    const broken = {
      importLibrary: () => Promise.reject(new Error('places unavailable')),
    } as unknown as GoogleMapsApi;
    expect(await searchPlaceByText(broken, '이치란')).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * 「주변 맛집」이 쓰는 두 갈래 (M43)
 * ------------------------------------------------------------------ */

/** `searchByText` + `searchNearby` 둘을 든 가짜. */
function fakeGourmetMaps(options: {
  text?: unknown;
  nearby?: unknown;
  nearbyError?: Error;
  noNearby?: boolean;
}) {
  const log: { kind: 'text' | 'nearby'; request: Record<string, unknown> }[] = [];
  const Place: Record<string, unknown> = {
    searchByText: (request: Record<string, unknown>) => {
      log.push({ kind: 'text', request });
      return Promise.resolve(options.text ?? { places: [] });
    },
  };
  if (!options.noNearby) {
    Place.searchNearby = (request: Record<string, unknown>) => {
      log.push({ kind: 'nearby', request });
      if (options.nearbyError) return Promise.reject(options.nearbyError);
      return Promise.resolve(options.nearby ?? { places: [] });
    };
  }
  return {
    maps: {
      importLibrary: (name: string) => Promise.resolve(name === 'places' ? { Place } : {}),
    } as unknown as GoogleMapsApi,
    log,
  };
}

describe('toGourmetPlace', () => {
  it('평점·평점수·장소 id·타입까지 읽는다', () => {
    expect(
      toGourmetPlace(
        rawPlace(34.6659, 135.5013, {
          rating: 4.42,
          userRatingCount: 5200,
          id: 'p1',
          types: ['ramen_restaurant', 'restaurant'],
        }),
      ),
    ).toEqual({
      name: '이치란 난바점',
      lat: 34.6659,
      lng: 135.5013,
      address: '일본 오사카부 오사카시',
      rating: 4.42,
      ratingCount: 5200,
      placeId: 'p1',
      types: ['ramen_restaurant', 'restaurant'],
    });
  });

  it('예약 여부는 `reservable`로도 `isReservable`로도 온다', () => {
    expect(toGourmetPlace(rawPlace(1, 2, { reservable: true }))?.reservable).toBe(true);
    expect(toGourmetPlace(rawPlace(1, 2, { isReservable: false }))?.reservable).toBe(false);
    expect('reservable' in (toGourmetPlace(rawPlace(1, 2)) ?? {})).toBe(false);
  });

  it('좌표가 없으면 한 줄이 아니다', () => {
    expect(toGourmetPlace(undefined)).toBeNull();
    expect(toGourmetPlace({ displayName: 'x' })).toBeNull();
  });
});

describe('searchGourmetPlace', () => {
  it('맛집용 필드 셋으로 묻는다 — 값을 치르는 목록은 여기 하나뿐', () => {
    expect(GOURMET_FIELDS).toEqual([
      'displayName',
      'location',
      'formattedAddress',
      'rating',
      'userRatingCount',
      'id',
      'types',
    ]);
    // `reservable`은 더 비싼 등급이라 일부러 없다 — 조사값이 그 자리를 채운다.
    expect(GOURMET_FIELDS).not.toContain('reservable');
  });

  it('첫 결과 하나를 돌려주고 M41의 검색은 건드리지 않는다', async () => {
    const { maps, log } = fakeGourmetMaps({
      text: { places: [rawPlace(34.6659, 135.5013, { rating: 4.4, id: 'p1' })] },
    });
    const found = await searchGourmetPlace(maps, '一蘭 道頓堀店 도톤보리', { lat: 34.7, lng: 135.5 });
    expect(found).toMatchObject({ rating: 4.4, placeId: 'p1' });
    expect(log[0].request.fields).toEqual(GOURMET_FIELDS);
    expect(log[0].request.maxResultCount).toBe(1);
    expect(log[0].request.locationBias).toEqual({
      center: { lat: 34.7, lng: 135.5 },
      radius: PLACE_BIAS_RADIUS_M,
    });
  });

  it('minRating은 준 때만 실린다', async () => {
    const { maps, log } = fakeGourmetMaps({ text: { places: [] } });
    await searchGourmetPlaces(maps, 'とんかつ', undefined, { minRating: 4.3 });
    expect(log[0].request.minRating).toBe(4.3);

    await searchGourmetPlaces(maps, 'とんかつ');
    expect('minRating' in (log[1].request as object)).toBe(false);
  });

  it('빈 질의는 묻지 않고, 오류는 빈 목록이다', async () => {
    const { maps, log } = fakeGourmetMaps({ text: { places: [] } });
    expect(await searchGourmetPlaces(maps, '  ')).toEqual([]);
    expect(log).toHaveLength(0);

    const broken = {
      importLibrary: () => Promise.reject(new Error('places unavailable')),
    } as unknown as GoogleMapsApi;
    expect(await searchGourmetPlaces(broken, 'x')).toEqual([]);
    expect(await searchGourmetPlace(broken, 'x')).toBeNull();
  });
});

describe('searchNearbyGourmet', () => {
  it('중심·반경·타입을 실어 한 번 묻는다', async () => {
    const { maps, log } = fakeGourmetMaps({
      nearby: { places: [rawPlace(1, 2, { rating: 4.6, id: 'n1' })] },
    });
    const found = await searchNearbyGourmet(
      maps,
      { lat: 34.6659, lng: 135.5013 },
      ['ramen_restaurant', 'sushi_restaurant'],
      { radius: 1500, maxResultCount: 20 },
    );

    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ rating: 4.6, placeId: 'n1' });
    expect(log[0].kind).toBe('nearby');
    expect(log[0].request.includedTypes).toEqual(['ramen_restaurant', 'sushi_restaurant']);
    expect(log[0].request.locationRestriction).toEqual({
      center: { lat: 34.6659, lng: 135.5013 },
      radius: 1500,
    });
    expect(log[0].request.maxResultCount).toBe(20);
    // 순서는 우리가 평점으로 다시 정한다 — 구글에 순위를 사지 않는다.
    expect('rankPreference' in (log[0].request as object)).toBe(false);
  });

  it('타입이 없으면 묻지 않는다', async () => {
    const { maps, log } = fakeGourmetMaps({});
    expect(await searchNearbyGourmet(maps, { lat: 1, lng: 2 }, [], { radius: 1, maxResultCount: 1 })).toEqual([]);
    expect(log).toHaveLength(0);
  });

  it('실패는 던진다 — 호출부가 키워드 검색으로 내려갈 수 있어야 한다', async () => {
    const missing = fakeGourmetMaps({ noNearby: true });
    await expect(
      searchNearbyGourmet(missing.maps, { lat: 1, lng: 2 }, ['ramen_restaurant'], {
        radius: 1,
        maxResultCount: 1,
      }),
    ).rejects.toThrow();

    const rejected = fakeGourmetMaps({ nearbyError: new Error('INVALID_ARGUMENT') });
    await expect(
      searchNearbyGourmet(rejected.maps, { lat: 1, lng: 2 }, ['nope_restaurant'], {
        radius: 1,
        maxResultCount: 1,
      }),
    ).rejects.toThrow('INVALID_ARGUMENT');
  });
});

describe('searchPlaceSuggestions — 카드 검색의 여러 후보 (M44)', () => {
  it('다섯 줄까지 받아 오고, 좌표가 없는 줄은 버린다', async () => {
    const { maps, log } = fakeMaps({
      places: [
        rawPlace(34.6659, 135.5013),
        { displayName: '좌표 없음' },
        rawPlace(34.6701, 135.5011, { displayName: '이치란 도톤보리점' }),
      ],
    });

    const found = await searchPlaceSuggestions(maps, '이치란 난바', {
      lat: 34.6,
      lng: 135.5,
    });

    expect(found).toHaveLength(2);
    expect(found[0]).toEqual({
      name: '이치란 난바점',
      lat: 34.6659,
      lng: 135.5013,
      address: '일본 오사카부 오사카시',
    });
    expect(found[1].name).toBe('이치란 도톤보리점');

    // M41의 세 필드 그대로 — 검색창은 평점을 그리지 않는다.
    expect(log[0].fields).toEqual(['displayName', 'location', 'formattedAddress']);
    expect(log[0].maxResultCount).toBe(PLACE_SEARCH_MAX_RESULTS);
    expect(log[0].language).toBe('ko');
    expect(log[0].locationBias).toEqual({
      center: { lat: 34.6, lng: 135.5 },
      radius: PLACE_BIAS_RADIUS_M,
    });
  });

  it('목적지가 없으면 기울이지 않는다', async () => {
    const { maps, log } = fakeMaps({ places: [rawPlace(1, 2)] });
    await searchPlaceSuggestions(maps, '난바');
    expect(log[0].locationBias).toBeUndefined();
  });

  it('빈 질의는 아무것도 묻지 않는다', async () => {
    const { maps, log } = fakeMaps({ places: [rawPlace(1, 2)] });
    expect(await searchPlaceSuggestions(maps, '   ')).toEqual([]);
    expect(log).toHaveLength(0);
  });

  it('실패는 삼키지 않고 **던진다** — 부르는 쪽이 「못 찾음」과 구별해야 한다', async () => {
    const maps = {
      importLibrary: () => Promise.reject(new Error('blocked')),
    } as unknown as GoogleMapsApi;
    await expect(searchPlaceSuggestions(maps, '난바')).rejects.toThrow();
  });
});
