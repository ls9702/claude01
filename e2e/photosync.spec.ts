import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { startMockApi, type MockApi } from './mock-api';

/**
 * 사진 자동 동기화 (M20).
 *
 * M10 proved the bytes survive a reload on the device that took the photo.
 * This proves the half that makes a shared trip work: the bytes reach the
 * *other* device, and leave both when the photo is deleted.
 *
 * Two isolated `BrowserContext`s stand in for two phones — separate IndexedDB
 * *and* separate `localStorage`, so device B genuinely starts knowing nothing
 * and has to download what it renders. The photo goes in through the real file
 * input and the real compression pipeline; nothing about the add path is
 * stubbed here either.
 *
 * The one seam is the GC's clock: sweeping is on a 30초 grace period, and
 * three of those per run is not a test, it is a nap. `__tripBoardSweepPhotos`
 * (see `stores/photoGc`) runs the same two-visit protocol with the clock
 * wound forward.
 */

const PHOTO = fileURLToPath(new URL('./fixtures/photo.png', import.meta.url));

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

/** Opens a fresh, isolated device (its own IndexedDB *and* localStorage). */
async function openDevice(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  await page.goto('/');
  await expect(page.getByTestId('tab-bar')).toBeVisible();
  return page;
}

/** Points a device at the mock server through the settings sheet. */
async function configureSync(page: Page): Promise<void> {
  await page.getByTestId('sync-chip').click();
  await expect(page.getByTestId('sync-settings')).toBeVisible();
  await page.getByTestId('sync-base-url').fill(api.baseUrl);
  await page.getByTestId('sync-token').fill(api.token);
  await page.getByTestId('sync-save').click();

  await expect(page.getByTestId('sync-notice')).toHaveText('저장했어요');
  await page.getByTestId('sheet-close').click();
  await expect(page.getByTestId('sync-settings')).toHaveCount(0);
  await expect(page.getByTestId('sync-chip')).toHaveAttribute('data-status', 'idle');
}

/** Pull-merge-push on demand, for the steps that must not wait on a debounce. */
async function syncNow(page: Page): Promise<void> {
  await page.getByTestId('sync-chip').click();
  await expect(page.getByTestId('sync-settings')).toBeVisible();
  await page.getByTestId('sync-now').click();
  await expect(page.getByTestId('sync-notice')).toHaveText('동기화했어요');
  await page.getByTestId('sheet-close').click();
  await expect(page.getByTestId('sync-settings')).toHaveCount(0);
}

async function createTrip(page: Page, title: string): Promise<void> {
  await page.getByTestId('add-trip').click();
  await page.getByTestId('trip-title-input').fill(title);
  await page.getByTestId('trip-submit').click();
  await expect(page.getByTestId('trip-form')).toHaveCount(0);
  await page.getByTestId('trip-card').filter({ hasText: title }).getByTestId('trip-open').click();
  await expect(page).toHaveURL(/#\/board$/);
}

async function openTrip(page: Page, title: string): Promise<void> {
  await page.getByTestId('tab-trips').click();
  await page.getByTestId('trip-card').filter({ hasText: title }).getByTestId('trip-open').click();
  await expect(page).toHaveURL(/#\/board$/);
  await expect(page.getByTestId('board-column').first()).toBeVisible();
}

async function addCard(page: Page, columnIndex: number, title: string): Promise<void> {
  await page.getByTestId('board-column').nth(columnIndex).getByTestId('add-card').click();
  await page.getByTestId('card-title-input').fill(title);
  await page.getByTestId('card-submit').click();
  await expect(page.getByTestId('card-form')).toHaveCount(0);
}

/** Opens a card's edit sheet from the board. */
async function openCard(page: Page, title: string): Promise<void> {
  await page.getByTestId('board-card').filter({ hasText: title }).first().click();
  await expect(page.getByTestId('card-form')).toBeVisible();
  await expect(page.getByTestId('card-photos')).toBeVisible();
}

/** Attaches one photo and returns the id the card now carries. */
async function attachPhoto(page: Page): Promise<string> {
  await page.getByTestId('card-photo-input').setInputFiles(PHOTO);
  const thumb = page.getByTestId('card-photo-thumb');
  await expect(thumb).toHaveCount(1, { timeout: 15_000 });
  await expect(thumb).toHaveAttribute('data-loaded', 'true', { timeout: 15_000 });
  const id = await thumb.getAttribute('data-photo-id');
  expect(id).toBeTruthy();
  return id as string;
}

/**
 * Runs the photo GC to completion with the grace period fast-forwarded.
 *
 * Twice, because that is what a real deletion costs: the first sweep writes
 * the now-unreferenced id down as a candidate, the second finds it still
 * unreferenced and past the deadline and deletes it — locally and, in M20, on
 * the server.
 */
async function sweepPhotos(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const sweep = (window as unknown as { __tripBoardSweepPhotos?: () => Promise<string[]> })
      .__tripBoardSweepPhotos;
    if (!sweep) throw new Error('__tripBoardSweepPhotos is not installed');
    await sweep();
    await sweep();
  });
}

test('한쪽에서 붙인 사진이 서버를 거쳐 다른 기기에 뜨고, 지우면 서버에서도 사라진다', async ({
  browser,
}) => {
  test.setTimeout(120_000);

  // --- 기기 A: 사진을 붙인다 -------------------------------------------
  const contextA = await browser.newContext();
  const a = await openDevice(contextA);
  await configureSync(a);

  await createTrip(a, '오사카');
  await addCard(a, 0, '도톤보리');
  await openCard(a, '도톤보리');
  const photoId = await attachPhoto(a);
  await a.getByTestId('sheet-close').click();

  // 저장 already pushed once; the photo arrived after that, so this is the
  // sync whose success hands the uploader its cue.
  await syncNow(a);
  await expect.poll(() => api.hasPhoto(photoId), { timeout: 25_000 }).toBe(true);
  expect(api.photoCount()).toBe(1);

  // The 사진 용량 row says so out loud, once there is a server to say it about.
  await a.getByTestId('sync-chip').click();
  await expect(a.getByTestId('photo-sync-note')).toContainText('서버 동기화 켜짐');
  await a.getByTestId('sheet-close').click();

  // --- 기기 B: 아무것도 모르는 채로 시작한다 ---------------------------
  const contextB = await browser.newContext();
  const b = await openDevice(contextB);
  await configureSync(b);
  await syncNow(b);

  await openTrip(b, '오사카');
  await expect(b.getByTestId('card-chip-photos')).toHaveText('1장');

  // The load-bearing assertion: B never saw these bytes, and the only place
  // they can have come from is `image.php`.
  await openCard(b, '도톤보리');
  const thumbB = b.getByTestId('card-photo-thumb');
  await expect(thumbB).toHaveCount(1);
  await expect(thumbB).toHaveAttribute('data-photo-id', photoId);
  await expect(thumbB).toHaveAttribute('data-loaded', 'true', { timeout: 20_000 });

  // …and it kept them, so the second look costs no network at all.
  await b.reload();
  await expect(b.getByTestId('tab-bar')).toBeVisible();
  await openTrip(b, '오사카');
  await openCard(b, '도톤보리');
  await expect(b.getByTestId('card-photo-thumb')).toHaveAttribute('data-loaded', 'true', {
    timeout: 20_000,
  });
  await b.getByTestId('sheet-close').click();

  // --- 기기 A: 지우면 서버에서도 지워진다 ------------------------------
  await openCard(a, '도톤보리');
  await a.getByTestId('card-photo-thumb').click();
  await expect(a.getByTestId('photo-lightbox')).toBeVisible();
  await a.getByTestId('photo-lightbox-delete').click();
  await a.getByTestId('confirm-accept').click();
  await expect(a.getByTestId('card-photo-thumb')).toHaveCount(0);
  await a.getByTestId('sheet-close').click();

  await sweepPhotos(a);
  await expect.poll(() => api.hasPhoto(photoId), { timeout: 20_000 }).toBe(false);
  expect(api.photoCount()).toBe(0);

  await contextA.close();
  await contextB.close();
});

test('동기화를 끄고 쓰면 사진은 이 기기에만 남는다', async ({ browser }) => {
  test.setTimeout(60_000);

  const context = await browser.newContext();
  const page = await openDevice(context);

  // Nothing configured — every photoSync entry point is a no-op, and the
  // 사진 용량 row must not promise a server that does not exist.
  await expect(page.getByTestId('sync-chip')).toHaveAttribute('data-status', 'off');

  await createTrip(page, '제주');
  await addCard(page, 0, '성산일출봉');
  await openCard(page, '성산일출봉');
  await attachPhoto(page);
  await page.getByTestId('sheet-close').click();

  await page.getByTestId('sync-chip').click();
  await expect(page.getByTestId('photo-usage')).toHaveAttribute('data-count', '1');
  await expect(page.getByTestId('photo-sync-note')).toHaveCount(0);
  await page.getByTestId('sheet-close').click();

  expect(api.photoCount()).toBe(0);
  await context.close();
});
