import { expect, test, type Page } from '@playwright/test';
import { installFakeGoogle, type FakeGoogleState, type FakePlace } from './fake-google';

/**
 * 시트별 구글 지도 + 배치 위치 보정 — M41.
 *
 * 진짜 구글 자바스크립트는 여기서 절대 뜨지 않는다. `src/map/googleLoader.ts`의
 * 이음매(`window.__tripBoardFakeGoogle`)에 가짜를 심고, 그 가짜가 **받아 적은
 * 호출**로 앱의 배선을 확인한다 — 자세한 이유는 `e2e/fake-google.ts`.
 *
 * 이 스펙이 못박는 것:
 *
 * 1. 키가 있는 기기에서만 시트 마법사·복제가 지도를 묻는다.
 * 2. 구글 시트를 「일정 전체」로 보면 구글 지도가 서고, 핀·동선·필터가 OSM 지도와
 *    같은 계산에서 나온다.
 * 3. 키가 없거나 구글을 못 불러오면 **조용히 OSM으로** 돌아간다 — 안내 한 줄과
 *    함께. (그리고 기존 지도 스펙 전부가 손대지 않은 채로 계속 통과한다.)
 * 4. 구글 시트에 카드를 놓으면 위치를 한 번 되묻고, 「보정」은 카드를 옮기고
 *    「그대로 두기」는 아무것도 하지 않는다. 결과가 없으면 묻지도 않는다.
 * 5. 390px에서 그 팝업이 스크롤 없이 들어간다.
 */

test.use({ viewport: { width: 1280, height: 800 } });

const GMAPS_KEY_STORAGE = 'trip-board/gmaps-key';
/** 이 스펙만 쓰는 표시 — 「이 기기는 키를 회수당했다」. */
const REVOKED_MARKER = 'e2e/gmaps-revoked';

/** 카드가 이미 들고 있는 좌표 — 오사카 난바. */
const CARD_POINT = { lat: 34.6659, lng: 135.5013 };
/** 두 번째 카드의 좌표 — 같은 동네의 다른 자리(동선이 그려지도록). */
const OTHER_POINT = { lat: 34.6725, lng: 135.5031 };
/** 구글이 제안하는 자리 — 위로 250m. */
const GOOGLE_POINT = { lat: 34.66815, lng: 135.5013 };

/** A transparent 1×1 png — enough for Leaflet to count as a loaded tile. */
const TILE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** 가짜가 받아 적은 호출들. */
const readFake = (page: Page): Promise<FakeGoogleState> =>
  page.evaluate(
    () =>
      (window as unknown as { __tripBoardFakeGoogle: { state: FakeGoogleState } })
        .__tripBoardFakeGoogle.state,
  ) as Promise<FakeGoogleState>;

/** OSM 타일은 어느 갈래에서도 밖으로 나가지 않는다. */
async function stubTiles(page: Page): Promise<void> {
  await page.route(/tile\.openstreetmap\.org/, (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: TILE_PNG }),
  );
  await page.route('**/nominatim.openstreetmap.org/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
}

/**
 * 이 기기에 구글 키가 있다 — NAS의 bootstrap-config.json이 하는 일과 같은 것.
 *
 * `addInitScript`는 **매 내비게이션마다** 다시 돈다. 그래서 「키를 잃은 기기」를
 * 흉내 내는 스펙이 리로드하면 이 줄이 키를 도로 넣어 버린다 — 회수 표시를 하나
 * 두고, 그 표시가 있으면 심지 않는다 ({@link revokeKey}).
 */
async function seedKey(page: Page): Promise<void> {
  await page.addInitScript(
    ([key, revoked]) => {
      if (localStorage.getItem(revoked) === null) localStorage.setItem(key, 'test-gmaps-key');
    },
    [GMAPS_KEY_STORAGE, REVOKED_MARKER] as const,
  );
}

/** 키를 잃은 기기가 된다 — 다음 리로드부터. */
async function revokeKey(page: Page): Promise<void> {
  await page.evaluate(
    ([key, revoked]) => {
      localStorage.setItem(revoked, '1');
      localStorage.removeItem(key);
    },
    [GMAPS_KEY_STORAGE, REVOKED_MARKER] as const,
  );
}

/** 구글이 이렇게 답한다고 미리 정해 둔다. 비우면 「못 찾음」. */
async function seedPlaces(page: Page, places: FakePlace[]): Promise<void> {
  await page.addInitScript((seeded) => {
    (window as unknown as Record<string, unknown>).__tripBoardFakeGooglePlaces = seeded;
  }, places);
}

/** 키 + 가짜 구글 + 타일 스텁, 그리고 앱 첫 화면. */
async function openWithGoogle(page: Page, places: FakePlace[] = []): Promise<void> {
  await stubTiles(page);
  await seedKey(page);
  await page.addInitScript(installFakeGoogle);
  await seedPlaces(page, places);
  await page.goto('/');
  await expect(page.getByTestId('tab-bar')).toBeVisible();
}

/** Creates a trip from the 여행 tab and lands on its board. */
async function createTrip(page: Page, title: string): Promise<void> {
  await page.getByTestId('add-trip').click();
  await page.getByTestId('trip-title-input').fill(title);
  await page.getByTestId('trip-submit').click();
  await expect(page.getByTestId('trip-form')).toHaveCount(0);
  await page.getByTestId('trip-card').filter({ hasText: title }).getByTestId('trip-open').click();
  await expect(page).toHaveURL(/#\/board$/);
}

/**
 * 좌표를 든 카드 한 장 — 네트워크 없이.
 *
 * M37의 「좌표 붙여넣기」를 그대로 쓴다: 검색 엔진을 통째로 건너뛰므로 이 스펙은
 * Nominatim도 AI도 부르지 않는다.
 */
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
  await expect(page.getByTestId('place-search')).toBeVisible();
  await page.getByTestId('place-search-input').fill(`${point.lat}, ${point.lng}`);
  await page.getByTestId('place-search-coord').click();
  await expect(page.getByTestId('place-search')).toHaveCount(0);
  await page.getByTestId('card-submit').click();
  await expect(page.getByTestId('card-form')).toHaveCount(0);
}

/** 위치 없는 카드 한 장. */
async function addCard(page: Page, columnIndex: number, title: string): Promise<void> {
  await page.getByTestId('board-column').nth(columnIndex).getByTestId('add-card').click();
  await page.getByTestId('card-title-input').fill(title);
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

/** 지도 탭을 열고 「일정 전체」로 — 구글 시트가 구글로 그려지는 범위. */
async function openSheetScopedMap(page: Page): Promise<void> {
  await page.getByTestId('tab-map').click();
  await expect(page.getByTestId('view-map')).toBeVisible();
  await page.getByTestId('map-scope-sheet').click();
  await expect(page.getByTestId('map-scope-sheet')).toHaveAttribute('data-active', 'true');
}

/* ------------------------------------------------------------------ *
 * 1. 엔진 선택은 키가 있는 기기에만 있다
 * ------------------------------------------------------------------ */

test('구글 키가 있으면 시트 마법사가 지도를 묻는다', async ({ page }) => {
  await openWithGoogle(page);
  await createTrip(page, '오사카 구글');

  await page.getByTestId('tab-timeline').click();
  await page.getByTestId('sheet-add').click();
  await expect(page.getByTestId('sheet-wizard')).toBeVisible();

  const segment = page.getByTestId('wizard-engine');
  await expect(segment).toBeVisible();
  // 기본은 언제나 OSM — 아무것도 고르지 않은 사람이 얻는 것은 지금까지의 지도다.
  await expect(segment).toHaveAttribute('data-engine', 'osm');
  await page.getByTestId('wizard-engine-google').click();
  await expect(segment).toHaveAttribute('data-engine', 'google');
});

test('키가 없는 기기에는 그 선택지가 아예 없다', async ({ page }) => {
  await stubTiles(page);
  await page.goto('/');
  await expect(page.getByTestId('tab-bar')).toBeVisible();
  await createTrip(page, '키 없는 여행');

  await page.getByTestId('tab-timeline').click();
  await page.getByTestId('sheet-add').click();
  await expect(page.getByTestId('sheet-wizard')).toBeVisible();
  await expect(page.getByTestId('wizard-engine')).toHaveCount(0);

  // 그리고 복제도 묻지 않는다 — M40 그대로 한 번에 끝난다.
  await page.getByTestId('wizard-mode-days').click();
  await page.getByTestId('wizard-submit').click();
  await expect(page.getByTestId('sheet-wizard')).toHaveCount(0);

  await page.getByTestId('sheet-menu').click();
  await page.getByTestId('sheet-duplicate').click();
  await expect(page.getByTestId('sheet-duplicate-dialog')).toHaveCount(0);
  await expect(page.getByTestId('sheet-tab')).toHaveCount(2);
});

/* ------------------------------------------------------------------ *
 * 2. 구글 시트는 구글로 그려진다
 * ------------------------------------------------------------------ */

test('구글 시트를 일정 전체로 보면 구글 지도가 서고 핀·동선·필터가 그대로 동작한다', async ({
  page,
}) => {
  await openWithGoogle(page);
  await createTrip(page, '오사카 구글');
  await addLocatedCard(page, 2, '이치란', CARD_POINT);
  await addLocatedCard(page, 4, '츠텐카쿠', OTHER_POINT);

  await createSheet(page, 'google');
  await scheduleCard(page, '이치란');
  await scheduleCard(page, '츠텐카쿠', 2);

  await openSheetScopedMap(page);

  const map = page.getByTestId('google-map');
  await expect(map).toHaveAttribute('data-engine', 'google');
  await expect(map).toHaveAttribute('data-status', 'ready');
  await expect(map).toHaveAttribute('data-pin-count', '2');
  // Leaflet은 아예 마운트되지 않는다 — 두 지도가 겹쳐 뜨지 않는다.
  await expect(page.getByTestId('map-marker')).toHaveCount(0);
  await expect(page.getByTestId('gmap-marker')).toHaveCount(2);

  const state = await readFake(page);
  // 지도는 하나, map id를 들고 태어났다 (AdvancedMarker의 조건).
  expect(state.maps).toHaveLength(1);
  expect(state.maps[0].options.mapId).toBe('DEMO_MAP_ID');
  // 화살표를 단 동선 하나 — 전체 모드의 1일차 색.
  expect(state.polylines.length).toBeGreaterThanOrEqual(1);
  const line = state.polylines[state.polylines.length - 1];
  expect(line.path).toHaveLength(2);
  expect(line.arrows).toBe(1);
  expect(line.repeat).toBe('80px');
  expect(line.strokeColor).toBe('#1d4ed8');
  // 필터가 정해지면 그 결과로 화면을 맞춘다.
  expect(state.fits.length).toBeGreaterThan(0);

  // 카테고리를 하나 끄면 구글 지도에서도 그만큼 핀이 준다 (M27의 그 규칙).
  await page.getByTestId('map-legend-chip').first().click();
  await expect(map).toHaveAttribute('data-pin-count', '1');
  await expect(page.getByTestId('gmap-marker')).toHaveCount(1);

  await page.getByTestId('map-legend-all').click();
  await expect(page.getByTestId('gmap-marker')).toHaveCount(2);
});

test('구글 핀을 누르면 카드 팝업이 열리고 보드로 넘어간다', async ({ page }) => {
  await openWithGoogle(page);
  await createTrip(page, '오사카 구글');
  await addLocatedCard(page, 2, '이치란', CARD_POINT);

  await createSheet(page, 'google');
  await scheduleCard(page, '이치란');
  await openSheetScopedMap(page);

  await expect(page.getByTestId('gmap-marker')).toHaveCount(1);
  await page.getByTestId('gmap-marker').first().click();

  const popup = page.getByTestId('gmap-popup');
  await expect(popup).toBeVisible();
  await expect(popup).toContainText('이치란');

  await page.getByTestId('gmap-popup-edit').click();
  await expect(page.getByTestId('view-board')).toBeVisible();
  await expect(page.getByTestId('card-form')).toBeVisible();
});

test('전체 아이템 범위와 OSM 시트는 지금까지 그대로 Leaflet이다', async ({ page }) => {
  await openWithGoogle(page);
  await createTrip(page, '오사카 구글');
  await addLocatedCard(page, 2, '이치란', CARD_POINT);

  await createSheet(page, 'google');
  await scheduleCard(page, '이치란');

  await page.getByTestId('tab-map').click();
  await expect(page.getByTestId('view-map')).toBeVisible();
  // 기본 범위(전체 아이템)는 여행 전체의 화면이라 시트의 엔진을 따르지 않는다.
  await expect(page.getByTestId('map-scope-all')).toHaveAttribute('data-active', 'true');
  await expect(page.getByTestId('google-map')).toHaveCount(0);
  await expect(page.getByTestId('map-marker')).toHaveCount(1);
  await expect(page.getByTestId('map-google-fallback')).toHaveCount(0);

  // 일정 전체로 옮기면 구글, 다시 전체 아이템으로 오면 Leaflet.
  await page.getByTestId('map-scope-sheet').click();
  await expect(page.getByTestId('google-map')).toHaveCount(1);
  await page.getByTestId('map-scope-all').click();
  await expect(page.getByTestId('google-map')).toHaveCount(0);
  await expect(page.getByTestId('map-marker')).toHaveCount(1);
});

/* ------------------------------------------------------------------ *
 * 3. 키가 없거나 구글이 안 뜨면 조용히 OSM
 * ------------------------------------------------------------------ */

test('키가 사라진 기기에서는 구글 시트도 OSM으로 보이고 한 줄로 말한다', async ({ page }) => {
  await openWithGoogle(page);
  await createTrip(page, '오사카 구글');
  await addLocatedCard(page, 2, '이치란', CARD_POINT);
  await createSheet(page, 'google');
  await scheduleCard(page, '이치란');

  // 이 기기에서 키를 걷어낸다 — GitHub Pages로 같은 워크스페이스를 연 상황.
  await revokeKey(page);
  await page.reload();
  await expect(page.getByTestId('tab-bar')).toBeVisible();

  await openSheetScopedMap(page);
  await expect(page.getByTestId('google-map')).toHaveCount(0);
  const note = page.getByTestId('map-google-fallback');
  await expect(note).toHaveText('구글 지도 키가 없어 OSM으로 보여요');
  await expect(note).toHaveAttribute('data-reason', 'no-key');
  await expect(page.getByTestId('map-marker')).toHaveCount(1);
});

test('구글을 못 불러오면 같은 자리에서 OSM으로 되돌아간다', async ({ page }) => {
  await stubTiles(page);
  await seedKey(page);
  // 가짜를 심지 **않는다** — 진짜 스크립트를 부르러 나가고, 그 길을 막는다.
  await page.route(/maps\.googleapis\.com/, (route) => route.abort());
  await page.goto('/');
  await expect(page.getByTestId('tab-bar')).toBeVisible();

  await createTrip(page, '오사카 실패');
  await addLocatedCard(page, 2, '이치란', CARD_POINT);
  await createSheet(page, 'google');
  await scheduleCard(page, '이치란');

  await openSheetScopedMap(page);
  const note = page.getByTestId('map-google-fallback');
  await expect(note).toHaveText('구글 지도를 불러오지 못해 OSM으로 보여요');
  await expect(note).toHaveAttribute('data-reason', 'failed');
  await expect(page.getByTestId('google-map')).toHaveCount(0);
  await expect(page.getByTestId('map-marker')).toHaveCount(1);
});

/* ------------------------------------------------------------------ *
 * 4. 복제가 지도를 묻는다
 * ------------------------------------------------------------------ */

test('복제는 원본의 지도를 기본으로 묻고, 고른 대로 사본이 선다', async ({ page }) => {
  await openWithGoogle(page);
  await createTrip(page, '오사카 구글');
  await addLocatedCard(page, 2, '이치란', CARD_POINT);
  await createSheet(page, 'osm');
  await scheduleCard(page, '이치란');
  await page.getByTestId('tab-timeline').click();

  await page.getByTestId('sheet-menu').click();
  await page.getByTestId('sheet-duplicate').click();
  const dialog = page.getByTestId('sheet-duplicate-dialog');
  await expect(dialog).toBeVisible();
  // 원본이 OSM이므로 기본도 OSM — 그냥 누르면 M40과 같은 사본이다.
  await expect(page.getByTestId('sheet-duplicate-engine')).toHaveAttribute('data-engine', 'osm');
  await page.getByTestId('sheet-duplicate-engine-google').click();
  await page.getByTestId('confirm-accept').click();
  await expect(dialog).toHaveCount(0);

  // 사본이 활성 시트가 되고(M40), 그 사본은 구글 시트다.
  await expect(page.getByTestId('sheet-tab')).toHaveCount(2);
  await expect(page.getByTestId('timeline-sheet-name')).toHaveText('일정 1 (복사)');
  await expect(page.getByTestId('timeline-entry')).toHaveCount(1);

  await openSheetScopedMap(page);
  await expect(page.getByTestId('google-map')).toHaveCount(1);

  // 원본으로 돌아가면 다시 OSM이다 — 둘은 서로를 모른다.
  await page.getByTestId('tab-timeline').click();
  await page.getByTestId('sheet-tab').first().click();
  await page.getByTestId('tab-map').click();
  await expect(page.getByTestId('map-scope-sheet')).toHaveAttribute('data-active', 'true');
  await expect(page.getByTestId('google-map')).toHaveCount(0);
  await expect(page.getByTestId('map-marker')).toHaveCount(1);
});

/* ------------------------------------------------------------------ *
 * 5. 배치 시 위치 보정
 * ------------------------------------------------------------------ */

/** 구글이 250m 떨어진 자리를 답한다. */
const FAR_PLACE: FakePlace[] = [
  {
    displayName: '이치란 도톤보리점',
    formattedAddress: '일본 오사카부 오사카시 주오구',
    lat: GOOGLE_POINT.lat,
    lng: GOOGLE_POINT.lng,
  },
];

/** 카드 하나를 구글 시트에 놓기까지. */
async function placeOntoGoogleSheet(page: Page, title = '이치란'): Promise<void> {
  await createTrip(page, '오사카 보정');
  await addLocatedCard(page, 2, title, CARD_POINT);
  await createSheet(page, 'google');
  await scheduleCard(page, title);
}

/** 카드 편집 시트를 열어 저장된 좌표를 읽는다. */
async function readCardPoint(page: Page, title: string): Promise<{ lat: string; lng: string }> {
  await page.getByTestId('tab-board').click();
  await page.getByTestId('board-card').filter({ hasText: title }).click();
  await expect(page.getByTestId('card-form')).toBeVisible();
  const address = page.getByTestId('card-location-address');
  const lat = (await address.getAttribute('data-lat')) ?? '';
  const lng = (await address.getAttribute('data-lng')) ?? '';
  await page.getByTestId('sheet-close').click();
  return { lat, lng };
}

test('구글 시트에 놓으면 두 자리를 나란히 보여 주고, 보정하면 카드가 옮겨진다', async ({
  page,
}) => {
  await openWithGoogle(page, FAR_PLACE);
  await placeOntoGoogleSheet(page);

  const dialog = page.getByTestId('place-fix-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('data-has-existing', 'true');
  await expect(dialog).toHaveAttribute('data-reason', 'far');
  expect(Number(await dialog.getAttribute('data-distance-m'))).toBeGreaterThan(200);
  expect(Number(await dialog.getAttribute('data-distance-m'))).toBeLessThan(300);

  // 미니 지도에 두 점이 다 서고, 그 사이는 점선이다.
  await expect(page.getByTestId('place-fix-map')).toHaveAttribute('data-ready', 'true');
  await expect(page.getByTestId('place-fix-pin-existing')).toHaveCount(1);
  await expect(page.getByTestId('place-fix-pin-suggested')).toHaveCount(1);
  await expect(page.getByTestId('place-fix-distance')).toContainText('기존 위치와');
  await expect(page.getByTestId('place-fix-distance')).toContainText('차이');
  await expect(page.getByTestId('place-fix-warning')).toContainText('다른 시트와 지도에도 적용');

  const state = await readFake(page);
  // 물어본 것은 카드 제목이고, 값을 치른 필드는 셋뿐이다.
  expect(state.searches.length).toBeGreaterThan(0);
  const search = state.searches[state.searches.length - 1];
  expect(search.textQuery).toBe('이치란');
  expect(search.fields).toEqual(['displayName', 'location', 'formattedAddress']);
  // 카드의 현재 좌표로 검색을 기울인다 — 세계 어딘가의 동명 가게가 아니라.
  expect(search.bias?.lat).toBeCloseTo(CARD_POINT.lat, 4);
  // 두 점을 잇는 점선(실선 투명 + 반복 심볼)과 두 점을 담은 맞추기.
  const dashed = state.polylines.find((line) => line.strokeOpacity === 0);
  expect(dashed).toBeTruthy();
  expect(dashed?.path).toHaveLength(2);
  expect(state.fits.some((fit) => fit.points.length === 2)).toBe(true);

  await page.getByTestId('place-fix-apply').click();
  await expect(dialog).toHaveCount(0);

  const point = await readCardPoint(page, '이치란');
  expect(Number(point.lat)).toBeCloseTo(GOOGLE_POINT.lat, 5);
  expect(Number(point.lng)).toBeCloseTo(GOOGLE_POINT.lng, 5);
});

test('그대로 두기를 누르면 카드는 원래 자리에 남는다', async ({ page }) => {
  await openWithGoogle(page, FAR_PLACE);
  await placeOntoGoogleSheet(page);

  await expect(page.getByTestId('place-fix-dialog')).toBeVisible();
  await page.getByTestId('place-fix-keep').click();
  await expect(page.getByTestId('place-fix-dialog')).toHaveCount(0);

  const point = await readCardPoint(page, '이치란');
  expect(Number(point.lat)).toBeCloseTo(CARD_POINT.lat, 5);
  expect(Number(point.lng)).toBeCloseTo(CARD_POINT.lng, 5);
});

test('구글이 못 찾으면 아무것도 묻지 않는다', async ({ page }) => {
  await openWithGoogle(page, []);
  await placeOntoGoogleSheet(page);

  // 검색은 실제로 나갔고(배선은 살아 있고), 팝업만 없다.
  await expect
    .poll(async () => (await readFake(page)).searches.length)
    .toBeGreaterThan(0);
  await expect(page.getByTestId('place-fix-dialog')).toHaveCount(0);
  // 배치는 어떤 경우에도 막히지 않는다.
  await page.getByTestId('tab-timeline').click();
  await expect(page.getByTestId('timeline-entry')).toHaveCount(1);
});

test('OSM 시트에 놓을 때는 구글에 묻지도 않는다', async ({ page }) => {
  await openWithGoogle(page, FAR_PLACE);
  await createTrip(page, '오사카 OSM');
  await addLocatedCard(page, 2, '이치란', CARD_POINT);
  await createSheet(page, 'osm');
  await scheduleCard(page, '이치란');

  await expect(page.getByTestId('place-fix-dialog')).toHaveCount(0);
  expect((await readFake(page)).searches).toHaveLength(0);
});

test('위치가 없던 카드에는 거리 대신 이유를 말한다', async ({ page }) => {
  await openWithGoogle(page, FAR_PLACE);
  await createTrip(page, '오사카 보정');
  await addCard(page, 2, '이치란');
  await createSheet(page, 'google');
  await scheduleCard(page, '이치란');

  const dialog = page.getByTestId('place-fix-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('data-has-existing', 'false');
  await expect(dialog).toHaveAttribute('data-reason', 'no-location');
  await expect(page.getByTestId('place-fix-distance')).toHaveText(
    '카드에 위치가 없어 구글 결과를 제안해요',
  );
  // 기존 핀이 없으니 점도 하나뿐이고, 이을 점선도 없다.
  await expect(page.getByTestId('place-fix-pin-existing')).toHaveCount(0);
  await expect(page.getByTestId('place-fix-pin-suggested')).toHaveCount(1);

  await page.getByTestId('place-fix-apply').click();
  const point = await readCardPoint(page, '이치란');
  expect(Number(point.lat)).toBeCloseTo(GOOGLE_POINT.lat, 5);
});

test('390px에서 팝업이 스크롤 없이 들어간다', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openWithGoogle(page, FAR_PLACE);
  await placeOntoGoogleSheet(page);

  const dialog = page.getByTestId('place-fix-dialog');
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId('place-fix-map')).toBeVisible();
  await expect(page.getByTestId('place-fix-distance')).toBeVisible();
  await expect(page.getByTestId('place-fix-warning')).toBeVisible();

  // 두 버튼이 화면 안에 있고, 손가락이 닿는 높이다.
  for (const testId of ['place-fix-keep', 'place-fix-apply']) {
    const box = await page.getByTestId(testId).boundingBox();
    expect(box).toBeTruthy();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.y + box!.height).toBeLessThanOrEqual(844);
  }

  // 가로 스크롤이 생기지 않는다.
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
});
