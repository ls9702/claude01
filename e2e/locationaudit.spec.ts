import { expect, test, type Page } from '@playwright/test';
import { startMockApi, type MockApi } from './mock-api';

/**
 * 위치 재정비 (M36) — 이미 저장된 핀들을 M35의 방식으로 다시 맞추기.
 *
 * 이 스펙이 지키는 것은 넷이다:
 *
 *  1. 입구는 **설정 시트의 맨 아래 링크 한 줄**이다. 지도 탭에는 아무것도 늘지
 *     않는다 — 사용자가 그렇게 요구했다.
 *  2. 훑기는 카드마다 AI에 한 번 묻고, 그 현지 표기로 Nominatim에 되물어 좌표를
 *     확인한다(M35의 길 그대로). 200m 어긋난 카드만 목록에 서고, 3m 차이는
 *     「이미 제자리」, AI가 못 찾은 카드는 「제안 없음」으로 아래에 접힌다.
 *  3. 「선택 적용」을 눌러야만 카드가 바뀐다. 바뀌는 것은 좌표뿐이고, 되돌리기는
 *     한 번에 전부다.
 *  4. AI가 꺼져 있으면 줄은 눌리지 않고 **이유를 말한다**.
 *
 * 네트워크는 양쪽 다 가짜다: Gemini 자리에는 `mock-api.ts`가, Nominatim 자리에는
 * 검색어별로 답이 다른 라우트 스텁이 앉는다.
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

/* ------------------------------------------------------------------ *
 * 가짜 세계
 * ------------------------------------------------------------------ */

/**
 * 카드 세 장의 이야기.
 *
 * - **히요리 호텔**: 저장된 자리가 200m 남쪽이다 — 이 도구가 존재하는 이유.
 * - **통천각**: 3m 차이. 옮길 이유가 없다.
 * - **글리코상**: AI가 못 찾는다. 제안이 없으면 아무 일도 일어나지 않는다.
 */
const SEED = {
  hotel: { lat: '34.6500', lon: '135.5004', name: '히요리 호텔, 나니와구, 오사카시, 일본' },
  tower: { lat: '34.6525', lon: '135.5063', name: '통천각, 나니와구, 오사카시, 일본' },
  sign: { lat: '34.6687', lon: '135.5013', name: '글리코 간판, 도톤보리, 오사카시, 일본' },
} as const;

/** 현지 표기로 되물었을 때 Nominatim이 주는 「진짜」 자리. */
const CONFIRMED = {
  // 저장된 자리에서 정북 200m.
  hotel: { lat: '34.6518', lon: '135.5004', name: '日和ホテル, 나니와구, 오사카시, 일본' },
  // 저장된 자리에서 3m — 30m 문턱 아래다.
  tower: { lat: '34.65252', lon: '135.50632', name: '通天閣, 나니와구, 오사카시, 일본' },
} as const;

const place = (row: { lat: string; lon: string; name: string }, id: number) => [
  { place_id: id, lat: row.lat, lon: row.lon, display_name: row.name },
];

/** A transparent 1×1 png — enough for Leaflet to count as a loaded tile. */
const TILE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** How many Nominatim searches the page has made since the last reset. */
let osmHits = 0;

/**
 * 검색어에 따라 답이 다른 Nominatim.
 *
 * 한국어 이름은 **저장할 때** 쓴 자리를 주고, 현지 표기는 **재정비가 찾아낼**
 * 자리를 준다. 이 두 답이 다른 것이 이 기능 전체의 전제다.
 */
async function stubNetwork(page: Page): Promise<void> {
  osmHits = 0;
  await page.route('**/nominatim.openstreetmap.org/**', (route) => {
    osmHits += 1;
    const query = new URL(route.request().url()).searchParams.get('q') ?? '';

    const body = query.includes('日和ホテル')
      ? place(CONFIRMED.hotel, 31)
      : query.includes('通天閣')
        ? place(CONFIRMED.tower, 32)
        : query.includes('히요리 호텔')
          ? place(SEED.hotel, 41)
          : query.includes('통천각')
            ? place(SEED.tower, 42)
            : query.includes('글리코상')
              ? place(SEED.sign, 43)
              : [];

    void route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
  await page.route(/tile\.openstreetmap\.org/, (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: TILE_PNG }),
  );
}

/** 카드별로 다른 AI 답 — 세 장이 서로 다른 결말을 갖게 하는 장치. */
function stubAi(): void {
  api.setAiPlacesFor('찾는 장소: 히요리 호텔', {
    places: [
      { name: '히요리 호텔', localName: '日和ホテル', locality: '오사카', lat: 34.652, lng: 135.501 },
    ],
  });
  api.setAiPlacesFor('찾는 장소: 통천각', {
    places: [{ name: '통천각', localName: '通天閣', locality: '오사카', lat: 34.653, lng: 135.507 }],
  });
  // 모델이 모르는 이름. 대량 훑기는 grounding 재시도를 붙이지 않으므로 여기서 끝난다.
  api.setAiPlacesFor('찾는 장소: 글리코상', 'empty');
}

/* ------------------------------------------------------------------ *
 * 앱 조작
 * ------------------------------------------------------------------ */

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

async function enableAi(page: Page): Promise<void> {
  await page.getByTestId('sync-chip').click();
  await page.getByTestId('ai-toggle').click();
  await expect(page.getByTestId('ai-status')).toHaveAttribute('data-state', 'ready');
  await page.getByTestId('sheet-close').click();
  await expect(page.getByTestId('sync-settings')).toHaveCount(0);
}

async function createTrip(page: Page, title: string): Promise<void> {
  await page.getByTestId('add-trip').click();
  await page.getByTestId('trip-title-input').fill(title);
  await page.getByTestId('trip-submit').click();
  await expect(page.getByTestId('trip-form')).toHaveCount(0);
  await page.getByTestId('trip-card').filter({ hasText: title }).getByTestId('trip-open').click();
  await expect(page).toHaveURL(/#\/board$/);
}

/**
 * 위치까지 붙은 카드 한 장 — **AI를 켜기 전에** 만든다.
 *
 * 그래야 저장되는 좌표가 M35 이전과 똑같은 성질을 갖는다: Nominatim이 한국어
 * 이름으로 준 대략의 자리이고, 현지 표기로 되묻는 단계를 거치지 않았다. 재정비가
 * 고쳐야 할 것이 정확히 이런 핀이다.
 */
async function seedCard(page: Page, title: string): Promise<void> {
  await page.getByTestId('board-column').nth(4).getByTestId('add-card').click();
  await page.getByTestId('card-title-input').fill(title);
  await page.getByTestId('card-location-search').click();
  await expect(page.getByTestId('place-search')).toBeVisible();
  await expect(page.getByTestId('place-search-input')).toHaveValue(title);
  await page.getByTestId('place-search-submit').click();
  await page.getByTestId('place-search-result').first().click();
  await expect(page.getByTestId('place-search')).toHaveCount(0);
  await page.getByTestId('card-submit').click();
  await expect(page.getByTestId('card-form')).toHaveCount(0);
}

/** 설정 시트를 열고 「위치 재정비」까지 들어간다. */
async function openAudit(page: Page): Promise<void> {
  await page.getByTestId('sync-chip').click();
  await expect(page.getByTestId('sync-settings')).toBeVisible();
  await expect(page.getByTestId('location-audit-note')).toHaveAttribute('data-state', 'ready');
  await page.getByTestId('location-audit-open').click();
  await expect(page.getByTestId('location-audit')).toBeVisible();
}

/** 카드에 지금 저장돼 있는 좌표. */
async function storedCoords(page: Page, title: string): Promise<{ lat: string; lng: string }> {
  await page.getByTestId('board-card').filter({ hasText: title }).click();
  await expect(page.getByTestId('card-form')).toBeVisible();
  const address = page.getByTestId('card-location-address');
  const lat = (await address.getAttribute('data-lat')) ?? '';
  const lng = (await address.getAttribute('data-lng')) ?? '';
  await page.getByTestId('sheet-close').click();
  await expect(page.getByTestId('card-form')).toHaveCount(0);
  return { lat, lng };
}

/** 여행 하나 + 카드 셋 + AI 켜짐 — 재정비를 돌릴 수 있는 상태까지. */
async function setUpTrip(page: Page): Promise<void> {
  await stubNetwork(page);
  await page.goto('/');
  await expect(page.getByTestId('tab-bar')).toBeVisible();

  await createTrip(page, '오사카 3박');
  await configureSync(page);

  await seedCard(page, '히요리 호텔');
  await seedCard(page, '통천각');
  await seedCard(page, '글리코상');

  await enableAi(page);
  stubAi();
}

/* ------------------------------------------------------------------ *
 * 본편
 * ------------------------------------------------------------------ */

test('설정의 「위치 재정비」가 저장된 핀을 훑고, 고른 것만 옮긴다', async ({ page }) => {
  await setUpTrip(page);

  // 저장된 자리는 한국어 이름으로 찾은 대략의 자리다.
  expect(await storedCoords(page, '히요리 호텔')).toEqual({ lat: '34.65', lng: '135.5004' });

  const seedOsmHits = osmHits;
  await openAudit(page);

  await expect(page.getByTestId('location-audit-intro')).toHaveAttribute('data-total', '3');
  await page.getByTestId('location-audit-start').click();

  // 훑기가 끝나면 요약 한 줄 — 세 장을 보고 한 장을 골랐다.
  const summary = page.getByTestId('location-audit-summary');
  await expect(summary).toBeVisible();
  await expect(summary).toHaveAttribute('data-scanned', '3');
  await expect(summary).toHaveAttribute('data-movable', '1');
  await expect(summary).toContainText('옮길 만한 곳 1곳');

  // 목록에 서는 것은 200m 어긋난 그 한 장뿐이고, 켜진 채로 등장한다.
  const rows = page.getByTestId('location-audit-row');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('히요리 호텔');
  await expect(rows.first()).toHaveAttribute('data-checked', 'true');
  await expect(page.getByTestId('location-audit-distance')).toHaveText('200m');

  // 나머지 둘은 왜 그대로 두는지를 말하며 아래에 접힌다.
  await expect(page.getByTestId('location-audit-skipped')).toHaveAttribute('data-count', '2');
  const skipped = page.getByTestId('location-audit-skip');
  await expect(skipped).toHaveCount(2);
  await expect(skipped.filter({ hasText: '통천각' })).toHaveAttribute('data-status', 'near');
  await expect(skipped.filter({ hasText: '통천각' })).toContainText('이미 제자리');
  await expect(skipped.filter({ hasText: '글리코상' })).toHaveAttribute('data-status', 'missing');
  await expect(skipped.filter({ hasText: '글리코상' })).toContainText('제안 없음');

  // 요청은 카드마다 딱 한 번씩. grounding 재시도는 대량 훑기에서 붙이지 않는다.
  const calls = api.aiCalls();
  expect(calls).toHaveLength(3);
  expect(calls.every((call) => call.grounding === undefined)).toBe(true);
  expect(calls[0].prompt).toContain('찾는 장소: 히요리 호텔');
  // 카드에 이미 붙어 있던 주소가 문맥으로 실려 간다 — 히요리 호텔은 여럿 있다.
  expect(calls[0].prompt).toContain('여행지: 히요리 호텔, 나니와구, 오사카시, 일본');
  // 좌표 확인에 쓴 Nominatim 요청은 후보를 낸 두 장에 한 번씩.
  expect(osmHits - seedOsmHits).toBe(2);

  // 적용하기 전까지는 아무것도 바뀌지 않았다.
  await expect(page.getByTestId('location-audit-apply')).toHaveAttribute('data-count', '1');
  await page.getByTestId('location-audit-apply').click();
  await expect(page.getByTestId('location-audit')).toHaveCount(0);

  // 되돌리기는 배치 하나를 통째로 — 「1곳」이라고 말한다.
  await expect(page.getByTestId('undo-message')).toHaveText('위치 1곳 재정비됨');

  await page.getByTestId('sheet-close').click();
  await expect(page.getByTestId('sync-settings')).toHaveCount(0);

  // 바뀐 것은 좌표뿐이고, 옮기지 않기로 한 카드는 그대로다.
  expect(await storedCoords(page, '히요리 호텔')).toEqual({ lat: '34.6518', lng: '135.5004' });
  expect(await storedCoords(page, '통천각')).toEqual({ lat: '34.6525', lng: '135.5063' });
});

test('실행 취소 한 번이 배치 전체를 되돌린다', async ({ page }) => {
  await setUpTrip(page);
  await openAudit(page);
  await page.getByTestId('location-audit-start').click();
  await expect(page.getByTestId('location-audit-summary')).toHaveAttribute('data-movable', '1');
  await page.getByTestId('location-audit-apply').click();

  await expect(page.getByTestId('undo-message')).toHaveText('위치 1곳 재정비됨');
  await page.getByTestId('undo-action').click();
  await expect(page.getByTestId('undo-toast')).toHaveCount(0);

  await page.getByTestId('sheet-close').click();
  await expect(page.getByTestId('sync-settings')).toHaveCount(0);
  // 원래 자리로 정확히 돌아왔다 — 주소도 좌표도 적용 전 그대로다.
  expect(await storedCoords(page, '히요리 호텔')).toEqual({ lat: '34.65', lng: '135.5004' });
});

test('한 번 정리한 뒤에 다시 열면 옮길 곳이 없다고 말한다', async ({ page }) => {
  await setUpTrip(page);

  await openAudit(page);
  await page.getByTestId('location-audit-start').click();
  await expect(page.getByTestId('location-audit-summary')).toHaveAttribute('data-movable', '1');
  await page.getByTestId('location-audit-apply').click();
  await expect(page.getByTestId('location-audit')).toHaveCount(0);

  // 같은 설정 시트에서 곧바로 한 번 더 — 재실행 가능한 도구다.
  await page.getByTestId('location-audit-open').click();
  await expect(page.getByTestId('location-audit')).toBeVisible();
  await page.getByTestId('location-audit-start').click();

  const summary = page.getByTestId('location-audit-summary');
  await expect(summary).toHaveAttribute('data-movable', '0');
  await expect(summary).toContainText('이미 정리돼 있어요');
  await expect(page.getByTestId('location-audit-row')).toHaveCount(0);
  await expect(page.getByTestId('location-audit-skipped')).toHaveAttribute('data-count', '3');
  // 옮길 것이 없으면 적용 버튼도 눌리지 않는다.
  await expect(page.getByTestId('location-audit-apply')).toBeDisabled();
});

test('훑는 도중에 중단해도 그때까지의 결과는 남는다', async ({ page }) => {
  await setUpTrip(page);

  // 두 번째 카드의 AI 응답을 3초 붙잡아 둔다. 「훑는 도중」을 시험하려면 그런
  // 순간이 실제로 존재해야 하는데, 목은 너무 빨라서 세 장이 눈 깜짝할 새 끝난다.
  await page.route('**/ai.php', async (route) => {
    if ((route.request().postData() ?? '').includes('통천각')) {
      await new Promise((resolve) => setTimeout(resolve, 3_000));
    }
    await route.continue();
  });

  await openAudit(page);
  await page.getByTestId('location-audit-start').click();

  // 첫 카드가 끝난 자리에서 멈춘다.
  const progress = page.getByTestId('location-audit-progress');
  await expect(progress).toHaveAttribute('data-total', '3');
  await expect(progress).toHaveAttribute('data-done', '1');
  await page.getByTestId('location-audit-stop').click();
  await expect(page.getByTestId('location-audit-stop')).toHaveText('멈추는 중…');

  const summary = page.getByTestId('location-audit-summary');
  await expect(summary).toBeVisible();
  // 세 장을 다 보지는 못했지만, 본 만큼은 목록에 그대로 있다.
  await expect(summary).toHaveAttribute('data-scanned', '1');
  await expect(page.getByTestId('location-audit-row')).toHaveCount(1);
  await expect(page.getByTestId('location-audit-row').first()).toContainText('히요리 호텔');
  await expect(page.getByTestId('location-audit-partial')).toBeVisible();
  // 남은 두 장은 아예 물어보지 않았다.
  expect(api.aiCalls()).toHaveLength(2);
});

test('AI가 꺼져 있으면 줄이 눌리지 않고 이유를 말한다', async ({ page }) => {
  await stubNetwork(page);
  await page.goto('/');
  await expect(page.getByTestId('tab-bar')).toBeVisible();

  await createTrip(page, '오사카 3박');
  await configureSync(page);
  await seedCard(page, '히요리 호텔');

  await page.getByTestId('sync-chip').click();
  await expect(page.getByTestId('location-audit-note')).toHaveAttribute('data-state', 'ai-off');
  await expect(page.getByTestId('location-audit-note')).toHaveText('AI 도우미를 켜야 쓸 수 있어요');

  const open = page.getByTestId('location-audit-open');
  await expect(open).toBeDisabled();
  await open.click({ force: true });
  await expect(page.getByTestId('location-audit')).toHaveCount(0);
  expect(api.aiCalls()).toHaveLength(0);
});

test('여행을 열기 전에는 훑을 것이 없다고 말한다', async ({ page }) => {
  await stubNetwork(page);
  await page.goto('/');
  await expect(page.getByTestId('tab-bar')).toBeVisible();

  await configureSync(page);
  await enableAi(page);

  await page.getByTestId('sync-chip').click();
  await expect(page.getByTestId('location-audit-note')).toHaveAttribute('data-state', 'no-trip');
  await expect(page.getByTestId('location-audit-open')).toBeDisabled();
});

test.describe('모바일', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('390px에서도 시트가 넘치지 않고 줄이 44px을 지킨다', async ({ page }) => {
    await setUpTrip(page);
    await openAudit(page);
    await page.getByTestId('location-audit-start').click();
    await expect(page.getByTestId('location-audit-summary')).toBeVisible();

    // 가로 스크롤이 생기지 않는다.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    const row = page.getByTestId('location-audit-row').first();
    const box = await row.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.width ?? 0).toBeLessThanOrEqual(390);

    // 접힌 줄도 같은 바닥을 지킨다.
    const skip = await page.getByTestId('location-audit-skip').first().boundingBox();
    expect(skip?.height ?? 0).toBeGreaterThanOrEqual(44);
  });
});
