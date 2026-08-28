import { expect, test, type Page } from '@playwright/test';
import { installFakeGoogle, type FakeGoogleState } from './fake-google';

/**
 * 내 위치 — M42.
 *
 * 브라우저의 위치는 Playwright가 통째로 흉내 낼 수 있다(`context.setGeolocation`
 * + 권한). 그래서 여기서는 **가짜가 필요 없다**: 앱은 진짜 `watchPosition`을
 * 부르고, 컨텍스트가 준비해 둔 좌표를 받는다. 구글 갈래만 지도 자체가 가짜다
 * (`e2e/fake-google.ts` — 이유는 그 파일).
 *
 * 이 스펙이 못박는 것:
 *
 * 1. 한 번 누르면 파란 점이 서고 지도가 그리로 간다. 다시 누르면 사라진다.
 * 2. 권한이 없으면 모달이 아니라 **한 줄**이 뜬다.
 * 3. 구글 지도에서도 같은 버튼이 같은 자리에서 같은 일을 한다.
 * 4. 390px에서 손가락이 닿는다.
 */

/**
 * 오사카 난바 한복판 — 이 스펙의 「지금 내가 있는 곳」.
 *
 * `accuracy`를 주는 이유: Playwright의 기본값은 0이고, 정확도 0은 「모른다」라
 * 앱이 원을 그리지 않는다(그리면 반경 0짜리 점이 하나 더 생길 뿐이다).
 */
const HERE = { latitude: 34.6659, longitude: 135.5013, accuracy: 30 };

/** 카드가 든 좌표 — 「내 위치」와 몇 백 m 떨어진 자리. */
const CARD_POINT = { lat: 34.6725, lng: 135.5031 };

/** A transparent 1×1 png — enough for Leaflet to count as a loaded tile. */
const TILE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const GMAPS_KEY_STORAGE = 'trip-board/gmaps-key';

/** 가짜가 받아 적은 호출들. */
const readFake = (page: Page): Promise<FakeGoogleState> =>
  page.evaluate(
    () =>
      (window as unknown as { __tripBoardFakeGoogle: { state: FakeGoogleState } })
        .__tripBoardFakeGoogle.state,
  ) as Promise<FakeGoogleState>;

async function stubNetwork(page: Page): Promise<void> {
  await page.route(/tile\.openstreetmap\.org/, (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: TILE_PNG }),
  );
  await page.route('**/nominatim.openstreetmap.org/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
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

/** 좌표를 든 카드 한 장 — M37의 「좌표 붙여넣기」라 네트워크가 필요 없다. */
async function addLocatedCard(
  page: Page,
  title: string,
  point: { lat: number; lng: number },
): Promise<void> {
  await page.getByTestId('board-column').nth(2).getByTestId('add-card').click();
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

/** 지도 탭을 연다. */
async function openMap(page: Page): Promise<void> {
  await page.getByTestId('tab-map').click();
  await expect(page.getByTestId('view-map')).toBeVisible();
  await expect(page.getByTestId('map-root')).toHaveAttribute('data-ready', 'true');
}

/* ------------------------------------------------------------------ *
 * 1. Leaflet — 켜고, 따라가고, 끈다
 * ------------------------------------------------------------------ */

test.describe('권한이 있는 기기', () => {
  test.use({
    viewport: { width: 1280, height: 800 },
    permissions: ['geolocation'],
    geolocation: HERE,
  });

  test('버튼 한 번에 파란 점이 서고 지도가 그리로 간다', async ({ page }) => {
    await stubNetwork(page);
    await page.goto('/');
    await createTrip(page, '오사카 내위치');
    await addLocatedCard(page, '츠텐카쿠', CARD_POINT);
    await openMap(page);

    const button = page.getByTestId('map-locate');
    await expect(button).toBeVisible();
    await expect(button).toHaveAttribute('data-active', 'false');
    // 누르기 전에는 점도 안내도 없다.
    await expect(page.getByTestId('map-my-location')).toHaveCount(0);

    await button.click();
    await expect(button).toHaveAttribute('data-active', 'true');
    await expect(page.getByTestId('map-my-location')).toHaveCount(1);
    await expect(page.getByTestId('map-locate-error')).toHaveCount(0);

    // 지도가 그 자리로 옮겨 갔다 — 카드가 아니라 나를 보고 있다.
    const root = page.getByTestId('map-root');
    await expect(root).toHaveAttribute('data-center-lat', HERE.latitude.toFixed(3));
    await expect(root).toHaveAttribute('data-center-lng', HERE.longitude.toFixed(3));

    // 다시 누르면 점도 감시도 사라진다.
    await button.click();
    await expect(button).toHaveAttribute('data-active', 'false');
    await expect(page.getByTestId('map-my-location')).toHaveCount(0);
  });

  test('지도를 떠났다 오면 꺼진 채로 시작한다', async ({ page }) => {
    await stubNetwork(page);
    await page.goto('/');
    await createTrip(page, '오사카 내위치');
    await addLocatedCard(page, '츠텐카쿠', CARD_POINT);
    await openMap(page);

    await page.getByTestId('map-locate').click();
    await expect(page.getByTestId('map-my-location')).toHaveCount(1);

    await page.getByTestId('tab-board').click();
    await expect(page.getByTestId('view-board')).toBeVisible();
    await openMap(page);

    // 감시는 지도와 함께 끝난다 — 돌아온 화면은 처음처럼 조용하다.
    await expect(page.getByTestId('map-locate')).toHaveAttribute('data-active', 'false');
    await expect(page.getByTestId('map-my-location')).toHaveCount(0);
  });

  test('구글 지도에서도 같은 버튼이 같은 일을 한다', async ({ page }) => {
    await stubNetwork(page);
    await page.addInitScript((key) => localStorage.setItem(key, 'test-gmaps-key'), GMAPS_KEY_STORAGE);
    await page.addInitScript(installFakeGoogle);
    await page.goto('/');

    await createTrip(page, '오사카 구글 내위치');
    await addLocatedCard(page, '츠텐카쿠', CARD_POINT);

    // 구글 시트 하나를 만들고 그 시트를 「일정 전체」로 본다.
    await page.getByTestId('tab-timeline').click();
    await page.getByTestId('sheet-add').click();
    await page.getByTestId('wizard-mode-days').click();
    await page.getByTestId('wizard-engine-google').click();
    await page.getByTestId('wizard-submit').click();
    await expect(page.getByTestId('sheet-wizard')).toHaveCount(0);

    await page.getByTestId('tab-map').click();
    await page.getByTestId('map-scope-sheet').click();
    await expect(page.getByTestId('google-map')).toHaveAttribute('data-status', 'ready');

    await page.getByTestId('map-locate').click();
    await expect(page.getByTestId('gmap-my-location')).toHaveCount(1);

    const state = await readFake(page);
    // 지도를 그 자리로 데려갔고, 정확도 원도 함께 섰다.
    expect(state.centers.length).toBeGreaterThan(0);
    const last = state.centers[state.centers.length - 1];
    expect(last.lat).toBeCloseTo(HERE.latitude, 4);
    expect(last.lng).toBeCloseTo(HERE.longitude, 4);
    expect(state.circles.length).toBeGreaterThan(0);
    expect(state.circles[state.circles.length - 1].radius).toBeGreaterThan(0);

    await page.getByTestId('map-locate').click();
    await expect(page.getByTestId('gmap-my-location')).toHaveCount(0);
  });
});

/* ------------------------------------------------------------------ *
 * 2. 390px
 * ------------------------------------------------------------------ */

test.describe('폰 화면', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    permissions: ['geolocation'],
    geolocation: HERE,
  });

  test('버튼이 화면 안에 있고 손가락이 닿는다', async ({ page }) => {
    await stubNetwork(page);
    await page.goto('/');
    await createTrip(page, '오사카 폰');
    await addLocatedCard(page, '츠텐카쿠', CARD_POINT);
    await openMap(page);

    const box = await page.getByTestId('map-locate').boundingBox();
    expect(box).toBeTruthy();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);

    await page.getByTestId('map-locate').click();
    await expect(page.getByTestId('map-my-location')).toHaveCount(1);

    // 가로 스크롤이 생기지 않는다.
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
  });
});

/* ------------------------------------------------------------------ *
 * 3. 거절당했을 때
 * ------------------------------------------------------------------ */

test.describe('권한이 없는 기기', () => {
  test.use({ viewport: { width: 1280, height: 800 }, permissions: [] });

  test('모달이 아니라 한 줄로 말하고, 지도는 그대로 있다', async ({ page }) => {
    await stubNetwork(page);
    await page.goto('/');
    await createTrip(page, '오사카 거절');
    await addLocatedCard(page, '츠텐카쿠', CARD_POINT);
    await openMap(page);

    await page.getByTestId('map-locate').click();

    const note = page.getByTestId('map-locate-error');
    await expect(note).toBeVisible();
    await expect(note).toHaveText('위치 권한이 꺼져 있어요');
    // 점은 서지 않고, 버튼은 눌린 모양으로 남지 않는다.
    await expect(page.getByTestId('map-my-location')).toHaveCount(0);
    await expect(page.getByTestId('map-locate')).toHaveAttribute('data-active', 'false');
    // 지도와 핀은 아무 일도 없었다는 듯 그대로다.
    await expect(page.getByTestId('map-marker')).toHaveCount(1);
  });
});
