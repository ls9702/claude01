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

/** Opens the card's 장소 검색 modal, with the card title already in the box. */
async function openCardSearch(page: Page, title: string): Promise<void> {
  await page.getByTestId('board-card').filter({ hasText: title }).click();
  await expect(page.getByTestId('card-form')).toBeVisible();
  await page.getByTestId('card-location-search').click();
  await expect(page.getByTestId('place-search')).toBeVisible();
  await expect(page.getByTestId('place-search-input')).toHaveValue(title);
}

/** Opens the card's 장소 검색 modal and searches for whatever is prefilled. */
async function searchFromCard(page: Page, title: string): Promise<void> {
  await openCardSearch(page, title);
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
  // 장소 한 번 + 주소 되묻기 두 번 (M37): 이 목의 Nominatim은 두 후보 모두에게
  // 4km 밖을 주므로 이름 스냅이 둘 다 빗나가고, 앞의 두 후보가 주소 계단에 오른다.
  // 목은 등록되지 않은 장소에 「모르겠다」고 답하므로 좌표는 그대로 남는다.
  expect(calls).toHaveLength(3);
  expect(calls.slice(1).every((call) => call.grounding === true)).toBe(true);
  expect(calls[1].prompt).toContain('주소 확인 장소: 通天閣');
  expect(calls[0].prompt).toContain('찾는 장소: 츠텐카쿠');
  expect(calls[0].prompt).toContain('여행지: 오사카시, 오사카부, 일본');
  expect(calls[0].schema).toBeTruthy();
  expect(calls[0].grounding).toBeUndefined();
  // 목적지를 잡을 때 한 번, 그리고 M35의 좌표 보정이 후보 둘에 두 번씩.
  // 이 목의 Nominatim은 두 후보 모두에게 4km 넘게 떨어진 곳을 주므로 —
  // 아래에서 보듯 — 좌표는 AI 것 그대로 남는다.
  expect(osmHits).toBe(5);

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

/**
 * M35 — AI 좌표를 OSM에 맞춰 조인다.
 *
 * 「通天閣」을 물었을 때 Nominatim이 AI가 말한 자리 바로 옆(30m)을 주면 그 좌표를
 * 쓰고, 두 번째 후보처럼 도쿄를 주면 무시한다. 사용자가 신고한 증상(한 블록
 * 어긋남)은 앞의 경우이고, 뒤의 경우까지 갈아끼우면 여행이 다른 나라로 간다.
 */
const TSUTENKAKU_OSM = [
  {
    place_id: 21,
    lat: '34.6527',
    lon: '135.5064',
    display_name: '통천각, 나니와구, 오사카시, 일본',
  },
];

/** 400km 밖 — 이름만 같고 자리는 다른 곳. */
const SHIBUYA_OSM = [
  {
    place_id: 22,
    lat: '35.6595',
    lon: '139.7005',
    display_name: '시부야 스크램블 교차로, 도쿄도, 일본',
  },
];

test('AI 결과의 좌표를 근처 OSM 자리로 조여 준다', async ({ page }) => {
  osmHits = 0;
  await page.route('**/nominatim.openstreetmap.org/**', (route) => {
    osmHits += 1;
    const query = new URL(route.request().url()).searchParams.get('q') ?? '';
    void route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(query.includes('通天閣') ? TSUTENKAKU_OSM : SHIBUYA_OSM),
    });
  });
  await page.route(/tile\.openstreetmap\.org/, (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: TILE_PNG }),
  );

  await page.goto('/');
  await expect(page.getByTestId('tab-bar')).toBeVisible();

  await createTrip(page, '오사카 3박');
  await configureSync(page);
  await enableAi(page);

  await addCard(page, '츠텐카쿠');
  await searchFromCard(page, '츠텐카쿠');

  const rows = page.getByTestId('place-search-result');
  await expect(rows).toHaveCount(2);

  // 첫 줄은 현지 표기로 물어본 한 번에 맞았다 — 좌표가 OSM 것으로 바뀌었다.
  await expect(rows.first()).toHaveAttribute('data-refined', 'true');
  await expect(rows.first()).toHaveAttribute('data-lat', '34.6527');
  await expect(page.getByTestId('place-search-refined')).toHaveCount(1);
  await expect(rows.first()).toContainText('지도 확인됨');
  // 조여도 이름은 사용자가 찾은 그 이름이다.
  await expect(rows.first()).toContainText('통천각');

  // 둘째 줄은 400km 밖이라 손대지 않는다 — 목이 준 좌표를 그대로 쓰면 도쿄로 간다.
  await expect(rows.nth(1)).toHaveAttribute('data-refined', 'false');
  await expect(rows.nth(1)).toHaveAttribute('data-lat', '34.6519');

  // 카드에 들어가는 것도 조여진 좌표다.
  await rows.first().click();
  await expect(page.getByTestId('place-search')).toHaveCount(0);
  const address = page.getByTestId('card-location-address');
  await expect(address).toHaveAttribute('data-lat', '34.6527');
  await expect(address).toHaveAttribute('data-lng', '135.5064');
  await expect(address).toContainText('통천각');

  // 보정에 쓴 요청은 첫 후보 1건 + 둘째 후보 2건. 예산(6) 안이다.
  expect(osmHits).toBe(3);
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

/* ------------------------------------------------------------------ *
 * M37 — 이름으로 못 찾는 가게를 주소로 잡는다
 * ------------------------------------------------------------------ */

/**
 * 사용자의 신고는 이랬다: *「잇푸도 난바점을 구글 지도에서 검색했을 때랑 지금 위치랑
 * 차이가 많이 남. 뭔가 못 찾는 것 같음.」*
 *
 * 원인은 M35의 구멍이었다. 작은 체인점은 OSM의 POI 색인에 아예 없어서 현지 표기로
 * 되물어도 0건이 나오고, 그러면 모델의 기억 좌표가 표시 없이 살아남는다. 그래서
 * 한 계단을 더 둔다 — 좌표가 아니라 **주소**를 되묻고, 그 주소를 지오코딩한다.
 * 가게는 색인에 없어도 그 가게가 든 번지는 색인에 있다.
 */
const IPPUDO_ADDRESS = '大阪府大阪市中央区難波1-4-16';

/** 그 번지가 진짜로 있는 자리 — 모델의 기억에서 900m쯤 떨어져 있다. */
const IPPUDO_BUILDING = [
  {
    place_id: 51,
    lat: '34.6659',
    lon: '135.5013',
    display_name: '1-4-16, 난바, 주오구, 오사카시, 일본',
  },
];

test('OSM에 없는 가게는 주소로 되물어 좌표를 잡는다', async ({ page }) => {
  osmHits = 0;
  await page.route('**/nominatim.openstreetmap.org/**', (route) => {
    osmHits += 1;
    const query = new URL(route.request().url()).searchParams.get('q') ?? '';
    void route.fulfill({
      status: 200,
      contentType: 'application/json',
      // 이름으로는 아무것도 모른다 — 아는 것은 번지뿐이다.
      body: JSON.stringify(query.includes(IPPUDO_ADDRESS) ? IPPUDO_BUILDING : []),
    });
  });
  await page.route(/tile\.openstreetmap\.org/, (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: TILE_PNG }),
  );

  await page.goto('/');
  await expect(page.getByTestId('tab-bar')).toBeVisible();

  await createTrip(page, '오사카 3박');
  await configureSync(page);
  await enableAi(page);

  api.setAiPlacesFor('찾는 장소: 잇푸도 난바점', {
    places: [
      // 동네까지는 맞고 블록은 틀린 좌표 — 신고된 그 증상.
      { name: '잇푸도 난바점', localName: '一風堂 なんば店', locality: '오사카', lat: 34.67, lng: 135.51 },
    ],
  });
  api.setAiAddressFor('一風堂', IPPUDO_ADDRESS);

  await addCard(page, '잇푸도 난바점');
  await searchFromCard(page, '잇푸도 난바점');

  const rows = page.getByTestId('place-search-result');
  await expect(rows).toHaveCount(1);
  // 이름으로는 빈손이었지만 주소가 이 줄을 지도 위에 올려놓았다.
  await expect(rows.first()).toHaveAttribute('data-refined', 'true');
  await expect(rows.first()).toHaveAttribute('data-refined-by', 'address');
  await expect(rows.first()).toHaveAttribute('data-lat', '34.6659');
  await expect(rows.first()).toHaveAttribute('data-lng', '135.5013');
  await expect(page.getByTestId('place-search-refined')).toHaveCount(1);
  // 바뀐 것은 좌표뿐 — 줄에는 사용자가 찾은 이름과 현지 표기가 그대로 있다.
  await expect(rows.first()).toContainText('잇푸도 난바점');
  await expect(page.getByTestId('place-search-local').first()).toHaveText('一風堂 なんば店');

  // 두 번째 호출은 검색을 붙인 주소 질문이다 — 스키마는 서버가 떨구므로 없다.
  const calls = api.aiCalls();
  expect(calls).toHaveLength(2);
  expect(calls[1].grounding).toBe(true);
  expect(calls[1].schema).toBeUndefined();
  expect(calls[1].prompt).toContain('주소 확인 장소: 一風堂 なんば店');
  expect(calls[1].prompt).toContain('대략 위치: 34.67, 135.51');
  // 이름 둘로 빈손, 그리고 주소로 한 번 — 예산(6) 안이다.
  expect(osmHits).toBe(3);

  // 카드에 들어가는 것도, 「위치 확인」이 보여 주는 것도 그 번지의 좌표다.
  await rows.first().click();
  await expect(page.getByTestId('place-search')).toHaveCount(0);
  const address = page.getByTestId('card-location-address');
  await expect(address).toHaveAttribute('data-lat', '34.6659');
  await expect(address).toHaveAttribute('data-lng', '135.5013');
  await expect(address).toContainText('잇푸도 난바점');

  await page.getByTestId('location-preview-open').click();
  await expect(page.getByTestId('location-preview-map')).toHaveAttribute('data-lat', '34.6659');
  await expect(page.getByTestId('location-preview-map')).toHaveAttribute('data-lng', '135.5013');
});

test('주소를 모른다고 하면 AI 좌표를 그대로 둔다', async ({ page }) => {
  osmHits = 0;
  await page.route('**/nominatim.openstreetmap.org/**', (route) => {
    osmHits += 1;
    void route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await page.route(/tile\.openstreetmap\.org/, (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: TILE_PNG }),
  );

  await page.goto('/');
  await expect(page.getByTestId('tab-bar')).toBeVisible();

  await createTrip(page, '오사카 3박');
  await configureSync(page);
  await enableAi(page);

  api.setAiPlacesFor('찾는 장소: 잇푸도 난바점', {
    places: [
      { name: '잇푸도 난바점', localName: '一風堂 なんば店', locality: '오사카', lat: 34.67, lng: 135.51 },
    ],
  });
  // 주소 답을 등록하지 않는다 → 목이 「확실하지 않다」고 답한다.

  await addCard(page, '잇푸도 난바점');
  await searchFromCard(page, '잇푸도 난바점');

  const rows = page.getByTestId('place-search-result');
  await expect(rows).toHaveCount(1);
  // 조용히 실패한다. 오류 화면도, 사과도 없다 — 한 블록 틀린 좌표가 남을 뿐이다.
  await expect(rows.first()).toHaveAttribute('data-refined', 'false');
  await expect(rows.first()).toHaveAttribute('data-lat', '34.67');
  await expect(page.getByTestId('place-search-refined')).toHaveCount(0);
  await expect(page.getByTestId('place-search-error')).toHaveCount(0);
  expect(api.aiCalls()).toHaveLength(2);
  // 주소를 못 받았으므로 지오코딩도 하지 않았다 — 이름 두 번이 전부다.
  expect(osmHits).toBe(2);
});

/* ------------------------------------------------------------------ *
 * M37 — 좌표·구글 지도 주소 붙여넣기
 * ------------------------------------------------------------------ */

/**
 * 사용자가 이미 자리를 알고 있을 때는 아무에게도 묻지 않는다.
 *
 * 구글 지도에서 가게를 찾아 놓고 주소창을 복사해 왔다면 답은 이미 손에 있고,
 * 그 이름으로 다시 찾는 것은 틀릴 기회를 한 번 더 주는 것이다. 이 세 스펙이 지키는
 * 것은 그 지름길이다 — 요청 0건, 좌표 그대로, 그리고 못 하는 것(단축 링크)은
 * 조용히 실패하는 대신 말한다.
 */
async function seedCardForPaste(page: Page, title: string): Promise<void> {
  osmHits = 0;
  await page.route('**/nominatim.openstreetmap.org/**', (route) => {
    osmHits += 1;
    void route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await page.route(/tile\.openstreetmap\.org/, (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: TILE_PNG }),
  );

  await page.goto('/');
  await expect(page.getByTestId('tab-bar')).toBeVisible();
  await createTrip(page, '오사카 3박');
  await addCard(page, title);
  await openCardSearch(page, title);
}

test('구글 지도 주소를 붙여넣으면 그 자리를 그대로 꽂는다', async ({ page }) => {
  await seedCardForPaste(page, '잇푸도 난바점');

  // 화면 중심(@)은 손으로 끌어 밀려 있고, 가게의 점(!3d!4d)은 밀리지 않는다.
  await page
    .getByTestId('place-search-input')
    .fill(
      'https://www.google.com/maps/place/一風堂+難波店/@34.6700,135.5100,17z/' +
        'data=!4m6!3m5!1s0x6000e1f0!8m2!3d34.6659!4d135.5013!16s%2Fg%2F1td',
    );

  const direct = page.getByTestId('place-search-coord');
  await expect(direct).toBeVisible();
  await expect(direct).toHaveAttribute('data-lat', '34.6659');
  await expect(direct).toHaveAttribute('data-lng', '135.5013');
  await expect(direct).toContainText('좌표로 지정');
  await expect(direct).toContainText('34.6659, 135.5013');
  // 검색할 것이 없다 — 버튼은 잠기고 요청은 나가지 않는다.
  await expect(page.getByTestId('place-search-submit')).toBeDisabled();
  expect(osmHits).toBe(0);

  await direct.click();
  await expect(page.getByTestId('place-search')).toHaveCount(0);

  const address = page.getByTestId('card-location-address');
  await expect(address).toHaveAttribute('data-lat', '34.6659');
  await expect(address).toHaveAttribute('data-lng', '135.5013');
  // 손으로 찍은 핀과 같은 주소 표기 — 「위도, 경도」.
  await expect(address).toHaveText('34.6659, 135.5013');

  await page.getByTestId('location-preview-open').click();
  await expect(page.getByTestId('location-preview-map')).toHaveAttribute('data-lat', '34.6659');
  await expect(page.getByTestId('location-preview-map')).toHaveAttribute('data-lng', '135.5013');
  expect(osmHits).toBe(0);
});

test('좌표를 그대로 붙여넣어도 똑같이 동작한다', async ({ page }) => {
  await seedCardForPaste(page, '잇푸도 난바점');

  await page.getByTestId('place-search-input').fill('34.6659, 135.5013');
  const direct = page.getByTestId('place-search-coord');
  await expect(direct).toHaveAttribute('data-lat', '34.6659');
  await expect(direct).toHaveAttribute('data-lng', '135.5013');

  await direct.click();
  await expect(page.getByTestId('card-location-address')).toHaveAttribute('data-lat', '34.6659');
  expect(osmHits).toBe(0);

  // 좌표가 아닌 글자로 되돌리면 그 줄은 사라지고 다시 평범한 검색 화면이 된다.
  await page.getByTestId('card-location-search').click();
  await page.getByTestId('place-search-input').fill('잇푸도 난바점');
  await expect(page.getByTestId('place-search-coord')).toHaveCount(0);
  await expect(page.getByTestId('place-search-submit')).toBeEnabled();
});

test('단축 링크는 못 편다고 말하고 무엇을 하면 되는지 알려 준다', async ({ page }) => {
  await seedCardForPaste(page, '잇푸도 난바점');

  await page.getByTestId('place-search-input').fill('https://maps.app.goo.gl/abcDEF123');

  await expect(page.getByTestId('place-search-shortlink')).toHaveText(
    '단축 링크는 열어서 주소창의 전체 주소를 복사해 주세요',
  );
  await expect(page.getByTestId('place-search-coord')).toHaveCount(0);
  await expect(page.getByTestId('place-search-submit')).toBeDisabled();
  await expect(page.getByTestId('place-search-error')).toHaveCount(0);
  expect(osmHits).toBe(0);
});

test.describe('모바일', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('390px에서 긴 주소를 붙여넣어도 화면이 넘치지 않는다', async ({ page }) => {
    await seedCardForPaste(page, '잇푸도 난바점');

    await page
      .getByTestId('place-search-input')
      .fill(
        'https://www.google.com/maps/place/一風堂+難波店/@34.6700,135.5100,17z/' +
          'data=!4m6!3m5!1s0x6000e1f0!8m2!3d34.6659!4d135.5013!16s%2Fg%2F1td',
      );

    const direct = page.getByTestId('place-search-coord');
    await expect(direct).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    const box = await direct.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.width ?? 0).toBeLessThanOrEqual(390);

    // 붙여넣기 안내도 한 줄로 얌전히 있는다.
    await expect(page.getByTestId('place-search-paste-hint')).toBeVisible();
  });
});
