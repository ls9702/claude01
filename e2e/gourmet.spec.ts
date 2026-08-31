import { expect, test, type Page } from '@playwright/test';
import { installFakeGoogle, type FakeGoogleState, type FakePlace } from './fake-google';
import { GOURMET_ENTRIES, type GourmetEntry } from '../src/data/gourmet';
import { lookupQuery } from '../src/gourmet/spots';

/**
 * 「주변 맛집」 하이브리드 레이어 — M43.
 *
 * 진짜 구글은 여기서 뜨지 않는다. `src/map/googleLoader.ts`의 이음매에 가짜를
 * 심고, 그 가짜가 **받아 적은 호출**로 배선을 확인한다 — 어떤 질의로 큐레이션
 * 목록을 물었나, `searchNearby`에 어떤 `includedTypes`를 실었나, 타입이 없는
 * 갈래는 정말 키워드 + `minRating`으로 갔나.
 *
 * ## 이 스펙은 조사 데이터를 검사하지 않는다
 *
 * 큐레이션 배열(`src/data/gourmet.ts`)은 조사 때마다 통째로 갈린다 — 열한 줄로
 * 태어나 백스물일곱 줄이 됐고, 그때 id도 전부 바뀌었다. 그 id를 여기 적어 두면
 * 조사 한 번이 스펙 여섯 개를 깨뜨리는데, 그건 기능이 망가졌다는 뜻이 아니라
 * **스펙이 데이터를 검사하고 있었다**는 뜻이다.
 *
 * 그래서 이 스펙은 `__tripBoardGourmetEntries` 이음매(`src/gourmet/entries.ts`)에
 * **자기 목록 여섯 줄**을 심고 그것으로 배선을 확인한다. 실제 배열과 앱이 정말
 * 이어져 있는지는 아래 마지막 한 건이 따로 못박는다 — 그 한 건만 진짜 배열을
 * import하고, 그래서 데이터가 갈려도 저절로 따라간다.
 *
 * 이 스펙이 못박는 것:
 *
 * 1. 토글은 **구글 엔진 지도에만** 있다 (OSM 시트에는 아예 없다).
 * 2. 켜면 씨앗 목록을 순차로 조회하며 진행을 말하고, 답이 온 집만 핀이 된다.
 * 3. 구글 평점 4.3 미만은 큐레이션이어도 감춰진다 — 이중 필터.
 * 4. 장르·예약·출처 칩이 핀을 거른다.
 * 5. 실시간 검색은 우리가 정한 타입 셋으로 나가고, 그 결과도 핀이 된다.
 *    지도를 미는 것만으로는 다시 나가지 않고, 버튼을 눌러야 나간다.
 * 6. 팝업의 「구글 지도 앱에서 보기」는 `query_place_id`까지 달고 나간다.
 * 7. 「보드에 카드로 추가」는 위치를 든 카드를 맛집 칸에 만든다 (M49: 식사 → 맛집).
 * 8. 390px에서 패널도 팝업도 가로로 넘치지 않는다.
 * 9. 끄면 전부 사라진다.
 * 10. 그리고 아무것도 심지 않으면 앱은 **진짜 조사 배열**을 조회한다.
 */

test.use({ viewport: { width: 1280, height: 800 } });

const GMAPS_KEY_STORAGE = 'trip-board/gmaps-key';

/** 카드가 이미 들고 있는 좌표 — 오사카 난바. */
const CARD_POINT = { lat: 34.6659, lng: 135.5013 };

/** A transparent 1×1 png — enough for Leaflet to count as a loaded tile. */
const TILE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/**
 * 이 스펙이 조회할 큐레이션 목록 — **여섯 줄, 전부 이 파일의 것**.
 *
 * 다섯 갈래 · 두 도시 · 예약 두 상태를 다 덮되, 각 줄은 아래 canned 답과 한 쌍이
 * 되도록 지어졌다: 넷은 문턱을 넘고, 하나는 4.1로 답해 감춰지고, 하나는 구글이
 * 아예 못 찾아 감춰진다. 현지 상호는 키워드 검색어(`とんかつ`·`お好み焼き`)와 한
 * 글자도 겹치지 않게 골랐다 — 겹치면 어느 canned 답이 이기는지가 순서에 달린다.
 */
const SPEC_ENTRIES: GourmetEntry[] = [
  {
    id: 'spec-ramen',
    name: '스펙 라멘',
    localName: 'スペック軒',
    genre: 'ramen',
    city: 'osaka',
    area: '난바',
    tabelog: 3.58,
    reservable: false,
    note: '칸막이 1인석',
    surveyedAt: '2026-08',
  },
  {
    id: 'spec-sushi',
    name: '스펙 초밥',
    localName: 'スペック鮨',
    genre: 'sushi',
    city: 'osaka',
    area: '우메다',
    tabelog: 3.72,
    reservable: false,
    surveyedAt: '2026-08',
  },
  {
    id: 'spec-katsu',
    name: '스펙 카츠',
    localName: 'スペック亭',
    genre: 'katsu',
    city: 'osaka',
    area: '우메다',
    tabelog: 3.45,
    reservable: true,
    note: '백화점 안이라 예약이 된다',
    surveyedAt: '2026-08',
  },
  {
    id: 'spec-okonomi',
    name: '스펙 오코노미',
    localName: 'スペック焼',
    genre: 'okonomiyaki',
    city: 'osaka',
    area: '도톤보리',
    tabelog: 3.66,
    reservable: false,
    note: '야마이모야키가 간판',
    surveyedAt: '2026-08',
  },
  {
    // 문턱을 못 넘는 하나 — 예약도 되고 교토이지만, 지금 평점이 4.1이다.
    id: 'spec-dessert-low',
    name: '스펙 디저트',
    localName: 'スペック茶房',
    genre: 'dessert',
    city: 'kyoto',
    area: '기온',
    tabelog: 3.51,
    reservable: true,
    surveyedAt: '2026-08',
  },
  {
    // 구글이 못 찾는 하나 — canned 답이 없다.
    id: 'spec-missing',
    name: '스펙 실종',
    localName: 'スペック不明',
    genre: 'sushi',
    city: 'kyoto',
    area: '기온',
    tabelog: 3.4,
    reservable: false,
    surveyedAt: '2026-08',
  },
];

/** 화면에 서야 하는 큐레이션 줄 수 — 여섯 중 넷. */
const VISIBLE_CURATED = 4;

/** 팝업·카드 시험이 쓰는 한 집의 좌표. */
const OKONOMI_POINT = { lat: 34.6684, lng: 135.5008 };

/**
 * 위 목록의 집들이 이렇게 답한다고 미리 정해 둔다.
 *
 * 열쇠는 **질의에 들어 있는 문자열**이다(`fake-google.ts`의 질의별 답). 맛집
 * 조회는 집마다 다른 질의를 내므로(「スペック焼 도톤보리」) 하나의 배열로는
 * 흉내 낼 수 없다.
 *
 * 여기 없는 집(`スペック不明`)은 「못 찾음」이 되고, 그런 집은 이번 세션 동안
 * 감춰진다.
 */
const CURATED_ANSWERS: Record<string, FakePlace[]> = {
  スペック軒: [
    {
      displayName: '스펙 라멘',
      formattedAddress: '일본 오사카부 오사카시 주오구',
      lat: 34.6652,
      lng: 135.5019,
      rating: 4.4,
      userRatingCount: 5200,
      id: 'place-ramen',
    },
  ],
  スペック鮨: [
    { displayName: '스펙 초밥', lat: 34.7075, lng: 135.5117, rating: 4.6, id: 'place-sushi' },
  ],
  スペック亭: [
    { displayName: '스펙 카츠', lat: 34.7038, lng: 135.4989, rating: 4.4, id: 'place-katsu' },
  ],
  スペック焼: [
    {
      displayName: '스펙 오코노미',
      formattedAddress: '일본 오사카부 오사카시 주오구 도톤보리',
      lat: OKONOMI_POINT.lat,
      lng: OKONOMI_POINT.lng,
      rating: 4.7,
      id: 'place-okonomi',
    },
  ],
  // 4.1 — 목록에 있어도 화면에는 서지 못한다.
  スペック茶房: [
    { displayName: '스펙 디저트', lat: 35.0037, lng: 135.7788, rating: 4.1, id: 'place-dessert' },
  ],
  // 타입이 없는 갈래의 **실시간** 키워드 검색. 위의 상호들과 한 글자도 겹치지
  // 않으므로 어느 쪽이 먼저 맞는지를 걱정할 필요가 없다.
  とんかつ: [
    { displayName: '토모에 돈카츠', lat: 34.667, lng: 135.502, rating: 4.5, id: 'place-katsu-live' },
  ],
  お好み焼き: [
    { displayName: '후쿠타로', lat: 34.6666, lng: 135.5035, rating: 4.6, id: 'place-okonomi-live' },
  ],
};

/** `searchNearby`가 돌려주는 줄들 — 타입이 있는 세 갈래의 답. */
const NEARBY_ANSWERS: FakePlace[] = [
  {
    displayName: '하리주 난바 본점',
    lat: 34.6664,
    lng: 135.5022,
    rating: 4.8,
    id: 'place-nearby-sushi',
    types: ['sushi_restaurant', 'restaurant'],
  },
  {
    displayName: '킨류 라멘',
    lat: 34.6675,
    lng: 135.5029,
    rating: 4.4,
    id: 'place-nearby-ramen',
    types: ['ramen_restaurant', 'restaurant'],
  },
  {
    // 문턱을 못 넘는 줄 — 구글 쪽 결과도 같은 문턱을 넘어야 한다.
    displayName: '어느 관광지 식당',
    lat: 34.6699,
    lng: 135.5045,
    rating: 3.9,
    id: 'place-nearby-meh',
    types: ['restaurant'],
  },
];

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
 * 키 + 가짜 구글 + 심어 둔 답들 + **이 스펙의 큐레이션 목록**, 그리고 첫 화면.
 *
 * `entries: false`면 목록을 심지 않는다 — 앱이 진짜 조사 배열을 조회하는지
 * 확인하는 마지막 한 건이 그 길로 간다.
 */
async function openWithGoogle(
  page: Page,
  options: { delayMs?: number; entries?: GourmetEntry[] | false } = {},
): Promise<void> {
  await stubTiles(page);
  await page.addInitScript((key) => localStorage.setItem(key, 'test-gmaps-key'), GMAPS_KEY_STORAGE);
  await page.addInitScript(installFakeGoogle);
  await page.addInitScript(
    (seeded) => {
      const scope = window as unknown as Record<string, unknown>;
      scope.__tripBoardFakeGooglePlaces = [];
      scope.__tripBoardFakeGooglePlacesByQuery = seeded.byQuery;
      scope.__tripBoardFakeGoogleNearby = seeded.nearby;
      scope.__tripBoardFakeGoogleDelayMs = seeded.delayMs;
      // 앱이 조사 배열 대신 읽을 목록 (`src/gourmet/entries.ts`의 이음매).
      if (seeded.entries) scope.__tripBoardGourmetEntries = seeded.entries;
    },
    {
      byQuery: CURATED_ANSWERS,
      nearby: NEARBY_ANSWERS,
      delayMs: options.delayMs ?? 0,
      entries: options.entries === false ? null : (options.entries ?? SPEC_ENTRIES),
    },
  );
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

/** 좌표를 든 카드 한 장 — 네트워크 없이 (M37의 좌표 붙여넣기). */
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
async function scheduleCard(page: Page, title: string): Promise<void> {
  await page.getByTestId('tab-board').click();
  await page.getByTestId('board-card').filter({ hasText: title }).click();
  await expect(page.getByTestId('card-form')).toBeVisible();
  await page.getByTestId('card-schedule').click();
  await expect(page.getByTestId('schedule-sheet')).toBeVisible();
  await page.getByTestId('schedule-submit').click();
  await expect(page.getByTestId('schedule-sheet')).toHaveCount(0);
  // M41의 배치 위치 보정 팝업이 뜰 수 있다 — 이 스펙의 관심사가 아니므로 닫는다.
  const fix = page.getByTestId('place-fix-keep');
  if (await fix.isVisible().catch(() => false)) await fix.click();
}

/** 지도 탭을 열고 「일정 전체」로 — 구글 시트가 구글로 그려지는 범위. */
async function openSheetScopedMap(page: Page): Promise<void> {
  await page.getByTestId('tab-map').click();
  await expect(page.getByTestId('view-map')).toBeVisible();
  await page.getByTestId('map-scope-sheet').click();
  await expect(page.getByTestId('map-scope-sheet')).toHaveAttribute('data-active', 'true');
}

/** 구글 지도가 선 화면까지 한 번에. */
async function openGoogleMap(page: Page, tripTitle = '오사카 맛집'): Promise<void> {
  await createTrip(page, tripTitle);
  await addLocatedCard(page, 2, '이치란', CARD_POINT);
  await createSheet(page, 'google');
  await scheduleCard(page, '이치란');
  await openSheetScopedMap(page);
  await expect(page.getByTestId('google-map')).toHaveAttribute('data-status', 'ready');
}

/**
 * 맛집 핀 하나를 누른다.
 *
 * `dispatchEvent`를 쓰는 이유는 가짜 지도에 있다: 진짜 구글은 마커를 좌표에
 * 맞춰 **절대 배치**하지만, 가짜는 만들어진 순서대로 컨테이너에 쌓기만 한다
 * (`e2e/fake-google.ts` — 그리지 않는다). 그래서 핀 아홉 개가 왼쪽 위에 줄지어
 * 서고, 그 위를 필터 패널이 덮는다. 앱은 요소에 평범한 `click` 리스너를 달아
 * 두므로(구글의 이벤트 시스템을 거치지 않는다) 이 호출이 확인하는 배선은
 * 진짜 클릭과 같다.
 */
const clickSpot = (page: Page, key: string) =>
  page.locator(`[data-spot-key="${key}"]`).dispatchEvent('click');

/** 레이어를 켜고 큐레이션 조회가 끝날 때까지. */
async function activateGourmet(page: Page): Promise<void> {
  await page.getByTestId('gourmet-toggle').click();
  await expect(page.getByTestId('gourmet-panel')).toBeVisible();
  await expect(page.getByTestId('gourmet-progress')).toHaveCount(0, { timeout: 15_000 });
}

/* ------------------------------------------------------------------ *
 * 1. 토글은 구글 엔진 지도에만 있다
 * ------------------------------------------------------------------ */

test('구글 시트 지도에는 맛집 토글이 있고, OSM 시트에는 아예 없다', async ({ page }) => {
  await openWithGoogle(page);
  await openGoogleMap(page);

  await expect(page.getByTestId('gourmet-toggle')).toBeVisible();
  await expect(page.getByTestId('gourmet-toggle')).toHaveAttribute('data-active', 'false');
  // 켜기 전에는 패널도 핀도 없다.
  await expect(page.getByTestId('gourmet-panel')).toHaveCount(0);
  await expect(page.getByTestId('gourmet-pin')).toHaveCount(0);

});

test('OSM 시트의 지도에는 맛집 토글이 아예 없다 — Leaflet 갈래는 이 레이어를 모른다', async ({
  page,
}) => {
  await openWithGoogle(page);
  await createTrip(page, '오사카 OSM');
  await addLocatedCard(page, 2, '이치란', CARD_POINT);
  await createSheet(page, 'osm');
  await scheduleCard(page, '이치란');
  await openSheetScopedMap(page);

  await expect(page.getByTestId('map-marker')).toHaveCount(1);
  await expect(page.getByTestId('google-map')).toHaveCount(0);
  await expect(page.getByTestId('gourmet-toggle')).toHaveCount(0);
  await expect(page.getByTestId('gourmet-pin')).toHaveCount(0);
});

test('전체 아이템 범위(Leaflet)에도 토글이 없다', async ({ page }) => {
  await openWithGoogle(page);
  await openGoogleMap(page);
  await expect(page.getByTestId('gourmet-toggle')).toBeVisible();

  await page.getByTestId('map-scope-all').click();
  await expect(page.getByTestId('google-map')).toHaveCount(0);
  await expect(page.getByTestId('gourmet-toggle')).toHaveCount(0);
});

/* ------------------------------------------------------------------ *
 * 2. 켜면 씨앗 목록을 순차로 조회한다
 * ------------------------------------------------------------------ */

test('켜면 진행을 말하며 큐레이션을 조회하고, 답이 온 집만 핀이 된다', async ({ page }) => {
  // 답을 늦춰야 「불러오는 중 3/11」이라는 화면이 존재한다.
  //
  // M45 — 40ms이던 자리다. 조회가 동시 폭 6의 워커 풀로 바뀌면서 여섯 줄짜리
  // 목록은 한 계단(≈40ms)에 끝나고, 그러면 이 화면은 존재하기도 전에 사라진다.
  // 늦추는 값을 키우는 것은 기능이 아니라 **관측 창**을 키우는 일이다.
  await openWithGoogle(page, { delayMs: 300 });
  await openGoogleMap(page);

  await page.getByTestId('gourmet-toggle').click();
  await expect(page.getByTestId('gourmet-toggle')).toHaveAttribute('data-active', 'true');
  const progress = page.getByTestId('gourmet-progress');
  await expect(progress).toBeVisible();
  await expect(progress).toContainText('맛집 정보 불러오는 중');

  await expect(progress).toHaveCount(0, { timeout: 20_000 });

  await expect(page.locator('[data-testid="gourmet-pin"][data-source="curated"]')).toHaveCount(
    VISIBLE_CURATED,
  );

  // 질의는 「상호 + 동네」로 나갔다.
  const state = await readFake(page);
  const queries = state.searches.map((search) => search.textQuery);
  expect(queries).toContain('スペック軒 난바');
  expect(queries).toContain('スペック不明 기온');
  // 그리고 값을 치르는 필드 셋에 평점과 장소 id가 들어 있다.
  const gourmetSearch = state.searches.find((search) => search.textQuery.includes('スペック軒'));
  expect(gourmetSearch?.fields).toContain('rating');
  expect(gourmetSearch?.fields).toContain('id');
});

test('구글 평점 4.3 미만은 큐레이션 목록에 있어도 감춰진다', async ({ page }) => {
  await openWithGoogle(page);
  await openGoogleMap(page);
  await activateGourmet(page);

  await expect(page.locator('[data-spot-key="curated:spec-ramen"]')).toHaveCount(1);
  // 스펙 디저트는 4.1로 답했다 — 목록에 있지만 화면에는 없다.
  await expect(page.locator('[data-spot-key="curated:spec-dessert-low"]')).toHaveCount(0);
  // 답이 아예 없던 집도 이번 세션에는 없다.
  await expect(page.locator('[data-spot-key="curated:spec-missing"]')).toHaveCount(0);
});

test('맛집 핀은 카드 핀만큼 크고, 「AI추천」 이름표를 달고 있다 (M45)', async ({ page }) => {
  await openWithGoogle(page);
  await openGoogleMap(page);
  await activateGourmet(page);

  // 지도 타일 위에서 읽히려면 24px 흰 원으로는 모자랐다 — 원을 키우고 이름표를 단다.
  const disc = page.getByTestId('gourmet-pin-disc').first();
  const box = await disc.boundingBox();
  expect(box).not.toBeNull();
  expect(Math.round(box!.width)).toBeGreaterThanOrEqual(32);
  expect(Math.round(box!.height)).toBeGreaterThanOrEqual(32);

  // 큐레이션도 라이브도 같은 말을 쓴다 — 사용자에게 이 층은 하나다.
  const labels = page.getByTestId('gourmet-pin-label');
  await expect(labels.first()).toHaveText('AI추천');
  expect(await labels.count()).toBe(await page.getByTestId('gourmet-pin').count());
  await expect(
    page.locator('[data-source="google"] [data-testid="gourmet-pin-label"]').first(),
  ).toHaveText('AI추천');
});

test('큐레이션 핀과 카드 핀은 서로를 건드리지 않는다', async ({ page }) => {
  await openWithGoogle(page);
  await openGoogleMap(page);

  const cardPins = page.getByTestId('gmap-marker');
  await expect(cardPins).toHaveCount(1);

  await activateGourmet(page);
  // 카드 핀은 그대로, 동선 계산도 그대로.
  await expect(cardPins).toHaveCount(1);
  await expect(page.getByTestId('google-map')).toHaveAttribute('data-pin-count', '1');

  // 끄면 맛집만 사라진다.
  await page.getByTestId('gourmet-toggle').click();
  await expect(page.getByTestId('gourmet-pin')).toHaveCount(0);
  await expect(page.getByTestId('gourmet-panel')).toHaveCount(0);
  await expect(cardPins).toHaveCount(1);
});

/* ------------------------------------------------------------------ *
 * 3. 칩이 핀을 거른다
 * ------------------------------------------------------------------ */

test('장르·예약·출처 칩이 핀을 거르고, 선택은 기기에 남는다', async ({ page }) => {
  await openWithGoogle(page);
  await openGoogleMap(page);
  await activateGourmet(page);

  const pins = page.getByTestId('gourmet-pin');
  const before = await pins.count();
  // 큐레이션 넷 + 구글 실시간 줄들.
  expect(before).toBeGreaterThan(VISIBLE_CURATED);

  // 라멘만 — 큐레이션 한 곳과 구글의 라멘 줄. 갈래를 못 읽은 줄도 통과한다.
  await page.locator('[data-testid="gourmet-genre-chip"][data-genre="ramen"]').click();
  await expect(page.locator('[data-testid="gourmet-pin"][data-genre="sushi"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="gourmet-pin"][data-genre="ramen"]')).not.toHaveCount(0);
  await page.locator('[data-testid="gourmet-genre-chip"][data-genre="ramen"]').click();

  // 예약 「가능」 — 조사값이 true인 집만. 구글 줄은 예약을 모르므로 빠진다.
  await page.locator('[data-testid="gourmet-reservable-chip"][data-value="yes"]').click();
  await expect(page.locator('[data-testid="gourmet-pin"][data-source="google"]')).toHaveCount(0);
  await expect(page.locator('[data-spot-key="curated:spec-katsu"]')).toHaveCount(1);
  await expect(page.locator('[data-spot-key="curated:spec-ramen"]')).toHaveCount(0);
  await page.locator('[data-testid="gourmet-reservable-chip"][data-value="all"]').click();

  // 출처 「구글」 — 큐레이션이 전부 물러난다.
  await page.locator('[data-testid="gourmet-source-chip"][data-value="google"]').click();
  await expect(page.locator('[data-testid="gourmet-pin"][data-source="curated"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="gourmet-pin"][data-source="google"]')).not.toHaveCount(
    0,
  );

  // 이 기기는 그 선택을 기억한다 — 리로드해도 「구글」에 켜져 있다.
  await page.reload();
  await expect(page.getByTestId('tab-bar')).toBeVisible();
  await openSheetScopedMap(page);
  await expect(page.getByTestId('google-map')).toHaveAttribute('data-status', 'ready');
  await activateGourmet(page);
  await expect(
    page.locator('[data-testid="gourmet-source-chip"][data-value="google"]'),
  ).toHaveAttribute('data-active', 'true');
  await expect(page.locator('[data-testid="gourmet-pin"][data-source="curated"]')).toHaveCount(0);
});

/* ------------------------------------------------------------------ *
 * 4. 실시간 검색
 * ------------------------------------------------------------------ */

test('실시간 검색은 우리가 정한 타입으로 나가고, 타입 없는 갈래는 키워드로 간다', async ({
  page,
}) => {
  await openWithGoogle(page);
  await openGoogleMap(page);
  await activateGourmet(page);

  const state = await readFake(page);
  expect(state.nearby).toHaveLength(1);
  const call = state.nearby[0];
  expect(call.includedTypes).toEqual([
    'sushi_restaurant',
    'ramen_restaurant',
    'dessert_shop',
  ]);
  expect(call.radius).toBe(1500);
  expect(call.maxResultCount).toBe(20);
  expect(call.center?.lat).toBeGreaterThan(34);
  expect(call.center?.lng).toBeGreaterThan(135);

  // 타입이 없는 두 갈래는 현지어 키워드로 — 문턱은 서버 쪽에서 넘긴다.
  const keywords = state.searches.map((search) => search.textQuery);
  expect(keywords).toContain('とんかつ');
  expect(keywords).toContain('お好み焼き');

  // 그 결과들이 핀이 됐다: 타입에서 갈래를 되읽은 초밥·라멘, 키워드에서 온 카츠.
  await expect(page.locator('[data-spot-key="google:place-nearby-sushi"]')).toHaveAttribute(
    'data-genre',
    'sushi',
  );
  await expect(page.locator('[data-spot-key="google:place-nearby-ramen"]')).toHaveAttribute(
    'data-genre',
    'ramen',
  );
  await expect(page.locator('[data-spot-key="google:place-katsu-live"]')).toHaveAttribute(
    'data-genre',
    'katsu',
  );
  // 4.3을 못 넘은 구글 줄은 서지 못한다.
  await expect(page.locator('[data-spot-key="google:place-nearby-meh"]')).toHaveCount(0);
});

test('지도를 미는 것만으로는 다시 묻지 않고, 버튼을 눌러야 나간다', async ({ page }) => {
  await openWithGoogle(page);
  await openGoogleMap(page);
  await activateGourmet(page);

  expect((await readFake(page)).nearby).toHaveLength(1);

  // 필터 칩을 눌러도(=다시 그려도) 호출은 늘지 않는다.
  await page.locator('[data-testid="gourmet-genre-chip"][data-genre="sushi"]').click();
  await page.locator('[data-testid="gourmet-genre-chip"][data-genre="sushi"]').click();
  expect((await readFake(page)).nearby).toHaveLength(1);

  await page.getByTestId('gourmet-research').click();
  await expect
    .poll(async () => (await readFake(page)).nearby.length, { timeout: 10_000 })
    .toBe(2);
});

/* ------------------------------------------------------------------ *
 * 5. 팝업
 * ------------------------------------------------------------------ */

test('핀을 누르면 간단한 정보와 세 갈래의 문이 열린다', async ({ page }) => {
  await openWithGoogle(page);
  await openGoogleMap(page);
  await activateGourmet(page);

  await clickSpot(page, 'curated:spec-okonomi');

  const popup = page.getByTestId('gourmet-popup');
  await expect(popup).toBeVisible();
  await expect(popup).toHaveAttribute('data-source', 'curated');
  await expect(popup).toContainText('스펙 오코노미');
  await expect(popup).toContainText('오코노미야키 · 도톤보리');
  await expect(popup).toContainText('야마이모야키가 간판');
  await expect(page.getByTestId('gourmet-popup-rating')).toHaveText('⭐ 구글 4.7 · 타베로그 3.7');
  await expect(page.getByTestId('gourmet-popup-reservable')).toHaveText('예약 불가');

  // 「구글 지도 앱에서 보기」는 그 가게의 페이지를 바로 연다 — place id까지.
  const place = page.getByTestId('gourmet-popup-place');
  await expect(place).toHaveAttribute(
    'href',
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent('スペック焼')}&query_place_id=place-okonomi`,
  );
  await expect(place).toHaveAttribute('target', '_blank');

  // 길찾기는 M42의 그 링크 그대로.
  await expect(page.getByTestId('gourmet-popup-directions')).toHaveAttribute(
    'href',
    'https://www.google.com/maps/dir/?api=1&destination=34.6684,135.5008&travelmode=transit',
  );

  // 패널은 물러났다 — 한 화면에 두 장을 세우지 않는다.
  await expect(page.getByTestId('gourmet-panel')).toHaveCount(0);
  await page.getByTestId('gourmet-popup-close').click();
  await expect(page.getByTestId('gourmet-popup')).toHaveCount(0);
  await expect(page.getByTestId('gourmet-panel')).toBeVisible();
});

test('구글에서 온 집은 평점이 하나뿐이라고 말한다', async ({ page }) => {
  await openWithGoogle(page);
  await openGoogleMap(page);
  await activateGourmet(page);

  await clickSpot(page, 'google:place-nearby-sushi');
  const popup = page.getByTestId('gourmet-popup');
  await expect(popup).toHaveAttribute('data-source', 'google');
  await expect(page.getByTestId('gourmet-popup-rating')).toHaveText('⭐ 구글 4.8 (구글만)');
  await expect(page.getByTestId('gourmet-popup-reservable')).toHaveText('예약 정보 없음');
  await expect(page.getByTestId('gourmet-popup-place')).toHaveAttribute(
    'href',
    /query_place_id=place-nearby-sushi$/,
  );
});

test('카드 핀을 누르면 맛집 팝업이 물러난다 — 두 장이 겹치지 않는다', async ({ page }) => {
  await openWithGoogle(page);
  await openGoogleMap(page);
  await activateGourmet(page);

  await clickSpot(page, 'curated:spec-okonomi');
  await expect(page.getByTestId('gourmet-popup')).toBeVisible();

  await page.getByTestId('gmap-marker').first().click();
  await expect(page.getByTestId('gmap-popup')).toBeVisible();
  await expect(page.getByTestId('gourmet-popup')).toHaveCount(0);

  // 반대 방향도 같다.
  await clickSpot(page, 'curated:spec-okonomi');
  await expect(page.getByTestId('gourmet-popup')).toBeVisible();
  await expect(page.getByTestId('gmap-popup')).toHaveCount(0);
});

/* ------------------------------------------------------------------ *
 * 6. 보드에 카드로 추가
 * ------------------------------------------------------------------ */

/**
 * M49 — 목적지가 「식사」에서 **「맛집」**으로 옮겨졌다.
 *
 * 이제 모든 여행이 상설 맛집 칸을 달고 태어나므로(`SEED_COLUMNS`), 지도에서 고른
 * 집은 그 칸으로 간다 — 거기 놓여야 ⭐ 층에도 뜬다. 맛집 칸이 없는 여행에서는
 * M43 그대로 「식사」로 내려간다(`board/gourmetColumn.pickGourmetColumn`의 계약이고
 * 그 갈래는 단위 테스트가 지킨다).
 */
test('「보드에 카드로 추가」가 위치를 든 카드를 맛집 칸에 만든다', async ({ page }) => {
  await openWithGoogle(page);
  await openGoogleMap(page);
  await activateGourmet(page);

  await clickSpot(page, 'curated:spec-okonomi');
  await page.getByTestId('gourmet-popup-add').click();

  // 무슨 일이 벌어졌는지 한 줄로 말한다.
  await expect(page.getByTestId('undo-toast')).toContainText('맛집');
  await expect(page.getByTestId('gourmet-popup')).toHaveCount(0);

  await page.getByTestId('tab-board').click();
  const column = page.getByTestId('board-column').nth(5);
  await expect(column).toContainText('맛집');
  const card = column.getByTestId('board-card').filter({ hasText: '스펙 오코노미' });
  await expect(card).toHaveCount(1);

  // 위치가 담겼다 — 카드 편집의 위치 줄과 「위치 확인」 미니맵으로 확인한다.
  await card.click();
  await expect(page.getByTestId('card-form')).toBeVisible();
  const address = page.getByTestId('card-location-address');
  await expect(address).toHaveAttribute('data-lat', '34.6684');
  await expect(address).toHaveAttribute('data-lng', '135.5008');
  await expect(page.getByTestId('card-memo-input')).toHaveValue(
    '⭐ 구글 4.7 · 타베로그 3.7 · 예약 불가',
  );

  await page.getByTestId('location-preview-open').click();
  await expect(page.getByTestId('location-preview-map')).toHaveAttribute('data-lat', '34.6684');
  await expect(page.getByTestId('location-preview-map')).toHaveAttribute('data-lng', '135.5008');
});

/* ------------------------------------------------------------------ *
 * 7. 그런데 진짜 배열과는 이어져 있나
 * ------------------------------------------------------------------ */

/**
 * 위의 모든 시험은 이 스펙이 심은 여섯 줄로 돌았다. 그러면 남는 질문 하나:
 * **아무것도 심지 않으면 앱은 정말 조사 배열을 읽나?**
 *
 * 그 한 가지만 확인한다. `src/data/gourmet.ts`를 import해서 첫 줄의 질의와 전체
 * 줄 수를 기대값으로 삼으므로, 다음 조사에서 배열이 통째로 갈려도 이 시험은
 * 저절로 따라간다 — 고쳐야 할 것은 없다.
 *
 * 백스물일곱 집을 다 조회하게 두지 않는다: 첫 질의를 확인한 즉시 토글을 꺼서
 * 중단시킨다(중단은 레이어가 이미 하는 일이다).
 *
 * M45 — 조회는 이제 동시 폭 6의 워커 풀이다(순차가 아니다). 그래도 **첫 요청은
 * 언제나 첫 줄의 것**이다: 워커는 만들어진 순서대로 다음 칸을 집어간다
 * (`src/gourmet/pool.ts`). 그래서 아래의 `searches[before]` 단정은 그대로다.
 */
test('아무것도 심지 않으면 진짜 조사 배열을 조회한다', async ({ page }) => {
  // 답을 늦춰야 「불러오는 중」이 화면에 머문다 — 그리고 127집이 다 나가기 전에
  // 끌 수 있다.
  await openWithGoogle(page, { delayMs: 60, entries: false });
  await openGoogleMap(page);

  const before = (await readFake(page)).searches.length;

  await page.getByTestId('gourmet-toggle').click();
  const progress = page.getByTestId('gourmet-progress');
  await expect(progress).toBeVisible();
  // 총 수는 조사 배열의 길이 그대로다.
  await expect(progress).toContainText(`/${GOURMET_ENTRIES.length}`);

  // 첫 질의는 조사 배열 첫 줄의 「상호 + 동네」다.
  await expect
    .poll(async () => (await readFake(page)).searches.length, { timeout: 10_000 })
    .toBeGreaterThan(before);
  const first = (await readFake(page)).searches[before];
  expect(first.textQuery).toBe(lookupQuery(GOURMET_ENTRIES[0]));

  // 끄면 진행 중이던 줄이 자기 결과를 버리고 화면이 비워진다.
  await page.getByTestId('gourmet-toggle').click();
  await expect(page.getByTestId('gourmet-panel')).toHaveCount(0);
  await expect(page.getByTestId('gourmet-pin')).toHaveCount(0);
});

/* ------------------------------------------------------------------ *
 * 8. 패널 접기 (M45)
 * ------------------------------------------------------------------ */

test('필터 패널을 접으면 요약 한 줄만 남고, 핀은 그대로다', async ({ page }) => {
  await openWithGoogle(page);
  await openGoogleMap(page);
  await activateGourmet(page);

  const panel = page.getByTestId('gourmet-panel');
  await expect(panel).toHaveAttribute('data-collapsed', 'false');
  await expect(page.getByTestId('gourmet-genre-chip')).not.toHaveCount(0);
  const pinsBefore = await page.getByTestId('gourmet-pin').count();
  expect(pinsBefore).toBeGreaterThan(0);

  await page.getByTestId('gourmet-panel-toggle').click();

  // 본문이 사라지고 요약 알약 하나만 남는다…
  await expect(panel).toHaveAttribute('data-collapsed', 'true');
  await expect(page.getByTestId('gourmet-genre-chip')).toHaveCount(0);
  await expect(page.getByTestId('gourmet-research')).toHaveCount(0);
  await expect(page.getByTestId('gourmet-panel-toggle')).toContainText('주변 맛집');
  // …그리고 접기는 끄기가 아니다: 핀은 한 개도 줄지 않는다.
  await expect(page.getByTestId('gourmet-pin')).toHaveCount(pinsBefore);

  // 접으면 지도를 덜 가린다 — 그게 이 기능의 전부다.
  const collapsedBox = await panel.boundingBox();
  expect(collapsedBox).not.toBeNull();
  expect(collapsedBox!.height).toBeLessThan(64);

  // 탭하면 다시 펼쳐진다.
  await page.getByTestId('gourmet-panel-toggle').click();
  await expect(panel).toHaveAttribute('data-collapsed', 'false');
  await expect(page.getByTestId('gourmet-genre-chip')).not.toHaveCount(0);
});

test('접힘은 이 기기가 기억한다 — 기본값은 펼침', async ({ page }) => {
  await openWithGoogle(page);
  await openGoogleMap(page);
  await activateGourmet(page);

  // 처음 켠 사람은 칩을 본다.
  await expect(page.getByTestId('gourmet-panel')).toHaveAttribute('data-collapsed', 'false');
  await page.getByTestId('gourmet-panel-toggle').click();
  await expect(page.getByTestId('gourmet-panel')).toHaveAttribute('data-collapsed', 'true');

  await page.reload();
  await expect(page.getByTestId('tab-bar')).toBeVisible();
  await openSheetScopedMap(page);
  await expect(page.getByTestId('google-map')).toHaveAttribute('data-status', 'ready');
  await activateGourmet(page);

  await expect(page.getByTestId('gourmet-panel')).toHaveAttribute('data-collapsed', 'true');
});

/* ------------------------------------------------------------------ *
 * 9. 390px
 * ------------------------------------------------------------------ */

test.describe('폰 폭', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('패널도 팝업도 가로로 넘치지 않는다', async ({ page }) => {
    await openWithGoogle(page);
    await openGoogleMap(page);
    await activateGourmet(page);

    const overflow = () =>
      page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
    expect(await overflow()).toBeLessThanOrEqual(0);

    const panel = await page.getByTestId('gourmet-panel').boundingBox();
    expect(panel).not.toBeNull();
    expect(panel!.x).toBeGreaterThanOrEqual(0);
    expect(panel!.x + panel!.width).toBeLessThanOrEqual(390);

    // 토글도 패널도 서로를 가리지 않는다 — 버튼은 패널 위쪽에 산다.
    const toggle = await page.getByTestId('gourmet-toggle').boundingBox();
    expect(toggle).not.toBeNull();
    expect(toggle!.y + toggle!.height).toBeLessThanOrEqual(panel!.y);

    await clickSpot(page, 'curated:spec-okonomi');
    const popup = await page.getByTestId('gourmet-popup').boundingBox();
    expect(popup).not.toBeNull();
    expect(popup!.x).toBeGreaterThanOrEqual(0);
    expect(popup!.x + popup!.width).toBeLessThanOrEqual(390);
    expect(popup!.y + popup!.height).toBeLessThanOrEqual(844);
    expect(await overflow()).toBeLessThanOrEqual(0);
  });
});
