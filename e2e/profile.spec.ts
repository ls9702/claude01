import { expect, test, type Page } from '@playwright/test';

/**
 * 2인 프로필 — M13.
 *
 * Every other spec is handed a profile by `playwright.config`'s `storageState`
 * so the picker never gets in its way. This suite is the one that wants the
 * first-run experience, so it opts back out with an **empty** storage state and
 * meets 누구세요? head on.
 *
 * What is actually being tested is the stamp: whoever is holding the device
 * when a card / comment is written owns it forever, switching later changes
 * only what comes next, and the device remembers the choice across a reload.
 */

test.use({
  viewport: { width: 1280, height: 800 },
  // No seeded profile: this is the only suite that starts as a new device.
  storageState: { cookies: [], origins: [] },
});

/** Answers 누구세요? and waits for the app proper. */
async function pick(page: Page, profile: 'song' | 'hoyabom'): Promise<void> {
  await expect(page.getByTestId('profile-picker')).toBeVisible();
  await page.locator(`[data-testid="profile-option"][data-profile="${profile}"]`).click();
  await expect(page.getByTestId('profile-picker')).toHaveCount(0);
}

/** Creates a trip from the 여행 tab and lands on its board. */
async function createTrip(page: Page, title: string): Promise<void> {
  await page.getByTestId('add-trip').click();
  await page.getByTestId('trip-title-input').fill(title);
  await page.getByTestId('trip-submit').click();
  await expect(page.getByTestId('trip-form')).toHaveCount(0);
  await page.getByTestId('trip-card').filter({ hasText: title }).getByTestId('trip-open').click();
  await expect(page).toHaveURL(/#\/board$/);
}

/** Adds a card to the column at `columnIndex`. */
async function addCard(page: Page, columnIndex: number, title: string): Promise<void> {
  await page.getByTestId('board-column').nth(columnIndex).getByTestId('add-card').click();
  await page.getByTestId('card-title-input').fill(title);
  await page.getByTestId('card-submit').click();
  await expect(page.getByTestId('card-form')).toHaveCount(0);
}

/** Opens a board card's edit sheet, writes one comment, closes it again. */
async function comment(page: Page, cardTitle: string, text: string): Promise<void> {
  await page.getByTestId('board-card').filter({ hasText: cardTitle }).click();
  await expect(page.getByTestId('card-form')).toBeVisible();
  await page.getByTestId('card-comment-input').fill(text);
  await page.getByTestId('card-comment-add').click();
  await expect(page.getByTestId('card-comment-row').filter({ hasText: text })).toHaveCount(1);
  await page.getByTestId('sheet-close').click();
  await expect(page.getByTestId('card-form')).toHaveCount(0);
}

test('첫 방문에는 누구인지 묻고, 고른 사람이 카드와 코멘트에 남는다', async ({ page }) => {
  await page.goto('/');

  // The picker is a wall, not a banner: nothing else is on screen behind it.
  const picker = page.getByTestId('profile-picker');
  await expect(picker).toBeVisible();
  await expect(picker).toContainText('누구세요?');
  await expect(picker).toContainText('이 기기에서 사용할 프로필을 선택하세요');
  await expect(page.getByTestId('profile-option')).toHaveCount(2);
  await expect(page.getByTestId('tab-bar')).toHaveCount(0);
  await expect(page.getByTestId('view-trips')).toHaveCount(0);

  await pick(page, 'hoyabom');

  // …and now the app, with the chosen face in the top bar's utility zone.
  await expect(page.getByTestId('view-trips')).toBeVisible();
  // M52a — 드로우가 여섯 번째 탭으로 붙었다.
  await expect(page.getByTestId('tab-bar').getByRole('tab')).toHaveCount(6);
  await expect(page.getByTestId('profile-chip')).toHaveAttribute('data-profile', 'hoyabom');

  await createTrip(page, '오사카');
  await addCard(page, 1, '유니버설 스튜디오');

  const card = page.getByTestId('board-card').filter({ hasText: '유니버설 스튜디오' });
  await expect(card.getByTestId('card-author')).toHaveAttribute('data-profile', 'hoyabom');
  await expect(card.getByTestId('card-author')).toContainText('HB');

  await comment(page, '유니버설 스튜디오', '익스프레스 패스 사자');
  await page.getByTestId('board-card').filter({ hasText: '유니버설 스튜디오' }).click();
  await expect(page.getByTestId('ledger-author')).toHaveAttribute('data-profile', 'hoyabom');
  await expect(page.getByTestId('ledger-author')).toContainText('HB');
});

test('설정에서 전환하면 그 뒤에 쓴 것만 새 프로필이고, 새로고침해도 유지된다', async ({
  page,
}) => {
  await page.goto('/');
  await pick(page, 'hoyabom');
  await createTrip(page, '오사카');
  await addCard(page, 1, '유니버설 스튜디오');
  await comment(page, '유니버설 스튜디오', '익스프레스 패스 사자');

  // 설정 — the profile section is the first thing in it, and the other person's
  // 마지막 접속 sits under it (nothing yet: song has never opened this device).
  await page.getByTestId('sync-chip').click();
  await expect(page.getByTestId('sync-settings')).toBeVisible();
  await expect(page.getByTestId('profile-current')).toHaveAttribute('data-profile', 'hoyabom');
  await expect(page.getByTestId('profile-current')).toContainText('hoyabom');
  await expect(page.getByTestId('profile-seen')).toHaveAttribute('data-profile', 'song');
  await expect(page.getByTestId('profile-seen')).toContainText('아직 접속 기록 없음');

  await page.getByTestId('profile-switch').click();
  await pick(page, 'song');
  await expect(page.getByTestId('profile-current')).toHaveAttribute('data-profile', 'song');
  await page.getByTestId('sheet-close').click();
  await expect(page.getByTestId('sync-settings')).toHaveCount(0);

  await expect(page.getByTestId('profile-chip')).toHaveAttribute('data-profile', 'song');

  // The new comment is song's; the old one is still hoyabom's. A profile switch
  // rewrites nothing that was already written.
  await comment(page, '유니버설 스튜디오', '아침 일찍 가자');

  await page.getByTestId('board-card').filter({ hasText: '유니버설 스튜디오' }).click();
  await expect(page.getByTestId('card-comment-row')).toHaveCount(2);
  await expect(page.getByTestId('ledger-author')).toHaveCount(2);
  await expect(page.getByTestId('ledger-author').nth(0)).toHaveAttribute(
    'data-profile',
    'hoyabom',
  );
  await expect(page.getByTestId('ledger-author').nth(1)).toHaveAttribute('data-profile', 'song');
  // The card itself keeps its maker — createdBy is not "last touched by".
  await page.getByTestId('sheet-close').click();
  await expect(
    page.getByTestId('board-card').filter({ hasText: '유니버설 스튜디오' }).getByTestId('card-author'),
  ).toHaveAttribute('data-profile', 'hoyabom');

  // The device remembers: no picker on the way back in.
  await page.reload();
  await expect(page.getByTestId('tab-bar')).toBeVisible();
  await expect(page.getByTestId('profile-picker')).toHaveCount(0);
  await expect(page.getByTestId('profile-chip')).toHaveAttribute('data-profile', 'song');

  // And 설정 now reports the other one's visit rather than "기록 없음".
  await page.getByTestId('sync-chip').click();
  await expect(page.getByTestId('profile-seen')).toHaveAttribute('data-profile', 'hoyabom');
  await expect(page.getByTestId('profile-seen')).toContainText('마지막 접속');
});

test('전환을 취소하면 프로필은 그대로다', async ({ page }) => {
  await page.goto('/');
  await pick(page, 'song');

  await page.getByTestId('sync-chip').click();
  await page.getByTestId('profile-switch').click();
  await expect(page.getByTestId('profile-picker')).toBeVisible();
  await page.getByTestId('profile-picker-cancel').click();

  await expect(page.getByTestId('profile-picker')).toHaveCount(0);
  await expect(page.getByTestId('profile-current')).toHaveAttribute('data-profile', 'song');
});
