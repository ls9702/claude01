import { expect, test, type Page } from '@playwright/test';

/**
 * 지도 필터 (M27) — 「무엇을 지도에 올릴 것인가」.
 *
 * M3의 지도는 여행의 위치 있는 카드를 전부 한꺼번에 뿌렸다. 이 스펙은 그 위에
 * 얹힌 두 가지 좁히기를 지킨다.
 *
 * 1. **범위** — 전체 아이템 / 일정 전체 / 일자별 / 미확정. 일자 판정은 05시
 *    창이라서, 2일차 02:00에 걸어 둔 심야 라멘은 지도에서도 **1일차**다
 *    (`timeline/dayWindow`, HANDOFF §4.3). 이 파일에 심야 라멘이 있는 이유가
 *    그것 하나다.
 * 2. **카테고리** — 범례 칩. 사용자가 직접 만든 카테고리(여기서는 「맛집」)도
 *    당연히 같은 칩을 얻는다.
 *
 * 마지막 테스트는 사용자가 같은 요청에서 물은 것을 지킨다: 새로 만든 카테고리가
 * 일정표의 「필요 예산」 카테고리별 팝오버에도 잡히는가 (M25).
 *
 * map.spec.ts와 같은 이유로 **오프라인**이다 — Nominatim과 타일을 둘 다 막는다.
 */

test.use({ viewport: { width: 1280, height: 800 } });

/** 시부야 두 곳 — 카드마다 둘 중 하나를 골라 붙인다. */
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

/** Leaflet이 「타일 하나 그렸다」고 볼 수 있는 최소 png. */
const TILE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function stubNetwork(page: Page): Promise<void> {
  await page.route('**/nominatim.openstreetmap.org/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(NOMINATIM_FIXTURE),
    }),
  );
  await page.route(/tile\.openstreetmap\.org/, (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: TILE_PNG }),
  );
}

/** IndexedDB의 워크스페이스가 `needle`을 담을 때까지 — reload 경합 방지. */
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

async function createTrip(page: Page, title: string): Promise<void> {
  await page.getByTestId('add-trip').click();
  await page.getByTestId('trip-title-input').fill(title);
  await page.getByTestId('trip-submit').click();
  await expect(page.getByTestId('trip-form')).toHaveCount(0);
  await page.getByTestId('trip-card').filter({ hasText: title }).getByTestId('trip-open').click();
  await expect(page).toHaveURL(/#\/board$/);
}

/** 사용자가 직접 만드는 카테고리 — 씨앗 다섯 칸 뒤에 붙는다. */
async function addColumn(page: Page, name: string): Promise<void> {
  await page.getByTestId('add-column').click();
  await page.getByTestId('column-name-input').fill(name);
  await page.getByTestId('add-column-submit').click();
  await expect(page.getByTestId('add-column-form')).toHaveCount(0);
}

async function addCard(
  page: Page,
  columnIndex: number,
  title: string,
  budget?: string,
): Promise<void> {
  await page.getByTestId('board-column').nth(columnIndex).getByTestId('add-card').click();
  await page.getByTestId('card-title-input').fill(title);
  if (budget) await page.getByTestId('card-budget-input').fill(budget);
  await page.getByTestId('card-submit').click();
  await expect(page.getByTestId('card-form')).toHaveCount(0);
}

async function openCard(page: Page, title: string): Promise<void> {
  await page.getByTestId('board-card').filter({ hasText: title }).click();
  await expect(page.getByTestId('card-form')).toBeVisible();
}

/** 카드에 위치를 붙인다 — 스텁 두 곳 중 `index`번째. */
async function locate(page: Page, title: string, index: number): Promise<void> {
  await openCard(page, title);
  await page.getByTestId('card-location-search').click();
  await expect(page.getByTestId('place-search')).toBeVisible();
  await page.getByTestId('place-search-submit').click();
  await expect(page.getByTestId('place-search-result')).toHaveCount(2);
  await page.getByTestId('place-search-result').nth(index).click();
  await expect(page.getByTestId('place-search')).toHaveCount(0);
  await page.getByTestId('card-submit').click();
  await expect(page.getByTestId('card-form')).toHaveCount(0);
}

/**
 * 카드를 `dayIndex`번째 일자에 건다. 기본 시각은 10:00이고, 15분 단위로 민다
 * (`nudge`가 음수면 앞으로).
 */
async function schedule(
  page: Page,
  title: string,
  dayIndex: number,
  nudge = 0,
): Promise<void> {
  await openCard(page, title);
  await page.getByTestId('card-schedule').click();
  await page.getByTestId('schedule-day-option').nth(dayIndex).click();
  const step = nudge < 0 ? 'schedule-start-minus' : 'schedule-start-plus';
  for (let i = 0; i < Math.abs(nudge); i += 1) await page.getByTestId(step).click();
  await page.getByTestId('schedule-submit').click();
  await expect(page.getByTestId('schedule-sheet')).toHaveCount(0);
}

/** Leaflet이 패널을 재고 타일을 그릴 때까지. */
async function expectLiveMap(page: Page): Promise<void> {
  const root = page.getByTestId('map-root');
  await expect(root).toHaveAttribute('data-ready', 'true');
  await expect.poll(() => page.locator('.leaflet-tile').count()).toBeGreaterThan(0);
}

/** 일자 `count`개짜리 일정표를 만들고 보드로 돌아온다. */
async function addDays(page: Page, count: number): Promise<void> {
  await page.getByTestId('tab-timeline').click();
  await page.getByTestId('timeline-add-day-empty').click();
  await expect(page.getByTestId('timeline-day')).toHaveCount(1);
  for (let day = 2; day <= count; day += 1) {
    await page.getByTestId('timeline-add-day').click();
    await expect(page.getByTestId('timeline-day')).toHaveCount(day);
  }
  await page.getByTestId('tab-board').click();
}

/**
 * 이 파일의 표준 여행 — 위치 있는 카드 다섯 장.
 *
 * | 카드 | 카테고리 | 배치 |
 * |---|---|---|
 * | 아침 산책 | 볼거리 | 1일차 10:00 |
 * | 점심 라멘 | 맛집(직접 만든 칸) | 1일차 10:30 |
 * | 전망대 | 볼거리 | 2일차 10:00 |
 * | 심야 라멘 | 맛집 | **2일차 02:00** → 05시 창에서는 1일차 밤 |
 * | 미정 맛집 | 맛집 | 없음 → 미확정 |
 */
async function seedTrip(page: Page): Promise<void> {
  await createTrip(page, '오사카 필터');
  await addColumn(page, '맛집');

  await addCard(page, 4, '아침 산책');
  await addCard(page, 5, '점심 라멘', '20000');
  await addCard(page, 4, '전망대');
  await addCard(page, 5, '심야 라멘');
  await addCard(page, 5, '미정 맛집');

  await locate(page, '아침 산책', 0);
  await locate(page, '점심 라멘', 1);
  await locate(page, '전망대', 0);
  await locate(page, '심야 라멘', 1);
  await locate(page, '미정 맛집', 1);

  await addDays(page, 2);
  await schedule(page, '아침 산책', 0);
  await schedule(page, '점심 라멘', 0, 2);
  await schedule(page, '전망대', 1);
  // 「1일차 02:00」 — 배치 시트도 창 좌표로 말한다. 저장은 2일차 02:00이고,
  // 일정표도 지도도 이것을 **1일차** 밤으로 그린다 (daywindow.spec과 같은 손짓).
  await schedule(page, '심야 라멘', 0, -32);
}

test.beforeEach(async ({ page }) => {
  await stubNetwork(page);
  await page.goto('/');
  await expect(page.getByTestId('tab-bar')).toBeVisible();
});

test('범위 필터가 일자·일정 전체·미확정을 갈라 보여 준다', async ({ page }) => {
  await seedTrip(page);

  await page.getByTestId('tab-map').click();
  await expectLiveMap(page);

  // 기본값은 M3부터의 동작 그대로 — 전체 아이템, 다섯 곳.
  await expect(page.getByTestId('map-scope-all')).toHaveAttribute('data-active', 'true');
  await expect(page.getByTestId('map-marker')).toHaveCount(5);
  await expect(page.getByTestId('map-pin-count')).toHaveAttribute('data-count', '5');

  // 일정 전체 — 미확정 한 장이 빠진다.
  await page.getByTestId('map-scope-sheet').click();
  await expect(page.getByTestId('map-scope-sheet')).toHaveAttribute('data-active', 'true');
  await expect(page.getByTestId('map-scope-all')).toHaveAttribute('data-active', 'false');
  await expect(page.getByTestId('map-marker')).toHaveCount(4);

  // 일자별 — 1일차. 심야 라멘(2일차 02:00)이 여기에 든다: 05시 창이다.
  await page.getByTestId('map-scope-day').click();
  await expect(page.getByTestId('map-scope-day')).toHaveAttribute('data-active', 'true');
  await expect(page.getByTestId('map-marker')).toHaveCount(3);
  // 그날의 동선이 자연스러운 짝 — 일자 칩이 곧 이 범위의 일자 피커다.
  await expect(page.getByTestId('map-route-day').first()).toHaveAttribute('data-active', 'true');
  await expect(page.getByTestId('map-scope-day-label')).toContainText('1일차');

  // 2일차 — 전망대 하나만 남는다. 심야 라멘은 앞날의 밤이라 여기 없다.
  await page.getByTestId('map-route-day').nth(1).click();
  await expect(page.getByTestId('map-marker')).toHaveCount(1);
  await expect(page.getByTestId('map-scope-day-label')).toContainText('2일차');

  // 미확정 — 어디에도 안 건 한 장. 경로는 스스로 꺼진다(보이지 않는 핀을 잇는
  // 화살표는 거짓말이다).
  await page.getByTestId('map-scope-unscheduled').click();
  await expect(page.getByTestId('map-marker')).toHaveCount(1);
  await expect(page.getByTestId('map-route-off')).toHaveAttribute('data-active', 'true');
  await expect(page.getByTestId('route-stop')).toHaveCount(0);

  await page.getByTestId('map-marker').click();
  await expect(page.getByTestId('map-popup')).toContainText('미정 맛집');

  // 전체로 돌아오면 다시 다섯 곳이다.
  await page.getByTestId('map-scope-all').click();
  await expect(page.getByTestId('map-marker')).toHaveCount(5);
});

test('카테고리 칩이 범위 안에서 다시 좁힌다', async ({ page }) => {
  await seedTrip(page);

  await page.getByTestId('tab-map').click();
  await expectLiveMap(page);

  // 직접 만든 「맛집」도 범례 칩을 얻는다 — 카테고리는 고정 목록이 아니다.
  const chips = page.getByTestId('map-legend-chip');
  await expect(chips).toHaveCount(2);
  const sightseeing = chips.filter({ hasText: '볼거리' });
  const food = chips.filter({ hasText: '맛집' });
  await expect(food).toHaveCount(1);

  // 볼거리를 끄면 맛집만 — 전체 아이템 안에서 셋(라멘 둘 + 미확정 하나).
  await sightseeing.click();
  await expect(sightseeing).toHaveAttribute('data-active', 'false');
  await expect(page.getByTestId('map-marker')).toHaveCount(3);
  await expect(page.getByTestId('map-pin-count')).toHaveAttribute('data-count', '3');

  // 범위를 겹쳐도 그대로 성립한다: 1일차 ∩ 맛집 = 라멘 둘.
  await page.getByTestId('map-scope-day').click();
  await expect(page.getByTestId('map-marker')).toHaveCount(2);

  // 남은 하나까지 끄면 빈 지도가 아니라 한 줄짜리 안내가 뜬다.
  await food.click();
  await expect(page.getByTestId('map-marker')).toHaveCount(0);
  await expect(page.getByTestId('map-empty')).toHaveCount(0);
  await expect(page.getByTestId('map-filter-empty')).toContainText('카테고리');

  // 되돌리기 한 번이면 범위도 카테고리도 원래대로.
  await page.getByTestId('map-filter-reset').click();
  await expect(page.getByTestId('map-filter-empty')).toHaveCount(0);
  await expect(page.getByTestId('map-scope-all')).toHaveAttribute('data-active', 'true');
  await expect(page.getByTestId('map-marker')).toHaveCount(5);
  await expect(sightseeing).toHaveAttribute('data-active', 'true');

  // 「전체 카테고리」 칩은 꺼 둔 것이 있을 때만 나타난다.
  await expect(page.getByTestId('map-legend-all')).toHaveCount(0);
  await food.click();
  await expect(page.getByTestId('map-legend-all')).toBeVisible();
  await page.getByTestId('map-legend-all').click();
  await expect(page.getByTestId('map-legend-all')).toHaveCount(0);
  await expect(page.getByTestId('map-marker')).toHaveCount(5);
});

test('고른 범위와 카테고리는 이 기기에 남는다', async ({ page }) => {
  await createTrip(page, '교토 필터');
  await addColumn(page, '맛집');
  await addCard(page, 4, '기요미즈데라');
  await addCard(page, 5, '니시키 시장');
  await locate(page, '기요미즈데라', 0);
  await locate(page, '니시키 시장', 1);

  await addDays(page, 2);
  await schedule(page, '기요미즈데라', 0);

  await page.getByTestId('tab-map').click();
  await expectLiveMap(page);
  await expect(page.getByTestId('map-marker')).toHaveCount(2);

  // 미확정 + 볼거리 끔 — 니시키 시장 한 곳만 남는 조합.
  await page.getByTestId('map-scope-unscheduled').click();
  await page.getByTestId('map-legend-chip').filter({ hasText: '볼거리' }).click();
  await expect(page.getByTestId('map-marker')).toHaveCount(1);

  await waitForPersisted(page, '니시키 시장');
  await page.reload();
  await expect(page.getByTestId('tab-bar')).toBeVisible();
  await expectLiveMap(page);

  await expect(page.getByTestId('map-scope-unscheduled')).toHaveAttribute('data-active', 'true');
  await expect(
    page.getByTestId('map-legend-chip').filter({ hasText: '볼거리' }),
  ).toHaveAttribute('data-active', 'false');
  await expect(page.getByTestId('map-marker')).toHaveCount(1);
});

test('새로 만든 카테고리도 일정표의 필요 예산에 잡힌다', async ({ page }) => {
  await createTrip(page, '오사카 예산');
  await addColumn(page, '맛집');
  await addCard(page, 5, '점심 라멘', '20000');

  await page.getByTestId('tab-timeline').click();
  await page.getByTestId('timeline-add-day-empty').click();
  await expect(page.getByTestId('timeline-day')).toHaveCount(1);
  await page.getByTestId('tab-board').click();
  await schedule(page, '점심 라멘', 0);

  // M25의 카테고리별 팝오버는 칼럼 id로 나눈다 — 목록이 박혀 있지 않다.
  await page.getByTestId('tab-timeline').click();
  await page.getByTestId('spend-summary-cats-open').click();
  const row = page.getByTestId('spend-cat-row').filter({ hasText: '맛집' });
  await expect(row).toHaveCount(1);
  await expect(row).toHaveAttribute('data-budget', '20000');
  await expect(page.getByTestId('spend-summary-sheet')).toHaveAttribute('data-budget', '20000');
});

test.describe('좁은 화면', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('390px에서도 표시 줄이 가로로 넘치지 않는다', async ({ page }) => {
    await createTrip(page, '후쿠오카 필터');
    await addCard(page, 4, '오호리 공원');
    await locate(page, '오호리 공원', 0);
    await addDays(page, 1);
    await schedule(page, '오호리 공원', 0);

    await page.getByTestId('tab-map').click();
    await expectLiveMap(page);

    // 칩 줄은 스스로 스크롤한다 — 화면이 통째로 옆으로 밀리지 않는다.
    await expect(page.getByTestId('map-scope-controls')).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    // 세그먼트는 44px 터치 타깃을 지킨다.
    const box = await page.getByTestId('map-scope-unscheduled').boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(36);
    await page.getByTestId('map-scope-unscheduled').click();
    await expect(page.getByTestId('map-filter-empty')).toBeVisible();
  });
});
