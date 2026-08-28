import { expect, test, type Page } from '@playwright/test';
import { installFakeGoogle, type FakeGoogleState } from './fake-google';

/**
 * 실제 경로 + 소요시간, 그리고 「길찾기」 — M42.
 *
 * Routes API는 여기서 절대 부르지 않는다: 키가 필요하고, 돈이 들고, 무엇보다 답이
 * 결정적이지 않다(시간표는 매 순간 바뀐다). 그래서 `src/map/googleRoutes.ts`에
 * 로더와 **같은 철학**의 이음매를 하나 두었다 — 부르기 직전에
 * `window.__tripBoardFakeRoutes`를 보고, 있으면 우리가 만든 요청을 그대로 넘긴다.
 *
 * 덕분에 여기서 확인되는 것은 가짜가 아니라 **진짜 배선**이다: 어떤 엔드포인트에
 * 어떤 필드마스크로 물었는가, 대중교통이 비면 정말 걷는 길로 한 번 더 묻는가,
 * 받은 폴리라인을 정말 디코드해서 그리는가, 그리고 **언제 묻지 않는가**.
 */

test.use({ viewport: { width: 1280, height: 800 } });

const GMAPS_KEY_STORAGE = 'trip-board/gmaps-key';

/** 카드 두 장의 자리 — 오사카 난바와 그 북쪽. */
const CARD_POINT = { lat: 34.6659, lng: 135.5013 };
const OTHER_POINT = { lat: 34.6725, lng: 135.5031 };

/**
 * 구글이 답했다고 치는 경로선 — 위 두 점을 잇는 세 점짜리.
 *
 * 직선이 두 점이므로, 그려진 선의 점이 **셋**이라는 사실 하나가 「직선이 아니라
 * 디코드된 진짜 경로가 그려졌다」를 증명한다.
 */
const ENCODED = '{tqrEcb`zXwL_IoZg@';

/** 1380초 = 23분. 칩에 그대로 적혀야 한다. */
const TRANSIT_ANSWER = {
  routes: [{ polyline: { encodedPolyline: ENCODED }, duration: '1380s', distanceMeters: 3200 }],
};

/** 걷는 길의 답 — 12분. */
const WALK_ANSWER = {
  routes: [{ polyline: { encodedPolyline: ENCODED }, duration: '720s', distanceMeters: 900 }],
};

/** 길이 없다 — Routes는 오류가 아니라 빈 객체로 답한다. */
const NO_ROUTE = {};

/** A transparent 1×1 png — enough for Leaflet to count as a loaded tile. */
const TILE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** 가짜 구글이 받아 적은 호출들. */
const readFake = (page: Page): Promise<FakeGoogleState> =>
  page.evaluate(
    () =>
      (window as unknown as { __tripBoardFakeGoogle: { state: FakeGoogleState } })
        .__tripBoardFakeGoogle.state,
  ) as Promise<FakeGoogleState>;

/** Routes 이음매가 받아 적은 요청들. */
interface RouteCall {
  endpoint: string;
  fieldMask: string;
  apiKey: string;
  mode: string;
  body: Record<string, unknown>;
}

const readRouteCalls = (page: Page): Promise<RouteCall[]> =>
  page.evaluate(
    () => (window as unknown as { __tripBoardRouteCalls: RouteCall[] }).__tripBoardRouteCalls ?? [],
  ) as Promise<RouteCall[]>;

async function stubTiles(page: Page): Promise<void> {
  await page.route(/tile\.openstreetmap\.org/, (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: TILE_PNG }),
  );
  await page.route('**/nominatim.openstreetmap.org/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
}

/** 이동수단마다 이렇게 답한다고 미리 정해 둔다. */
async function seedRoutes(page: Page, answers: { transit: unknown; walk: unknown }): Promise<void> {
  await page.addInitScript((seeded) => {
    const scope = window as unknown as Record<string, unknown>;
    scope.__tripBoardRouteCalls = [];
    scope.__tripBoardFakeRoutes = (request: {
      endpoint: string;
      fieldMask: string;
      apiKey: string;
      mode: string;
      body: Record<string, unknown>;
    }) => {
      (scope.__tripBoardRouteCalls as unknown[]).push({
        endpoint: request.endpoint,
        fieldMask: request.fieldMask,
        apiKey: request.apiKey,
        mode: request.mode,
        body: request.body,
      });
      return request.mode === 'TRANSIT'
        ? (seeded as { transit: unknown }).transit
        : (seeded as { walk: unknown }).walk;
    };
  }, answers);
}

/** 키 + 가짜 구글 + 가짜 Routes + 타일 스텁, 그리고 앱 첫 화면. */
async function openWithGoogle(
  page: Page,
  answers: { transit: unknown; walk: unknown } = { transit: TRANSIT_ANSWER, walk: WALK_ANSWER },
): Promise<void> {
  await stubTiles(page);
  await page.addInitScript((key) => localStorage.setItem(key, 'test-gmaps-key'), GMAPS_KEY_STORAGE);
  await page.addInitScript(installFakeGoogle);
  await seedRoutes(page, answers);
  await page.goto('/');
  await expect(page.getByTestId('tab-bar')).toBeVisible();
}

async function createTrip(page: Page, title: string): Promise<void> {
  await page.getByTestId('add-trip').click();
  await page.getByTestId('trip-title-input').fill(title);
  await page.getByTestId('trip-submit').click();
  await expect(page.getByTestId('trip-form')).toHaveCount(0);
  await page.getByTestId('trip-card').filter({ hasText: title }).getByTestId('trip-open').click();
  await expect(page).toHaveURL(/#\/board$/);
}

/** 좌표를 든 카드 한 장 — M37의 「좌표 붙여넣기」라 네트워크가 필요 없다. */
async function addLocatedCard(
  page: Page,
  columnIndex: number,
  title: string,
  point: { lat: number; lng: number },
): Promise<void> {
  await page.getByTestId('board-column').nth(columnIndex).getByTestId('add-card').click();
  await page.getByTestId('card-title-input').fill(title);
  await page.getByTestId('card-submit').click();
  await expect(page.getByTestId('card-form')).toHaveCount(0);

  await page.getByTestId('board-card').filter({ hasText: title }).click();
  await expect(page.getByTestId('card-form')).toBeVisible();
  await page.getByTestId('card-location-search').click();
  await page.getByTestId('place-search-input').fill(`${point.lat}, ${point.lng}`);
  await page.getByTestId('place-search-coord').click();
  await expect(page.getByTestId('place-search')).toHaveCount(0);
  await page.getByTestId('card-submit').click();
  await expect(page.getByTestId('card-form')).toHaveCount(0);
}

/** 일정 탭에서 시트를 하나 만든다 — 지도 엔진까지 골라서. */
async function createSheet(page: Page, engine: 'osm' | 'google'): Promise<void> {
  await page.getByTestId('tab-timeline').click();
  await expect(page.getByTestId('view-timeline')).toBeVisible();
  await page.getByTestId('sheet-add').click();
  await expect(page.getByTestId('sheet-wizard')).toBeVisible();
  await page.getByTestId('wizard-mode-days').click();
  await page.getByTestId(`wizard-engine-${engine}`).click();
  await page.getByTestId('wizard-submit').click();
  await expect(page.getByTestId('sheet-wizard')).toHaveCount(0);
  await expect(page.getByTestId('timeline-day')).not.toHaveCount(0);
}

/** 보드에서 카드를 시간표에 올린다 — 드래그를 쓰지 않는 배치 경로. */
async function scheduleCard(page: Page, title: string, quarterSteps = 0): Promise<void> {
  await page.getByTestId('tab-board').click();
  await page.getByTestId('board-card').filter({ hasText: title }).click();
  await expect(page.getByTestId('card-form')).toBeVisible();
  await page.getByTestId('card-schedule').click();
  await expect(page.getByTestId('schedule-sheet')).toBeVisible();
  for (let step = 0; step < quarterSteps; step += 1) {
    await page.getByTestId('schedule-start-plus').click();
  }
  await page.getByTestId('schedule-submit').click();
  await expect(page.getByTestId('schedule-sheet')).toHaveCount(0);
}

/** 지도 탭을 열고 「일자별」로 — 실제 경로를 묻는 유일한 화면. */
async function openDayScopedMap(page: Page): Promise<void> {
  await page.getByTestId('tab-map').click();
  await expect(page.getByTestId('view-map')).toBeVisible();
  await page.getByTestId('map-scope-day').click();
  await expect(page.getByTestId('map-scope-day')).toHaveAttribute('data-active', 'true');
}

/** 두 장을 한 날에 놓은 구글 시트 하나. */
async function twoStopGoogleDay(page: Page): Promise<void> {
  await createTrip(page, '오사카 경로');
  await addLocatedCard(page, 2, '이치란', CARD_POINT);
  await addLocatedCard(page, 4, '츠텐카쿠', OTHER_POINT);
  await createSheet(page, 'google');
  await scheduleCard(page, '이치란');
  await scheduleCard(page, '츠텐카쿠', 2);
}

/* ------------------------------------------------------------------ *
 * 1. 진짜 경로가 직선을 대신한다
 * ------------------------------------------------------------------ */

test('일자별로 한 날을 보면 그 날의 다리를 구글에 묻고 진짜 경로를 그린다', async ({ page }) => {
  await openWithGoogle(page);
  await twoStopGoogleDay(page);
  await openDayScopedMap(page);

  const map = page.getByTestId('google-map');
  await expect(map).toHaveAttribute('data-status', 'ready');
  // 다리 하나가 진짜 경로로 바뀔 때까지.
  await expect(map).toHaveAttribute('data-real-legs', '1');

  // 물어본 방식이 계약 그대로다.
  const calls = await readRouteCalls(page);
  expect(calls).toHaveLength(1);
  expect(calls[0].endpoint).toBe('https://routes.googleapis.com/directions/v2:computeRoutes');
  expect(calls[0].fieldMask).toBe(
    'routes.polyline.encodedPolyline,routes.duration,routes.distanceMeters',
  );
  expect(calls[0].apiKey).toBe('test-gmaps-key');
  expect(calls[0].mode).toBe('TRANSIT');
  expect(calls[0].body).toMatchObject({
    travelMode: 'TRANSIT',
    origin: { location: { latLng: { latitude: CARD_POINT.lat, longitude: CARD_POINT.lng } } },
    destination: { location: { latLng: { latitude: OTHER_POINT.lat, longitude: OTHER_POINT.lng } } },
  });

  // 그려진 선은 직선(점 둘)이 아니라 디코드된 경로(점 셋)다.
  const state = await readFake(page);
  const drawn = state.polylines[state.polylines.length - 1];
  expect(drawn.path).toHaveLength(3);
  expect(drawn.path[0].lat).toBeCloseTo(CARD_POINT.lat, 4);
  expect(drawn.path[2].lat).toBeCloseTo(OTHER_POINT.lat, 4);
  // 실선이다 — 점선(투명 선)이 아니다.
  expect(drawn.strokeOpacity).toBe(0.85);
  expect(drawn.arrows).toBe(1);

  // 그리고 다리 가운데에 소요시간 한 칸.
  const chip = page.getByTestId('gmap-route-duration');
  await expect(chip).toHaveCount(1);
  await expect(chip).toHaveText('23분');
  await expect(chip).toHaveAttribute('data-mode', 'TRANSIT');
});

test('대중교통이 없으면 걷는 길로 한 번 더 묻는다', async ({ page }) => {
  await openWithGoogle(page, { transit: NO_ROUTE, walk: WALK_ANSWER });
  await twoStopGoogleDay(page);
  await openDayScopedMap(page);

  await expect(page.getByTestId('google-map')).toHaveAttribute('data-real-legs', '1');

  const calls = await readRouteCalls(page);
  expect(calls.map((call) => call.mode)).toEqual(['TRANSIT', 'WALK']);

  const chip = page.getByTestId('gmap-route-duration');
  await expect(chip).toHaveText('12분');
  await expect(chip).toHaveAttribute('data-mode', 'WALK');
});

test('길이 아예 없으면 직선 점선이 그대로 남고 아무 말도 하지 않는다', async ({ page }) => {
  await openWithGoogle(page, { transit: NO_ROUTE, walk: NO_ROUTE });
  await twoStopGoogleDay(page);
  await openDayScopedMap(page);

  // 두 번 물었고(대중교통·도보), 진짜 경로는 하나도 없다.
  await expect.poll(async () => (await readRouteCalls(page)).length).toBe(2);
  await expect(page.getByTestId('google-map')).toHaveAttribute('data-real-legs', '0');
  await expect(page.getByTestId('gmap-route-duration')).toHaveCount(0);

  // 그 다리는 점선(투명 선 + 반복 눈금) 두 점짜리로 남는다.
  const state = await readFake(page);
  const dashed = state.polylines.filter((line) => line.strokeOpacity === 0);
  expect(dashed.length).toBeGreaterThan(0);
  expect(dashed[dashed.length - 1].path).toHaveLength(2);

  // 오류 안내 같은 것은 없다 — 실패는 조용하다.
  await expect(page.getByTestId('map-google-fallback')).toHaveCount(0);
});

/* ------------------------------------------------------------------ *
 * 2. 언제 묻지 않는가 (돈이 드는 호출이다)
 * ------------------------------------------------------------------ */

test('전체·일정 전체 범위에서는 한 번도 묻지 않는다', async ({ page }) => {
  await openWithGoogle(page);
  await twoStopGoogleDay(page);

  await page.getByTestId('tab-map').click();
  await page.getByTestId('map-scope-sheet').click();
  await expect(page.getByTestId('google-map')).toHaveAttribute('data-status', 'ready');
  await expect(page.getByTestId('gmap-marker')).toHaveCount(2);
  expect(await readRouteCalls(page)).toHaveLength(0);

  // 경로를 「전체」로 켜도 마찬가지 — 여러 날을 한 화면에 보는 동안은 직선이다.
  await page.getByTestId('map-route-all').click();
  await expect(page.getByTestId('google-map')).toHaveAttribute('data-route-count', '1');
  expect(await readRouteCalls(page)).toHaveLength(0);
});

test('OSM 시트에서는 일자별로 봐도 묻지 않는다', async ({ page }) => {
  await openWithGoogle(page);
  await createTrip(page, '오사카 OSM 경로');
  await addLocatedCard(page, 2, '이치란', CARD_POINT);
  await addLocatedCard(page, 4, '츠텐카쿠', OTHER_POINT);
  await createSheet(page, 'osm');
  await scheduleCard(page, '이치란');
  await scheduleCard(page, '츠텐카쿠', 2);
  await openDayScopedMap(page);

  await expect(page.getByTestId('map-marker')).toHaveCount(2);
  await expect(page.getByTestId('google-map')).toHaveCount(0);
  expect(await readRouteCalls(page)).toHaveLength(0);
});

test('같은 날을 다시 보면 다시 묻지 않는다 — 세션 캐시', async ({ page }) => {
  await openWithGoogle(page);
  await twoStopGoogleDay(page);
  await openDayScopedMap(page);
  await expect(page.getByTestId('google-map')).toHaveAttribute('data-real-legs', '1');
  expect(await readRouteCalls(page)).toHaveLength(1);

  // 범위를 옮겼다 돌아오고, 카테고리를 껐다 켠다 — 화면은 여러 번 다시 그려진다.
  await page.getByTestId('map-scope-sheet').click();
  await page.getByTestId('map-scope-day').click();
  await expect(page.getByTestId('google-map')).toHaveAttribute('data-real-legs', '1');
  await page.getByTestId('map-legend-chip').first().click();
  await page.getByTestId('map-legend-all').click();
  await expect(page.getByTestId('gmap-marker')).toHaveCount(2);

  expect(await readRouteCalls(page)).toHaveLength(1);
});

/* ------------------------------------------------------------------ *
 * 3. 「길찾기」 — 세 자리, 같은 규칙
 * ------------------------------------------------------------------ */

test('구글 지도 팝업의 길찾기는 앞 장소를 출발지로 싣는다', async ({ page }) => {
  await openWithGoogle(page);
  await twoStopGoogleDay(page);
  await openDayScopedMap(page);

  // 두 번째 장소 — 그 날 안에서 앞 장소(이치란)가 있다.
  await page.getByTestId('gmap-marker').nth(1).click();
  await expect(page.getByTestId('gmap-popup')).toBeVisible();

  const link = page.getByTestId('gmap-popup-directions');
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(link).toHaveAttribute(
    'href',
    `https://www.google.com/maps/dir/?api=1&origin=${CARD_POINT.lat},${CARD_POINT.lng}` +
      `&destination=${OTHER_POINT.lat},${OTHER_POINT.lng}&travelmode=transit`,
  );

  // 그 날의 첫 장소에는 출발지가 없다 — 구글이 현재 위치에서 찾게 둔다.
  await page.getByTestId('gmap-popup-close').click();
  await page.getByTestId('gmap-marker').first().click();
  await expect(page.getByTestId('gmap-popup-directions')).toHaveAttribute(
    'href',
    `https://www.google.com/maps/dir/?api=1&destination=${CARD_POINT.lat},${CARD_POINT.lng}` +
      '&travelmode=transit',
  );
});

test('OSM 지도 팝업에도 같은 규칙의 길찾기가 있다', async ({ page }) => {
  await openWithGoogle(page);
  await createTrip(page, '오사카 OSM 길찾기');
  await addLocatedCard(page, 2, '이치란', CARD_POINT);
  await addLocatedCard(page, 4, '츠텐카쿠', OTHER_POINT);
  await createSheet(page, 'osm');
  await scheduleCard(page, '이치란');
  await scheduleCard(page, '츠텐카쿠', 2);
  await openDayScopedMap(page);

  await page.getByTestId('map-marker').nth(1).click();
  const popup = page.getByTestId('map-popup');
  await expect(popup).toBeVisible();

  const link = page.getByTestId('map-popup-directions');
  await expect(link).toHaveAttribute(
    'href',
    `https://www.google.com/maps/dir/?api=1&origin=${CARD_POINT.lat},${CARD_POINT.lng}` +
      `&destination=${OTHER_POINT.lat},${OTHER_POINT.lng}&travelmode=transit`,
  );
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
});

test('일정 상세의 길찾기는 그 날 앞 배치를 출발지로 싣는다', async ({ page }) => {
  await openWithGoogle(page);
  await twoStopGoogleDay(page);

  await page.getByTestId('tab-timeline').click();
  await expect(page.getByTestId('timeline-entry')).toHaveCount(2);

  // 두 번째 배치(츠텐카쿠) — 앞에 이치란이 있다.
  await page.getByTestId('timeline-entry').nth(1).click();
  await expect(page.getByTestId('entry-sheet')).toBeVisible();
  await expect(page.getByTestId('entry-directions')).toHaveAttribute(
    'href',
    `https://www.google.com/maps/dir/?api=1&origin=${CARD_POINT.lat},${CARD_POINT.lng}` +
      `&destination=${OTHER_POINT.lat},${OTHER_POINT.lng}&travelmode=transit`,
  );
  await page.getByTestId('sheet-close').click();

  // 첫 배치에는 출발지가 없다.
  await page.getByTestId('timeline-entry').first().click();
  await expect(page.getByTestId('entry-directions')).toHaveAttribute(
    'href',
    `https://www.google.com/maps/dir/?api=1&destination=${CARD_POINT.lat},${CARD_POINT.lng}` +
      '&travelmode=transit',
  );
});

test('위치가 없는 카드의 일정 상세에는 길찾기가 없다', async ({ page }) => {
  await openWithGoogle(page);
  await createTrip(page, '위치 없는 카드');
  await page.getByTestId('board-column').nth(2).getByTestId('add-card').click();
  await page.getByTestId('card-title-input').fill('아직 미정');
  await page.getByTestId('card-submit').click();
  await createSheet(page, 'osm');
  await scheduleCard(page, '아직 미정');

  await page.getByTestId('tab-timeline').click();
  await page.getByTestId('timeline-entry').first().click();
  await expect(page.getByTestId('entry-sheet')).toBeVisible();
  await expect(page.getByTestId('entry-directions')).toHaveCount(0);
});

/* ------------------------------------------------------------------ *
 * 4. 390px
 * ------------------------------------------------------------------ */

test('390px에서도 소요시간 칩이 읽히고 가로 스크롤이 없다', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openWithGoogle(page);
  await twoStopGoogleDay(page);
  await openDayScopedMap(page);

  const chip = page.getByTestId('gmap-route-duration');
  await expect(chip).toHaveText('23분');
  const box = await chip.boundingBox();
  expect(box).toBeTruthy();
  // 11px 활자 + 여백 — 지도 위에서 읽히는 최소한.
  expect(box!.height).toBeGreaterThanOrEqual(14);

  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
});
