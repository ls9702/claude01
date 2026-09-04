import { expect, test } from '@playwright/test';

test('앱이 뜨고 탭 6개가 보인다', async ({ page }) => {
  await page.goto('/');

  const tabBar = page.getByTestId('tab-bar');
  await expect(tabBar).toBeVisible();
  // M52a — 드로우가 여섯 번째 탭으로 붙었다.
  await expect(tabBar.getByRole('tab')).toHaveCount(6);
  // Each tab renders an icon + its Korean label.
  await expect(tabBar.getByRole('tab')).toContainText([
    '여행',
    '보드',
    '일정',
    '지도',
    '메모',
    '드로우',
  ]);
  for (const id of ['trips', 'board', 'timeline', 'map', 'memo', 'draw']) {
    await expect(tabBar.getByTestId(`tab-${id}`)).toBeVisible();
  }

  // Default route.
  await expect(page).toHaveURL(/#\/trips$/);
  await expect(page.getByTestId('view-trips')).toBeVisible();
});

test('보드 탭을 누르면 해시와 화면이 바뀐다', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('tab-bar')).toBeVisible();

  await page.getByTestId('tab-board').click();

  await expect(page).toHaveURL(/#\/board$/);
  await expect(page.getByTestId('view-board')).toBeVisible();
  await expect(page.getByTestId('view-board')).toContainText('보드');
  await expect(page.getByTestId('view-trips')).toHaveCount(0);
});
