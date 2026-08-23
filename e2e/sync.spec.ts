import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { startMockApi, type MockApi } from './mock-api';

/**
 * Two-device sync, end to end, against the in-memory stand-in for `data.php`
 * (see `e2e/mock-api.ts`).
 *
 * Every wait in here is a poll on the mock's own version counter rather than a
 * fixed sleep: the push is debounced by 4s and the merge-retry adds a round
 * trip, so any hard-coded timing would be a flake waiting to happen.
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

/** Opens an already-existing trip's board (the active trip is not persisted). */
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

async function renameCard(page: Page, from: string, to: string): Promise<void> {
  await page.getByTestId('board-card').filter({ hasText: from }).first().click();
  await expect(page.getByTestId('card-form')).toBeVisible();
  await page.getByTestId('card-title-input').fill(to);
  await page.getByTestId('card-submit').click();
  await expect(page.getByTestId('card-form')).toHaveCount(0);
}

/** Waits for the mock's version counter to reach `target`. */
async function waitForVersion(target: number, timeout = 25_000): Promise<void> {
  await expect.poll(() => api.version(), { timeout }).toBeGreaterThanOrEqual(target);
}

/** Asserts the board shows exactly these card titles (order-insensitive). */
async function expectCards(page: Page, titles: string[]): Promise<void> {
  await expect(page.getByTestId('board-card')).toHaveCount(titles.length);
  for (const title of titles) {
    await expect(page.getByTestId('board-card').filter({ hasText: title })).toHaveCount(1);
  }
}

test('설정을 저장하면 곧바로 서버에 올라간다', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('tab-bar')).toBeVisible();

  // Nothing configured: the chip says 끔 and the app is perfectly usable.
  await expect(page.getByTestId('sync-chip')).toHaveAttribute('data-status', 'off');

  await createTrip(page, '오사카');
  await addCard(page, 0, '유니버설');

  expect(api.version()).toBe(0);
  await configureSync(page);

  // 저장 kicks a full round trip: the server had nothing (404), so our copy
  // becomes version 1 without waiting for the debounce.
  expect(api.version()).toBe(1);
  const stored = api.data() as { trips: Record<string, { title: string }> };
  expect(Object.values(stored.trips).map((trip) => trip.title)).toEqual(['오사카']);
});

test('잘못된 토큰은 연결 테스트에서 401로 걸린다', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('tab-bar')).toBeVisible();

  await page.getByTestId('sync-chip').click();
  await page.getByTestId('sync-base-url').fill(api.baseUrl);
  await page.getByTestId('sync-token').fill('wrong-token-1234');
  await page.getByTestId('sync-test').click();

  await expect(page.getByTestId('sync-notice')).toHaveAttribute('data-tone', 'bad');
  await expect(page.getByTestId('sync-notice')).toContainText('토큰이 올바르지 않아요');
  expect(api.version()).toBe(0);
});

test('헤더에 못 넣는 토큰은 연결 전에 막힌다', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('tab-bar')).toBeVisible();

  await page.getByTestId('sync-chip').click();
  await page.getByTestId('sync-base-url').fill(api.baseUrl);
  // Header values are Latin-1; a Korean token makes fetch throw outright, and
  // "서버에 연결할 수 없어요" would send the user hunting for a network fault.
  await page.getByTestId('sync-token').fill('한글토큰');
  await page.getByTestId('sync-test').click();

  await expect(page.getByTestId('sync-notice')).toHaveAttribute('data-tone', 'bad');
  await expect(page.getByTestId('sync-notice')).toContainText('쓸 수 없는 문자');
});

test('연결 테스트가 성공하면 서버 버전을 알려준다', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('tab-bar')).toBeVisible();

  await page.getByTestId('sync-chip').click();
  await page.getByTestId('sync-base-url').fill(api.baseUrl);
  await page.getByTestId('sync-token').fill(api.token);
  await page.getByTestId('sync-test').click();

  await expect(page.getByTestId('sync-notice')).toHaveAttribute('data-tone', 'ok');
  await expect(page.getByTestId('sync-notice')).toContainText('연결됐어요');
});

test('편집하면 디바운스 뒤에 저절로 올라간다', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('tab-bar')).toBeVisible();

  await createTrip(page, '삿포로');
  await configureSync(page);
  expect(api.version()).toBe(1);

  // No 지금 동기화 here on purpose — this is the 4s debounce doing its job.
  await addCard(page, 1, '스프카레');
  await waitForVersion(2);

  const stored = api.data() as { cards: Record<string, { title: string }> };
  expect(Object.values(stored.cards).map((card) => card.title)).toContain('스프카레');
});

test('다른 기기가 설정을 마치면 서버의 여행을 받아온다', async ({ browser }) => {
  test.setTimeout(90_000);

  const contextA = await browser.newContext();
  const contextB = await browser.newContext();

  try {
    const a = await openDevice(contextA);
    await createTrip(a, '오사카');
    await addCard(a, 0, '유니버설');
    await configureSync(a);
    await waitForVersion(1);

    // B is a completely separate device: empty IndexedDB, empty localStorage.
    const b = await openDevice(contextB);
    await expect(b.getByTestId('trips-empty')).toBeVisible();

    await configureSync(b);

    await expect(b.getByTestId('trip-card').filter({ hasText: '오사카' })).toHaveCount(1);
    await openTrip(b, '오사카');
    await expectCards(b, ['유니버설']);

    // A pull that changes nothing must not manufacture a push.
    expect(api.version()).toBe(1);
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

test('동시 편집이 409를 거쳐 양쪽 모두에서 합쳐진다', async ({ browser }) => {
  test.setTimeout(120_000);

  const contextA = await browser.newContext();
  const contextB = await browser.newContext();

  try {
    /* --- both devices start from the same server version ---------------- */
    const a = await openDevice(contextA);
    await createTrip(a, '오사카');
    await addCard(a, 0, '유니버설');
    await configureSync(a);
    await waitForVersion(1);

    const b = await openDevice(contextB);
    await configureSync(b);
    await openTrip(b, '오사카');
    await expectCards(b, ['유니버설']);
    expect(api.version()).toBe(1);

    /* --- A pushes first, so B is guaranteed to be pushing from a stale
           baseVersion — that is the 409 this test is about ---------------- */
    await addCard(a, 1, '도톤보리');
    await waitForVersion(2);
    expect(api.conflicts()).toBe(0);

    // B never pulled in between: its serverVersion is still 1.
    await renameCard(b, '유니버설', '유니버설 스튜디오');
    await waitForVersion(3);
    expect(api.conflicts()).toBeGreaterThanOrEqual(1);

    /* --- convergence ---------------------------------------------------- */
    // B resolved its own 409 by merging, so it already has both cards.
    await expectCards(b, ['유니버설 스튜디오', '도톤보리']);

    // A still has its pre-conflict copy until it pulls.
    await syncNow(a);
    await expectCards(a, ['유니버설 스튜디오', '도톤보리']);

    // And the server agrees with both of them.
    const stored = api.data() as { cards: Record<string, { title: string }> };
    expect(Object.values(stored.cards).map((card) => card.title).sort()).toEqual(
      ['도톤보리', '유니버설 스튜디오'].sort(),
    );

    // Both devices settled: no error state left behind.
    await expect(a.getByTestId('sync-chip')).toHaveAttribute('data-status', 'idle');
    await expect(b.getByTestId('sync-chip')).toHaveAttribute('data-status', 'idle');
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

test('해제하면 다시 로컬 전용으로 돌아간다', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('tab-bar')).toBeVisible();

  await createTrip(page, '다낭');
  await configureSync(page);
  await waitForVersion(1);

  await page.getByTestId('sync-chip').click();
  await page.getByTestId('sync-clear').click();
  await expect(page.getByTestId('sync-notice')).toHaveText('동기화를 껐어요');
  await page.getByTestId('sheet-close').click();

  await expect(page.getByTestId('sync-chip')).toHaveAttribute('data-status', 'off');

  // Edits keep working locally, and nothing more reaches the server.
  await addCard(page, 0, '한강다리');
  await page.waitForTimeout(6_000);
  expect(api.version()).toBe(1);
  await expectCards(page, ['한강다리']);
});
