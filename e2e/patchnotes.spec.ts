import { expect, test, type Page } from '@playwright/test';

/**
 * 패치노트 「새 소식」 — M40.
 *
 * 두 사람은 배포 노트를 읽지 않는다. 그래서 앱이 스스로, 조용히, 한 번만 말한다:
 * 새 회차가 나가면 버튼에 점이 하나 붙고, 한 번 열면 그 점은 사라진다.
 *
 * 여기서 못박는 것은 세 가지다.
 *
 * 1. 처음 켠 기기에는 점이 있고, 열면 회차 목록이 최신부터 뜬다.
 * 2. 열자마자 「봤음」이 이 기기에 적혀서, 점은 새로고침을 해도 돌아오지 않는다.
 * 3. 옛 회차만 본 기기에는 점이 **다시** 뜬다 — 다음 배포가 이 길로 온다.
 *
 * 일정 탭에는 이 버튼이 없다(그 줄은 이미 「리포트」가 물러날 만큼 좁다). 대신
 * 가장 한산한 여행 탭이 언제나 들고 있으므로, 배지는 어느 폭에서도 닿는다.
 */

const SEEN_KEY = 'trip-board/patch-seen';

/** 이 기기에 적힌 「여기까지 봤음」. */
const seenId = (page: Page): Promise<string | null> =>
  page.evaluate((key) => localStorage.getItem(key), SEEN_KEY);

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('tab-bar')).toBeVisible();
});

test('처음 켠 기기에는 점이 붙고, 한 번 열면 다시 붙지 않는다', async ({ page }) => {
  const button = page.getByTestId('patchnotes-open');
  await expect(button).toBeVisible();
  await expect(button).toHaveAttribute('data-unseen', 'true');
  await expect(page.getByTestId('patchnotes-badge')).toBeVisible();
  expect(await seenId(page)).toBeNull();

  await button.click();
  const sheet = page.getByTestId('patchnotes-sheet');
  await expect(sheet).toBeVisible();

  // 회차가 여럿, 최신이 맨 위. 각 회차는 제목과 한 줄 이상의 내용을 갖는다.
  const releases = sheet.getByTestId('patchnotes-release');
  const count = await releases.count();
  expect(count).toBeGreaterThanOrEqual(6);
  const newest = releases.first();
  await expect(newest.locator('li')).not.toHaveCount(0);
  const newestId = await newest.getAttribute('data-note-id');
  expect(newestId).toBeTruthy();

  // 여는 순간 「봤음」이 적히고, 점은 시트를 닫기도 전에 사라진다.
  expect(await seenId(page)).toBe(newestId);
  await expect(page.getByTestId('patchnotes-badge')).toHaveCount(0);

  await page.getByTestId('sheet-close').click();
  await expect(page.getByTestId('patchnotes-sheet')).toHaveCount(0);
  await expect(page.getByTestId('patchnotes-open')).toHaveAttribute('data-unseen', 'false');

  // 새로고침해도 돌아오지 않는다 — 기억은 이 기기의 것이다.
  await page.reload();
  await expect(page.getByTestId('tab-bar')).toBeVisible();
  await expect(page.getByTestId('patchnotes-open')).toHaveAttribute('data-unseen', 'false');
  await expect(page.getByTestId('patchnotes-badge')).toHaveCount(0);
});

test('옛 회차만 본 기기에는 점이 다시 뜬다', async ({ page }) => {
  // 다음 배포가 오는 길을 그대로 흉내 낸다: 기기에는 지난 회차 id가 적혀 있고,
  // 앱에는 그보다 새 회차가 들어 있다.
  await page.evaluate((key) => localStorage.setItem(key, 'v0'), SEEN_KEY);
  await page.reload();
  await expect(page.getByTestId('tab-bar')).toBeVisible();

  await expect(page.getByTestId('patchnotes-open')).toHaveAttribute('data-unseen', 'true');
  await expect(page.getByTestId('patchnotes-badge')).toBeVisible();

  await page.getByTestId('patchnotes-open').click();
  await expect(page.getByTestId('patchnotes-sheet')).toBeVisible();
  await expect(page.getByTestId('patchnotes-badge')).toHaveCount(0);
  expect(await seenId(page)).not.toBe('v0');
});

test.describe('모바일', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('폰에서는 여행 탭이 배지를 들고, 일정 탭은 들지 않는다', async ({ page }) => {
    // 여행 탭 — 가장 한산한 줄. 배지가 언제나 닿는 곳이다.
    await expect(page.getByTestId('patchnotes-open')).toBeVisible();
    await expect(page.getByTestId('patchnotes-badge')).toBeVisible();
    const box = await page.getByTestId('patchnotes-open').boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(32);

    // 여행이 있어야 나머지 탭이 열린다.
    await page.getByTestId('add-trip').click();
    await page.getByTestId('trip-title-input').fill('오사카 새소식');
    await page.getByTestId('trip-submit').click();
    await expect(page.getByTestId('trip-form')).toHaveCount(0);
    await page.getByTestId('trip-card').getByTestId('trip-open').click();
    await expect(page).toHaveURL(/#\/board$/);

    // 보드·지도·메모도 같은 자리에 든다.
    await expect(page.getByTestId('patchnotes-open')).toBeVisible();
    await page.getByTestId('tab-map').click();
    await expect(page.getByTestId('patchnotes-open')).toBeVisible();
    await page.getByTestId('tab-memo').click();
    await expect(page.getByTestId('patchnotes-open')).toBeVisible();

    // 일정 탭의 헤더 줄은 이미 좁다 — 여기에는 일부러 달지 않았다.
    await page.getByTestId('tab-timeline').click();
    await expect(page.getByTestId('view-timeline')).toBeVisible();
    await expect(page.getByTestId('patchnotes-open')).toHaveCount(0);

    // 보드로 돌아와 열고 닫는다 — 390px에서도 시트가 넘치지 않는다.
    await page.getByTestId('tab-board').click();
    await page.getByTestId('patchnotes-open').click();
    const sheet = page.getByTestId('patchnotes-sheet');
    await expect(sheet).toBeVisible();
    await expect(sheet.getByTestId('patchnotes-release').first()).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    await page.getByTestId('sheet-close').click();
    await expect(page.getByTestId('patchnotes-sheet')).toHaveCount(0);
    await expect(page.getByTestId('patchnotes-badge')).toHaveCount(0);
  });
});
