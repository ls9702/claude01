import { expect, test, type Page } from '@playwright/test';
import { installFakeGoogle } from './fake-google';

/**
 * 우리 맛집 — M49.
 *
 * M43의 🍜가 「남이 추천해 준 곳」이라면 이 층은 「우리가 고른 곳」이다. 그래서
 * 구글에 물을 것이 하나도 없고, **두 지도 엔진 모두**에서 똑같이 뜬다.
 *
 * 이 스펙이 못박는 것:
 *
 * 1. 새 여행은 「맛집」 칸을 달고 태어나고, 장르 픽커는 **그 칸의 카드에만** 선다.
 * 2. 고른 장르는 카드에 이모지로 서고, 새로고침을 넘긴다. 다시 누르면 해제된다.
 * 3. ⭐ 토글을 켜면 맛집 칸의 **위치 있는 카드 전부**가 핀이 된다(배치 무관).
 *    핀에는 「내 맛집」 이름표가 붙고, 위치 없는 카드는 패널의 한 줄이 된다.
 * 4. 장르 칩이 핀을 거르고, 끄면 통째로 사라진다 — 카드 핀은 한 개도 안 흔들린다.
 * 5. 핀 팝업의 「보드에서 편집」이 그 카드를 연다.
 * 6. 구글 시트에서도 같은 층이 뜬다 — 🍜 **아래**에 서고, 두 층은 서로를 모른다.
 */

test.use({ viewport: { width: 1280, height: 800 } });

const GMAPS_KEY_STORAGE = 'trip-board/gmaps-key';

/** A transparent 1×1 png — enough for Leaflet to count as a loaded tile. */
const TILE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** 씨앗 칸에서 「맛집」의 자리 — 맨 뒤 (M49). */
const GOURMET_COLUMN = 5;
/** 「볼거리」 — 맛집이 아닌 칸의 대표. */
const PLAIN_COLUMN = 4;

async function stubTiles(page: Page): Promise<void> {
  await page.route(/tile\.openstreetmap\.org/, (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: TILE_PNG }),
  );
  await page.route('**/nominatim.openstreetmap.org/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
}

async function createTrip(page: Page, title: string): Promise<void> {
  await page.getByTestId('add-trip').click();
  await page.getByTestId('trip-title-input').fill(title);
  await page.getByTestId('trip-submit').click();
  await expect(page.getByTestId('trip-form')).toHaveCount(0);
  await page.getByTestId('trip-card').filter({ hasText: title }).getByTestId('trip-open').click();
  await expect(page).toHaveURL(/#\/board$/);
}

/** 카드 하나 — 좌표와 장르는 있으면 넣는다. */
async function addCard(
  page: Page,
  columnIndex: number,
  title: string,
  options: { point?: { lat: number; lng: number }; genre?: string } = {},
): Promise<void> {
  await page.getByTestId('board-column').nth(columnIndex).getByTestId('add-card').click();
  await page.getByTestId('card-title-input').fill(title);
  if (options.point) {
    await page.getByTestId('card-location-search').click();
    await expect(page.getByTestId('place-search')).toBeVisible();
    // 좌표 붙여넣기 (M37) — 네트워크를 한 번도 타지 않는 길.
    await page
      .getByTestId('place-search-input')
      .fill(`${options.point.lat}, ${options.point.lng}`);
    await page.getByTestId('place-search-coord').click();
    await expect(page.getByTestId('place-search')).toHaveCount(0);
  }
  if (options.genre) {
    await page
      .locator(`[data-testid="card-genre-chip"][data-genre="${options.genre}"]`)
      .click();
  }
  await page.getByTestId('card-submit').click();
  await expect(page.getByTestId('card-form')).toHaveCount(0);
}

/** 지도 탭을 열고 Leaflet이 실제로 그려질 때까지 기다린다. */
async function openMap(page: Page): Promise<void> {
  await page.getByTestId('tab-map').click();
  await expect(page.getByTestId('view-map')).toBeVisible();
  await expect(page.getByTestId('map-root')).toHaveAttribute('data-ready', 'true');
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

/* ------------------------------------------------------------------ *
 * 1. 상설 「맛집」 칸과 장르 픽커
 * ------------------------------------------------------------------ */

test('새 여행은 「맛집」 칸을 달고 태어나고, 장르 픽커는 그 칸에만 선다', async ({ page }) => {
  await stubTiles(page);
  await page.goto('/');
  await createTrip(page, '오사카 맛집투어');

  const columns = page.getByTestId('board-column');
  await expect(columns).toHaveCount(6);
  await expect(columns.nth(GOURMET_COLUMN)).toContainText('맛집');

  // 맛집 칸의 새 카드에는 여덟 개의 장르 칩이 선다.
  await columns.nth(GOURMET_COLUMN).getByTestId('add-card').click();
  await expect(page.getByTestId('card-genre-row')).toBeVisible();
  await expect(page.getByTestId('card-genre-chip')).toHaveCount(8);
  await page.getByTestId('sheet-close').click();
  await expect(page.getByTestId('card-form')).toHaveCount(0);

  // 평범한 칸에는 그 줄이 아예 없다.
  await columns.nth(PLAIN_COLUMN).getByTestId('add-card').click();
  await expect(page.getByTestId('card-genre-row')).toHaveCount(0);
});

test('고른 장르는 카드에 이모지로 서고 새로고침을 넘긴다 — 다시 누르면 해제된다', async ({
  page,
}) => {
  await stubTiles(page);
  await page.goto('/');
  await createTrip(page, '교토 맛집');

  await addCard(page, GOURMET_COLUMN, '이치란', { genre: 'ramen' });

  const mark = page.getByTestId('card-genre-mark');
  await expect(mark).toHaveAttribute('data-genre', 'ramen');
  await expect(mark).toContainText('🍜');

  await waitForPersisted(page, '"gourmetGenre":"ramen"');
  await page.reload();
  await expect(page.getByTestId('card-genre-mark')).toHaveAttribute('data-genre', 'ramen');

  // 시트를 다시 열면 그 칩이 눌린 채다.
  await page.getByTestId('board-card').filter({ hasText: '이치란' }).click();
  const ramen = page.locator('[data-testid="card-genre-chip"][data-genre="ramen"]');
  await expect(ramen).toHaveAttribute('data-active', 'true');

  // 같은 칩을 다시 누르면 해제된다 — 「없음」 버튼을 따로 두지 않는 이유다.
  await ramen.click();
  await expect(ramen).toHaveAttribute('data-active', 'false');
  await page.getByTestId('card-submit').click();
  await expect(page.getByTestId('card-form')).toHaveCount(0);
  await expect(page.getByTestId('card-genre-mark')).toHaveCount(0);
});

/* ------------------------------------------------------------------ *
 * 2. 지도 — OSM 시트
 * ------------------------------------------------------------------ */

test('⭐를 켜면 맛집 카드가 「내 맛집」 핀으로 서고, 장르 칩이 거른다 (OSM)', async ({
  page,
}) => {
  await stubTiles(page);
  await page.goto('/');
  await createTrip(page, '오사카 지도');

  await addCard(page, GOURMET_COLUMN, '이치란', {
    point: { lat: 34.6659, lng: 135.5013 },
    genre: 'ramen',
  });
  await addCard(page, GOURMET_COLUMN, '아라비야 커피', {
    point: { lat: 34.6702, lng: 135.5011 },
    genre: 'cafe',
  });
  // 위치가 없는 한 곳 — 핀이 될 수 없고, 패널의 한 줄이 된다.
  await addCard(page, GOURMET_COLUMN, '이름만 적어 둔 집');
  // 맛집 칸이 **아닌** 칸의 카드는 이 층과 무관하다.
  await addCard(page, PLAIN_COLUMN, '츠텐카쿠', { point: { lat: 34.6524, lng: 135.5063 } });

  await openMap(page);

  // 꺼져 있는 동안에는 아무것도 없다.
  const toggle = page.getByTestId('usergourmet-toggle');
  await expect(toggle).toHaveAttribute('data-active', 'false');
  await expect(page.getByTestId('usergourmet-pin')).toHaveCount(0);
  await expect(page.getByTestId('usergourmet-panel')).toHaveCount(0);
  // OSM 시트에는 M43의 🍜이 아예 없으므로 ⭐이 그 자리에 선다.
  await expect(page.getByTestId('gourmet-toggle')).toHaveCount(0);
  await expect(toggle).toHaveCSS('top', '88px');

  const cardPins = await page.getByTestId('map-marker').count();
  await toggle.click();
  await expect(toggle).toHaveAttribute('data-active', 'true');

  // 배치는 하나도 안 했는데 둘 다 섰다.
  await expect(page.getByTestId('usergourmet-pin')).toHaveCount(2);
  await expect(page.getByTestId('usergourmet-pin-label').first()).toHaveText('내 맛집');
  // 카드 핀은 한 개도 흔들리지 않았다.
  await expect(page.getByTestId('map-marker')).toHaveCount(cardPins);

  const panel = page.getByTestId('usergourmet-panel');
  await expect(panel).toContainText('내 맛집 2곳');
  await expect(page.getByTestId('usergourmet-missing')).toHaveAttribute('data-count', '1');
  await expect(page.getByTestId('usergourmet-missing')).toContainText('위치 없는 1곳');

  // 장르 칩 여덟 + 「장르 없음」.
  await expect(panel.getByTestId('usergourmet-genre-chip')).toHaveCount(8);
  await expect(page.getByTestId('usergourmet-none-chip')).toHaveAttribute('data-active', 'true');

  // 라멘만 — 카페 핀이 사라진다.
  await panel.locator('[data-testid="usergourmet-genre-chip"][data-genre="ramen"]').click();
  await expect(page.getByTestId('usergourmet-pin')).toHaveCount(1);
  await expect(page.getByTestId('usergourmet-pin')).toHaveAttribute('data-genre', 'ramen');
  await expect(panel).toHaveAttribute('data-spot-count', '1');

  // 카페도 켜면 둘 다.
  await panel.locator('[data-testid="usergourmet-genre-chip"][data-genre="cafe"]').click();
  await expect(page.getByTestId('usergourmet-pin')).toHaveCount(2);

  // 끄면 통째로 사라진다 — 핀도, 패널도.
  await toggle.click();
  await expect(page.getByTestId('usergourmet-pin')).toHaveCount(0);
  await expect(page.getByTestId('usergourmet-panel')).toHaveCount(0);
  await expect(page.getByTestId('map-marker')).toHaveCount(cardPins);
});

test('핀 팝업이 장르·메모를 말하고 「보드에서 편집」으로 그 카드를 연다', async ({ page }) => {
  await stubTiles(page);
  await page.goto('/');
  await createTrip(page, '오사카 팝업');

  await addCard(page, GOURMET_COLUMN, '이치란', {
    point: { lat: 34.6659, lng: 135.5013 },
    genre: 'ramen',
  });
  await page.getByTestId('board-card').filter({ hasText: '이치란' }).click();
  await page.getByTestId('card-memo-input').fill('칸막이 1인석');
  await page.getByTestId('card-submit').click();
  await expect(page.getByTestId('card-form')).toHaveCount(0);

  await openMap(page);
  await page.getByTestId('usergourmet-toggle').click();
  await page.getByTestId('usergourmet-pin').first().click();

  const popup = page.getByTestId('usergourmet-popup');
  await expect(popup).toBeVisible();
  await expect(popup).toContainText('이치란');
  await expect(popup).toContainText('칸막이 1인석');
  await expect(page.getByTestId('usergourmet-popup-genre')).toContainText('라멘');
  // 「길찾기」는 M42의 그 링크 그대로.
  await expect(page.getByTestId('usergourmet-popup-directions')).toHaveAttribute(
    'href',
    /destination=34\.6659,135\.5013/,
  );
  // 팝업이 열려 있는 동안 패널은 물러난다 — 같은 자리에 두 장이 겹치지 않는다.
  await expect(page.getByTestId('usergourmet-panel')).toHaveCount(0);

  await page.getByTestId('usergourmet-popup-edit').click();
  await expect(page).toHaveURL(/#\/board$/);
  await expect(page.getByTestId('card-form')).toBeVisible();
  await expect(page.getByTestId('card-title-input')).toHaveValue('이치란');
});

/* ------------------------------------------------------------------ *
 * 3. 지도 — 구글 시트
 * ------------------------------------------------------------------ */

test('구글 시트에서는 🍜 아래에 서고, 같은 핀이 구글 지도 위에 뜬다', async ({ page }) => {
  await stubTiles(page);
  await page.addInitScript((key) => localStorage.setItem(key, 'test-gmaps-key'), GMAPS_KEY_STORAGE);
  await page.addInitScript(installFakeGoogle);
  await page.addInitScript(() => {
    const scope = window as unknown as Record<string, unknown>;
    scope.__tripBoardFakeGooglePlaces = [];
    // 조사 목록을 비워 둔다 — 이 스펙은 M43 층을 켜지 않는다.
    scope.__tripBoardGourmetEntries = [];
  });
  await page.goto('/');
  await expect(page.getByTestId('tab-bar')).toBeVisible();

  await createTrip(page, '오사카 구글');
  await addCard(page, GOURMET_COLUMN, '이치란', {
    point: { lat: 34.6659, lng: 135.5013 },
    genre: 'ramen',
  });

  // 구글 시트 하나를 만들고 그 일정표의 지도를 연다.
  await page.getByTestId('tab-timeline').click();
  await expect(page.getByTestId('view-timeline')).toBeVisible();
  await page.getByTestId('sheet-add').click();
  await expect(page.getByTestId('sheet-wizard')).toBeVisible();
  await page.getByTestId('wizard-mode-days').click();
  await page.getByTestId('wizard-engine-google').click();
  await page.getByTestId('wizard-submit').click();
  await expect(page.getByTestId('sheet-wizard')).toHaveCount(0);

  await page.getByTestId('tab-map').click();
  await expect(page.getByTestId('view-map')).toBeVisible();
  await page.getByTestId('map-scope-sheet').click();
  await expect(page.getByTestId('google-map')).toHaveAttribute('data-status', 'ready');

  // 두 토글이 한 줄에 세로로 선다: 🍜이 위(5.5rem), ⭐이 아래(8.75rem).
  await expect(page.getByTestId('gourmet-toggle')).toHaveCSS('top', '88px');
  const toggle = page.getByTestId('usergourmet-toggle');
  await expect(toggle).toHaveCSS('top', '140px');

  await toggle.click();
  await expect(page.getByTestId('usergourmet-pin')).toHaveCount(1);
  await expect(page.getByTestId('usergourmet-pin')).toHaveAttribute('data-genre', 'ramen');
  await expect(page.getByTestId('usergourmet-pin-label')).toHaveText('내 맛집');
  // M43의 층은 켜지 않았다 — 두 층은 서로를 모른다.
  await expect(page.getByTestId('gourmet-pin')).toHaveCount(0);

  await page.getByTestId('usergourmet-pin').click();
  await expect(page.getByTestId('usergourmet-popup')).toContainText('이치란');
});

/* ------------------------------------------------------------------ *
 * 4. 폰 폭 — 390px 실측
 * ------------------------------------------------------------------ */

/**
 * 이 층의 자리를 정한 것은 이 시험이다.
 *
 * 위쪽 왼편에는 이제 버튼이 셋(전체화면·🍜·⭐) 서고 M43의 패널이 그 아래를
 * 통째로 쓴다. 390px에서 두 패널을 세로로 나란히 세울 자리는 없으므로, ⭐의
 * 패널은 지도의 **반대편 끝**(아래)에 산다. 여기서 확인하는 것은 그 배치가
 * 정말로 상자 안에 들어가는가와, 가로로 한 픽셀도 넘치지 않는가다.
 */
test.describe('폰 폭', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('패널이 지도 상자 안에 들어가고 가로로 넘치지 않는다', async ({ page }) => {
    await stubTiles(page);
    await page.goto('/');
    await createTrip(page, '폰 맛집');
    await addCard(page, GOURMET_COLUMN, '이치란', {
      point: { lat: 34.6659, lng: 135.5013 },
      genre: 'ramen',
    });

    await openMap(page);
    await page.getByTestId('usergourmet-toggle').click();

    const panel = page.getByTestId('usergourmet-panel');
    await expect(panel).toBeVisible();

    const mapBox = (await page.getByTestId('map-root').boundingBox())!;
    const panelBox = (await panel.boundingBox())!;
    // 상자 안에 들어간다 — 위로도, 아래로도 새지 않는다.
    expect(panelBox.y).toBeGreaterThanOrEqual(mapBox.y - 1);
    expect(panelBox.y + panelBox.height).toBeLessThanOrEqual(mapBox.y + mapBox.height + 1);
    expect(panelBox.x).toBeGreaterThanOrEqual(mapBox.x - 1);
    expect(panelBox.width).toBeLessThanOrEqual(mapBox.width + 1);

    // 페이지가 가로로 밀리지 않는다.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    // 접으면 알약 하나만 남고, 핀은 접힘과 상관없다 (M45의 그 계약).
    await page.getByTestId('usergourmet-panel-toggle').click();
    await expect(panel).toHaveAttribute('data-collapsed', 'true');
    await expect(page.getByTestId('usergourmet-genre-chip')).toHaveCount(0);
    await expect(page.getByTestId('usergourmet-pin')).toHaveCount(1);
  });
});
