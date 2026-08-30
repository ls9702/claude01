import { expect, test, type Page } from '@playwright/test';
import { startMockApi, type MockApi } from './mock-api';

/**
 * 📤 사진 보관 — 원본 그대로 NAS로 (M46).
 *
 * The feature's whole claim is that nothing between the camera roll and the
 * disk touches the file, so the assertion that matters is a **byte count**: the
 * mock stores the length it actually received, and a build that quietly
 * compressed on the way (the way card photos are compressed, deliberately)
 * would fail this and nothing else.
 *
 * The rest is the shape of the sheet: a batch reports `n/N` while it runs and a
 * summary when it stops, a file that is not a photo is skipped rather than
 * failing the whole batch, and the button is not there at all on a device with
 * no server to file to.
 */

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

/** Sets the archive folder through the admin sheet, the way the owner would. */
async function setArchiveFolder(page: Page, folder: string): Promise<void> {
  await page.getByTestId('sync-chip').click();
  await page.getByTestId('admin-open').click();
  await page.getByTestId('admin-token-input').fill(api.adminToken);
  await page.getByTestId('admin-token-submit').click();
  await expect(page.getByTestId('admin-usage')).toBeVisible();
  await page.getByTestId('admin-archive-folder').fill(folder);
  await page.getByTestId('admin-archive-save').click();
  await expect(page.getByTestId('admin-result')).toHaveAttribute('data-tone', 'ok');
  await page.getByTestId('sheet-close').last().click();
  await page.getByTestId('sheet-close').click();
  await expect(page.getByTestId('sync-settings')).toHaveCount(0);
}

/** A recognisable blob of bytes, big enough that a resize would change it. */
const photoBytes = (size: number, fill: number): Buffer => Buffer.alloc(size, fill);

test('동기화가 없는 기기에는 버튼이 아예 없다', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('tab-bar')).toBeVisible();
  // GitHub Pages 배포가 이 상태다 — 보낼 곳이 없으면 보내기 버튼도 없다.
  await expect(page.getByTestId('photo-archive-open')).toHaveCount(0);
});

test('사진 두 장을 원본 그대로 보관한다', async ({ page }) => {
  await page.goto('/');
  await configureSync(page);
  await setArchiveFolder(page, '2026-11-osaka');
  await page.reload();

  await page.getByTestId('photo-archive-open').click();
  await expect(page.getByTestId('photo-archive')).toBeVisible();

  await page.getByTestId('photo-archive-input').setInputFiles([
    { name: 'IMG_0001.jpg', mimeType: 'image/jpeg', buffer: photoBytes(40_000, 0x11) },
    { name: '오사카 여행.png', mimeType: 'image/png', buffer: photoBytes(25_000, 0x22) },
  ]);

  await expect(page.getByTestId('photo-archive-progress')).toHaveAttribute('data-done', '2');
  await expect(page.getByTestId('photo-archive-progress')).toContainText('2장 보관했어요');
  await expect(page.getByTestId('photo-archive-row')).toHaveCount(2);

  const stored = api.archived();
  expect(stored).toHaveLength(2);
  // **원본 그대로.** 카드 사진은 500KB로 갈아 넣지만 보관함은 그 반대다 —
  // 바이트 수가 그대로여야 이 기능이 존재할 이유가 있다.
  expect(stored[0].bytes).toBe(40_000);
  expect(stored[1].bytes).toBe(25_000);

  // 한글 파일명은 서버가 쓸 수 있는 이름으로 다시 지어진다.
  expect(stored[0].name).toBe('IMG_0001.jpg');
  expect(stored[1].name).toBe('photo.png');

  await expect(page.getByTestId('photo-archive-row').first()).toContainText('2026-11-osaka');
});

test('사진이 아닌 파일은 건너뛰고 나머지는 보관한다', async ({ page }) => {
  await page.goto('/');
  await configureSync(page);
  await setArchiveFolder(page, '2026-11-osaka');
  await page.reload();

  await page.getByTestId('photo-archive-open').click();
  await page.getByTestId('photo-archive-input').setInputFiles([
    { name: 'clip.mp4', mimeType: 'video/mp4', buffer: photoBytes(1_000, 0x33) },
    { name: 'IMG_0002.heic', mimeType: 'image/heic', buffer: photoBytes(9_000, 0x44) },
  ]);

  await expect(page.getByTestId('photo-archive-progress')).toHaveAttribute('data-done', '2');
  // 스무 장 중 한 장이 화면 녹화라고 해서 스무 장이 다 거절되면 쓸모가 없다.
  await expect(page.getByTestId('photo-archive-progress')).toContainText('1장 보관했어요');
  await expect(page.getByTestId('photo-archive-progress')).toContainText('건너뛰었어요');

  await expect(
    page.locator('[data-testid="photo-archive-row"][data-outcome="skipped"]'),
  ).toHaveCount(1);
  expect(api.archived().map((item) => item.name)).toEqual(['IMG_0002.heic']);
});

test('보관 폴더가 없으면 서버의 한국어 안내가 그대로 뜬다', async ({ page }) => {
  await page.goto('/');
  await configureSync(page);
  await page.reload();

  await page.getByTestId('photo-archive-open').click();
  await page.getByTestId('photo-archive-input').setInputFiles([
    { name: 'IMG_0003.jpg', mimeType: 'image/jpeg', buffer: photoBytes(5_000, 0x55) },
  ]);

  const row = page.locator('[data-testid="photo-archive-row"][data-outcome="failed"]');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('관리자');
  expect(api.archived()).toHaveLength(0);
});
