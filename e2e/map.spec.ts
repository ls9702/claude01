import { expect, test, type Page } from '@playwright/test';

/**
 * 지도 (map) — M3.
 *
 * The suite is **offline by construction**: every Nominatim search is stubbed
 * with a fixture and every OSM tile with a 1×1 png. That keeps the run fast and
 * deterministic, and it keeps a test suite from hammering two free services.
 */

test.use({ viewport: { width: 1280, height: 800 } });

/** Two 시부야 hits, in Nominatim's `jsonv2` shape. */
const NOMINATIM_FIXTURE = [
  {
    place_id: 1,
    lat: '35.6595',
    lon: '139.7005',
    display_name: '시부야 스크램블 교차로, 시부야구, 도쿄도, 일본',
  },
  {
    place_id: 2,
    lat: '35.658',
    lon: '139.7016',
    display_name: '시부야역, 시부야구, 도쿄도, 일본',
  },
];

/** 「오사카」 → one hit in the middle of the city (M12). */
const OSAKA_FIXTURE = [
  {
    place_id: 9,
    lat: '34.69',
    lon: '135.50',
    display_name: '오사카시, 오사카부, 일본',
  },
];

/** A transparent 1×1 png — enough for Leaflet to count as a loaded tile. */
const TILE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/**
 * Stubs both outbound hosts.
 *
 * The tile route has to be a regex: the URL host is `a.tile.openstreetmap.org`,
 * so a `**‍/tile.openstreetmap.org/**` glob never sees the `/` it needs.
 */
async function stubNetwork(page: Page, searchBody: unknown = NOMINATIM_FIXTURE): Promise<void> {
  await page.route('**/nominatim.openstreetmap.org/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(searchBody),
    }),
  );
  await page.route(/tile\.openstreetmap\.org/, (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: TILE_PNG }),
  );
}

/**
 * Answers 오사카 with the city and every other query with the 시부야 pair.
 *
 * One M12 test has to set a 목적지 *and* then place a card 400km away from it,
 * so a single fixture for the whole run cannot serve both halves.
 */
async function stubNetworkByQuery(page: Page): Promise<void> {
  await page.route('**/nominatim.openstreetmap.org/**', (route) => {
    const query = new URL(route.request().url()).searchParams.get('q') ?? '';
    void route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(query.includes('오사카') ? OSAKA_FIXTURE : NOMINATIM_FIXTURE),
    });
  });
  await page.route(/tile\.openstreetmap\.org/, (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: TILE_PNG }),
  );
}

/**
 * The map's settled center, rounded to one decimal (~11km).
 *
 * Coarse on purpose: the test cares that the view sits over 오사카 rather than
 * over 시부야, not which metre Leaflet's pixel maths landed on.
 */
async function mapCenter(page: Page): Promise<string> {
  const root = page.getByTestId('map-root');
  const lat = Number(await root.getAttribute('data-center-lat'));
  const lng = Number(await root.getAttribute('data-center-lng'));
  return `${lat.toFixed(1)},${lng.toFixed(1)}`;
}

/**
 * Waits until the workspace blob actually sitting in IndexedDB mentions
 * `needle`, so a `reload()` cannot race the persist middleware's write.
 */
async function waitForPersisted(page: Page, needle: string): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(
          (key) =>
            new Promise<string>((resolve) => {
              const request = indexedDB.open('trip-board');
              request.onerror = () => resolve('');
              request.onsuccess = () => {
                try {
                  const read = request.result
                    .transaction('state', 'readonly')
                    .objectStore('state')
                    .get(key);
                  read.onsuccess = () =>
                    resolve(typeof read.result === 'string' ? read.result : '');
                  read.onerror = () => resolve('');
                } catch {
                  resolve('');
                }
              };
            }),
          'trip-board/workspace',
        ),
      { timeout: 5_000 },
    )
    .toContain(needle);
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

/** Adds a card to the column at `columnIndex` through the column's ＋ button. */
async function addCard(page: Page, columnIndex: number, title: string): Promise<void> {
  await page.getByTestId('board-column').nth(columnIndex).getByTestId('add-card').click();
  await page.getByTestId('card-title-input').fill(title);
  await page.getByTestId('card-submit').click();
  await expect(page.getByTestId('card-form')).toHaveCount(0);
}

/** Opens the edit sheet of the board card titled `title`. */
async function openCard(page: Page, title: string): Promise<void> {
  await page.getByTestId('board-card').filter({ hasText: title }).click();
  await expect(page.getByTestId('card-form')).toBeVisible();
}

/** Opens the 장소 검색 modal from an already-open card sheet. */
async function openPlaceSearch(page: Page): Promise<void> {
  await page.getByTestId('card-location-search').click();
  await expect(page.getByTestId('place-search')).toBeVisible();
}

/** Searches for the card's title and picks the first (stubbed) hit. */
async function pickFirstSearchResult(page: Page): Promise<void> {
  await openPlaceSearch(page);
  await page.getByTestId('place-search-submit').click();
  await expect(page.getByTestId('place-search-result')).toHaveCount(2);
  await page.getByTestId('place-search-result').first().click();
  await expect(page.getByTestId('place-search')).toHaveCount(0);
}

/** Waits until Leaflet has measured the panel and painted tiles into it. */
async function expectLiveMap(page: Page): Promise<void> {
  const root = page.getByTestId('map-root');
  await expect(root).toHaveAttribute('data-ready', 'true');
  await expect
    .poll(() => root.getAttribute('data-map-width').then((value) => Number(value ?? 0)))
    .toBeGreaterThan(0);
  await expect
    .poll(() => root.getAttribute('data-map-height').then((value) => Number(value ?? 0)))
    .toBeGreaterThan(0);
  await expect.poll(() => page.locator('.leaflet-tile').count()).toBeGreaterThan(0);
}

test('여행이 없으면 지도 탭이 여행 만들기로 안내한다', async ({ page }) => {
  await stubNetwork(page);
  await page.goto('/#/map');

  await expect(page.getByTestId('view-map')).toBeVisible();
  await expect(page.getByTestId('map-goto-trips')).toBeVisible();

  await page.getByTestId('map-goto-trips').click();
  await expect(page.getByTestId('view-trips')).toBeVisible();
});

test('위치가 없는 여행의 지도는 안내 카드를 띄운다', async ({ page }) => {
  await stubNetwork(page);
  await page.goto('/');
  await createTrip(page, '오사카 3박');
  await addCard(page, 4, '츠텐카쿠');

  await page.getByTestId('tab-map').click();
  await expect(page.getByTestId('view-map')).toBeVisible();
  await expectLiveMap(page);

  await expect(page.getByTestId('map-empty')).toContainText('카드에 위치를 추가하면');
  await expect(page.getByTestId('map-marker')).toHaveCount(0);
  await expect(page.getByTestId('map-legend')).toHaveCount(0);
});

test('카드에서 장소를 검색해 넣으면 지도에 핀이 선다', async ({ page }) => {
  await stubNetwork(page);
  await page.goto('/');
  await createTrip(page, '도쿄 5일');
  await addCard(page, 4, '시부야 스크램블');

  await openCard(page, '시부야 스크램블');
  // The search box opens pre-filled with the card's title.
  await openPlaceSearch(page);
  await expect(page.getByTestId('place-search-input')).toHaveValue('시부야 스크램블');
  await page.getByTestId('place-search-submit').click();
  await expect(page.getByTestId('place-search-result')).toHaveCount(2);
  await page.getByTestId('place-search-result').first().click();
  await expect(page.getByTestId('place-search')).toHaveCount(0);

  const address = page.getByTestId('card-location-address');
  await expect(address).toHaveAttribute('data-has-location', 'true');
  await expect(address).toContainText('시부야 스크램블 교차로');
  await expect(address).toHaveAttribute('data-lat', '35.6595');

  await page.getByTestId('card-submit').click();
  await expect(page.getByTestId('card-form')).toHaveCount(0);
  await expect(page.getByTestId('card-chip-location')).toContainText('시부야');

  await page.getByTestId('tab-map').click();
  await expect(page.getByTestId('view-map')).toBeVisible();
  await expectLiveMap(page);

  await expect(page.getByTestId('map-empty')).toHaveCount(0);
  await expect(page.getByTestId('map-marker')).toHaveCount(1);
  await expect(page.getByTestId('map-pin-count')).toHaveAttribute('data-count', '1');

  // One legend chip — the card's category — and it starts switched on.
  const chips = page.getByTestId('map-legend-chip');
  await expect(chips).toHaveCount(1);
  await expect(chips.first()).toHaveAttribute('data-active', 'true');
  await expect(chips.first()).toContainText('볼거리');

  await page.getByTestId('map-marker').click();
  await expect(page.getByTestId('map-popup')).toBeVisible();
  await expect(page.getByTestId('map-popup')).toContainText('시부야 스크램블');
  await expect(page.getByTestId('map-popup')).toContainText('교차로');
});

test('범례 칩으로 핀을 껐다 켤 수 있다', async ({ page }) => {
  await stubNetwork(page);
  await page.goto('/');
  await createTrip(page, '도쿄 5일');
  await addCard(page, 4, '시부야 스크램블');
  await openCard(page, '시부야 스크램블');
  await pickFirstSearchResult(page);
  await page.getByTestId('card-submit').click();

  await page.getByTestId('tab-map').click();
  await expectLiveMap(page);
  await expect(page.getByTestId('map-marker')).toHaveCount(1);

  const chip = page.getByTestId('map-legend-chip').first();
  await chip.click();
  await expect(chip).toHaveAttribute('data-active', 'false');
  await expect(page.getByTestId('map-marker')).toHaveCount(0);
  // Filtering hides pins; it does not empty the map.
  await expect(page.getByTestId('map-empty')).toHaveCount(0);

  await chip.click();
  await expect(chip).toHaveAttribute('data-active', 'true');
  await expect(page.getByTestId('map-marker')).toHaveCount(1);
});

test('보드↔지도를 두 번 오가도 지도가 회색이 되지 않는다', async ({ page }) => {
  await stubNetwork(page);
  await page.goto('/');
  await createTrip(page, '도쿄 5일');
  await addCard(page, 4, '시부야 스크램블');
  await openCard(page, '시부야 스크램블');
  await pickFirstSearchResult(page);
  await page.getByTestId('card-submit').click();

  for (let round = 0; round < 2; round += 1) {
    await page.getByTestId('tab-map').click();
    await expect(page.getByTestId('view-map')).toBeVisible();
    await expectLiveMap(page);
    await expect(page.getByTestId('map-marker')).toHaveCount(1);

    await page.getByTestId('tab-board').click();
    await expect(page.getByTestId('view-board')).toBeVisible();
    await expect(page.getByTestId('map-root')).toHaveCount(0);
  }

  await page.getByTestId('tab-map').click();
  await expectLiveMap(page);
});

test('팝업에서 보드로 건너가 편집하고, 지도에서 제거한다', async ({ page }) => {
  await stubNetwork(page);
  await page.goto('/');
  await createTrip(page, '도쿄 5일');
  await addCard(page, 4, '시부야 스크램블');
  await openCard(page, '시부야 스크램블');
  await pickFirstSearchResult(page);
  await page.getByTestId('card-submit').click();

  await page.getByTestId('tab-map').click();
  await expectLiveMap(page);
  await page.getByTestId('map-marker').click();

  // 「보드에서 편집」 hands the card over to the 보드 tab.
  await page.getByTestId('map-popup-edit').click();
  await expect(page).toHaveURL(/#\/board$/);
  await expect(page.getByTestId('card-form')).toBeVisible();
  await expect(page.getByTestId('card-title-input')).toHaveValue('시부야 스크램블');
  await page.getByTestId('sheet-close').click();
  await expect(page.getByTestId('card-form')).toHaveCount(0);

  // 「지도에서 제거」 clears the location and empties the map.
  await page.getByTestId('tab-map').click();
  await expectLiveMap(page);
  await page.getByTestId('map-marker').click();
  await page.getByTestId('map-popup-remove').click();

  await expect(page.getByTestId('map-marker')).toHaveCount(0);
  await expect(page.getByTestId('map-empty')).toBeVisible();
  await expect(page.getByTestId('map-legend')).toHaveCount(0);

  await page.getByTestId('tab-board').click();
  await expect(page.getByTestId('card-chip-location')).toHaveCount(0);
});

test('지도에서 직접 핀을 찍어 위치를 정한다', async ({ page }) => {
  await stubNetwork(page);
  await page.goto('/');
  await createTrip(page, '서울 나들이');
  await addCard(page, 4, '남산타워');

  await openCard(page, '남산타워');
  await page.getByTestId('card-location-pin').click();

  const picker = page.getByTestId('pin-picker');
  await expect(picker).toBeVisible();
  await expect(page.getByTestId('pin-picker-map')).toHaveAttribute('data-ready', 'true');
  // No location yet → the picker opens over Seoul.
  await expect(page.getByTestId('pin-picker-center')).toContainText('37.5665, 126.9780');

  await page.getByTestId('pin-picker-confirm').click();
  await expect(picker).toHaveCount(0);

  const address = page.getByTestId('card-location-address');
  await expect(address).toHaveAttribute('data-has-location', 'true');
  await expect(address).toHaveText('37.5665, 126.9780');

  await page.getByTestId('card-submit').click();
  await expect(page.getByTestId('card-chip-location')).toContainText('37.5665, 126.9780');

  await page.getByTestId('tab-map').click();
  await expectLiveMap(page);
  await expect(page.getByTestId('map-marker')).toHaveCount(1);
});

test('위치를 제거하면 카드에서 사라진다', async ({ page }) => {
  await stubNetwork(page);
  await page.goto('/');
  await createTrip(page, '도쿄 5일');
  await addCard(page, 4, '시부야 스크램블');
  await openCard(page, '시부야 스크램블');
  await pickFirstSearchResult(page);
  await page.getByTestId('card-submit').click();
  await expect(page.getByTestId('card-chip-location')).toBeVisible();

  await openCard(page, '시부야 스크램블');
  await page.getByTestId('card-location-clear').click();
  await expect(page.getByTestId('card-location-address')).toHaveText('없음');
  await page.getByTestId('card-submit').click();

  await expect(page.getByTestId('card-chip-location')).toHaveCount(0);
});

test('지도는 전체 동선으로 열리고, 일차를 고르면 그날만 남는다', async ({ page }) => {
  await stubNetwork(page);
  await page.goto('/');
  await createTrip(page, '도쿄 동선');
  await addCard(page, 4, '스크램블 교차로');
  await addCard(page, 4, '시부야역 앞');

  // The two stubbed hits sit ~150m apart — one card each.
  await openCard(page, '스크램블 교차로');
  await openPlaceSearch(page);
  await page.getByTestId('place-search-submit').click();
  await expect(page.getByTestId('place-search-result')).toHaveCount(2);
  await page.getByTestId('place-search-result').nth(0).click();
  await page.getByTestId('card-submit').click();

  await openCard(page, '시부야역 앞');
  await openPlaceSearch(page);
  await page.getByTestId('place-search-submit').click();
  await expect(page.getByTestId('place-search-result')).toHaveCount(2);
  await page.getByTestId('place-search-result').nth(1).click();
  await page.getByTestId('card-submit').click();

  // 1일차: both cards on it — 10:00 and 10:30, so the order is unambiguous.
  await page.getByTestId('tab-timeline').click();
  await page.getByTestId('timeline-add-day-empty').click();
  await expect(page.getByTestId('timeline-day')).toHaveCount(1);
  await page.getByTestId('timeline-add-day').click();
  await expect(page.getByTestId('timeline-day')).toHaveCount(2);

  for (const [title, nudges] of [
    ['스크램블 교차로', 0],
    ['시부야역 앞', 2],
  ] as const) {
    await page.getByTestId('tab-board').click();
    await openCard(page, title);
    await page.getByTestId('card-schedule').click();
    for (let i = 0; i < nudges; i += 1) await page.getByTestId('schedule-start-plus').click();
    await page.getByTestId('schedule-submit').click();
    await expect(page.getByTestId('schedule-sheet')).toHaveCount(0);
  }

  // 2일차: 시부야역 앞 once more, so the two days really do differ.
  await openCard(page, '시부야역 앞');
  await page.getByTestId('card-schedule').click();
  await page.getByTestId('schedule-day-option').nth(1).click();
  await page.getByTestId('schedule-submit').click();
  await expect(page.getByTestId('schedule-sheet')).toHaveCount(0);

  await page.getByTestId('tab-map').click();
  await expectLiveMap(page);
  await expect(page.getByTestId('map-marker')).toHaveCount(2);

  // M15 §3 — 지도는 「전체」로 열린다. M6에서는 경로가 꺼진 채 열렸고(사용자가
  // 칩 줄을 찾아 일자를 골라야 했다), 그 때문에 화살표를 본 적이 없다는 것이
  // 이번 피드백이었다. 이제 아무것도 누르지 않아도 동선이 그려져 있다.
  await expect(page.getByTestId('map-route-controls')).toBeVisible();
  await expect(page.getByTestId('map-route-sheet-select')).toBeVisible();
  await expect(page.getByTestId('map-route-all')).toHaveAttribute('data-active', 'true');
  await expect(page.getByTestId('map-route-off')).toHaveAttribute('data-active', 'false');
  await expect(page.getByTestId('route-stop')).toHaveCount(3);
  await expect(page.getByTestId('route-leg')).toHaveCount(1);
  // 전체 모드의 배지는 `일자-순번`이다.
  await expect(page.getByTestId('route-stop').first()).toHaveAttribute('data-order', '1');

  // 1일차 — 그날의 두 정거장과 그 사이 한 구간만.
  const dayChip = page.getByTestId('map-route-day').first();
  await dayChip.click();
  await expect(dayChip).toHaveAttribute('data-active', 'true');
  await expect(page.getByTestId('map-route-all')).toHaveAttribute('data-active', 'false');
  await expect(page.getByTestId('route-stop')).toHaveCount(2);
  await expect(page.getByTestId('route-leg')).toHaveCount(1);
  await expect(page.getByTestId('route-stop').first()).toHaveAttribute('data-order', '1');
  // The pins stay put underneath the numbered badges.
  await expect(page.getByTestId('map-marker')).toHaveCount(2);

  // 2일차 — 정거장 하나, 구간 없음. 그날에 없는 장소의 핀은 흐려진다.
  const secondDay = page.getByTestId('map-route-day').nth(1);
  await secondDay.click();
  await expect(page.getByTestId('route-stop')).toHaveCount(1);
  await expect(page.getByTestId('route-leg')).toHaveCount(0);
  await expect(page.locator('[data-testid="map-marker"][data-dimmed="true"]')).toHaveCount(1);

  // 끔 — 경로를 통째로 감춘다. (M6에서는 전체 칩을 한 번 더 눌러 껐다.)
  await page.getByTestId('map-route-off').click();
  await expect(page.getByTestId('route-stop')).toHaveCount(0);
  await expect(page.getByTestId('route-leg')).toHaveCount(0);
  await expect(page.locator('[data-testid="map-marker"][data-dimmed="true"]')).toHaveCount(0);

  // 마지막 선택은 이 기기에 남는다 — 새로고침해도 꺼진 채로 열린다.
  await waitForPersisted(page, '시부야역 앞');
  await page.reload();
  await expect(page.getByTestId('tab-bar')).toBeVisible();
  await expectLiveMap(page);
  await expect(page.getByTestId('map-route-off')).toHaveAttribute('data-active', 'true');
  await expect(page.getByTestId('route-stop')).toHaveCount(0);

  await page.getByTestId('map-route-all').click();
  await expect(page.getByTestId('route-stop')).toHaveCount(3);
  await page.reload();
  await expect(page.getByTestId('tab-bar')).toBeVisible();
  await expectLiveMap(page);
  await expect(page.getByTestId('map-route-all')).toHaveAttribute('data-active', 'true');
  await expect(page.getByTestId('route-leg')).toHaveCount(1);
});

test('여행에 목적지를 정하면 지도가 그 근처에서 열린다', async ({ page }) => {
  await stubNetworkByQuery(page);
  await page.goto('/');

  // 여행을 만들면서 목적지를 고른다.
  await page.getByTestId('add-trip').click();
  await page.getByTestId('trip-title-input').fill('가을 여행');
  await expect(page.getByTestId('trip-destination')).toHaveAttribute('data-has', 'false');
  await expect(page.getByTestId('trip-destination')).toHaveText('없음');
  await expect(page.getByTestId('trip-destination-clear')).toHaveCount(0);

  await page.getByTestId('trip-destination-search').click();
  await expect(page.getByTestId('place-search')).toBeVisible();
  await page.getByTestId('place-search-input').fill('일본 오사카');
  await page.getByTestId('place-search-submit').click();
  await expect(page.getByTestId('place-search-result')).toHaveCount(1);
  await page.getByTestId('place-search-result').first().click();
  await expect(page.getByTestId('place-search')).toHaveCount(0);

  const destination = page.getByTestId('trip-destination');
  await expect(destination).toHaveAttribute('data-has', 'true');
  await expect(destination).toHaveAttribute('data-lat', '34.69');
  await expect(destination).toHaveAttribute('data-lng', '135.5');
  // 칩은 첫 쉼표 앞만 보여준다.
  await expect(destination).toHaveText('오사카시');

  await page.getByTestId('trip-submit').click();
  await expect(page.getByTestId('trip-form')).toHaveCount(0);

  // 여행 카드의 둘째 줄이 목적지를 함께 말한다.
  const period = page.getByTestId('trip-card').filter({ hasText: '가을 여행' }).getByTestId('trip-period');
  await expect(period).toHaveAttribute('data-destination', 'true');
  await expect(period).toContainText('📍 오사카시');

  await page.getByTestId('trip-card').filter({ hasText: '가을 여행' }).getByTestId('trip-open').click();
  await expect(page).toHaveURL(/#\/board$/);

  // 핀이 하나도 없어도 지도는 오사카 위에서 열린다 (세계 지도가 아니라).
  await page.getByTestId('tab-map').click();
  await expectLiveMap(page);
  await expect(page.getByTestId('map-empty')).toBeVisible();
  await expect.poll(() => mapCenter(page)).toBe('34.7,135.5');

  // 핀을 찍을 때도 목적지에서 시작한다.
  await page.getByTestId('tab-board').click();
  await addCard(page, 4, '시부야 스크램블');
  await openCard(page, '시부야 스크램블');
  await page.getByTestId('card-location-pin').click();
  await expect(page.getByTestId('pin-picker-map')).toHaveAttribute('data-ready', 'true');
  await expect(page.getByTestId('pin-picker-center')).toContainText('34.69');
  await page.getByTestId('pin-picker-cancel').click();

  // 위치가 생기면 핀이 이긴다 — 지도는 시부야로 옮겨간다.
  await pickFirstSearchResult(page);
  await page.getByTestId('card-submit').click();
  await expect(page.getByTestId('card-form')).toHaveCount(0);

  await page.getByTestId('tab-map').click();
  await expectLiveMap(page);
  await expect(page.getByTestId('map-marker')).toHaveCount(1);
  await expect.poll(() => mapCenter(page)).toBe('35.7,139.7');
});

test('목적지를 지우면 여행 카드에서도 사라진다', async ({ page }) => {
  await stubNetworkByQuery(page);
  await page.goto('/');

  await page.getByTestId('add-trip').click();
  await page.getByTestId('trip-title-input').fill('오사카 3박');
  await page.getByTestId('trip-destination-search').click();
  // 검색창은 여행 이름으로 미리 채워져 있다.
  await expect(page.getByTestId('place-search-input')).toHaveValue('오사카 3박');
  await page.getByTestId('place-search-submit').click();
  await page.getByTestId('place-search-result').first().click();
  await page.getByTestId('trip-submit').click();

  const card = page.getByTestId('trip-card').filter({ hasText: '오사카 3박' });
  await expect(card.getByTestId('trip-period')).toContainText('📍 오사카시');

  // 수정 시트는 저장된 목적지를 그대로 들고 열린다.
  await card.getByTestId('trip-edit').click();
  await expect(page.getByTestId('trip-destination')).toHaveAttribute('data-lat', '34.69');
  await page.getByTestId('trip-destination-clear').click();
  await expect(page.getByTestId('trip-destination')).toHaveText('없음');
  await expect(page.getByTestId('trip-destination-clear')).toHaveCount(0);
  await page.getByTestId('trip-submit').click();
  await expect(page.getByTestId('trip-form')).toHaveCount(0);

  await expect(card.getByTestId('trip-period')).toHaveAttribute('data-destination', 'false');
  await expect(card.getByTestId('trip-period')).not.toContainText('📍');
});

test('검색이 실패하면 한국어 안내가 뜬다', async ({ page }) => {
  await page.route(/tile\.openstreetmap\.org/, (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: TILE_PNG }),
  );
  await page.route('**/nominatim.openstreetmap.org/**', (route) =>
    route.fulfill({ status: 503, contentType: 'text/plain', body: 'nope' }),
  );

  await page.goto('/');
  await createTrip(page, '도쿄 5일');
  await addCard(page, 4, '시부야 스크램블');
  await openCard(page, '시부야 스크램블');

  await page.getByTestId('card-location-search').click();
  await page.getByTestId('place-search-submit').click();

  await expect(page.getByTestId('place-search-error')).toContainText('잠시 후 다시 시도해 주세요');
  await expect(page.getByTestId('place-search-result')).toHaveCount(0);
  // The button rate-limits itself for 1.2s, then comes back.
  await expect(page.getByTestId('place-search-submit')).toBeEnabled({ timeout: 5_000 });
});

test('검색 결과가 없으면 그렇게 알려준다', async ({ page }) => {
  await stubNetwork(page, []);
  await page.goto('/');
  await createTrip(page, '도쿄 5일');
  await addCard(page, 4, '없는 장소');
  await openCard(page, '없는 장소');

  await page.getByTestId('card-location-search').click();
  await page.getByTestId('place-search-submit').click();

  await expect(page.getByTestId('place-search-empty')).toContainText('검색 결과가 없어요');
  await expect(page.getByTestId('card-location-address')).toHaveText('없음');
});

/**
 * 「위치 확인」 — 카드 안에서 핀을 눈으로 확인한다 (M35).
 *
 * 그전까지 카드가 위치에 대해 보여 주던 것은 주소 한 줄뿐이라, 그게 맞는지 보려면
 * 저장하고 지도 탭으로 건너가야 했다. 이 스펙이 지키는 것은 세 가지다: 위치가
 * 있을 때만 뜬다 · 지도가 실제로 그려진다 · 그 창은 카드를 바꾸지 않는다.
 */
test('카드 안에서 위치를 지도로 확인할 수 있다', async ({ page }) => {
  await stubNetwork(page);
  await page.goto('/');
  await createTrip(page, '도쿄 5일');
  await addCard(page, 4, '시부야 스크램블');
  await openCard(page, '시부야 스크램블');

  // 위치가 없는 동안에는 확인할 것도 없다.
  await expect(page.getByTestId('location-preview-open')).toHaveCount(0);

  await pickFirstSearchResult(page);
  await expect(page.getByTestId('location-preview-open')).toBeVisible();

  await page.getByTestId('location-preview-open').click();
  const preview = page.getByTestId('location-preview');
  await expect(preview).toBeVisible();

  // 시트 안의 지도도 제 크기를 재고 타일을 받아 온다.
  const map = page.getByTestId('location-preview-map');
  await expect(map).toHaveAttribute('data-ready', 'true');
  await expect(map).toHaveAttribute('data-lat', '35.6595');
  await expect.poll(() => preview.locator('.leaflet-tile').count()).toBeGreaterThan(0);

  // 카테고리 핀 하나. 지도 탭의 핀과 이름이 달라서 서로 세어지지 않는다.
  await expect(page.getByTestId('location-preview-pin')).toHaveCount(1);
  await expect(page.getByTestId('map-marker')).toHaveCount(0);

  await expect(page.getByTestId('location-preview-address')).toContainText(
    '시부야 스크램블 교차로',
  );
  await expect(page.getByTestId('location-preview-gmaps')).toHaveAttribute(
    'href',
    'https://www.google.com/maps/search/?api=1&query=35.6595,139.7005',
  );
  await expect(page.getByTestId('location-preview-gmaps')).toHaveAttribute('target', '_blank');
  await expect(page.getByTestId('location-preview-gmaps')).toHaveAttribute(
    'rel',
    'noopener noreferrer',
  );

  // 닫으면 카드 시트는 그대로 열려 있고, 위치도 그대로다 — 보기 전용이다.
  await page.getByTestId('map-modal-close').click();
  await expect(page.getByTestId('location-preview')).toHaveCount(0);
  await expect(page.getByTestId('card-form')).toBeVisible();
  await expect(page.getByTestId('card-location-address')).toHaveAttribute('data-lat', '35.6595');

  // 위치를 지우면 확인 버튼도 같이 사라진다.
  await page.getByTestId('card-location-clear').click();
  await expect(page.getByTestId('location-preview-open')).toHaveCount(0);
});

test('폰 폭에서도 위치 확인 시트가 넘치지 않는다', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await stubNetwork(page);
  await page.goto('/');
  await createTrip(page, '도쿄 5일');
  await addCard(page, 4, '시부야 스크램블');
  await openCard(page, '시부야 스크램블');
  await pickFirstSearchResult(page);

  await page.getByTestId('location-preview-open').click();
  await expect(page.getByTestId('location-preview-map')).toHaveAttribute('data-ready', 'true');

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  const box = await page.getByTestId('location-preview-map').boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeLessThanOrEqual(390);
  // 40vh — 손바닥 안에서도 한 블록이 보일 만큼은 된다.
  expect(box!.height).toBeGreaterThan(200);

  await expect(page.getByTestId('location-preview-gmaps')).toBeVisible();
});
