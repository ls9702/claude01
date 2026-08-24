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

/** Serve the bootstrap file pointing at `target` (this run's mock NAS by default). */
async function serveBootstrap(page: Page, target: MockApi = api): Promise<void> {
  await page.unroute('**/bootstrap-config.json').catch(() => {});
  await page.route('**/bootstrap-config.json', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        sync: { baseUrl: target.baseUrl, token: target.token },
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

/* ------------------------------------------------------------------ *
 * M20 — 주소 자동 이행
 * ------------------------------------------------------------------ */

test('부트스트랩 주소가 바뀌면 자동으로 따라간다', async ({ page }) => {
  await serveBootstrap(page);
  await page.goto('/');
  await expect(page.getByTestId('sync-chip')).toHaveAttribute('data-status', 'idle', {
    timeout: 15_000,
  });

  // The NAS moves — new DDNS name, new port, whatever. The file moves with it.
  const moved = await startMockApi('moved-token');
  try {
    await serveBootstrap(page, moved);
    await page.reload();

    await expect(page.getByTestId('sync-chip')).toHaveAttribute('data-status', 'idle', {
      timeout: 15_000,
    });
    await page.getByTestId('sync-chip').click();
    await expect(page.getByTestId('sync-base-url')).toHaveValue(moved.baseUrl);
    await expect(page.getByTestId('sync-token')).toHaveValue('moved-token');
    // Still an auto-configured device, so it will follow the next move too.
    await expect(page.getByTestId('bootstrap-note')).toBeVisible();
  } finally {
    await moved.stop();
  }
});

test('직접 저장한 기기는 부트스트랩 주소가 바뀌어도 그대로 둔다', async ({ page }) => {
  const other = await startMockApi('typed-token');
  try {
    await serveBootstrap(page);
    await page.goto('/');

    // The user types their own address — which clears the applied marker, and
    // with it the file's licence to move this device around.
    await page.getByTestId('sync-chip').click();
    await page.getByTestId('sync-base-url').fill(other.baseUrl);
    await page.getByTestId('sync-token').fill('typed-token');
    await page.getByTestId('sync-save').click();
    await expect(page.getByTestId('sync-notice')).toHaveText('저장했어요');
    await expect(page.getByTestId('bootstrap-note')).toHaveCount(0);

    const moved = await startMockApi('moved-token');
    try {
      await serveBootstrap(page, moved);
      await page.reload();
      await page.getByTestId('sync-chip').click();
      await expect(page.getByTestId('sync-base-url')).toHaveValue(other.baseUrl);
    } finally {
      await moved.stop();
    }
  } finally {
    await other.stop();
  }
});
