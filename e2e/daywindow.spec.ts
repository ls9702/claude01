import { expect, test, type Page } from '@playwright/test';

/**
 * 하루 시작 05시 + 상단 고정 지출 요약 바 — M16.
 *
 * Three claims the pure tests cannot make, because they are about pixels and
 * about what is on the screen:
 *
 * 1. dropping into the **새벽 zone** — the strip below a column's 24:00 line —
 *    creates the entry on the *next* day, at the small hour the pointer was on;
 * 2. the 요약 바 is a live readout: record a 지출 and its numbers move;
 * 3. at 새벽 2시 the app selects **yesterday's** column, and draws the now line
 *    near the bottom of it rather than at the top of today's.
 */

test.use({ viewport: { width: 1280, height: 800 } });

/** Grid geometry — must match `src/timeline/layout.ts` / `dayWindow.ts`. */
const PX_PER_MIN = 0.9;
const DAY_START_MIN = 300;
const DAY_MIN = 1440;

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

/** Walks the mouse in steps so the 8px MouseSensor threshold is really crossed. */
async function dragMouse(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (const step of [0.1, 0.3, 0.5, 0.7, 0.9, 1]) {
    await page.mouse.move(from.x + (to.x - from.x) * step, from.y + (to.y - from.y) * step);
  }
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('tab-bar')).toBeVisible();
});

test('24시 선 아래(새벽 구간)에 떨어뜨리면 다음 일자의 그 시각에 배치된다', async ({ page }) => {
  await createTrip(page, '오사카 새벽');
  await addCard(page, 2, '심야 라멘');

  await page.getByTestId('tab-timeline').click();
  await page.getByTestId('timeline-add-day-empty').click();
  await page.getByTestId('timeline-add-day').click();
  await expect(page.getByTestId('timeline-day')).toHaveCount(2);

  const railCard = page.getByTestId('timeline-rail').getByTestId('board-card').first();
  await railCard.scrollIntoViewIfNeeded();

  const firstGrid = page.getByTestId('timeline-day-grid').first();
  // 01:00 of the *next* day is offset 1200 in the first column's window.
  const targetOffset = 60 + DAY_MIN - DAY_START_MIN;
  await page
    .getByTestId('timeline-scroller')
    .evaluate((element, top) => {
      element.scrollTop = top;
    }, (targetOffset - 240) * PX_PER_MIN);

  const gridBox = await firstGrid.boundingBox();
  const cardBox = await railCard.boundingBox();
  if (!gridBox || !cardBox) throw new Error('드래그 대상의 위치를 찾지 못했어요');

  await dragMouse(
    page,
    { x: cardBox.x + cardBox.width / 2, y: cardBox.y + cardBox.height / 2 },
    { x: gridBox.x + gridBox.width / 2, y: gridBox.y + targetOffset * PX_PER_MIN },
  );

  const entry = page.getByTestId('timeline-entry');
  await expect(entry).toHaveCount(1);

  // Stored on the SECOND day, at ~01:00 — the clock the pointer was over.
  const days = page.getByTestId('timeline-day');
  const secondDayId = await days.nth(1).getAttribute('data-day-id');
  await expect(entry).toHaveAttribute('data-day-id', String(secondDayId));
  const startMin = Number(await entry.getAttribute('data-start-min'));
  expect(startMin % 15).toBe(0);
  expect(Math.abs(startMin - 60)).toBeLessThanOrEqual(15);

  // …but it is DRAWN in the first day's column, at the bottom of that night.
  await expect(days.first().getByTestId('timeline-entry')).toHaveCount(1);
  await expect(days.nth(1).getByTestId('timeline-entry')).toHaveCount(0);
  const offsetMin = Number(await entry.getAttribute('data-offset-min'));
  expect(offsetMin).toBe(startMin + DAY_MIN - DAY_START_MIN);
});

test('마지막 일자의 새벽 구간에는 놓을 수 없다고 말해준다', async ({ page }) => {
  await createTrip(page, '오사카 마지막밤');
  await addCard(page, 2, '심야 라멘');

  await page.getByTestId('tab-timeline').click();
  await page.getByTestId('timeline-add-day-empty').click();
  await expect(page.getByTestId('timeline-day')).toHaveCount(1);

  const railCard = page.getByTestId('timeline-rail').getByTestId('board-card').first();
  await railCard.scrollIntoViewIfNeeded();

  await page
    .getByTestId('timeline-scroller')
    .evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });

  const gridBox = await page.getByTestId('timeline-day-grid').first().boundingBox();
  const cardBox = await railCard.boundingBox();
  if (!gridBox || !cardBox) throw new Error('드래그 대상의 위치를 찾지 못했어요');

  await dragMouse(
    page,
    { x: cardBox.x + cardBox.width / 2, y: cardBox.y + cardBox.height / 2 },
    { x: gridBox.x + gridBox.width / 2, y: gridBox.y + 1300 * PX_PER_MIN },
  );

  // Nothing was invented, and the app said why.
  await expect(page.getByTestId('timeline-entry')).toHaveCount(0);
  await expect(page.getByTestId('undo-toast')).toContainText('다음 일자가 없어요');
  // A notice, not an offer: there is nothing to undo.
  await expect(page.getByTestId('undo-action')).toHaveCount(0);
});

test('시간표 시트에서 1일차 02시를 고르면 2일차 새벽에 저장된다', async ({ page }) => {
  await createTrip(page, '오사카 시트배치');
  await addCard(page, 2, '심야 라멘');

  await page.getByTestId('tab-timeline').click();
  await page.getByTestId('timeline-add-day-empty').click();
  await page.getByTestId('timeline-add-day').click();
  await expect(page.getByTestId('timeline-day')).toHaveCount(2);
  const days = page.getByTestId('timeline-day');
  const firstDayId = await days.first().getAttribute('data-day-id');
  const secondDayId = await days.nth(1).getAttribute('data-day-id');

  await page.getByTestId('tab-board').click();
  await page.getByTestId('board-card').filter({ hasText: '심야 라멘' }).click();
  await page.getByTestId('card-schedule').click();
  await expect(page.getByTestId('schedule-sheet')).toBeVisible();
  // 1일차를 고르고 10:00 → 02:00까지 15분씩 내린다.
  await page.getByTestId('schedule-day-option').nth(0).click();
  for (let i = 0; i < 32; i += 1) await page.getByTestId('schedule-start-minus').click();
  await expect(page.getByTestId('schedule-start-value')).toHaveText('02:00');
  await page.getByTestId('schedule-submit').click();
  await expect(page.getByTestId('schedule-sheet')).toHaveCount(0);

  await page.getByTestId('tab-timeline').click();
  const entry = page.getByTestId('timeline-entry');
  // 「1일차 02시」는 달력으로 2일차의 02:00이고, 그림은 1일차 칸 아래쪽이다.
  await expect(entry).toHaveAttribute('data-day-id', String(secondDayId));
  await expect(entry).toHaveAttribute('data-start-min', '120');
  await expect(days.first().getByTestId('timeline-entry')).toHaveCount(1);
  await expect(days.nth(1).getByTestId('timeline-entry')).toHaveCount(0);
  expect(String(firstDayId)).not.toBe(String(secondDayId));

  // 상세 시트도 그려진 곳의 이름으로 부른다.
  await entry.click();
  await expect(page.getByTestId('entry-sheet')).toContainText('1일차');
  await expect(page.getByTestId('entry-range')).toHaveText('02:00–03:00');
});

test('요약 바가 시트 전체와 카테고리별 지출을 말하고, 지출을 적으면 따라 움직인다', async ({
  page,
}) => {
  await createTrip(page, '오사카 요약');
  await addCard(page, 4, '우메다 전망대', '20000');
  await addCard(page, 2, '이치란', '15000');

  await page.getByTestId('tab-timeline').click();
  await page.getByTestId('timeline-add-day-empty').click();
  await expect(page.getByTestId('timeline-day')).toHaveCount(1);

  const summary = page.getByTestId('spend-summary');
  await expect(summary).toBeVisible();
  const sheetFigure = page.getByTestId('spend-summary-sheet');
  await expect(sheetFigure).toHaveAttribute('data-spent', '0');
  await expect(sheetFigure).toHaveAttribute('data-budget', '0');

  // Place both cards through the schedule sheet (the touch path).
  for (const title of ['우메다 전망대', '이치란']) {
    await page.getByTestId('tab-board').click();
    await page.getByTestId('board-card').filter({ hasText: title }).click();
    await page.getByTestId('card-schedule').click();
    await page.getByTestId('schedule-submit').click();
    await expect(page.getByTestId('schedule-sheet')).toHaveCount(0);
  }
  await page.getByTestId('tab-timeline').click();

  // Budgets landed; nothing has been spent yet.
  await expect(sheetFigure).toHaveAttribute('data-budget', '35000');
  await expect(sheetFigure).toHaveAttribute('data-spent', '0');

  // Record one 지출 — the bar is a readout, not a snapshot.
  await page.getByTestId('tab-board').click();
  await page.getByTestId('board-card').filter({ hasText: '우메다 전망대' }).click();
  await page.getByTestId('card-expense-amount-input').fill('18000');
  await page.getByTestId('card-expense-add').click();
  await page.getByTestId('sheet-close').click();
  await page.getByTestId('tab-timeline').click();

  await expect(sheetFigure).toHaveAttribute('data-spent', '18000');
  await expect(summary).toContainText('1.8만');

  // 카테고리별: one row per category that holds money, biggest 지출 first.
  await page.getByTestId('spend-summary-cats-open').click();
  await expect(page.getByTestId('spend-summary-cats')).toBeVisible();
  const rows = page.getByTestId('spend-cat-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toHaveAttribute('data-spent', '18000');
  await expect(rows.first()).toHaveAttribute('data-budget', '20000');
  await expect(rows.nth(1)).toHaveAttribute('data-spent', '0');
  await expect(rows.nth(1)).toHaveAttribute('data-budget', '15000');
  // Nothing is 미배치 yet, so the footer has nothing to own up to.
  await expect(page.getByTestId('spend-summary-unplaced')).toHaveCount(0);
  await page.getByTestId('spend-summary-cats-open').click();

  // A budgeted card nobody scheduled → the footer says what was left out (B14).
  await page.getByTestId('tab-board').click();
  await addCard(page, 1, '가부키 티켓', '30000');
  await page.getByTestId('tab-timeline').click();
  await page.getByTestId('spend-summary-cats-open').click();
  await expect(page.getByTestId('spend-summary-unplaced')).toHaveText(
    '미배치 카드 1장의 예산/지출은 제외됐어요',
  );
});

test.describe('새벽 2시', () => {
  // 2026-05-04 02:00 KST — the sheet below runs 5월 3일 ~ 5월 7일.
  test.use({ timezoneId: 'Asia/Seoul' });

  test('전날 칸이 오늘로 잡히고 현재 시각선이 그 칸 아래쪽에 그려진다', async ({ page }) => {
    await page.clock.setFixedTime('2026-05-03T17:00:00.000Z');
    await page.goto('/');
    await expect(page.getByTestId('tab-bar')).toBeVisible();

    await createTrip(page, '오사카 새벽 2시');
    await page.getByTestId('tab-timeline').click();
    await page.getByTestId('sheet-add').click();
    await page.getByTestId('wizard-name-input').fill('본 일정');
    await page.getByTestId('wizard-out-date').fill('2026-05-03');
    await page.getByTestId('wizard-out-dep').fill('08:00');
    await page.getByTestId('wizard-out-arr').fill('10:30');
    await page.getByTestId('wizard-in-date').fill('2026-05-07');
    await page.getByTestId('wizard-in-dep').fill('18:00');
    await page.getByTestId('wizard-in-arr').fill('20:30');
    await page.getByTestId('wizard-submit').click();
    await expect(page.getByTestId('timeline-day')).toHaveCount(5);

    // 새벽 2시는 전날 밤: 오늘은 5월 4일이 아니라 **5월 3일**, 곧 1일차다.
    const firstDayId = await page
      .getByTestId('timeline-day')
      .first()
      .getAttribute('data-day-id');
    const chip = page.getByTestId('today-chip');
    await expect(chip).toBeVisible();
    await expect(chip).toHaveAttribute('data-day-id', String(firstDayId));

    // The now line is on that column, near the bottom of its window.
    const nowLine = page.getByTestId('now-line');
    await expect(nowLine).toHaveCount(1);
    await expect(page.getByTestId('timeline-day').first().getByTestId('now-line')).toHaveCount(1);
    // The label is still the wall clock…
    await expect(nowLine).toHaveAttribute('data-min', '120');
    // …and the pixel is 02:00 of the window that opened at 05:00 yesterday.
    await expect(nowLine).toHaveAttribute('data-offset-min', String(120 + DAY_MIN - DAY_START_MIN));
    await expect(nowLine).toContainText('02:00');

    // 요약 바의 일자 칸도 같은 하루를 가리킨다.
    await expect(page.getByTestId('spend-summary-day')).toHaveAttribute(
      'data-day-id',
      String(firstDayId),
    );
  });
});

test.describe('모바일 요약 바', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('페이저의 일자를 따라가고, 한 줄(40px)만 쓴다', async ({ page }) => {
    await createTrip(page, '오사카 모바일 요약');
    await addCard(page, 2, '이치란', '15000');

    await page.getByTestId('tab-timeline').click();
    await page.getByTestId('timeline-add-day-empty').click();
    await page.getByTestId('timeline-add-day').click();
    // 일자 추가는 만든 일자로 페이저를 옮긴다.
    await expect(page.getByTestId('day-pager-label')).toHaveText('2일차');

    // 모바일은 한 번에 한 칸만 그린다 — 요약 바의 '현재 일자'는 그 칸이다.
    const shownDayId = await page
      .getByTestId('timeline-day')
      .first()
      .getAttribute('data-day-id');
    const dayFigure = page.getByTestId('spend-summary-day');
    await expect(dayFigure).toHaveAttribute('data-day-id', String(shownDayId));
    await expect(dayFigure).toContainText('2일차');

    // 세로 예산은 딱 한 줄이다 (S7): 40px, 여백도 그림자도 없다.
    const box = await page.getByTestId('spend-summary').boundingBox();
    expect(Math.round(box?.height ?? 0)).toBeLessThanOrEqual(41);
    // …그리고 그리드는 여전히 화면 안에 살아 있다.
    await expect(page.getByTestId('timeline-scroller')).toBeVisible();
    const grid = await page.getByTestId('timeline-scroller').boundingBox();
    expect(grid?.height ?? 0).toBeGreaterThan(150);

    // 다른 일자로 넘기면 요약 바도 따라간다.
    await page.getByTestId('day-pager-prev').click();
    await expect(page.getByTestId('day-pager-label')).toHaveText('1일차');
    await expect(dayFigure).toContainText('1일차');
    await expect(dayFigure).not.toHaveAttribute('data-day-id', String(shownDayId));
  });
});
