import { expect, test, type Page } from '@playwright/test';
import { startMockApi, type MockApi } from './mock-api';

/**
 * M14 — zero-config bootstrap. A `bootstrap-config.json` served next to the
 * app configures sync + AI on a fresh device; user choices always win.
 *
 * The preview server has no such file (404 → untouched app), so every test
 * here injects one with `page.route`.
 */

let api: MockApi;

test.beforeAll(async () => {
  api = await startMockApi();
});

test.afterAll(async () => {
  await api.stop();
});

/** Serve the bootstrap file pointing at this run's mock NAS. */
async function serveBootstrap(page: Page): Promise<void> {
  await page.route('**/bootstrap-config.json', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        sync: { baseUrl: api.baseUrl, token: api.token },
        aiEnabled: true,
      }),
    }),
  );
}

test('부트스트랩 파일이 있으면 무설정으로 동기화·AI가 켜진다', async ({ page }) => {
  await serveBootstrap(page);
  await page.goto('/');

  // Sync connects by itself — no settings sheet touched.
  await expect(page.getByTestId('sync-chip')).toHaveAttribute('data-status', 'idle', {
    timeout: 15_000,
  });

  await page.getByTestId('sync-chip').click();
  await expect(page.getByTestId('sync-base-url')).toHaveValue(api.baseUrl);
  await expect(page.getByTestId('bootstrap-note')).toBeVisible();
  await expect(page.getByTestId('ai-toggle')).toHaveAttribute('data-on', 'true');
  await expect(page.getByTestId('ai-status')).toHaveText('사용 준비 완료');
});

test('해제하면 다음 로드에서 다시 연결하지 않는다', async ({ page }) => {
  await serveBootstrap(page);
  await page.goto('/');
  await expect(page.getByTestId('sync-chip')).toHaveAttribute('data-status', 'idle', {
    timeout: 15_000,
  });

  await page.getByTestId('sync-chip').click();
  await page.getByTestId('sync-clear').click();
  await expect(page.getByTestId('sync-chip')).toHaveAttribute('data-status', 'off');

  await page.reload();
  await expect(page.getByTestId('sync-chip')).toHaveAttribute('data-status', 'off');
  await page.getByTestId('sync-chip').click();
  await expect(page.getByTestId('bootstrap-note')).toHaveCount(0);
});

test('AI를 명시적으로 끄면 리로드해도 꺼진 채 유지된다', async ({ page }) => {
  await serveBootstrap(page);
  await page.goto('/');
  await expect(page.getByTestId('sync-chip')).toHaveAttribute('data-status', 'idle', {
    timeout: 15_000,
  });

  await page.getByTestId('sync-chip').click();
  await expect(page.getByTestId('ai-toggle')).toHaveAttribute('data-on', 'true');
  await page.getByTestId('ai-toggle').click();
  await expect(page.getByTestId('ai-toggle')).toHaveAttribute('data-on', 'false');

  await page.reload();
  await page.getByTestId('sync-chip').click();
  await expect(page.getByTestId('ai-toggle')).toHaveAttribute('data-on', 'false');
});
