import { expect, test, type Page } from '@playwright/test';
import { installFakeGoogle, type FakeGoogleState, type FakePlace } from './fake-google';

/**
 * 카드 위치 검색의 1순위가 구글이 됐다 — M44.
 *
 * 신고는 한 가게에서 왔다: *「마루하치 슈퍼 난바점」을 찾을 때마다 다른 자리에
 * 꽂힌다.* 원인은 M28~M37의 두 계단에 있던 구멍이다 — 모델은 이름을 잘 옮기지만
 * 좌표는 블록 단위로 흘리고(그래서 M35가 OSM에 되물어 조인다), **OSM 색인에 없는
 * 가게**는 그 조이기가 통째로 실패해 모델의 기억 좌표가 표시 없이 남는다.
 *
 * M41에서 들어온 구글 키가 그 색인을 연다. 그래서 계단이 셋이 됐고, 이 스펙이
 * 못박는 것은 그 순서다.
 *
 * 1. 키가 있으면 **구글에게 먼저** 묻고, AI·Nominatim에는 가지 않는다.
 * 2. 그 결과는 조이지 않고 그대로 카드에 저장된다 — 구글 좌표가 원본이다.
 * 3. 구글이 못 찾으면 조용히 다음 계단으로 내려가고, 한 줄로 그 사실을 말한다.
 * 4. **키가 없는 기기는 한 글자도 달라지지 않는다** (그 갈래는 `aiplace.spec`이
 *    이미 통째로 지키고 있으므로 여기서는 「구글을 부르지 않는다」만 확인한다).
 *
 * 진짜 구글은 여기서 뜨지 않는다: `src/map/googleLoader.ts`의 이음매에
 * `e2e/fake-google.ts`를 심고, 그 가짜가 **받아 적은 질의**로 배선을 본다.
 */

test.use({ viewport: { width: 1280, height: 800 } });

const GMAPS_KEY_STORAGE = 'trip-board/gmaps-key';

/** A transparent 1×1 png — Leaflet은 이 스펙에서도 타일을 한 장 찾는다. */
const TILE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** 구글이 「마루하치」에 답하는 두 줄. 첫 줄이 사용자가 고를 그 가게다. */
const GOOGLE_ANSWER: FakePlace[] = [
  {
    displayName: '마루하치 슈퍼 난바점',
    formattedAddress: '일본 오사카부 오사카시 나니와구 난바나카 2-10-70',
    lat: 34.6614,
    lng: 135.5019,
  },
  {
    displayName: '마루하치 슈퍼 닛폰바시점',
    formattedAddress: '일본 오사카부 오사카시 나니와구 니혼바시 5-1',
    lat: 34.6558,
    lng: 135.5065,
  },
];

const readFake = (page: Page): Promise<FakeGoogleState> =>
  page.evaluate(
    () =>
      (window as unknown as { __tripBoardFakeGoogle: { state: FakeGoogleState } })
        .__tripBoardFakeGoogle.state,
  ) as Promise<FakeGoogleState>;

/** Nominatim은 이 스펙에서 **불려서는 안 된다** — 불리면 받아 적는다. */
async function stubNetwork(page: Page, osmCalls: string[]): Promise<void> {
  await page.route('**/nominatim.openstreetmap.org/**', (route) => {
    osmCalls.push(new URL(route.request().url()).searchParams.get('q') ?? '');
    void route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await page.route(/tile\.openstreetmap\.org/, (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: TILE_PNG }),
  );
}

/** 키 + 가짜 구글 + 심어 둔 답. `key: false`면 키 없는 기기다. */
async function open(
  page: Page,
  options: { key?: boolean; answer?: FakePlace[] } = {},
): Promise<string[]> {
  const osmCalls: string[] = [];
  await stubNetwork(page, osmCalls);
  if (options.key !== false) {
    await page.addInitScript(
      (key) => localStorage.setItem(key, 'test-gmaps-key'),
      GMAPS_KEY_STORAGE,
    );
  }
  await page.addInitScript(installFakeGoogle);
  await page.addInitScript((seeded) => {
    const scope = window as unknown as Record<string, unknown>;
    scope.__tripBoardFakeGooglePlaces = seeded;
  }, options.answer ?? GOOGLE_ANSWER);
  await page.goto('/');
  await expect(page.getByTestId('tab-bar')).toBeVisible();
  return osmCalls;
}

async function createTrip(page: Page, title: string): Promise<void> {
  await page.getByTestId('add-trip').click();
  await page.getByTestId('trip-title-input').fill(title);
  await page.getByTestId('trip-submit').click();
  await expect(page.getByTestId('trip-form')).toHaveCount(0);
  await page.getByTestId('trip-card').filter({ hasText: title }).getByTestId('trip-open').click();
  await expect(page).toHaveURL(/#\/board$/);
}

async function addCard(page: Page, columnIndex: number, title: string): Promise<void> {
  await page.getByTestId('board-column').nth(columnIndex).getByTestId('add-card').click();
  await page.getByTestId('card-title-input').fill(title);
  await page.getByTestId('card-submit').click();
  await expect(page.getByTestId('card-form')).toHaveCount(0);
}

/** 카드 편집 → 「검색」 → 질의 하나. */
async function searchInCard(page: Page, title: string, query: string): Promise<void> {
  await page.getByTestId('board-card').filter({ hasText: title }).click();
  await expect(page.getByTestId('card-form')).toBeVisible();
  await page.getByTestId('card-location-search').click();
  await expect(page.getByTestId('place-search')).toBeVisible();
  await page.getByTestId('place-search-input').fill(query);
  await page.getByTestId('place-search-submit').click();
}

test('키가 있으면 구글에게 먼저 묻고, 그 좌표를 그대로 카드에 담는다', async ({ page }) => {
  const osmCalls = await open(page);
  await createTrip(page, '오사카 구글검색');
  await addCard(page, 0, '마루하치 슈퍼 난바점');

  await searchInCard(page, '마루하치', '마루하치 슈퍼 난바점');

  const results = page.getByTestId('place-search-results');
  await expect(results).toBeVisible();
  await expect(results).toHaveAttribute('data-source', 'google');
  await expect(page.getByTestId('place-search-result')).toHaveCount(2);

  const first = page.getByTestId('place-search-result').first();
  await expect(first).toContainText('마루하치 슈퍼 난바점');
  // 구글 좌표는 원본이라 조이는 계단을 지나지 않는다 — 그래도 「지도 확인됨」이다.
  await expect(first).toHaveAttribute('data-refined', 'true');
  await expect(first).toHaveAttribute('data-refined-by', 'google');
  await expect(first).toHaveAttribute('data-lat', '34.6614');

  // 그리고 Nominatim은 한 번도 불리지 않았다 — 위 계단이 답했으니까.
  expect(osmCalls).toHaveLength(0);

  // 질의는 카드 제목 그대로, 세 필드만 값을 치른다 (M41의 그 셋).
  const state = await readFake(page);
  expect(state.searches).toHaveLength(1);
  expect(state.searches[0].textQuery).toBe('마루하치 슈퍼 난바점');
  expect(state.searches[0].fields).toEqual([
    'displayName',
    'location',
    'formattedAddress',
  ]);

  // 고르면 좌표와 주소가 카드에 앉는다.
  await first.click();
  await expect(page.getByTestId('place-search')).toHaveCount(0);
  const address = page.getByTestId('card-location-address');
  await expect(address).toHaveAttribute('data-lat', '34.6614');
  await expect(address).toHaveAttribute('data-lng', '135.5019');
  await expect(address).toContainText('난바나카');

  await page.getByTestId('card-submit').click();
  await expect(page.getByTestId('card-form')).toHaveCount(0);

  // 지도 탭에 그 자리로 핀이 선다 — 저장까지 이어졌다는 뜻이다.
  await page.getByTestId('tab-map').click();
  await expect(page.getByTestId('map-marker')).toHaveCount(1);
});

test('여행 목적지가 있으면 그 좌표로 검색을 기울인다', async ({ page }) => {
  await open(page);

  // 목적지를 든 여행 하나 — 좌표 붙여넣기로(네트워크 없이) 꽂는다.
  await page.getByTestId('add-trip').click();
  await page.getByTestId('trip-title-input').fill('오사카 기울임');
  await page.getByTestId('trip-destination-search').click();
  await expect(page.getByTestId('place-search')).toBeVisible();
  await page.getByTestId('place-search-input').fill('34.6937, 135.5023');
  await page.getByTestId('place-search-coord').click();
  await expect(page.getByTestId('place-search')).toHaveCount(0);
  await page.getByTestId('trip-submit').click();
  await expect(page.getByTestId('trip-form')).toHaveCount(0);
  await page
    .getByTestId('trip-card')
    .filter({ hasText: '오사카 기울임' })
    .getByTestId('trip-open')
    .click();

  await addCard(page, 0, '마루하치');
  await searchInCard(page, '마루하치', '마루하치');
  await expect(page.getByTestId('place-search-results')).toBeVisible();

  const state = await readFake(page);
  const search = state.searches[state.searches.length - 1];
  expect(search.bias?.lat).toBeCloseTo(34.6937, 4);
  expect(search.bias?.lng).toBeCloseTo(135.5023, 4);
});

test('구글이 못 찾으면 조용히 다음 계단으로 내려가고 한 줄로 말한다', async ({ page }) => {
  const osmCalls = await open(page, { answer: [] });
  await createTrip(page, '오사카 빈손');
  await addCard(page, 0, '없는 가게');

  await searchInCard(page, '없는 가게', '없는 가게');

  // AI는 꺼져 있으므로(기본값) 바로 OSM까지 내려간다.
  await expect(page.getByTestId('place-search-results')).toHaveCount(0);
  await expect(page.getByTestId('place-search-empty')).toBeVisible();
  await expect.poll(() => osmCalls.length).toBeGreaterThan(0);
  expect(osmCalls[0]).toBe('없는 가게');
});

test('키가 없는 기기는 구글을 부르지도 않는다', async ({ page }) => {
  const osmCalls = await open(page, { key: false });
  await createTrip(page, '오사카 키없음');
  await addCard(page, 0, '난바역');

  await searchInCard(page, '난바역', '난바역');
  await expect(page.getByTestId('place-search-empty')).toBeVisible();

  // Nominatim만 불렸고, 구글에는 한 글자도 나가지 않았다.
  expect(osmCalls).toEqual(['난바역']);
  expect((await readFake(page)).searches).toHaveLength(0);
  // 안내 문구도 M28 그대로다.
  await expect(page.getByTestId('place-search-hint')).toContainText('OpenStreetMap');
  await expect(page.getByTestId('place-search-hint')).not.toContainText('구글');
});
