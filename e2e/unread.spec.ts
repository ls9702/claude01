import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { startMockApi, type MockApi } from './mock-api';

/**
 * 안 읽음 — M24.
 *
 * 「안 읽음」은 기기가 아니라 **사람**의 상태다. 그래서 이 스펙이 증명해야 하는
 * 것은 배지가 예쁘게 뜬다는 사실이 아니라 세 가지다:
 *
 *  - 상대가 쓴 줄만 배지가 되고, 스레드를 여는 것으로 꺼진다 (그리고 새로고침을
 *    견딘다 — 읽은 지점은 워크스페이스 안에 있으니까).
 *  - 카드도 같은 규칙으로 산다: 상대의 새 코멘트에는 NEW가 붙고, 카드를 열면
 *    사라진다.
 *  - **내 폰에서 읽으면 내 맥북의 배지도 꺼진다.** 이게 이 마일스톤이 `seenBy`를
 *    쓴 이유 전부다. 두 컨텍스트가 같은 사람으로 같은 목 서버를 보고, 한쪽이
 *    스레드를 열면 다른 쪽은 **탭을 열지도 않고** 폴링만으로 배지를 끈다.
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

/** Creates a trip from the 여행 tab and lands on its board. */
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

/** Opens the 메모 tab of the trip that is already active. */
async function openMemo(page: Page): Promise<void> {
  await page.getByTestId('tab-memo').click();
  await expect(page).toHaveURL(/#\/memo$/);
  await expect(page.getByTestId('memo-thread')).toBeVisible();
}

/** Leaves the 메모 tab, so switching profiles does not count as reading. */
async function openBoard(page: Page): Promise<void> {
  await page.getByTestId('tab-board').click();
  await expect(page).toHaveURL(/#\/board$/);
}

/** Types one line and sends it, then waits for its bubble. */
async function send(page: Page, text: string): Promise<void> {
  await page.getByTestId('memo-input').fill(text);
  await page.getByTestId('memo-send').click();
  await expect(page.getByTestId('memo-msg').filter({ hasText: text })).toHaveCount(1);
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

/** Opens a fresh, isolated device (its own IndexedDB *and* localStorage). */
async function openDevice(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  await page.goto('/');
  await expect(page.getByTestId('tab-bar')).toBeVisible();
  return page;
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

/**
 * Waits until the workspace blob actually sitting in IndexedDB mentions
 * `needle`, so a `reload()` cannot race the persist middleware's write.
 * (Same helper as `memo.spec.ts` / `photos.spec.ts`, for the same reason.)
 */
async function waitForPersisted(page: Page, needle: string): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(
          (key) =>
            new Promise<string>((resolve) => {
              const request = indexedDB.open('trip-board');
              request.onerror = () => resolve('');
              request.onsuccess = () => {
                try {
                  const read = request.result
                    .transaction('state', 'readonly')
                    .objectStore('state')
                    .get(key);
                  read.onsuccess = () =>
                    resolve(typeof read.result === 'string' ? read.result : '');
                  read.onerror = () => resolve('');
                } catch {
                  resolve('');
                }
              };
            }),
          'trip-board/workspace',
        ),
      { timeout: 8_000 },
    )
    .toContain(needle);
}

/** Adds a card to the column at `columnIndex`. */
async function addCard(page: Page, columnIndex: number, title: string): Promise<void> {
  await page.getByTestId('board-column').nth(columnIndex).getByTestId('add-card').click();
  await page.getByTestId('card-title-input').fill(title);
  await page.getByTestId('card-submit').click();
  await expect(page.getByTestId('card-form')).toHaveCount(0);
}

/** Opens the edit sheet of the board card titled `title`. */
async function openCard(page: Page, title: string): Promise<void> {
  await page.getByTestId('board-card').filter({ hasText: title }).click();
  await expect(page.getByTestId('card-form')).toBeVisible();
}

test('상대가 쓴 메모는 탭 배지가 되고, 스레드를 열면 「여기까지 읽었어요」 뒤로 사라진다', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByTestId('tab-bar')).toBeVisible();

  await createTrip(page, '오사카');
  await openMemo(page);
  await send(page, '내일 우메다 어때?');
  await send(page, '저녁은 도톤보리');

  // 내가 쓴 줄로 나를 부르지 않는다.
  await expect(page.getByTestId('memo-tab-badge')).toHaveCount(0);

  // 메모 탭을 떠난 뒤에 사람을 바꾼다 — 보고 있는 스레드는 곧 읽는 스레드다.
  await openBoard(page);
  await switchProfile(page, 'hoyabom');

  // 이제 저 두 줄은 「상대의 말」이고, 탭이 그렇다고 말한다.
  const badge = page.getByTestId('memo-tab-badge');
  await expect(badge).toBeVisible();
  await expect(badge).toHaveAttribute('data-count', '2');
  await expect(badge).toHaveText('2');
  // 여행 하나뿐이어도 어느 여행인지는 고르는 화면이 말해준다.
  // M52a — 드로우가 여섯 번째 탭으로 붙었다.
  await expect(page.getByTestId('tab-bar').getByRole('tab')).toHaveCount(6);

  await openMemo(page);

  // 구분선은 안 읽은 첫 줄 위에 선다.
  const divider = page.getByTestId('memo-unread-divider');
  await expect(divider).toBeVisible();
  await expect(divider).toHaveText('여기까지 읽었어요');
  await expect(page.getByTestId('memo-msg')).toHaveCount(2);

  // 그리고 보는 것으로 배지는 꺼진다.
  await expect(page.getByTestId('memo-tab-badge')).toHaveCount(0);

  // 읽은 지점은 워크스페이스 안에 있다 — 그래서 새로고침을 견딘다.
  await waitForPersisted(page, 'memo:');
  await page.reload();
  await expect(page.getByTestId('tab-bar')).toBeVisible();
  await expect(page.getByTestId('memo-msg')).toHaveCount(2);
  await expect(page.getByTestId('memo-tab-badge')).toHaveCount(0);
  // 다시 온 방문에는 구분선도 없다.
  await expect(page.getByTestId('memo-unread-divider')).toHaveCount(0);
});

test('상대의 새 코멘트가 붙은 카드는 NEW를 달고, 카드를 열면 내려놓는다', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('tab-bar')).toBeVisible();

  await createTrip(page, '삿포로');
  await addCard(page, 0, '오도리 공원');

  await openCard(page, '오도리 공원');
  await page.getByTestId('card-comment-input').fill('야경이 좋대');
  await page.getByTestId('card-comment-add').click();
  await expect(page.getByTestId('card-comment-row')).toHaveCount(1);
  await page.getByTestId('sheet-close').click();
  await expect(page.getByTestId('card-form')).toHaveCount(0);

  // 내가 남긴 코멘트는 나에게 새 소식이 아니다.
  await expect(page.getByTestId('card-new-comments')).toHaveCount(0);

  await switchProfile(page, 'hoyabom');
  await expect(page.getByTestId('card-new-comments')).toBeVisible();
  // 칩 줄은 건드리지 않는다 — NEW는 제목 줄의 라벨 지대에 산다.
  await expect(page.getByTestId('board-card').filter({ hasText: '오도리 공원' })).toContainText(
    'NEW',
  );

  // 열어보면 읽은 것이다.
  await openCard(page, '오도리 공원');
  await expect(page.getByTestId('card-comment-row')).toHaveCount(1);
  await page.getByTestId('sheet-close').click();
  await expect(page.getByTestId('card-form')).toHaveCount(0);

  await expect(page.getByTestId('card-new-comments')).toHaveCount(0);
});

test('한 기기에서 읽으면, 같은 사람의 다른 기기는 탭을 열지도 않고 배지를 끈다', async ({
  browser,
}) => {
  test.setTimeout(120_000);

  const contextA = await browser.newContext();
  const contextB = await browser.newContext();

  try {
    /* --- 기기 A: 여행을 만들고 song으로 한 줄 남긴다 ------------------ */
    const a = await openDevice(contextA);
    await createTrip(a, '오사카');
    await configureSync(a);
    expect(api.version()).toBe(1);

    await openMemo(a);
    await send(a, '내일 우메다 어때?');
    await expect.poll(() => api.version(), { timeout: 15_000 }).toBeGreaterThan(1);

    // 그리고 A는 메모 탭을 떠나 hoyabom이 된다 — 여기부터 두 기기는 같은 사람이다.
    await openBoard(a);
    await switchProfile(a, 'hoyabom');
    await expect(a.getByTestId('memo-tab-badge')).toHaveAttribute('data-count', '1');

    /* --- 기기 B: 같은 사람(hoyabom)으로, 보드에 앉아 있다 -------------- */
    const b = await openDevice(contextB);
    await configureSync(b);
    await switchProfile(b, 'hoyabom');
    await openTrip(b, '오사카');

    // B는 메모 탭을 연 적이 없다. 폴링만으로 배지가 뜬다.
    await expect
      .poll(
        async () => {
          await pollNow(b);
          return b.getByTestId('memo-tab-badge').count();
        },
        { timeout: 30_000 },
      )
      .toBe(1);
    await expect(b.getByTestId('memo-tab-badge')).toHaveAttribute('data-count', '1');

    /* --- A가 스레드를 연다 (= 이 사람이 읽었다) ----------------------- */
    const versionBeforeRead = api.version();
    await openMemo(a);
    await expect(a.getByTestId('memo-msg')).toHaveCount(1);
    await expect(a.getByTestId('memo-tab-badge')).toHaveCount(0);
    // 읽은 지점이 서버까지 간다 — 이게 두 기기를 잇는 유일한 통로다.
    await expect.poll(() => api.version(), { timeout: 15_000 }).toBeGreaterThan(versionBeforeRead);

    /* --- B는 여전히 보드에 있고, 폴링만으로 배지를 내린다 ------------- */
    await expect
      .poll(
        async () => {
          await pollNow(b);
          return b.getByTestId('memo-tab-badge').count();
        },
        { timeout: 30_000 },
      )
      .toBe(0);
    await expect(b).toHaveURL(/#\/board$/);
    // 메시지는 그대로다 — 사라진 것은 배지뿐이다.
    await openMemo(b);
    await expect(b.getByTestId('memo-msg')).toHaveCount(1);
  } finally {
    await contextA.close();
    await contextB.close();
  }
});
