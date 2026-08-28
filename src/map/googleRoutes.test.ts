import { beforeEach, describe, expect, it } from 'vitest';
import {
  ROUTES_ENDPOINT,
  ROUTES_FIELD_MASK,
  buildRouteRequest,
  decodePolyline,
  formatRouteDuration,
  parseRouteAnswer,
  parseRouteDuration,
  pathMidpoint,
  resetRouteCacheForTests,
  routeCacheKey,
  routeCacheSize,
  routeDayFingerprint,
  routeLeg,
  routeLegPairs,
  type FakeRoutesRequest,
} from './googleRoutes';
import type { RouteStop } from '../timeline/route';

/** 구글 문서의 그 예제 — 세 점, 소수점 다섯 자리. */
const DOC_POLYLINE = '_p~iF~ps|U_ulLnnqC_mqNvxq`@';

/** 오사카 난바 근처의 짧은 선 하나. */
const OSAKA_POLYLINE = '{tqrEcb`zXwL_IoZg@';

const stop = (cardId: string, lat: number, lng: number, order: number): RouteStop => ({
  cardId,
  lat,
  lng,
  order,
  startMin: 600 + order * 60,
});

/** 이 창의 `window`에 가짜 이음매를 심는다. */
function installFake(
  answer: (request: FakeRoutesRequest) => unknown,
): { calls: FakeRoutesRequest[] } {
  const calls: FakeRoutesRequest[] = [];
  (globalThis as unknown as Record<string, unknown>).__tripBoardFakeRoutes = (
    request: FakeRoutesRequest,
  ) => {
    calls.push(request);
    return answer(request);
  };
  return { calls };
}

function clearFake(): void {
  delete (globalThis as unknown as Record<string, unknown>).__tripBoardFakeRoutes;
}

/** 답 하나 — 그리기에 충분한 최소한. */
const answerWith = (encoded: string, seconds: number, metres = 1200) => ({
  routes: [
    {
      polyline: { encodedPolyline: encoded },
      duration: `${seconds}s`,
      distanceMeters: metres,
    },
  ],
});

describe('decodePolyline', () => {
  it('구글 문서의 예제를 그대로 되돌린다', () => {
    const points = decodePolyline(DOC_POLYLINE);
    expect(points).toHaveLength(3);
    expect(points[0].lat).toBeCloseTo(38.5, 5);
    expect(points[0].lng).toBeCloseTo(-120.2, 5);
    expect(points[1].lat).toBeCloseTo(40.7, 5);
    expect(points[1].lng).toBeCloseTo(-120.95, 5);
    expect(points[2].lat).toBeCloseTo(43.252, 5);
    expect(points[2].lng).toBeCloseTo(-126.453, 5);
  });

  it('짧은 선도 점 순서대로 읽는다', () => {
    const points = decodePolyline(OSAKA_POLYLINE);
    expect(points).toHaveLength(3);
    expect(points[0].lat).toBeCloseTo(34.6659, 5);
    expect(points[0].lng).toBeCloseTo(135.5013, 5);
    expect(points[2].lat).toBeCloseTo(34.6725, 5);
    expect(points[2].lng).toBeCloseTo(135.5031, 5);
  });

  it('빈 문자열과 이상한 값에는 빈 목록으로 답한다', () => {
    expect(decodePolyline('')).toEqual([]);
    expect(decodePolyline(undefined as unknown as string)).toEqual([]);
  });

  it('도중에 끊긴 문자열은 읽은 만큼만 주고 던지지 않는다', () => {
    const whole = decodePolyline(DOC_POLYLINE);
    // 첫 점 한 쌍(10자)만 온전하고 그 뒤가 잘린 문자열.
    const cut = decodePolyline(DOC_POLYLINE.slice(0, 13));
    expect(cut).toHaveLength(1);
    expect(cut.length).toBeLessThan(whole.length);
    expect(cut[0].lat).toBeCloseTo(38.5, 5);
  });
});

describe('buildRouteRequest', () => {
  const from = { lat: 34.6659, lng: 135.5013 };
  const to = { lat: 34.6725, lng: 135.5031 };

  it('Routes v2가 읽는 모양으로 두 자리를 싣는다', () => {
    const body = buildRouteRequest(from, to, 'TRANSIT') as Record<string, never>;
    expect(body).toMatchObject({
      origin: { location: { latLng: { latitude: 34.6659, longitude: 135.5013 } } },
      destination: { location: { latLng: { latitude: 34.6725, longitude: 135.5031 } } },
      travelMode: 'TRANSIT',
      computeAlternativeRoutes: false,
      languageCode: 'ko-KR',
      units: 'METRIC',
    });
  });

  it('routingPreference를 절대 싣지 않는다 — TRANSIT/WALK에서는 400이 된다', () => {
    for (const mode of ['TRANSIT', 'WALK'] as const) {
      expect(buildRouteRequest(from, to, mode)).not.toHaveProperty('routingPreference');
    }
  });

  it('필드마스크와 엔드포인트는 값을 치르는 목록 그대로다', () => {
    expect(ROUTES_ENDPOINT).toBe('https://routes.googleapis.com/directions/v2:computeRoutes');
    expect(ROUTES_FIELD_MASK).toBe(
      'routes.polyline.encodedPolyline,routes.duration,routes.distanceMeters',
    );
  });
});

describe('parseRouteDuration', () => {
  it('초 표기를 숫자로', () => {
    expect(parseRouteDuration('1380s')).toBe(1380);
    expect(parseRouteDuration('90.5s')).toBe(90.5);
    expect(parseRouteDuration(42)).toBe(42);
  });

  it('못 읽는 값은 null', () => {
    expect(parseRouteDuration('1380')).toBeNull();
    expect(parseRouteDuration(undefined)).toBeNull();
    expect(parseRouteDuration({})).toBeNull();
  });
});

describe('parseRouteAnswer', () => {
  it('경로 하나를 디코드해서 돌려준다', () => {
    const result = parseRouteAnswer(answerWith(DOC_POLYLINE, 1380, 4200), 'TRANSIT');
    expect(result).toBeTruthy();
    expect(result!.mode).toBe('TRANSIT');
    expect(result!.path).toHaveLength(3);
    expect(result!.durationSec).toBe(1380);
    expect(result!.distanceMeters).toBe(4200);
  });

  it('길이 없으면 (빈 객체·빈 배열) null — 오류가 아니라 답이다', () => {
    expect(parseRouteAnswer({}, 'TRANSIT')).toBeNull();
    expect(parseRouteAnswer({ routes: [] }, 'TRANSIT')).toBeNull();
    expect(parseRouteAnswer(null, 'TRANSIT')).toBeNull();
    expect(parseRouteAnswer('nope', 'TRANSIT')).toBeNull();
  });

  it('점 하나짜리 선은 그릴 것이 없으므로 null', () => {
    expect(parseRouteAnswer(answerWith('_p~iF~ps|U', 60), 'WALK')).toBeNull();
  });

  it('시간·거리가 빠져 있어도 선만 있으면 그린다', () => {
    const result = parseRouteAnswer(
      { routes: [{ polyline: { encodedPolyline: DOC_POLYLINE } }] },
      'WALK',
    );
    expect(result!.durationSec).toBe(0);
    expect(result!.distanceMeters).toBe(0);
  });
});

describe('routeLegPairs', () => {
  it('이웃한 정거장끼리 다리를 만든다', () => {
    const pairs = routeLegPairs([
      stop('a', 34.66, 135.5, 1),
      stop('b', 34.67, 135.51, 2),
      stop('c', 34.68, 135.52, 3),
    ]);
    expect(pairs).toHaveLength(2);
    expect(pairs[0].fromCardId).toBe('a');
    expect(pairs[0].toCardId).toBe('b');
    expect(pairs[1].from).toEqual({ lat: 34.67, lng: 135.51 });
  });

  it('정거장이 하나뿐이면 다리가 없다', () => {
    expect(routeLegPairs([stop('a', 34.66, 135.5, 1)])).toEqual([]);
    expect(routeLegPairs([])).toEqual([]);
  });

  it('같은 자리에 선 두 정거장은 묻지 않는다', () => {
    const pairs = routeLegPairs([
      stop('a', 34.66, 135.5, 1),
      stop('b', 34.66, 135.5, 2),
      stop('c', 34.68, 135.52, 3),
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].fromCardId).toBe('b');
  });
});

describe('routeDayFingerprint', () => {
  const stops = [stop('a', 34.66, 135.5, 1), stop('b', 34.67, 135.51, 2)];

  it('같은 날 같은 정거장이면 같은 지문', () => {
    expect(routeDayFingerprint('d1', stops)).toBe(routeDayFingerprint('d1', [...stops]));
  });

  it('날이 다르거나 좌표가 움직이면 다른 지문', () => {
    expect(routeDayFingerprint('d2', stops)).not.toBe(routeDayFingerprint('d1', stops));
    const moved = [stops[0], stop('b', 34.675, 135.51, 2)];
    expect(routeDayFingerprint('d1', moved)).not.toBe(routeDayFingerprint('d1', stops));
  });

  it('순서가 뒤집히면 다른 지문 — 방향이 다른 날이다', () => {
    expect(routeDayFingerprint('d1', [stops[1], stops[0]])).not.toBe(
      routeDayFingerprint('d1', stops),
    );
  });
});

describe('pathMidpoint', () => {
  it('두 점이면 정확히 가운데', () => {
    const mid = pathMidpoint([
      { lat: 0, lng: 0 },
      { lat: 0, lng: 2 },
    ]);
    expect(mid!.lng).toBeCloseTo(1, 6);
    expect(mid!.lat).toBeCloseTo(0, 6);
  });

  it('점이 촘촘한 쪽이 아니라 **길이의** 절반을 집는다', () => {
    // 앞쪽에 점 셋이 몰려 있고 뒤에 긴 구간 하나.
    const mid = pathMidpoint([
      { lat: 0, lng: 0 },
      { lat: 0, lng: 0.01 },
      { lat: 0, lng: 0.02 },
      { lat: 0, lng: 4 },
    ]);
    expect(mid!.lng).toBeCloseTo(2, 2);
  });

  it('빈 목록은 null, 한 점은 그 점, 제자리 선은 첫 점', () => {
    expect(pathMidpoint([])).toBeNull();
    expect(pathMidpoint([{ lat: 1, lng: 2 }])).toEqual({ lat: 1, lng: 2 });
    expect(
      pathMidpoint([
        { lat: 1, lng: 2 },
        { lat: 1, lng: 2 },
      ]),
    ).toEqual({ lat: 1, lng: 2 });
  });
});

describe('formatRouteDuration', () => {
  it('분과 시간으로 읽는다', () => {
    expect(formatRouteDuration(1380)).toBe('23분');
    expect(formatRouteDuration(3900)).toBe('1시간 5분');
    expect(formatRouteDuration(3600)).toBe('1시간');
  });

  it('아주 짧은 다리도 0분이라고 말하지 않는다', () => {
    expect(formatRouteDuration(20)).toBe('1분');
  });

  it('값이 없으면 빈 문자열 — 칩 자체가 서지 않는다', () => {
    expect(formatRouteDuration(0)).toBe('');
    expect(formatRouteDuration(Number.NaN)).toBe('');
  });
});

describe('routeLeg', () => {
  const from = { lat: 34.6659, lng: 135.5013 };
  const to = { lat: 34.6725, lng: 135.5031 };

  beforeEach(() => {
    resetRouteCacheForTests();
    clearFake();
  });

  it('대중교통으로 한 번 묻고, 그 요청은 우리가 만든 그대로다', async () => {
    const { calls } = installFake(() => answerWith(DOC_POLYLINE, 1380));
    const result = await routeLeg('key-1', from, to);

    expect(result!.mode).toBe('TRANSIT');
    expect(result!.path).toHaveLength(3);
    expect(calls).toHaveLength(1);
    expect(calls[0].endpoint).toBe(ROUTES_ENDPOINT);
    expect(calls[0].fieldMask).toBe(ROUTES_FIELD_MASK);
    expect(calls[0].apiKey).toBe('key-1');
    expect(calls[0].body).toMatchObject({ travelMode: 'TRANSIT' });
  });

  it('대중교통이 빈 답이면 걷는 길로 한 번 더 묻는다', async () => {
    const { calls } = installFake((request) =>
      request.mode === 'TRANSIT' ? {} : answerWith(DOC_POLYLINE, 600),
    );
    const result = await routeLeg('key-1', from, to);

    expect(result!.mode).toBe('WALK');
    expect(calls.map((call) => call.mode)).toEqual(['TRANSIT', 'WALK']);
  });

  it('둘 다 없으면 null — 그 다리는 직선으로 남는다', async () => {
    const { calls } = installFake(() => ({}));
    expect(await routeLeg('key-1', from, to)).toBeNull();
    expect(calls).toHaveLength(2);
  });

  it('걸을 거리가 아니면(3km 초과 직선) 도보를 묻지도 않는다 — 간사이공항 사건', async () => {
    // 간사이공항 → 난바: 직선 ~38km. 일본은 API에 전철 경로가 없어 TRANSIT이
    // 빈손으로 오는데, 여기서 도보로 넘어가면 「12시간, 고베 경유」가 그려졌다.
    const kix = { lat: 34.4347, lng: 135.2441 };
    const namba = { lat: 34.6659, lng: 135.5013 };
    const { calls } = installFake((request) =>
      request.mode === 'TRANSIT' ? {} : answerWith(DOC_POLYLINE, 44_880),
    );
    expect(await routeLeg('key-1', kix, namba)).toBeNull();
    expect(calls.map((call) => call.mode)).toEqual(['TRANSIT']);
  });

  it('걸을 만한 거리(3km 이내)의 도보 폴백은 그대로 산다', async () => {
    const { calls } = installFake((request) =>
      request.mode === 'TRANSIT' ? {} : answerWith(DOC_POLYLINE, 600),
    );
    const result = await routeLeg('key-1', from, to);
    expect(result!.mode).toBe('WALK');
    expect(calls.map((call) => call.mode)).toEqual(['TRANSIT', 'WALK']);
  });

  it('가짜가 던져도 조용히 null', async () => {
    installFake(() => {
      throw new Error('boom');
    });
    expect(await routeLeg('key-1', from, to)).toBeNull();
  });

  it('같은 다리를 두 번 묻지 않는다 — 세션 캐시', async () => {
    const { calls } = installFake(() => answerWith(DOC_POLYLINE, 1380));
    await routeLeg('key-1', from, to);
    await routeLeg('key-1', from, to);
    await routeLeg('key-1', from, to);
    expect(calls).toHaveLength(1);
    expect(routeCacheSize()).toBe(1);
  });

  it('길이 없었다는 사실도 기억한다', async () => {
    const { calls } = installFake(() => ({}));
    await routeLeg('key-1', from, to);
    await routeLeg('key-1', from, to);
    expect(calls).toHaveLength(2);
  });

  it('방향이 다르면 다른 다리다', async () => {
    const { calls } = installFake(() => answerWith(DOC_POLYLINE, 1380));
    await routeLeg('key-1', from, to);
    await routeLeg('key-1', to, from);
    expect(calls).toHaveLength(2);
  });

  it('키가 없으면 아예 묻지 않는다', async () => {
    const { calls } = installFake(() => answerWith(DOC_POLYLINE, 1380));
    expect(await routeLeg('', from, to)).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('캐시 이름은 (출발·도착·이동수단) 셋으로만 정해진다', () => {
    expect(routeCacheKey(from, to, 'TRANSIT')).toBe(routeCacheKey({ ...from }, { ...to }, 'TRANSIT'));
    expect(routeCacheKey(from, to, 'WALK')).not.toBe(routeCacheKey(from, to, 'TRANSIT'));
  });
});
