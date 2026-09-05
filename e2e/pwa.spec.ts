import { expect, test, type Page } from '@playwright/test';

/**
 * PWA wiring, checked against the real production build (the e2e suite already
 * runs `vite preview`, so the service worker and manifest are the built ones).
 *
 * Scope note: this asserts that the app *is installable and does cache its
 * shell*. It does not try to prove offline-first behaviour for the whole app —
 * the workspace lives in IndexedDB and is already covered by the board specs.
 */

/**
 * Waits for a fully **activated** worker.
 *
 * `navigator.serviceWorker.ready` is not enough on its own: it resolves as
 * soon as there is an active worker, which can still be in `activating` while
 * the precache finishes settling.
 */
async function waitForActiveWorker(page: Page): Promise<void> {
  await page.waitForFunction(
    async () => {
      const registration = await navigator.serviceWorker.ready;
      return registration.active?.state === 'activated';
    },
    undefined,
    { timeout: 20_000 },
  );
}

/**
 * Waits until a worker actually controls the page.
 *
 * With `registerType: 'prompt'` the worker deliberately does not call
 * `clients.claim()`, so the page that installed it stays uncontrolled — the
 * caller has to navigate once before this can succeed.
 */
async function waitForController(page: Page): Promise<void> {
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
    timeout: 20_000,
  });
}

test('설치용 manifest가 붙어 있다', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('tab-bar')).toBeVisible();

  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBeTruthy();

  const response = await page.request.get(href as string);
  expect(response.ok()).toBe(true);

  const manifest = (await response.json()) as {
    name: string;
    short_name: string;
    lang: string;
    display: string;
    start_url: string;
    scope: string;
    icons: { src: string; sizes: string; type: string; purpose?: string }[];
  };

  expect(manifest.name).toBe('Trip Board');
  expect(manifest.short_name).toBe('TripBoard');
  expect(manifest.lang).toBe('ko');
  expect(manifest.display).toBe('standalone');
  // Relative so a VITE_BASE subpath deploy keeps working.
  expect(manifest.start_url).toBe('./');
  expect(manifest.scope).toBe('./');

  expect(manifest.icons.map((icon) => icon.sizes)).toEqual(
    expect.arrayContaining(['192x192', '512x512']),
  );
  expect(manifest.icons.some((icon) => icon.purpose === 'maskable')).toBe(true);

  // Every icon the manifest promises must actually be served.
  for (const icon of manifest.icons) {
    const iconUrl = new URL(icon.src, new URL(href as string, page.url())).toString();
    const iconResponse = await page.request.get(iconUrl);
    expect(iconResponse.ok(), `${icon.src} 가 404예요`).toBe(true);
    expect(iconResponse.headers()['content-type']).toContain('image/png');
  }
});

test('서비스 워커가 등록되고 활성화된다', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('tab-bar')).toBeVisible();

  await waitForActiveWorker(page);

  const state = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    // `ready`는 워커가 **activating**인 순간에도 풀린다 — 전체 스위트 부하에서
    // 그 찰나를 밟아 `activating`을 읽은 적이 있다(M52b 게이트). 활성화가
    // 끝날 때까지 statechange를 기다린다 — 기다림이지 건너뜀이 아니다.
    const worker = registration.active;
    if (worker && worker.state !== 'activated') {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 10_000);
        worker.addEventListener('statechange', () => {
          if (worker.state === 'activated') {
            clearTimeout(timer);
            resolve();
          }
        });
      });
    }
    return {
      scope: registration.scope,
      active: registration.active?.state ?? null,
      // The precached shell is what makes the offline reload below possible.
      cached: (await caches.keys()).length,
    };
  });

  expect(state.active).toBe('activated');
  expect(state.scope).toContain('localhost');
  expect(state.cached).toBeGreaterThan(0);
});

test('오프라인으로 새로고침해도 앱 껍데기가 뜬다', async ({ page, context }) => {
  await page.goto('/');
  await expect(page.getByTestId('tab-bar')).toBeVisible();

  // The shell must be precached *and* the worker must be driving this client
  // before cutting the network — otherwise the reload races the install.
  await waitForActiveWorker(page);

  // `prompt` mode does not claim the installing page, so one online reload is
  // needed to hand this client over to the worker.
  await page.reload();
  await expect(page.getByTestId('tab-bar')).toBeVisible();
  await waitForController(page);

  await context.setOffline(true);
  try {
    await page.reload();
    await expect(page.getByTestId('tab-bar')).toBeVisible();
    // M52a — 드로우가 여섯 번째 탭으로 붙었다.
    await expect(page.getByRole('tab')).toHaveCount(6);
    // Sync is unconfigured here, so the chip must not panic about the network.
    await expect(page.getByTestId('sync-chip')).toHaveAttribute('data-status', 'off');
  } finally {
    await context.setOffline(false);
  }
});
