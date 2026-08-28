import { describe, expect, it } from 'vitest';
import { PLACE_BIAS_RADIUS_M, searchPlaceByText, toSuggestion } from './googlePlaces';
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
