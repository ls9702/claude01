import { expect, test, type Page } from '@playwright/test';

/**
 * 오늘 모드 · 여행 결산 · 이동 갭 — M7b.
 *
 * The whole suite runs on a **fixed clock** (`page.clock.setFixedTime`) in a
 * fixed timezone, and seeds a sheet whose dates bracket that clock. Computing
 * dates from the real today would work too, but it would also mean the day the
 * suite runs decides what it asserts — a red build at midnight and a green one
 * at noon is not a test.
 *
 * `setFixedTime` freezes `Date.now()` while leaving timers running, which is
 * exactly the shape 오늘 모드 has: the app re-reads the clock every minute, so
 * a frozen clock simply keeps answering 10:30.
 */

test.use({
  viewport: { width: 1280, height: 800 },
  // UTC+9 all year — no daylight-saving edge to reason about.
  timezoneId: 'Asia/Seoul',
});

/** 2026-05-04 10:30 KST. The seeded sheet runs 5월 3일 ~ 5월 7일. */
const NOW = '2026-05-04T01:30:00.000Z';
const TODAY_INDEX = 1;
/** 10:30 in minutes from midnight — what the now line must report. */
const NOW_MIN = 630;

/** Grid constant mirrored from `src/timeline/layout.ts`. */
const PX_PER_MIN = 0.9;
/** 하루의 시작 (M16-B) — the grid's window opens here, so offset 0 is 05:00. */
const DAY_START_MIN = 300;
/** `INITIAL_SCROLL_MIN` — offset into the window, i.e. 08:00 at the top. */
const INITIAL_SCROLL_MIN = 180;

/** Creates a trip from the 여행 tab and lands on its board. */
async function createTrip(page: Page, title: string): Promise<void> {
  await page.getByTestId('add-trip').click();
  await page.getByTestId('trip-title-input').fill(title);
  await page.getByTestId('trip-submit').click();
  await expect(page.getByTestId('trip-form')).toHaveCount(0);
  await page.getByTestId('trip-card').filter({ hasText: title }).getByTestId('trip-open').click();
  await expect(page).toHaveURL(/#\/board$/);
}

/** Adds a card (optionally with a budget) to the column at `columnIndex`. */
async function addCard(
  page: Page,
  columnIndex: number,
  title: string,
  budget?: string,
): Promise<void> {
  await page.getByTestId('board-column').nth(columnIndex).getByTestId('add-card').click();
  await page.getByTestId('card-title-input').fill(title);
  if (budget) await page.getByTestId('card-budget-input').fill(budget);
  await page.getByTestId('card-submit').click();
  await expect(page.getByTestId('card-form')).toHaveCount(0);
}

/** Opens the edit sheet of the board card titled `title`. */
async function openCard(page: Page, title: string): Promise<void> {
  await page.getByTestId('board-card').filter({ hasText: title }).click();
  await expect(page.getByTestId('card-form')).toBeVisible();
}

/** Records one 지출 through whichever ledger is currently open. */
async function addExpense(page: Page, amount: string, label?: string): Promise<void> {
  await page.getByTestId('card-expense-amount-input').fill(amount);
  if (label) await page.getByTestId('card-expense-label-input').fill(label);
  await page.getByTestId('card-expense-add').click();
}

/**
 * Puts a board card on `dayIndex` of the active sheet through the schedule
 * sheet. The picker opens on 10:00, so `startMin` is walked there in 15-minute
 * steps — the same taps a user would make.
 */
async function scheduleCard(
  page: Page,
  title: string,
  dayIndex: number,
  startMin = 600,
): Promise<void> {
  await page.getByTestId('tab-board').click();
  await openCard(page, title);
  await page.getByTestId('card-schedule').click();
  await expect(page.getByTestId('schedule-sheet')).toBeVisible();
  await page.getByTestId('schedule-day-option').nth(dayIndex).click();

  const steps = Math.round((startMin - 600) / 15);
  const stepper = page.getByTestId(steps >= 0 ? 'schedule-start-plus' : 'schedule-start-minus');
  for (let i = 0; i < Math.abs(steps); i += 1) await stepper.click();

  await page.getByTestId('schedule-submit').click();
  await expect(page.getByTestId('schedule-sheet')).toHaveCount(0);
  await page.getByTestId('tab-timeline').click();
}

/** Creates the 5월 3일 ~ 5월 7일 sheet with the 항공편 마법사. */
async function seedDatedSheet(page: Page): Promise<void> {
  await page.getByTestId('tab-timeline').click();
  await page.getByTestId('sheet-add').click();
  await expect(page.getByTestId('sheet-wizard')).toBeVisible();
  await page.getByTestId('wizard-name-input').fill('본 일정');
  await page.getByTestId('wizard-out-date').fill('2026-05-03');
  await page.getByTestId('wizard-out-dep').fill('08:00');
  await page.getByTestId('wizard-out-arr').fill('10:30');
  await page.getByTestId('wizard-in-date').fill('2026-05-07');
  await page.getByTestId('wizard-in-dep').fill('18:00');
  await page.getByTestId('wizard-in-arr').fill('20:30');
  await page.getByTestId('wizard-submit').click();
  await expect(page.getByTestId('sheet-wizard')).toHaveCount(0);
  // Not a day count: below `lg` the grid pages through one day at a time.
  await expect(page.getByTestId('timeline-sheet-name')).toHaveText('본 일정');
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(NOW);
  await page.goto('/');
  await expect(page.getByTestId('tab-bar')).toBeVisible();
});

test('오늘이 있는 시트를 열면 오늘 칸·현재 시각선·지금/다음 바가 함께 뜬다', async ({ page }) => {
  await createTrip(page, '오사카');
  await addCard(page, 2, '조식 카페');
  await addCard(page, 4, '우메다 전망대');
  await seedDatedSheet(page);
  await expect(page.getByTestId('timeline-day')).toHaveCount(5);

  await scheduleCard(page, '조식 카페', TODAY_INDEX, 600); // 10:00–11:00 → 지금
  await scheduleCard(page, '우메다 전망대', TODAY_INDEX, 660); // 11:00 → 다음

  // The 오늘 chip knows which day is today, and says it is the selected one.
  const chip = page.getByTestId('today-chip');
  await expect(chip).toBeVisible();
  await expect(chip).toHaveAttribute('data-active', 'true');
  const todayColumn = page.getByTestId('timeline-day').nth(TODAY_INDEX);
  await expect(todayColumn).toContainText('5월 4일');
  await expect(chip).toHaveAttribute(
    'data-day-id',
    String(await todayColumn.getAttribute('data-day-id')),
  );

  // Exactly one red now line, on today's column, at the frozen minute.
  const nowLine = page.getByTestId('now-line');
  await expect(nowLine).toHaveCount(1);
  await expect(nowLine).toHaveAttribute('data-min', String(NOW_MIN));
  await expect(todayColumn.getByTestId('now-line')).toHaveCount(1);

  // …and the grid opened an hour before it, not on the window's default.
  // The scroller measures window offsets, so 10:30 is `630 - 300` from the top.
  const scrollTop = await page
    .getByTestId('timeline-scroller')
    .evaluate((element) => element.scrollTop);
  expect(Math.round(scrollTop)).toBe(
    Math.round((NOW_MIN - DAY_START_MIN - 60) * PX_PER_MIN),
  );

  // 지금 / 다음 read the two seeded entries.
  const bar = page.getByTestId('now-bar');
  await expect(bar).toHaveAttribute('data-has-current', 'true');
  await expect(bar).toContainText('조식 카페');
  await expect(bar).toContainText('10:00–11:00');
  await expect(bar).toContainText('우메다 전망대');

  // 💸 → 금액 → 추가: two taps, and the day chip has the money.
  await page.getByTestId('now-spend').click();
  await expect(page.getByTestId('quick-spend-sheet')).toBeVisible();
  await expect(page.getByTestId('quick-spend-card')).toContainText('조식 카페');
  await page.getByTestId('card-expense-amount-input').fill('5000');
  await page.getByTestId('card-expense-add').click();
  // The sheet closes itself the moment the store has the number.
  await expect(page.getByTestId('quick-spend-sheet')).toHaveCount(0);

  const dayChip = todayColumn.getByTestId('day-spend');
  await expect(dayChip).toHaveAttribute('data-spent', '5000');

  // The same receipt is on the card, through the entry sheet's shared ledger.
  await todayColumn.getByTestId('timeline-entry').first().click();
  await expect(page.getByTestId('entry-sheet').getByTestId('card-expense-total')).toHaveAttribute(
    'data-total',
    '5000',
  );
  await page.getByTestId('sheet-close').click();

  // 다음 gets its own 💸, pointed at the other card.
  await page.getByTestId('next-spend').click();
  await expect(page.getByTestId('quick-spend-card')).toContainText('우메다 전망대');
  await page.getByTestId('sheet-close').click();
});

test('오늘이 없는 시트에는 오늘 칩도 현재 시각선도 없다', async ({ page }) => {
  await createTrip(page, '강릉');
  await page.getByTestId('tab-timeline').click();
  await page.getByTestId('timeline-add-day-empty').click();
  await expect(page.getByTestId('timeline-day')).toHaveCount(1);

  // A dateless 일수 sheet cannot be "today", so nothing today-flavoured shows.
  await expect(page.getByTestId('today-chip')).toHaveCount(0);
  await expect(page.getByTestId('now-line')).toHaveCount(0);
  await expect(page.getByTestId('now-bar')).toHaveCount(0);

  // …and the grid still opens on its default — 08:00 of the 05시 window.
  const scrollTop = await page
    .getByTestId('timeline-scroller')
    .evaluate((element) => element.scrollTop);
  expect(Math.round(scrollTop)).toBe(Math.round(INITIAL_SCROLL_MIN * PX_PER_MIN));
});

test('결산이 총지출·카테고리·Top 5를 보여주고 카드로 이어진다', async ({ page }) => {
  await createTrip(page, '오사카 결산');
  await addCard(page, 4, '우메다 전망대', '20000');
  await addCard(page, 2, '이치란', '15000');
  await seedDatedSheet(page);
  await scheduleCard(page, '우메다 전망대', TODAY_INDEX, 600);
  await scheduleCard(page, '이치란', TODAY_INDEX, 660);

  await page.getByTestId('tab-board').click();
  await openCard(page, '우메다 전망대');
  await addExpense(page, '18000', '입장료');
  await page.getByTestId('sheet-close').click();
  await openCard(page, '이치란');
  await addExpense(page, '9000', '라멘');
  await page.getByTestId('sheet-close').click();

  await page.getByTestId('tab-trips').click();
  await page
    .getByTestId('trip-card')
    .filter({ hasText: '오사카 결산' })
    .getByTestId('trip-recap-open')
    .click();
  await expect(page.getByTestId('recap-sheet')).toBeVisible();

  await expect(page.getByTestId('recap-spent')).toHaveAttribute('data-amount', '27000');
  await expect(page.getByTestId('recap-budget')).toHaveAttribute('data-amount', '35000');
  await expect(page.getByTestId('recap-diff')).toHaveAttribute('data-amount', '8000');
  await expect(page.getByTestId('recap-diff')).toHaveAttribute('data-over', 'false');
  await expect(page.getByTestId('recap-diff')).toContainText('8,000원');
  // 5월 3일 ~ 5월 7일, and today is inside it → 5일간, not a D-day.
  await expect(page.getByTestId('recap-period')).toContainText('5월 3일 ~ 5월 7일');
  await expect(page.getByTestId('recap-period')).toContainText('5일간');

  // One bar per category that holds a counted card, biggest first.
  const bars = page.getByTestId('recap-cat-bar');
  await expect(bars).toHaveCount(2);
  await expect(bars.first()).toHaveAttribute('data-amount', '18000');

  // Top 5: the biggest receipt leads, and tapping it opens the card on 보드.
  const rows = page.getByTestId('recap-top-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText('우메다 전망대');
  await expect(rows.first()).toHaveAttribute('data-amount', '18000');

  // Everything is on the timeline, so there is nothing the 결산 left out (B14).
  await expect(page.getByTestId('recap-unplaced')).toHaveCount(0);

  await rows.first().click();
  await expect(page.getByTestId('recap-sheet')).toHaveCount(0);
  await expect(page).toHaveURL(/#\/board$/);
  await expect(page.getByTestId('card-form')).toBeVisible();
  await expect(page.getByTestId('card-title-input')).toHaveValue('우메다 전망대');
  await page.getByTestId('sheet-close').click();

  // A budgeted card nobody scheduled: the board shows its money, the 결산 does
  // not count it — and now says so instead of quietly differing (B14).
  await addCard(page, 1, '가부키 티켓', '30000');
  await page.getByTestId('tab-trips').click();
  await page
    .getByTestId('trip-card')
    .filter({ hasText: '오사카 결산' })
    .getByTestId('trip-recap-open')
    .click();

  await expect(page.getByTestId('recap-budget')).toHaveAttribute('data-amount', '35000');
  const unplaced = page.getByTestId('recap-unplaced');
  await expect(unplaced).toHaveAttribute('data-count', '1');
  await expect(unplaced).toHaveText('미배치 카드 1장의 예산/지출은 제외됐어요');
});

test('현지 통화를 켜면 지출을 현지 금액으로 적고 기준 통화로 저장한다', async ({ page }) => {
  await page.getByTestId('add-trip').click();
  await page.getByTestId('trip-title-input').fill('도쿄');
  await page.getByTestId('trip-local-toggle').click();
  await page.getByTestId('trip-local-currency-select').selectOption('JPY');
  await page.getByTestId('trip-local-rate-input').fill('9.3');
  await expect(page.getByTestId('trip-local-example')).toContainText('1 JPY = 9.3 KRW');
  await page.getByTestId('trip-submit').click();
  await expect(page.getByTestId('trip-form')).toHaveCount(0);

  await page.getByTestId('trip-card').filter({ hasText: '도쿄' }).getByTestId('trip-open').click();
  await addCard(page, 2, '라멘집');
  await openCard(page, '라멘집');

  // The toggle defaults to 현지 — that is what the receipt in hand says.
  await expect(page.getByTestId('expense-mode-toggle')).toHaveAttribute('data-mode', 'local');
  await page.getByTestId('card-expense-amount-input').fill('1200');
  await expect(page.getByTestId('expense-converted')).toHaveAttribute('data-amount', '11160');
  await page.getByTestId('card-expense-label-input').fill('라멘');
  await page.getByTestId('card-expense-add').click();

  // Stored in the trip's own currency, with the local figure kept in the label.
  const row = page.getByTestId('card-expense-row');
  await expect(row).toHaveCount(1);
  await expect(row).toHaveAttribute('data-amount', '11160');
  await expect(row).toContainText('¥1,200 라멘');
  await expect(page.getByTestId('card-expense-total')).toHaveAttribute('data-total', '11160');

  // 기준 통화 mode stores the number as typed, untouched.
  await page.getByTestId('expense-mode-base').click();
  await page.getByTestId('card-expense-amount-input').fill('3000');
  await expect(page.getByTestId('expense-converted')).toHaveCount(0);
  await page.getByTestId('card-expense-add').click();
  await expect(page.getByTestId('card-expense-row').nth(1)).toHaveAttribute('data-amount', '3000');
  await expect(page.getByTestId('card-expense-total')).toHaveAttribute('data-total', '14160');
});

test.describe('모바일', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('오늘 칸이 저절로 펼쳐지고, 다른 날로 넘어가도 오늘 칩으로 돌아온다', async ({ page }) => {
    await createTrip(page, '오사카 모바일');
    await seedDatedSheet(page);

    // The pager opened on today — the second of the five days — by itself.
    // (The 마법사 labels its days `N일차`; the date rides in the subtitle.)
    await expect(page.getByTestId('day-pager-label')).toHaveText('2일차');
    await expect(page.getByTestId('timeline-day-header')).toContainText('5월 4일');
    await expect(page.getByTestId('today-chip')).toHaveAttribute('data-active', 'true');
    await expect(page.getByTestId('now-line')).toHaveCount(1);

    // Paging away is allowed to leave 오늘 behind…
    await page.getByTestId('day-pager-next').click();
    await expect(page.getByTestId('day-pager-label')).toHaveText('3일차');
    await expect(page.getByTestId('today-chip')).toHaveAttribute('data-active', 'false');
    await expect(page.getByTestId('now-line')).toHaveCount(0);

    // …and the chip is the one tap back.
    await page.getByTestId('today-chip').click();
    await expect(page.getByTestId('day-pager-label')).toHaveText('2일차');
    await expect(page.getByTestId('now-line')).toHaveAttribute('data-min', String(NOW_MIN));
  });
});
