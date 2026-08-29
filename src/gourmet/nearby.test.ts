import { describe, expect, it } from 'vitest';
import { GOURMET_MIN_RATING } from './filter';
import {
  CITY_CENTER,
  GENRE_PLACE_TYPE,
  genreFromTypes,
  nearbyCacheKey,
  nearbyFallbackQueries,
  nearbyPlan,
} from './nearby';

describe('갈래 → Places (New) 타입', () => {
  it('구글이 이름을 가진 셋만 타입으로 묻는다', () => {
    expect(GENRE_PLACE_TYPE.sushi).toBe('sushi_restaurant');
    expect(GENRE_PLACE_TYPE.ramen).toBe('ramen_restaurant');
    expect(GENRE_PLACE_TYPE.dessert).toBe('dessert_shop');
  });

  it('카츠·오코노미야키는 타입이 없다 — 키워드로 간다', () => {
    expect(GENRE_PLACE_TYPE.katsu).toBeNull();
    expect(GENRE_PLACE_TYPE.okonomiyaki).toBeNull();
  });
});

describe('검색 계획', () => {
  it('타입이 있는 갈래는 한 번에 묶이고, 없는 갈래만 따로 묻는다', () => {
    const plan = nearbyPlan(['sushi', 'ramen', 'katsu', 'okonomiyaki', 'dessert']);
    expect(plan.includedTypes).toEqual(['sushi_restaurant', 'ramen_restaurant', 'dessert_shop']);
    expect(plan.typedGenres).toEqual(['sushi', 'ramen', 'dessert']);
    expect(plan.textQueries.map((query) => query.genre)).toEqual(['katsu', 'okonomiyaki']);
    // 다섯 갈래를 다 켜도 나가는 호출은 셋이다 (nearby 1 + 키워드 2).
    expect(1 + plan.textQueries.length).toBe(3);
  });

  it('키워드는 현지어로, 문턱은 서버 쪽에서', () => {
    const plan = nearbyPlan(['katsu']);
    expect(plan.includedTypes).toEqual([]);
    expect(plan.textQueries[0]).toEqual({
      genre: 'katsu',
      textQuery: 'とんかつ',
      minRating: GOURMET_MIN_RATING,
    });
  });

  it('nearby가 실패하면 그 갈래들을 키워드로 다시 묻는다', () => {
    const plan = nearbyPlan(['sushi', 'dessert']);
    expect(nearbyFallbackQueries(plan).map((query) => query.textQuery)).toEqual([
      '寿司',
      'スイーツ',
    ]);
  });

  it('아무 갈래도 없으면 아무것도 묻지 않는다', () => {
    const plan = nearbyPlan([]);
    expect(plan.includedTypes).toEqual([]);
    expect(plan.textQueries).toEqual([]);
    expect(nearbyFallbackQueries(plan)).toEqual([]);
  });
});

describe('결과의 갈래 되읽기', () => {
  it('물어본 갈래 중 처음 맞는 것', () => {
    expect(genreFromTypes(['restaurant', 'ramen_restaurant', 'food'], ['sushi', 'ramen'])).toBe(
      'ramen',
    );
  });

  it('맞는 것이 없으면 `null`', () => {
    expect(genreFromTypes(['bar', 'restaurant'], ['sushi', 'ramen'])).toBeNull();
    expect(genreFromTypes(undefined, ['sushi'])).toBeNull();
    expect(genreFromTypes([], ['sushi'])).toBeNull();
  });

  it('물어보지 않은 갈래로는 읽지 않는다', () => {
    expect(genreFromTypes(['sushi_restaurant'], ['ramen'])).toBeNull();
  });
});

describe('세션 캐시 이름', () => {
  it('110m 안쪽으로 민 것은 같은 검색이다', () => {
    const a = nearbyCacheKey({ lat: 34.66591, lng: 135.50134 }, ['ramen']);
    const b = nearbyCacheKey({ lat: 34.66609, lng: 135.5014 }, ['ramen']);
    expect(a).toBe(b);
  });

  it('고른 순서는 질문을 바꾸지 않는다', () => {
    expect(nearbyCacheKey({ lat: 1, lng: 2 }, ['ramen', 'sushi'])).toBe(
      nearbyCacheKey({ lat: 1, lng: 2 }, ['sushi', 'ramen']),
    );
  });

  it('갈래가 다르면 다른 검색이다', () => {
    expect(nearbyCacheKey({ lat: 1, lng: 2 }, ['ramen'])).not.toBe(
      nearbyCacheKey({ lat: 1, lng: 2 }, ['sushi']),
    );
  });
});

describe('도시 중심', () => {
  it('오사카와 교토는 서로 다른 자리를 본다', () => {
    expect(CITY_CENTER.osaka.lat).toBeCloseTo(34.70, 1);
    expect(CITY_CENTER.kyoto.lat).toBeCloseTo(34.99, 1);
    expect(CITY_CENTER.osaka.lng).not.toBeCloseTo(CITY_CENTER.kyoto.lng, 1);
  });
});
