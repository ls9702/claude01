import { expect, test, type Page } from '@playwright/test';
import { startMockApi, type MockApi } from './mock-api';

/**
 * AI 장소 검색 (M28) — AI 먼저, 안 되면 OpenStreetMap.
 *
 * 이 스펙이 지키는 것은 세 갈래다:
 *
 *  1. AI가 켜져 있으면 검색은 **프록시로 간다**. 「츠텐카쿠」처럼 Nominatim에는
 *     없는 이름이 결과가 되고, 현지 표기(通天閣)가 줄에 같이 보여서 사용자가
 *     맞는 장소인지 확인할 수 있다.
 *  2. AI가 꺼져 있으면 M3 그대로 Nominatim으로 간다. GitHub Pages 빌드에는
 *     이 길밖에 없으므로, 이게 깨지면 앱의 절반이 깨진다.
 *  3. AI가 실패하면 **자동으로** Nominatim으로 내려가고, 그 사실만 한 줄 알린다.
 *
 * 네트워크는 양쪽 다 가짜다: Gemini 자리에는 `mock-api.ts`가, Nominatim 자리에는
 * 라우트 스텁이 앉는다.
 */

test.use({ viewport: { width: 1280, height: 800 } });

let api: MockApi;

test.beforeAll(async () => {
  api = await startMockApi();
});

test.afterAll(async () => {
  await api.stop();
});

test.beforeEach(() => {
  api.reset();
});

/** 「오사카」를 물으면 도시, 그 밖에는 오사카성 한 곳. */
const OSAKA_CITY = [
  { place_id: 9, lat: '34.69', lon: '135.50', display_name: '오사카시, 오사카부, 일본' },
];

/** Nominatim이 「츠텐카쿠」에 줄 수 있는 최선 — 이름이 다르다는 게 요점이다. */
const OSAKA_CASTLE = [
  {
    place_id: 11,
    lat: '34.6873',
    lon: '135.5259',
    display_name: '오사카성, 주오구, 오사카시, 일본',
  },
];

/** A transparent 1×1 png — enough for Leaflet to count as a loaded tile. */
const TILE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** How many Nominatim searches the page actually made. */
let osmHits = 0;

async function stubNetwork(page: Page): Promise<void> {
  osmHits = 0;
  await page.route('**/nominatim.openstreetmap.org/**', (route) => {
    osmHits += 1;
    const query = new URL(route.request().url()).searchParams.get('q') ?? '';
    void route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(query.includes('오사카') ? OSAKA_CITY : OSAKA_CASTLE),
    });
  });
  await page.route(/tile\.openstreetmap\.org/, (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: TILE_PNG }),
  );
}

/** Points the device at the mock server through the settings sheet. */
async function configureSync(page: Page): Promise<void> {
  await page.getByTestId('sync-chip').click();
  await expect(page.getByTestId('sync-settings')).toBeVisible();
  await page.getByTestId('sync-base-url').fill(api.baseUrl);
  await page.getByTestId('sync-token').fill(api.token);
  await page.getByTestId('sync-save').click();
  await expect(page.getByTestId('sync-notice')).toHaveText('저장했어요');
  await page.getByTestId('sheet-close').click();
  await expect(page.getByTestId('sync-settings')).toHaveCount(0);
}

/** Flips 「AI 도우미」 on and waits for the status line to say it is ready. */
async function enableAi(page: Page): Promise<void> {
  await page.getByTestId('sync-chip').click();
  await page.getByTestId('ai-toggle').click();
  await expect(page.getByTestId('ai-status')).toHaveAttribute('data-state', 'ready');
  await page.getByTestId('sheet-close').click();
  await expect(page.getByTestId('sync-settings')).toHaveCount(0);
}

/** Creates a trip, optionally giving it a 목적지 through the (OSM) search box. */
async function createTrip(page: Page, title: string, withDestination = false): Promise<void> {
  await page.getByTestId('add-trip').click();
  await page.getByTestId('trip-title-input').fill(title);

  if (withDestination) {
    await page.getByTestId('trip-destination-search').click();
    await expect(page.getByTestId('place-search')).toBeVisible();
    await page.getByTestId('place-search-submit').click();
    await page.getByTestId('place-search-result').first().click();
    await expect(page.getByTestId('place-search')).toHaveCount(0);
    await expect(page.getByTestId('trip-destination')).toHaveAttribute('data-has', 'true');
  }

  await page.getByTestId('trip-submit').click();
  await expect(page.getByTestId('trip-form')).toHaveCount(0);
  await page.getByTestId('trip-card').filter({ hasText: title }).getByTestId('trip-open').click();
  await expect(page).toHaveURL(/#\/board$/);
}

async function addCard(page: Page, title: string): Promise<void> {
  await page.getByTestId('board-column').nth(4).getByTestId('add-card').click();
  await page.getByTestId('card-title-input').fill(title);
  await page.getByTestId('card-submit').click();
  await expect(page.getByTestId('card-form')).toHaveCount(0);
}

/** Opens the card's 장소 검색 modal and searches for whatever is prefilled. */
async function searchFromCard(page: Page, title: string): Promise<void> {
  await page.getByTestId('board-card').filter({ hasText: title }).click();
  await expect(page.getByTestId('card-form')).toBeVisible();
  await page.getByTestId('card-location-search').click();
  await expect(page.getByTestId('place-search')).toBeVisible();
  await expect(page.getByTestId('place-search-input')).toHaveValue(title);
  await page.getByTestId('place-search-submit').click();
}

test('AI가 켜져 있으면 프록시로 찾고, 현지 표기까지 보여준다', async ({ page }) => {
  await stubNetwork(page);
  await page.goto('/');
  await expect(page.getByTestId('tab-bar')).toBeVisible();

  // 목적지는 AI를 켜기 전에 (OSM으로) 잡아 둔다 — 프롬프트에 실려 가는지 보려고.
  await createTrip(page, '오사카 3박', true);
  await configureSync(page);
  await enableAi(page);

  await addCard(page, '츠텐카쿠');
  await searchFromCard(page, '츠텐카쿠');

  // 안내 문구부터 AI 경로라고 말한다.
  await expect(page.getByTestId('place-search-hint')).toContainText('AI가 먼저 찾고');

  const results = page.getByTestId('place-search-results');
  await expect(results).toHaveAttribute('data-source', 'ai');
  await expect(page.getByTestId('place-search-result')).toHaveCount(2);
  // Nominatim에는 이 이름이 없다 — 그래서 이 기능이 있다.
  await expect(page.getByTestId('place-search-result').first()).toContainText('통천각');
  await expect(page.getByTestId('place-search-local')).toHaveCount(1);
  await expect(page.getByTestId('place-search-local').first()).toHaveText('通天閣');
  await expect(page.getByTestId('place-search-locality').first()).toContainText('오사카');
  await expect(page.getByTestId('place-search-note')).toHaveCount(0);

  // 요청은 정말 프록시로 갔고, 여행지가 문맥으로 실려 있다.
  const calls = api.aiCalls();
  expect(calls).toHaveLength(1);
  expect(calls[0].prompt).toContain('찾는 장소: 츠텐카쿠');
  expect(calls[0].prompt).toContain('여행지: 오사카시, 오사카부, 일본');
  expect(calls[0].schema).toBeTruthy();
  expect(calls[0].grounding).toBeUndefined();
  // 목적지를 잡을 때 쓴 한 번 말고는 Nominatim에 가지 않았다.
  expect(osmHits).toBe(1);

  // 고르면 Nominatim 결과와 똑같이 카드 위치가 된다.
  await page.getByTestId('place-search-result').first().click();
  await expect(page.getByTestId('place-search')).toHaveCount(0);

  const address = page.getByTestId('card-location-address');
  await expect(address).toHaveAttribute('data-has-location', 'true');
  await expect(address).toContainText('통천각');
  await expect(address).toHaveAttribute('data-lat', '34.6525');

  await page.getByTestId('card-submit').click();
  await expect(page.getByTestId('card-form')).toHaveCount(0);
  await expect(page.getByTestId('card-chip-location')).toContainText('통천각');
});

test('AI가 꺼져 있으면 예전처럼 OpenStreetMap으로 찾는다', async ({ page }) => {
  await stubNetwork(page);
  await page.goto('/');
  await expect(page.getByTestId('tab-bar')).toBeVisible();

  await createTrip(page, '오사카 3박');
  // 동기화만 하고 토글은 그대로 둔다: 게이트를 잡고 있는 건 토글 하나다.
  await configureSync(page);

  await addCard(page, '츠텐카쿠');
  await searchFromCard(page, '츠텐카쿠');

  const results = page.getByTestId('place-search-results');
  await expect(results).toHaveAttribute('data-source', 'osm');
  await expect(page.getByTestId('place-search-result')).toHaveCount(1);
  await expect(page.getByTestId('place-search-result').first()).toContainText('오사카성');
  await expect(page.getByTestId('place-search-hint')).toHaveText(
    'OpenStreetMap(Nominatim)에서 찾아요. 검색 버튼을 눌러야 요청해요.',
  );
  // 평소 상태를 매번 사과하지 않는다.
  await expect(page.getByTestId('place-search-note')).toHaveCount(0);
  expect(api.aiCalls()).toHaveLength(0);
  expect(osmHits).toBe(1);

  await page.getByTestId('place-search-result').first().click();
  await expect(page.getByTestId('card-location-address')).toHaveAttribute('data-lat', '34.6873');
});

test('AI가 실패하면 알아서 OpenStreetMap으로 내려간다', async ({ page }) => {
  api.setAiPlaceMode('error');

  await stubNetwork(page);
  await page.goto('/');
  await expect(page.getByTestId('tab-bar')).toBeVisible();

  await createTrip(page, '오사카 3박');
  await configureSync(page);
  await enableAi(page);

  await addCard(page, '츠텐카쿠');
  await searchFromCard(page, '츠텐카쿠');

  // 사용자에게 보이는 것은 결과와 한 줄뿐 — 오류 화면이 아니다.
  await expect(page.getByTestId('place-search-note')).toHaveText(
    'AI 검색이 안 돼서 OpenStreetMap 결과예요',
  );
  await expect(page.getByTestId('place-search-error')).toHaveCount(0);
  await expect(page.getByTestId('place-search-results')).toHaveAttribute('data-source', 'osm');
  await expect(page.getByTestId('place-search-result').first()).toContainText('오사카성');
  expect(api.aiCalls()).toHaveLength(1);
  expect(osmHits).toBe(1);

  await page.getByTestId('place-search-result').first().click();
  await expect(page.getByTestId('card-location-address')).toHaveAttribute('data-lat', '34.6873');
});

test('AI가 못 찾으면 검색을 한 번 더 붙여 보고, 그래도 없으면 내려간다', async ({ page }) => {
  api.setAiPlaceMode('empty');

  await stubNetwork(page);
  await page.goto('/');
  await expect(page.getByTestId('tab-bar')).toBeVisible();

  await createTrip(page, '오사카 3박');
  await configureSync(page);
  await enableAi(page);

  await addCard(page, '츠텐카쿠');
  await searchFromCard(page, '츠텐카쿠');

  await expect(page.getByTestId('place-search-note')).toHaveText(
    'AI가 찾지 못해서 OpenStreetMap 결과예요',
  );
  await expect(page.getByTestId('place-search-results')).toHaveAttribute('data-source', 'osm');

  // 두 번째 시도는 grounding — 스키마는 서버가 떨구므로 보내지 않는다.
  const calls = api.aiCalls();
  expect(calls).toHaveLength(2);
  expect(calls[0].grounding).toBeUndefined();
  expect(calls[1].grounding).toBe(true);
  expect(calls[1].schema).toBeUndefined();
  expect(osmHits).toBe(1);
});
