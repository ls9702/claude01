import { expect, test, type Page } from '@playwright/test';

/**
 * 모바일 지도 최대화 — M45.
 *
 * 실사용 신고: 폰에서 지도 탭을 열면 제목·카테고리 칩·표시 줄·경로 줄이 화면의
 * 절반을 가져가고, 아래에는 탭 바가 있다. 남는 상자에서 동선을 읽는 것은 어렵다.
 *
 * 그래서 버튼 하나로 지도가 화면을 다 쓴다. 못박는 것은 넷이다.
 *
 * 1. **폰에만 있다** — 데스크톱 폭에서는 버튼 자체가 없다.
 * 2. **정말 커진다** — 상자가 뷰포트만 해지고 탭 바를 덮는다.
 * 3. **나가는 문이 분명하다** — 복귀 버튼이 화면 안에 있고, 누르면 원래 자리로.
 * 4. **저장하지 않는다** — 다시 열면 평소 크기다. 이건 설정이 아니라 몸짓이다.
 */

test.use({ viewport: { width: 390, height: 844 } });

/** A transparent 1×1 png — enough for Leaflet to count as a loaded tile. */
const TILE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function stubNetwork(page: Page): Promise<void> {
  await page.route('**/nominatim.openstreetmap.org/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.route(/tile\.openstreetmap\.org/, (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: TILE_PNG }),
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

/** 지도 탭까지 — 핀은 없어도 된다. 이 스펙이 재는 것은 상자다. */
async function openMap(page: Page, title: string): Promise<void> {
  await stubNetwork(page);
  await page.goto('/');
  await expect(page.getByTestId('tab-bar')).toBeVisible();
  await createTrip(page, title);
  await page.getByTestId('tab-map').click();
  await expect(page.getByTestId('map-root')).toBeVisible();
}

const rootBox = async (page: Page) => {
  const box = await page.getByTestId('map-root').boundingBox();
  if (!box) throw new Error('지도 상자를 찾지 못했어요');
  return box;
};

test('폰에서 최대화하면 지도가 화면을 다 쓰고, 복귀 버튼으로 돌아온다', async ({ page }) => {
  await openMap(page, '오사카 전체화면');

  const root = page.getByTestId('map-root');
  await expect(root).toHaveAttribute('data-fullscreen', 'false');
  const before = await rootBox(page);
  // 평소에는 헤더·칩 줄들 아래에 있고, 탭 바 위에서 끝난다.
  expect(before.y).toBeGreaterThan(0);
  expect(before.height).toBeLessThan(844);

  const enter = page.getByTestId('map-fullscreen');
  await expect(enter).toBeVisible();
  // 「내 위치」와 겹치지 않는다 — 하나는 왼쪽 위, 하나는 오른쪽.
  const locateBox = await page.getByTestId('map-locate').boundingBox();
  const enterBox = await enter.boundingBox();
  if (!locateBox || !enterBox) throw new Error('버튼을 찾지 못했어요');
  expect(enterBox.x + enterBox.width).toBeLessThanOrEqual(locateBox.x);

  await enter.click();
  await expect(root).toHaveAttribute('data-fullscreen', 'true');

  const after = await rootBox(page);
  expect(Math.round(after.x)).toBe(0);
  expect(Math.round(after.y)).toBe(0);
  expect(Math.round(after.width)).toBe(390);
  expect(Math.round(after.height)).toBe(844);
  // Leaflet도 그 크기를 알고 있다 — `invalidateSize`가 돌았다는 뜻이다.
  await expect
    .poll(async () => Number(await root.getAttribute('data-map-height')))
    .toBeGreaterThan(before.height);

  // 탭 바를 덮었다: 그게 이 모드의 목적이다.
  const tabBar = await page.getByTestId('tab-bar').boundingBox();
  expect(tabBar).not.toBeNull();
  const covered = await page.evaluate(() => {
    const point = document.elementFromPoint(195, 820);
    return point?.closest('[data-testid="map-root"]') !== null;
  });
  expect(covered).toBe(true);

  // 들어온 버튼은 사라지고 나가는 문이 선다.
  await expect(page.getByTestId('map-fullscreen')).toHaveCount(0);
  const exit = page.getByTestId('map-fullscreen-exit');
  await expect(exit).toBeVisible();
  const exitBox = await exit.boundingBox();
  if (!exitBox) throw new Error('복귀 버튼을 찾지 못했어요');
  expect(exitBox.x).toBeGreaterThanOrEqual(0);
  expect(exitBox.y).toBeGreaterThanOrEqual(0);
  expect(exitBox.x + exitBox.width).toBeLessThanOrEqual(390);

  // 「내 위치」는 전체화면에서도 그대로 동작한다 — 손잡이가 줄지 않는다.
  await expect(page.getByTestId('map-locate')).toBeVisible();

  await exit.click();
  await expect(root).toHaveAttribute('data-fullscreen', 'false');
  const back = await rootBox(page);
  expect(Math.round(back.y)).toBe(Math.round(before.y));
  expect(Math.round(back.height)).toBe(Math.round(before.height));
});

test('전체화면은 저장되지 않는다 — 다시 열면 평소 크기다', async ({ page }) => {
  await openMap(page, '오사카 세션');

  await page.getByTestId('map-fullscreen').click();
  await expect(page.getByTestId('map-root')).toHaveAttribute('data-fullscreen', 'true');

  // 리로드하면 평소 크기다 — 이 상태는 어디에도 적히지 않는다.
  await page.reload();
  await expect(page.getByTestId('tab-bar')).toBeVisible();
  await expect(page.getByTestId('map-root')).toHaveAttribute('data-fullscreen', 'false');

  // 나갔다 온 뒤 다른 탭을 들렀다 와도 마찬가지다.
  await page.getByTestId('map-fullscreen').click();
  await page.getByTestId('map-fullscreen-exit').click();
  await page.getByTestId('tab-board').click();
  await page.getByTestId('tab-map').click();
  await expect(page.getByTestId('map-root')).toHaveAttribute('data-fullscreen', 'false');
  await expect(page.getByTestId('map-fullscreen')).toBeVisible();
});

test.describe('데스크톱', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('넓은 화면에는 최대화 버튼이 아예 없다', async ({ page }) => {
    await openMap(page, '오사카 데스크톱');
    await expect(page.getByTestId('map-root')).toBeVisible();
    await expect(page.getByTestId('map-fullscreen')).toHaveCount(0);
    await expect(page.getByTestId('map-fullscreen-exit')).toHaveCount(0);
    // 「내 위치」는 그대로 있다 — 사라진 것은 최대화뿐이다.
    await expect(page.getByTestId('map-locate')).toBeVisible();
  });
});
