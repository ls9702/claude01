import { describe, expect, it, vi } from 'vitest';
import type { PlaceCandidate } from '../ai/aiPlaces';
import type { GeoPoint } from '../types/models';
import { SEARCH_ERROR_MESSAGE } from '../utils/geo';
import {
  MAX_REFINE_QUERIES,
  REFINE_RADIUS_KM,
  haversineKm,
  nearestWithin,
  refineCandidates,
  refineQueries,
} from './refine';

/** 통천각 — AI가 기억으로 찍은 자리. */
const TSUTENKAKU: PlaceCandidate = {
  name: '통천각',
  localName: '通天閣',
  locality: '오사카',
  lat: 34.6525,
  lng: 135.5063,
};

/** 같은 통천각, OSM이 아는 자리 — 30m쯤 옆이다. */
const NEAR: GeoPoint = { lat: 34.6527, lng: 135.5064, address: '通天閣, 나니와구, 오사카' };

/** 도쿄 시부야 — 같은 이름의 다른 곳이라고 치자. */
const FAR: GeoPoint = { lat: 35.6595, lng: 139.7005, address: '시부야 스크램블 교차로' };

describe('haversineKm', () => {
  it('is zero for a point against itself', () => {
    expect(haversineKm(TSUTENKAKU, TSUTENKAKU)).toBe(0);
  });

  it('measures a short hop in metres, not kilometres', () => {
    // 통천각 ↔ 30m 옆.
    expect(haversineKm(TSUTENKAKU, NEAR)).toBeLessThan(0.05);
  });

  it('measures 오사카 ↔ 도쿄 at roughly 400km', () => {
    const km = haversineKm(TSUTENKAKU, FAR);
    expect(km).toBeGreaterThan(390);
    expect(km).toBeLessThan(420);
  });

  it('is symmetric', () => {
    expect(haversineKm(TSUTENKAKU, FAR)).toBeCloseTo(haversineKm(FAR, TSUTENKAKU), 9);
  });

  it('knows one degree of latitude is about 111km, anywhere', () => {
    expect(haversineKm({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(111.2, 1);
    expect(haversineKm({ lat: 60, lng: 30 }, { lat: 61, lng: 30 })).toBeCloseTo(111.2, 1);
  });

  it('shrinks a degree of longitude as it climbs away from the equator', () => {
    const atEquator = haversineKm({ lat: 0, lng: 0 }, { lat: 0, lng: 1 });
    const atSixty = haversineKm({ lat: 60, lng: 0 }, { lat: 60, lng: 1 });
    expect(atSixty).toBeCloseTo(atEquator / 2, 0);
  });
});

describe('nearestWithin', () => {
  it('picks the closest row inside the radius, not the first one', () => {
    const closer: GeoPoint = { lat: 34.6526, lng: 135.5063 };
    expect(nearestWithin(TSUTENKAKU, [NEAR, closer])).toBe(closer);
  });

  it('returns nothing when every row is outside the radius', () => {
    expect(nearestWithin(TSUTENKAKU, [FAR])).toBeNull();
  });

  it('returns nothing for an empty answer', () => {
    expect(nearestWithin(TSUTENKAKU, [])).toBeNull();
  });

  it('honours a caller-supplied radius', () => {
    // 3km 기본값으로는 못 잡는 거리도, 반경을 넓히면 잡힌다.
    const km = haversineKm(TSUTENKAKU, FAR);
    expect(km).toBeGreaterThan(REFINE_RADIUS_KM);
    expect(nearestWithin(TSUTENKAKU, [FAR], 500)).toBe(FAR);
  });

  it('skips rows with unusable coordinates', () => {
    const broken = { lat: Number.NaN, lng: 135.5063 } as GeoPoint;
    expect(nearestWithin(TSUTENKAKU, [broken])).toBeNull();
    expect(nearestWithin(TSUTENKAKU, [broken, NEAR])).toBe(NEAR);
  });
});

describe('refineQueries', () => {
  it('asks in the local script first, then biased by the locality', () => {
    expect(refineQueries(TSUTENKAKU)).toEqual(['通天閣', '通天閣, 오사카']);
  });

  it('falls back from the local name to the display name when there is no locality', () => {
    expect(refineQueries({ name: '통천각', localName: '通天閣', lat: 1, lng: 2 })).toEqual([
      '通天閣',
      '통천각',
    ]);
  });

  it('uses the display name when the row has no local script at all', () => {
    expect(refineQueries({ name: '신세카이 상점가', locality: '오사카', lat: 1, lng: 2 })).toEqual([
      '신세카이 상점가',
      '신세카이 상점가, 오사카',
    ]);
  });

  it('asks exactly once when there is nothing to add', () => {
    expect(refineQueries({ name: '통천각', lat: 1, lng: 2 })).toEqual(['통천각']);
  });

  it('asks nothing for a nameless row', () => {
    expect(refineQueries({ name: '   ', lat: 1, lng: 2 })).toEqual([]);
  });
});

describe('refineCandidates — 반경 안이면 갈아끼운다', () => {
  it('snaps the coordinates to OSM and marks the row', async () => {
    const osmSearch = vi.fn(async () => [NEAR]);
    const [row] = await refineCandidates([TSUTENKAKU], { osmSearch });

    expect(row.lat).toBe(NEAR.lat);
    expect(row.lng).toBe(NEAR.lng);
    expect(row.refined).toBe(true);
    // 이름·지역·주소는 AI 것 그대로 — 사용자가 찾은 말이 줄에 남아야 한다.
    expect(row.name).toBe('통천각');
    expect(row.localName).toBe('通天閣');
    expect(row.locality).toBe('오사카');
  });

  it('asks Nominatim with the local name and stops there when it hits', async () => {
    const osmSearch = vi.fn(async () => [NEAR]);
    await refineCandidates([TSUTENKAKU], { osmSearch });

    expect(osmSearch).toHaveBeenCalledTimes(1);
    expect(osmSearch).toHaveBeenCalledWith('通天閣', undefined);
  });

  it('falls through to the second query when the first misses', async () => {
    const osmSearch = vi.fn(async (query: string) => (query === '通天閣, 오사카' ? [NEAR] : [FAR]));
    const [row] = await refineCandidates([TSUTENKAKU], { osmSearch });

    expect(osmSearch).toHaveBeenNthCalledWith(1, '通天閣', undefined);
    expect(osmSearch).toHaveBeenNthCalledWith(2, '通天閣, 오사카', undefined);
    expect(row.refined).toBe(true);
    expect(row.lat).toBe(NEAR.lat);
  });

  it('falls through from the local name to the display name', async () => {
    const candidate: PlaceCandidate = {
      name: '통천각',
      localName: '通天閣',
      lat: 34.6525,
      lng: 135.5063,
    };
    const osmSearch = vi.fn(async (query: string) => (query === '통천각' ? [NEAR] : []));
    const [row] = await refineCandidates([candidate], { osmSearch });

    expect(osmSearch).toHaveBeenNthCalledWith(1, '通天閣', undefined);
    expect(osmSearch).toHaveBeenNthCalledWith(2, '통천각', undefined);
    expect(row.refined).toBe(true);
    expect(row.lat).toBe(NEAR.lat);
  });
});

describe('refineCandidates — 반경 밖이면 그대로 둔다', () => {
  it('keeps the AI coordinates when every hit is far away', async () => {
    const osmSearch = vi.fn(async () => [FAR]);
    const [row] = await refineCandidates([TSUTENKAKU], { osmSearch });

    expect(row.lat).toBe(TSUTENKAKU.lat);
    expect(row.lng).toBe(TSUTENKAKU.lng);
    expect(row.refined).toBeUndefined();
  });

  it('keeps the AI coordinates when Nominatim knows nothing', async () => {
    const [row] = await refineCandidates([TSUTENKAKU], { osmSearch: async () => [] });
    expect(row).toEqual(TSUTENKAKU);
  });

  it('keeps the AI coordinates, silently, when the refine call fails', async () => {
    const [row] = await refineCandidates([TSUTENKAKU], {
      osmSearch: async () => {
        throw new Error(SEARCH_ERROR_MESSAGE);
      },
    });
    expect(row).toEqual(TSUTENKAKU);
  });

  it('gives up on the rest of the list after one failure', async () => {
    const osmSearch = vi.fn(async () => {
      throw new Error(SEARCH_ERROR_MESSAGE);
    });
    const rows = await refineCandidates([TSUTENKAKU, { ...TSUTENKAKU, name: '신세카이' }], {
      osmSearch,
    });

    expect(rows).toHaveLength(2);
    expect(osmSearch).toHaveBeenCalledTimes(1);
    expect(rows[1].refined).toBeUndefined();
  });
});

describe('refineCandidates — 목록 다루기', () => {
  it('keeps the order and the count', async () => {
    const rows = await refineCandidates([TSUTENKAKU, { ...TSUTENKAKU, name: '신세카이' }], {
      osmSearch: async () => [NEAR],
    });
    expect(rows.map((row) => row.name)).toEqual(['통천각', '신세카이']);
  });

  it('does nothing at all for an empty list', async () => {
    const osmSearch = vi.fn(async () => [NEAR]);
    expect(await refineCandidates([], { osmSearch })).toEqual([]);
    expect(osmSearch).not.toHaveBeenCalled();
  });

  it('asks the same query only once per search', async () => {
    const osmSearch = vi.fn(async () => [FAR]);
    await refineCandidates([TSUTENKAKU, { ...TSUTENKAKU }], { osmSearch });
    // 후보 둘이 같은 두 검색어를 쓰므로, 요청은 네 번이 아니라 두 번이다.
    expect(osmSearch).toHaveBeenCalledTimes(2);
  });

  it('stops asking once the request budget is spent', async () => {
    const osmSearch = vi.fn(async (query: string) => (query.startsWith('a') ? [] : [FAR]));
    const many = Array.from({ length: 5 }, (_, index) => ({
      name: `place-${index}`,
      locality: `city-${index}`,
      lat: 34.65,
      lng: 135.5,
    }));

    const rows = await refineCandidates(many, { osmSearch, maxQueries: 3 });

    expect(rows).toHaveLength(5);
    expect(osmSearch).toHaveBeenCalledTimes(3);
    expect(rows.every((row) => row.refined === undefined)).toBe(true);
  });

  it('never spends more than the default budget', async () => {
    const osmSearch = vi.fn(async () => []);
    const many = Array.from({ length: 5 }, (_, index) => ({
      name: `place-${index}`,
      locality: `city-${index}`,
      lat: 34.65,
      lng: 135.5,
    }));

    await refineCandidates(many, { osmSearch });
    expect(osmSearch.mock.calls.length).toBeLessThanOrEqual(MAX_REFINE_QUERIES);
  });
});

describe('refineCandidates — 취소', () => {
  it('passes the abort signal down to every request', async () => {
    const signal = new AbortController().signal;
    const osmSearch = vi.fn(async () => [NEAR]);
    await refineCandidates([TSUTENKAKU], { osmSearch, signal });
    expect(osmSearch).toHaveBeenCalledWith('通天閣', signal);
  });

  it('lets an abort through instead of swallowing it', async () => {
    await expect(
      refineCandidates([TSUTENKAKU], {
        osmSearch: async () => {
          throw new DOMException('aborted', 'AbortError');
        },
      }),
    ).rejects.toThrow(DOMException);
  });
});
