import { expect, test, type Page } from '@playwright/test';

/**
 * 지출 / 코멘트 + 일자별 합계 — M6.
 *
 * The point of the suite is that the ledger is **not** part of the card form:
 * 지출 and 코멘트 hit the store the moment they are added, so closing the sheet
 * without 저장 keeps them, and a reload finds them in IndexedDB. From there the
 * numbers roll up into the 일정 tab's day and sheet chips.
 */

test.use({ viewport: { width: 1280, height: 800 } });

/** Creates a trip from the 여행 tab and lands on its board. */
async function createTrip(page: Page, title: string): Promise<void> {
  await page.getByTestId('add-trip').click();
  await page.getByTestId('trip-title-input').fill(title);
  await page.getByTestId('trip-submit').click();
  await expect(page.getByTestId('trip-form')).toHaveCount(0);
  await page.getByTestId('trip-card').filter({ hasText: title }).getByTestId('trip-open').click();
  await expect(page).toHaveURL(/#\/board$/);
}

/** Adds a card (with a budget) to the column at `columnIndex`. */
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

/** Records one 지출 through the sheet's ledger section. */
async function addExpense(page: Page, amount: string, label?: string): Promise<void> {
  await page.getByTestId('card-expense-amount-input').fill(amount);
  if (label) await page.getByTestId('card-expense-label-input').fill(label);
  await page.getByTestId('card-expense-add').click();
}

/**
 * Waits until the workspace blob actually sitting in IndexedDB mentions
 * `needle`, so a `reload()` cannot race the persist middleware's write.
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
      { timeout: 5_000 },
    )
    .toContain(needle);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('tab-bar')).toBeVisible();
});

test('카드에 지출·코멘트를 남기면 저장 없이도 남고, 새로고침해도 살아있다', async ({ page }) => {
  await createTrip(page, '오사카 가계부');
  await addCard(page, 4, '츠텐카쿠', '20000');

  await openCard(page, '츠텐카쿠');
  // Create mode hides the ledger; edit mode shows it, empty.
  await expect(page.getByTestId('card-expense-row')).toHaveCount(0);
  await expect(page.getByTestId('card-expense-total')).toHaveAttribute('data-total', '0');

  await addExpense(page, '12000', '입장료');
  await expect(page.getByTestId('card-expense-row')).toHaveCount(1);
  // The inputs clear themselves, ready for the next receipt.
  await expect(page.getByTestId('card-expense-amount-input')).toHaveValue('');
  await addExpense(page, '3000');

  const rows = page.getByTestId('card-expense-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('입장료');
  await expect(rows.nth(0)).toHaveAttribute('data-amount', '12000');
  // No label → the row reads 지출.
  await expect(rows.nth(1)).toContainText('지출');
  await expect(page.getByTestId('card-expense-total')).toHaveAttribute('data-total', '15000');
  await expect(page.getByTestId('card-expense-total')).toContainText('15,000원');

  await page.getByTestId('card-comment-input').fill('야경이 좋아요');
  await page.getByTestId('card-comment-add').click();
  await expect(page.getByTestId('card-comment-row')).toHaveCount(1);
  await expect(page.getByTestId('card-comment-row')).toContainText('야경이 좋아요');
  await expect(page.getByTestId('card-comment-count')).toHaveAttribute('data-count', '1');

  // Closed with ✕, never 저장 — the ledger wrote straight to the store.
  await page.getByTestId('sheet-close').click();
  await expect(page.getByTestId('card-form')).toHaveCount(0);
  await expect(page.getByTestId('card-chip-budget')).toContainText('20,000원');
  await expect(page.getByTestId('card-chip-spent')).toContainText('15,000원');

  await waitForPersisted(page, '입장료');
  await page.reload();
  await expect(page.getByTestId('tab-bar')).toBeVisible();
  // 새로고침해도 보던 여행 그대로다 (B15).
  await expect(page.getByTestId('board-trip-option')).toHaveCount(0);

  await expect(page.getByTestId('card-chip-spent')).toContainText('15,000원');
  await openCard(page, '츠텐카쿠');
  await expect(page.getByTestId('card-expense-row')).toHaveCount(2);
  await expect(page.getByTestId('card-comment-row')).toHaveCount(1);
  await expect(page.getByTestId('card-expense-total')).toHaveAttribute('data-total', '15000');
});

test('일정표가 일자별·시트별 지출 합계를 보여준다', async ({ page }) => {
  await createTrip(page, '오사카 가계부');
  await addCard(page, 4, '츠텐카쿠', '20000');

  await openCard(page, '츠텐카쿠');
  await addExpense(page, '12000', '입장료');
  await addExpense(page, '3000');
  await page.getByTestId('sheet-close').click();

  // A day to put the card on…
  await page.getByTestId('tab-timeline').click();
  await expect(page.getByTestId('view-timeline')).toBeVisible();
  await page.getByTestId('timeline-add-day-empty').click();
  await expect(page.getByTestId('timeline-day')).toHaveCount(1);
  // Nothing scheduled yet → no money chip at all. The 요약 바 is always there
  // (M16-A) and honestly says zero.
  await expect(page.getByTestId('day-spend')).toHaveCount(0);
  await expect(page.getByTestId('spend-summary-sheet')).toHaveAttribute('data-budget', '0');

  // …placed through the card sheet (the touch path).
  await page.getByTestId('tab-board').click();
  await openCard(page, '츠텐카쿠');
  await page.getByTestId('card-schedule').click();
  await expect(page.getByTestId('schedule-sheet')).toBeVisible();
  await page.getByTestId('schedule-submit').click();
  await expect(page.getByTestId('schedule-sheet')).toHaveCount(0);

  await page.getByTestId('tab-timeline').click();
  const dayChip = page.getByTestId('day-spend');
  await expect(dayChip).toHaveAttribute('data-spent', '15000');
  await expect(dayChip).toHaveAttribute('data-budget', '20000');
  await expect(dayChip).toContainText('1.5만');

  // Tapping the chip spells both halves out.
  await dayChip.click();
  await expect(page.getByTestId('day-spend-budget')).toContainText('예산 20,000원');
  await expect(page.getByTestId('day-spend-spent')).toContainText('지출 15,000원');
  await dayChip.click();

  // 시트 전체의 **필요 예산**은 상단 고정 요약 바가 말한다 (M16-A → M25).
  // 지출은 여기 없다: 이 줄은 계획이 얼마 드는지만 답한다.
  const sheetSummary = page.getByTestId('spend-summary-sheet');
  await expect(sheetSummary).toHaveAttribute('data-budget', '20000');
  // 이 시트에는 날짜가 없어 '오늘'이 없다 → 데스크톱 요약 바는 일자 칸을 생략한다
  // (여러 칸이 한 화면에 있는데 '현재 보이는 일자'를 하나로 고를 수 없어서다).
  await expect(page.getByTestId('spend-summary-day')).toHaveCount(0);

  // The entry sheet carries the card's *live* ledger (M7b) — the same numbers,
  // and a receipt can be recorded without walking back to the board.
  await page.getByTestId('timeline-entry').click();
  const entrySheet = page.getByTestId('entry-sheet');
  await expect(entrySheet.getByTestId('card-expense-total')).toHaveAttribute('data-total', '15000');
  await expect(entrySheet.getByTestId('card-expense-row')).toHaveCount(2);

  await entrySheet.getByTestId('card-expense-amount-input').fill('1000');
  await entrySheet.getByTestId('card-expense-add').click();
  await expect(entrySheet.getByTestId('card-expense-row')).toHaveCount(3);
  await expect(entrySheet.getByTestId('card-expense-total')).toHaveAttribute('data-total', '16000');
  // Undone right here, so the rest of the test still speaks about 15,000원.
  await entrySheet.getByTestId('card-expense-remove').last().click();
  await expect(entrySheet.getByTestId('card-expense-total')).toHaveAttribute('data-total', '15000');
  await page.getByTestId('sheet-close').click();

  // Removing a receipt flows all the way back to the day chip.
  await page.getByTestId('tab-board').click();
  await openCard(page, '츠텐카쿠');
  await page.getByTestId('card-expense-remove').last().click();
  await expect(page.getByTestId('card-expense-row')).toHaveCount(1);
  await expect(page.getByTestId('card-expense-total')).toHaveAttribute('data-total', '12000');
  await page.getByTestId('sheet-close').click();

  await page.getByTestId('tab-timeline').click();
  await expect(page.getByTestId('day-spend')).toHaveAttribute('data-spent', '12000');
  // 영수증을 지워도 필요 예산은 그대로다 — 계획은 계획이다 (M25).
  await expect(page.getByTestId('spend-summary-sheet')).toHaveAttribute('data-budget', '20000');
});
