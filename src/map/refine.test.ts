import { describe, expect, it, vi } from 'vitest';
import { AiError } from '../ai/aiClient';
import type { PlaceCandidate } from '../ai/aiPlaces';
import type { GeoPoint } from '../types/models';
import { SEARCH_ERROR_MESSAGE } from '../utils/geo';
import {
  ADDRESS_FALLBACK_CANDIDATES,
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

/* ------------------------------------------------------------------ *
 * 주소 경유 스냅 (M37)
 * ------------------------------------------------------------------ */

describe('refineCandidates — 이름으로 못 찾으면 주소로 (M37)', () => {
  /** OSM의 POI 색인에 없는 작은 체인점 — 이 계단이 존재하는 이유. */
  const IPPUDO: PlaceCandidate = {
    name: '잇푸도 난바점',
    localName: '一風堂 なんば店',
    locality: '오사카',
    lat: 34.6659,
    lng: 135.5013,
  };

  /** 그 가게가 든 건물 — 이름으로는 못 찾아도 번지로는 찾힌다. 300m쯤 옆. */
  const BUILDING: GeoPoint = {
    lat: 34.6632,
    lng: 135.5009,
    address: '大阪府大阪市中央区難波1-4-16',
  };

  const ADDRESS = '大阪府大阪市中央区難波1-4-16';

  /** 이름은 모르고 주소만 아는 Nominatim. */
  const osmKnowsOnlyTheAddress = () =>
    vi.fn(async (query: string) => (query === ADDRESS ? [BUILDING] : []));

  it('asks for an address only after every name query has missed', async () => {
    const osmSearch = osmKnowsOnlyTheAddress();
    const askAddress = vi.fn(async () => ADDRESS);

    const [row] = await refineCandidates([IPPUDO], { osmSearch, askAddress });

    expect(osmSearch).toHaveBeenNthCalledWith(1, '一風堂 なんば店', undefined);
    expect(osmSearch).toHaveBeenNthCalledWith(2, '一風堂 なんば店, 오사카', undefined);
    // 그다음에야 주소를 물었고, 그 주소로 한 번 더 물었다.
    expect(askAddress).toHaveBeenCalledTimes(1);
    expect(askAddress).toHaveBeenCalledWith(IPPUDO);
    expect(osmSearch).toHaveBeenNthCalledWith(3, ADDRESS, undefined);
    expect(row.lat).toBe(BUILDING.lat);
    expect(row.lng).toBe(BUILDING.lng);
    expect(row.refined).toBe(true);
    expect(row.refinedBy).toBe('address');
    // 바뀐 것은 좌표 두 칸뿐 — 줄에 보이는 이름도 주소도 그대로다.
    expect(row.name).toBe('잇푸도 난바점');
    expect(row.localName).toBe('一風堂 なんば店');
  });

  it('never asks when the name already hit', async () => {
    const askAddress = vi.fn(async () => ADDRESS);
    const [row] = await refineCandidates([TSUTENKAKU], {
      osmSearch: async () => [NEAR],
      askAddress,
    });

    expect(askAddress).not.toHaveBeenCalled();
    expect(row.refinedBy).toBe('name');
  });

  it('keeps the AI coordinates when the address lands in another city', async () => {
    const osmSearch = vi.fn(async (query: string) => (query === ADDRESS ? [FAR] : []));
    const [row] = await refineCandidates([IPPUDO], { osmSearch, askAddress: async () => ADDRESS });

    // 같은 3km 반경이 여기서도 마지막 벽이다 — 주소를 잘못 짚어도 도쿄로 가지 않는다.
    expect(row.lat).toBe(IPPUDO.lat);
    expect(row.lng).toBe(IPPUDO.lng);
    expect(row.refined).toBeUndefined();
  });

  it('keeps the AI coordinates when the address geocodes to nothing', async () => {
    const [row] = await refineCandidates([IPPUDO], {
      osmSearch: async () => [],
      askAddress: async () => ADDRESS,
    });
    expect(row).toEqual(IPPUDO);
  });

  it('keeps the AI coordinates, silently, when the grounded ask fails', async () => {
    const osmSearch = osmKnowsOnlyTheAddress();
    const [row] = await refineCandidates([IPPUDO], {
      osmSearch,
      askAddress: async () => {
        throw new AiError('rate');
      },
    });

    expect(row).toEqual(IPPUDO);
    // 물어보지 못한 주소를 지오코딩하지도 않았다.
    expect(osmSearch).toHaveBeenCalledTimes(2);
  });

  it('keeps the AI coordinates when the model has no address to give', async () => {
    const askAddress = vi.fn(async () => null);
    const [row] = await refineCandidates([IPPUDO], {
      osmSearch: osmKnowsOnlyTheAddress(),
      askAddress,
    });
    expect(row).toEqual(IPPUDO);
    expect(askAddress).toHaveBeenCalledTimes(1);
  });

  it('gives up on the rest of the list after one grounded failure', async () => {
    const askAddress = vi.fn(async () => {
      throw new AiError('rate');
    });
    const rows = await refineCandidates([IPPUDO, { ...IPPUDO, name: '잇푸도 우메다점' }], {
      osmSearch: async () => [],
      askAddress,
      maxQueries: 20,
    });

    expect(rows).toHaveLength(2);
    // 429는 다음 후보에게도 429다. 8초를 한 번 더 기다릴 이유가 없다.
    expect(askAddress).toHaveBeenCalledTimes(1);
  });

  it('lets an abort through instead of swallowing it', async () => {
    await expect(
      refineCandidates([IPPUDO], {
        osmSearch: async () => [],
        askAddress: async () => {
          throw new DOMException('aborted', 'AbortError');
        },
      }),
    ).rejects.toThrow(DOMException);
  });

  it('does not start a slow grounded call after the search was cancelled', async () => {
    const controller = new AbortController();
    const askAddress = vi.fn(async () => ADDRESS);
    const osmSearch = vi.fn(async () => {
      controller.abort();
      return [];
    });

    await refineCandidates([IPPUDO], { osmSearch, askAddress, signal: controller.signal });
    expect(askAddress).not.toHaveBeenCalled();
  });
});

describe('refineCandidates — 주소 계단의 예산 (M37)', () => {
  const missing = (index: number): PlaceCandidate => ({
    name: `가게 ${index}`,
    locality: '오사카',
    lat: 34.6659,
    lng: 135.5013,
  });

  it(`climbs it for the first ${ADDRESS_FALLBACK_CANDIDATES} candidates only`, async () => {
    const askAddress = vi.fn(async (_candidate: PlaceCandidate): Promise<string | null> => null);
    await refineCandidates(
      Array.from({ length: 5 }, (_, index) => missing(index)),
      { osmSearch: async () => [], askAddress, maxQueries: 100 },
    );

    expect(askAddress).toHaveBeenCalledTimes(ADDRESS_FALLBACK_CANDIDATES);
    expect(askAddress.mock.calls.map(([row]) => row.name)).toEqual([
      '가게 0',
      '가게 1',
    ]);
  });

  it('honours a caller-supplied candidate cap — the audit uses one per card', async () => {
    const askAddress = vi.fn(async () => null);
    await refineCandidates([missing(0), missing(1)], {
      osmSearch: async () => [],
      askAddress,
      maxQueries: 100,
      maxAddressCandidates: 1,
    });
    expect(askAddress).toHaveBeenCalledTimes(1);
  });

  it('does not make the slow call when there is no request left to geocode it', async () => {
    const askAddress = vi.fn(async () => '大阪市中央区難波1-4-16');
    const osmSearch = vi.fn(async () => []);

    // 이름 질의 둘로 예산이 끝난다 — 주소를 받아도 넣을 곳이 없다.
    await refineCandidates([missing(0)], { osmSearch, askAddress, maxQueries: 2 });

    expect(osmSearch).toHaveBeenCalledTimes(2);
    expect(askAddress).not.toHaveBeenCalled();
  });

  it('spends the default budget on the two names and the address', async () => {
    const osmSearch = vi.fn(async () => []);
    const askAddress = vi.fn(async () => '大阪市中央区難波1-4-16');

    await refineCandidates([missing(0), missing(1), missing(2)], { osmSearch, askAddress });

    // 후보 하나에 이름 2 + 주소 1 = 3건. 기본 예산 6은 딱 두 후보까지다.
    expect(osmSearch).toHaveBeenCalledTimes(MAX_REFINE_QUERIES);
    expect(askAddress).toHaveBeenCalledTimes(2);
  });

  it('stays out of the way entirely when no ask is wired up (M35 그대로)', async () => {
    const osmSearch = vi.fn(async () => []);
    const rows = await refineCandidates([missing(0)], { osmSearch });
    expect(rows[0].refined).toBeUndefined();
    expect(osmSearch).toHaveBeenCalledTimes(2);
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
