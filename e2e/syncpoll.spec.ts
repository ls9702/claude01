import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { startMockApi, type MockApi } from './mock-api';

/**
 * 메모가 곧바로 오간다 — M22.
 *
 * M21 made the 메모 탭 a chat; this is the milestone that makes it behave like
 * one. Two things had to change and both are proved here against the in-memory
 * stand-in for `data.php` (see `e2e/mock-api.ts`):
 *
 *  - **보내기 does not wait for the 4초 디바운스.** The composer asks for the
 *    push itself, so the message is on the server about as fast as the network
 *    allows. The assertion is a deadline shorter than the debounce — if the
 *    flush regressed, the debounce would still get it there eventually, and a
 *    test without a clock on it would never notice.
 *  - **The other device finds out while looking at the screen.** B never
 *    reloads, never switches tabs, never touches the settings sheet. It runs
 *    the version probe its own 5초 interval would have run — through
 *    `__tripBoardPollNow`, the same kind of seam `__tripBoardSweepPhotos` is,
 *    so the spec exercises the shipped probe instead of napping through six of
 *    them per assertion.
 *
 * And the half that keeps the probe cheap: a tick that finds the version
 * unchanged must cost exactly one `?meta=1` and nothing else. The mock counts
 * both, so "no push" is an assertion rather than a hope.
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

/** How long the engine would have waited on its own (`PUSH_DEBOUNCE_MS`). */
const PUSH_DEBOUNCE_MS = 4_000;

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

/** Switches the device's profile through 설정 (see `profile.spec.ts`). */
async function switchProfile(page: Page, profile: 'song' | 'hoyabom'): Promise<void> {
  await page.getByTestId('sync-chip').click();
  await expect(page.getByTestId('sync-settings')).toBeVisible();
  await page.getByTestId('profile-switch').click();
  await page.locator(`[data-testid="profile-option"][data-profile="${profile}"]`).click();
  await expect(page.getByTestId('profile-current')).toHaveAttribute('data-profile', profile);
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

/** Opens an already-existing trip (the active trip is not shared between devices). */
async function openTrip(page: Page, title: string): Promise<void> {
  await page.getByTestId('tab-trips').click();
  await page.getByTestId('trip-card').filter({ hasText: title }).getByTestId('trip-open').click();
  await expect(page).toHaveURL(/#\/board$/);
}

/** Opens the 메모 탭 of the trip that is already active. */
async function openMemo(page: Page): Promise<void> {
  await page.getByTestId('tab-memo').click();
  await expect(page).toHaveURL(/#\/memo$/);
  await expect(page.getByTestId('memo-thread')).toBeVisible();
}

/** Runs one version probe now, instead of waiting for the interval. */
async function pollNow(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const poll = (window as unknown as { __tripBoardPollNow?: () => Promise<void> })
      .__tripBoardPollNow;
    if (!poll) throw new Error('__tripBoardPollNow is not installed');
    await poll();
  });
}

/** The messages the mock server is currently holding, in no particular order. */
function storedMemoTexts(): string[] {
  const stored = api.data() as { memos?: Record<string, { text?: string }> } | null;
  return Object.values(stored?.memos ?? {}).map((memo) => memo.text ?? '');
}

test('메모를 보내면 4초 디바운스를 기다리지 않고 서버에 올라간다', async ({ page }) => {
  test.setTimeout(60_000);

  await page.goto('/');
  await expect(page.getByTestId('tab-bar')).toBeVisible();

  await createTrip(page, '오사카');
  await configureSync(page);
  expect(api.version()).toBe(1);

  await openMemo(page);
  await page.getByTestId('memo-input').fill('숙소 체크인 8시');

  const sentAt = Date.now();
  await page.getByTestId('memo-send').click();
  await expect(page.getByTestId('memo-msg')).toHaveCount(1);

  // 디바운스보다 먼저 도착해야 한다 — 이게 이 마일스톤의 절반이다.
  await expect.poll(() => api.version(), { timeout: PUSH_DEBOUNCE_MS - 1_000 }).toBe(2);
  expect(Date.now() - sentAt).toBeLessThan(PUSH_DEBOUNCE_MS);
  expect(storedMemoTexts()).toContain('숙소 체크인 8시');
});

test('상대가 보낸 메모가, 화면을 그대로 둔 채 폴링만으로 뜬다', async ({ browser }) => {
  test.setTimeout(120_000);

  const contextA = await browser.newContext();
  const contextB = await browser.newContext();

  try {
    /* --- 기기 A: 여행을 만들고 동기화를 켠다 -------------------------- */
    const a = await openDevice(contextA);
    await createTrip(a, '오사카');
    await configureSync(a);
    expect(api.version()).toBe(1);

    /* --- 기기 B: 같은 여행의 메모 탭에 앉아 있다 ---------------------- */
    const b = await openDevice(contextB);
    await configureSync(b);
    // 두 사람이어야 말풍선이 좌우로 갈린다 (M13/M21).
    await switchProfile(b, 'hoyabom');
    await openTrip(b, '오사카');
    await openMemo(b);
    await expect(b.getByTestId('memo-empty')).toBeVisible();

    /* --- A가 한 줄 보낸다 --------------------------------------------- */
    await openMemo(a);
    await a.getByTestId('memo-input').fill('내일 우메다 어때?');
    await a.getByTestId('memo-send').click();
    await expect(a.getByTestId('memo-msg')).toHaveCount(1);

    /* --- B는 아무것도 하지 않는다. 폴링만 돈다 ------------------------ */
    // 새로고침도, 탭 전환도, 설정 시트도 없다. `expect.poll`이 매 시도마다
    // 프로브를 한 번 돌리는데, 이건 5초 간격이 알아서 할 일을 앞당긴 것뿐이다.
    await expect
      .poll(
        async () => {
          await pollNow(b);
          return b.getByTestId('memo-msg').count();
        },
        { timeout: 30_000 },
      )
      .toBe(1);

    const bubble = b.getByTestId('memo-msg');
    await expect(bubble).toContainText('내일 우메다 어때?');
    // 남의 말은 왼쪽에, 아바타를 달고 선다.
    await expect(bubble).toHaveAttribute('data-own', 'false');
    await expect(bubble.getByTestId('avatar')).toHaveAttribute('data-profile', 'song');
    await expect(bubble.getByTestId('memo-msg-author')).toHaveText('songlee');
    await expect(b.getByTestId('memo-empty')).toHaveCount(0);
    await expect(b.getByTestId('memo-thread')).toHaveAttribute('data-count', '1');

    /* --- 그리고 B가 답하면 A도 같은 길로 받는다 ----------------------- */
    await b.getByTestId('memo-input').fill('좋아, 저녁은 거기서');
    await b.getByTestId('memo-send').click();
    await expect(b.getByTestId('memo-msg')).toHaveCount(2);

    await expect
      .poll(
        async () => {
          await pollNow(a);
          return a.getByTestId('memo-msg').count();
        },
        { timeout: 30_000 },
      )
      .toBe(2);
    await expect(a.getByTestId('memo-msg').nth(1)).toHaveAttribute('data-own', 'false');
    await expect(a.getByTestId('memo-msg').nth(1)).toContainText('좋아, 저녁은 거기서');
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

test('바뀐 것이 없는 폴링은 버전만 물어보고 아무것도 쓰지 않는다', async ({ page }) => {
  test.setTimeout(60_000);

  await page.goto('/');
  await expect(page.getByTestId('tab-bar')).toBeVisible();

  await createTrip(page, '삿포로');
  await configureSync(page);
  expect(api.version()).toBe(1);

  // 설정 저장이 남겨둔 디바운스가 있다면 여기서 끝난다 — 스냅샷은 그 뒤에.
  await page.waitForTimeout(PUSH_DEBOUNCE_MS + 1_000);

  const version = api.version();
  const puts = api.puts();
  const metaReads = api.metaReads();

  await pollNow(page);
  await pollNow(page);
  await pollNow(page);

  // 프로브는 실제로 서버에 닿았고(= 조용히 건너뛴 게 아니고),
  expect(api.metaReads()).toBe(metaReads + 3);
  // 그 대가로 쓰기는 한 번도 일어나지 않았다.
  expect(api.puts()).toBe(puts);
  expect(api.version()).toBe(version);

  // 조금 더 기다려도 마찬가지다 — 폴링은 스스로 일거리를 만들지 않는다.
  await page.waitForTimeout(3_000);
  expect(api.puts()).toBe(puts);
  expect(api.version()).toBe(version);
});
