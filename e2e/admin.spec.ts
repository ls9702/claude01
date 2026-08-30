import { expect, test, type Page } from '@playwright/test';
import { startMockApi, type MockApi } from './mock-api';

/**
 * 관리자 — 세션 다중화·전환·공지·백업 복원 (M46/M47).
 *
 * One address, several independent workspaces, one person who decides which of
 * them everybody sees. What is worth proving in a browser (rather than in a
 * unit test) is the part that spans the whole app:
 *
 *  - **전환 really switches namespaces.** After moving to a new session the
 *    board is empty — not merged, not half-migrated — and moving back finds the
 *    original trip exactly where it was. That "유실 0" claim is the reason the
 *    switch is allowed to exist, and it is one assertion.
 *  - **The server, not the client, prevents pollution.** A tab that was left in
 *    the old session gets 409 `session_changed` on its next push, and the mock
 *    counts those.
 *  - **공지 reaches every tab**, and closing it is per device.
 *  - **보관 is read-only, visibly.** A locked session refuses the push with 423
 *    and the app says so in one quiet line instead of pretending it saved.
 *  - **복원 moves the version forward.** A restore that lowered the counter
 *    would be invisible to every phone already up to date, so the round trip is
 *    checked through the number the poll compares.
 *
 * All of it against `e2e/mock-api.ts`, which implements the same contracts —
 * `X-Session`, 409, 423, `?meta=1`'s extra fields — byte for byte.
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
  await expect(page.getByTestId('sync-chip')).toHaveAttribute('data-status', 'idle');
}

/**
 * 설정 → 관리자 → 비밀번호까지. Leaves the admin sheet open.
 *
 * The password is asked once per tab: it lives in `sessionStorage`, so
 * reopening the sheet in the same sitting goes straight to the list. Both paths
 * end at the same place, which is what this helper waits for.
 */
async function openAdmin(page: Page): Promise<void> {
  await page.getByTestId('sync-chip').click();
  await expect(page.getByTestId('sync-settings')).toBeVisible();
  await page.getByTestId('admin-open').click();
  await expect(page.getByTestId('admin-sheet')).toBeVisible();

  // 이 탭이 이미 비밀번호를 들고 있으면(sessionStorage) 시트는 목록으로 바로
  // 간다 — 그때는 「불러오는 중」이 잠깐 서고 입력칸은 아예 뜨지 않는다.
  const gate = page.getByTestId('admin-token-input');
  await expect(gate.or(page.getByTestId('admin-usage')).first()).toBeVisible();
  if ((await gate.count()) > 0) {
    await gate.fill(api.adminToken);
    await page.getByTestId('admin-token-submit').click();
  }
  await expect(page.getByTestId('admin-usage')).toBeVisible();
}

/** Closes the admin sheet and the settings sheet under it. */
async function closeSheets(page: Page): Promise<void> {
  await page.getByTestId('sheet-close').last().click();
  await expect(page.getByTestId('admin-sheet')).toHaveCount(0);
  await page.getByTestId('sheet-close').click();
  await expect(page.getByTestId('sync-settings')).toHaveCount(0);
}

async function createTrip(page: Page, title: string): Promise<void> {
  await page.getByTestId('add-trip').click();
  await page.getByTestId('trip-title-input').fill(title);
  await page.getByTestId('trip-submit').click();
  await expect(page.getByTestId('trip-form')).toHaveCount(0);
  await expect(page.getByTestId('trip-card').filter({ hasText: title })).toBeVisible();
}

/** Waits for the workspace to be on the server (the 4초 debounce plus slack). */
async function waitForPush(page: Page, atLeast = 1): Promise<void> {
  await expect
    .poll(() => api.version(), { timeout: 15_000, intervals: [200] })
    .toBeGreaterThanOrEqual(atLeast);
  await expect(page.getByTestId('sync-chip')).toHaveAttribute('data-status', 'idle');
}

test('비밀번호가 틀리면 열리지 않는다', async ({ page }) => {
  await page.goto('/');
  await configureSync(page);

  await page.getByTestId('sync-chip').click();
  await page.getByTestId('admin-open').click();
  await page.getByTestId('admin-token-input').fill('wrong-password');
  await page.getByTestId('admin-token-submit').click();

  await expect(page.getByTestId('admin-token-error')).toBeVisible();
  await expect(page.getByTestId('admin-usage')).toHaveCount(0);
});

test('새 세션을 만들고 전환하면 화면이 비고, 돌아오면 그대로 있다', async ({ page }) => {
  await page.goto('/');
  await configureSync(page);
  await createTrip(page, '오사카 첫 여행');
  await waitForPush(page);

  expect(api.session()).toBe('default');

  await openAdmin(page);

  // 만들기와 전환은 두 개의 결정이다 — 만든다고 옮겨지지 않는다.
  await page.getByTestId('admin-new-id').fill('busan-2027');
  await page.getByTestId('admin-new-label').fill('부산 2027');
  await page.getByTestId('admin-create').click();
  await expect(page.getByTestId('admin-result')).toHaveAttribute('data-tone', 'ok');
  expect(api.session()).toBe('default');

  const busan = page.locator('[data-testid="admin-session-row"][data-id="busan-2027"]');
  await expect(busan).toHaveCount(1);
  await expect(busan).toHaveAttribute('data-active', 'false');

  // 전환은 묻는다 — 모든 사용자가 보게 되는 일이다.
  await busan.getByTestId('admin-activate').click();
  await expect(page.getByTestId('admin-activate-confirm')).toBeVisible();
  await expect(page.getByTestId('admin-activate-confirm')).toContainText('모든 사용자가');
  await page.getByTestId('admin-activate-confirm').getByRole('button', { name: '전환' }).click();

  await expect.poll(() => api.session(), { timeout: 10_000 }).toBe('busan-2027');
  await closeSheets(page);

  // 새 세션은 빈 세션이다. 병합이 아니다 — 옛 여행이 따라오면 그것이 사고다.
  await expect(page.getByTestId('trips-empty')).toBeVisible();
  await expect(page.getByTestId('trip-card')).toHaveCount(0);

  await createTrip(page, '부산 여행');
  await waitForPush(page);

  // 되돌아가면 옛 세션의 데이터가 그대로 있다 (유실 0).
  await openAdmin(page);
  const def = page.locator('[data-testid="admin-session-row"][data-id="default"]');
  await def.getByTestId('admin-activate').click();
  await page.getByTestId('admin-activate-confirm').getByRole('button', { name: '전환' }).click();
  await expect.poll(() => api.session(), { timeout: 10_000 }).toBe('default');
  await closeSheets(page);

  await expect(page.getByTestId('trip-card').filter({ hasText: '오사카 첫 여행' })).toBeVisible();
  await expect(page.getByTestId('trip-card').filter({ hasText: '부산 여행' })).toHaveCount(0);
});

test('세션이 바뀐 뒤 옛 탭의 저장은 서버가 막는다', async ({ page }) => {
  await page.goto('/');
  await configureSync(page);
  await createTrip(page, '오사카');
  await waitForPush(page);

  // 관리자가 다른 기기에서 전환했다 — 이 탭은 아직 모른다.
  api.setSession('busan-2027');

  await createTrip(page, '이 탭이 모르고 만든 여행');

  // 그 다음 푸시는 409 session_changed로 거절되고, 이 탭은 조용히 새 세션으로
  // 갈아탄다. 옛 워크스페이스가 새 세션을 덮어쓰는 일은 일어나지 않는다.
  await expect.poll(() => api.sessionRejects(), { timeout: 20_000 }).toBeGreaterThanOrEqual(1);
  await expect.poll(() => api.session(), { timeout: 10_000 }).toBe('busan-2027');

  const stored = api.data() as { trips?: Record<string, { title: string }> } | null;
  const titles = Object.values(stored?.trips ?? {}).map((trip) => trip.title);
  expect(titles).not.toContain('오사카');
});

test('공지를 게시하면 모든 탭 위에 뜨고, 닫으면 사라진다', async ({ page }) => {
  await page.goto('/');
  await configureSync(page);

  await openAdmin(page);
  await page.getByTestId('admin-notice-input').fill('내일 아침 9시에 NAS를 잠깐 껐다 켤게요');
  await page.getByTestId('admin-notice-post').click();
  await expect(page.getByTestId('admin-result')).toHaveAttribute('data-tone', 'ok');
  await closeSheets(page);

  await expect(page.getByTestId('notice-banner')).toBeVisible();
  await expect(page.getByTestId('notice-banner')).toContainText('NAS를 잠깐');

  // 「모든 탭 위」가 문자 그대로여야 한다.
  await page.getByTestId('tab-board').click();
  await expect(page.getByTestId('notice-banner')).toBeVisible();
  await page.getByTestId('tab-map').click();
  await expect(page.getByTestId('notice-banner')).toBeVisible();

  await page.getByTestId('notice-banner-close').click();
  await expect(page.getByTestId('notice-banner')).toHaveCount(0);

  // 닫음은 기기가 기억한다 — 탭을 옮겨도 다시 오지 않는다.
  await page.getByTestId('tab-trips').click();
  await expect(page.getByTestId('notice-banner')).toHaveCount(0);
});

test('보관된 세션은 읽기 전용이라고 말한다', async ({ page }) => {
  await page.goto('/');
  await configureSync(page);
  await createTrip(page, '끝난 여행');
  await waitForPush(page);

  api.setLocked(true);

  // 폴링이 `locked`를 물어 오게 한다 — 그 한 번이 배너를 세운다. 프로브는 큐가
  // 바쁠 때 한 틱을 건너뛰므로(설계상), 한 번이 아니라 될 때까지 두드린다.
  await expect
    .poll(
      async () => {
        await page.evaluate(() =>
          (window as unknown as { __tripBoardPollNow: () => Promise<void> }).__tripBoardPollNow(),
        );
        return page.getByTestId('session-locked-banner').count();
      },
      { timeout: 15_000, intervals: [300] },
    )
    .toBe(1);

  await expect(page.getByTestId('session-locked-banner')).toBeVisible();
  await expect(page.getByTestId('session-locked-banner')).toContainText('읽기 전용');

  // 편집을 막지는 않는다 — 손이 멈추는 것보다 저장이 안 된다고 말하는 편이 낫다.
  await createTrip(page, '보관 중에 만든 여행');
  await expect(page.getByTestId('trip-card').filter({ hasText: '보관 중에 만든 여행' })).toBeVisible();
});

test('백업 목록에서 날짜를 골라 되돌린다', async ({ page }) => {
  await page.goto('/');
  await configureSync(page);

  // M30의 일 단위 스냅샷은 **그날 첫 저장 직전**의 상태다. 연결 직후의 첫
  // 푸시가 v1(빈 워크스페이스)를 만들고, 그 다음 저장이 그 v1을 그날의
  // 스냅샷으로 남긴다 — 그러니 이 날의 되돌릴 지점은 「여행이 없던 상태」다.
  await createTrip(page, '실수로 만든 여행');
  await waitForPush(page, 2);

  const beforeVersion = api.version();

  await openAdmin(page);
  const row = page.locator('[data-testid="admin-session-row"][data-id="default"]');
  await row.getByTestId('admin-row-expand').click();
  await row.getByTestId('admin-backups').click();

  const backup = row.getByTestId('admin-backup-row').first();
  await expect(backup).toBeVisible();
  await backup.getByTestId('admin-restore').click();

  await expect(page.getByTestId('admin-restore-confirm')).toBeVisible();
  await expect(page.getByTestId('admin-restore-confirm')).toContainText('모든 기기에 적용됩니다');
  await page.getByTestId('admin-restore-confirm').getByRole('button', { name: '복원' }).click();
  await expect(page.getByTestId('admin-result')).toHaveAttribute('data-tone', 'ok');

  // **번호는 앞으로만 간다.** 되돌렸다고 버전을 낮추면 이미 최신인 폰들은
  // 복원을 영영 알아채지 못한다 — 이 기능이 무용해지는 유일한 실패다.
  expect(api.version()).toBeGreaterThan(beforeVersion);

  await closeSheets(page);

  // 그리고 복원은 **이긴다**. 평소의 병합이라면 이 기기가 들고 있던 「실수로
  // 만든 여행」을 되돌린 상태 위에 친절히 다시 얹었을 것이다 — LWW는 지운 적
  // 없는 엔티티를 지우지 않는다. 복원 도장이 찍힌 응답만 통째로 채택된다.
  await expect(page.getByTestId('trip-card').filter({ hasText: '실수로 만든 여행' })).toHaveCount(0);
  await expect(page.getByTestId('trips-empty')).toBeVisible();
});

test('사진 보관함 폴더를 정하면 저장된다', async ({ page }) => {
  await page.goto('/');
  await configureSync(page);

  await openAdmin(page);
  await page.getByTestId('admin-archive-folder').fill('2026-11-osaka');
  await page.getByTestId('admin-archive-save').click();
  await expect(page.getByTestId('admin-result')).toHaveAttribute('data-tone', 'ok');
  await expect(page.getByTestId('admin-usage')).toContainText('2026-11-osaka');
});
