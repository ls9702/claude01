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

test('마지막 일자에서 05시 이전을 고르면 누르기 전에 막고 이유를 말한다', async ({ page }) => {
  await createTrip(page, '오사카 마지막 시트');
  await addCard(page, 2, '심야 라멘');

  await page.getByTestId('tab-timeline').click();
  await page.getByTestId('timeline-add-day-empty').click();
  await expect(page.getByTestId('timeline-day')).toHaveCount(1);

  await page.getByTestId('tab-board').click();
  await page.getByTestId('board-card').filter({ hasText: '심야 라멘' }).click();
  await page.getByTestId('card-schedule').click();
  await expect(page.getByTestId('schedule-sheet')).toBeVisible();

  // 10:00 — 하나뿐인 일자에 멀쩡히 들어가는 시각.
  await expect(page.getByTestId('schedule-submit')).toBeEnabled();
  await expect(page.getByTestId('schedule-out-of-range')).toHaveCount(0);

  // 02:00까지 내리면 「1일차 02시」= 2일차 새벽인데, 2일차가 없다.
  for (let i = 0; i < 32; i += 1) await page.getByTestId('schedule-start-minus').click();
  await expect(page.getByTestId('schedule-start-value')).toHaveText('02:00');
  await expect(page.getByTestId('schedule-out-of-range')).toHaveText(
    '마지막 일자라 새벽(05시 이전)으로 넘길 수 없어요',
  );
  await expect(page.getByTestId('schedule-submit')).toBeDisabled();

  // 시트는 열린 채다 — 고르던 값을 잃지 않고 05:00으로 되돌리면 다시 열린다.
  await expect(page.getByTestId('schedule-sheet')).toBeVisible();
  for (let i = 0; i < 12; i += 1) await page.getByTestId('schedule-start-plus').click();
  await expect(page.getByTestId('schedule-start-value')).toHaveText('05:00');
  await expect(page.getByTestId('schedule-out-of-range')).toHaveCount(0);
  await expect(page.getByTestId('schedule-submit')).toBeEnabled();
});

test('앞 일자가 사라진 새벽 일정은 제자리에 고정되고 끌리지 않는다', async ({ page }) => {
  await createTrip(page, '오사카 새벽 고정');
  await addCard(page, 2, '심야 라멘');

  await page.getByTestId('tab-timeline').click();
  await page.getByTestId('timeline-add-day-empty').click();
  await page.getByTestId('timeline-add-day').click();
  await expect(page.getByTestId('timeline-day')).toHaveCount(2);

  // 「1일차 02시」 → 달력으로는 2일차 02:00, 그림은 1일차 칸 아래쪽.
  await page.getByTestId('tab-board').click();
  await page.getByTestId('board-card').filter({ hasText: '심야 라멘' }).click();
  await page.getByTestId('card-schedule').click();
  await page.getByTestId('schedule-day-option').nth(0).click();
  for (let i = 0; i < 32; i += 1) await page.getByTestId('schedule-start-minus').click();
  await page.getByTestId('schedule-submit').click();
  await page.getByTestId('tab-timeline').click();

  // 1일차를 지우기 전에: 그 칸이 보여주는 개수와 지워질 개수가 다르다고 말한다 (B7).
  await page.getByTestId('timeline-day').first().getByTestId('day-menu').click();
  await page.getByTestId('day-menu-panel').getByTestId('day-delete').click();
  await expect(page.getByTestId('day-delete-dawn-note')).toHaveText(
    '이 칸에 보이는 새벽 일정 1개는 다음 일자 소속이라 남아요.',
  );
  await expect(page.getByTestId('day-delete-dawn-note')).toHaveAttribute('data-count', '1');
  await page.getByTestId('confirm-accept').click();

  // 이제 앞 일자가 없다 — 일정은 사라지지 않고 제 칸 꼭대기에 새벽으로 고정된다.
  await expect(page.getByTestId('timeline-day')).toHaveCount(1);
  const entry = page.getByTestId('timeline-entry');
  await expect(entry).toHaveCount(1);
  await expect(entry).toHaveAttribute('data-dawn', 'true');
  await expect(entry).toHaveAttribute('data-start-min', '120');
  await expect(entry).toHaveAttribute('data-offset-min', '0');
  await expect(entry.getByTestId('entry-dawn-badge')).toHaveCount(1);
  // 제목은 살아 있다 — 새벽 표시는 점 하나로 줄어든다 (B10).
  await expect(entry).toContainText('심야 라멘');

  // 고정된 블록은 끌리지 않는다 (B4): 잡아 끌어도 시각이 그대로다.
  await expect(entry).toHaveAttribute('data-draggable', 'false');
  const box = await entry.boundingBox();
  if (!box) throw new Error('새벽 블록의 위치를 찾지 못했어요');
  await dragMouse(
    page,
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
    { x: box.x + box.width / 2, y: box.y + 200 },
  );
  await expect(page.getByTestId('timeline-entry')).toHaveCount(1);
  await expect(page.getByTestId('timeline-entry')).toHaveAttribute('data-start-min', '120');
  await expect(page.getByTestId('timeline-entry')).toHaveAttribute('data-offset-min', '0');

  // 길이 조절 손잡이도 없다 — 그려진 높이가 길이가 아니기 때문이다.
  await expect(entry.getByTestId('entry-resize')).toHaveCount(0);
});

test('요약 바가 시트에 배치된 만큼의 필요 예산을 말한다 (M25)', async ({ page }) => {
  await createTrip(page, '오사카 요약');
  await addCard(page, 4, '우메다 전망대', '20000');
  await addCard(page, 2, '이치란', '15000');

  await page.getByTestId('tab-timeline').click();
  await page.getByTestId('timeline-add-day-empty').click();
  await page.getByTestId('timeline-add-day').click();
  await expect(page.getByTestId('timeline-day')).toHaveCount(2);

  const summary = page.getByTestId('spend-summary');
  await expect(summary).toBeVisible();
  const sheetFigure = page.getByTestId('spend-summary-sheet');
  await expect(sheetFigure).toHaveAttribute('data-budget', '0');
  await expect(summary).toContainText('필요 예산');

  // Place both cards on 1일차 through the schedule sheet (the touch path).
  for (const title of ['우메다 전망대', '이치란']) {
    await page.getByTestId('tab-board').click();
    await page.getByTestId('board-card').filter({ hasText: title }).click();
    await page.getByTestId('card-schedule').click();
    await page.getByTestId('schedule-day-option').nth(0).click();
    await page.getByTestId('schedule-submit').click();
    await expect(page.getByTestId('schedule-sheet')).toHaveCount(0);
  }
  await page.getByTestId('tab-timeline').click();

  await expect(sheetFigure).toHaveAttribute('data-budget', '35000');
  await expect(page.getByTestId('spend-summary-total')).toHaveText('₩3.5만');

  // ── 버그 1: 같은 카드를 두 번 걸면 필요한 돈도 두 배다 ──────────────
  // 15,000원짜리 이치란을 2일차에 한 번 더. 밥은 두 번 먹고 돈은 두 번 나간다.
  await page.getByTestId('tab-board').click();
  await page.getByTestId('board-card').filter({ hasText: '이치란' }).click();
  await page.getByTestId('card-schedule').click();
  await page.getByTestId('schedule-day-option').nth(1).click();
  await page.getByTestId('schedule-submit').click();
  await expect(page.getByTestId('schedule-sheet')).toHaveCount(0);
  await page.getByTestId('tab-timeline').click();

  await expect(page.getByTestId('timeline-entry')).toHaveCount(3);
  await expect(sheetFigure).toHaveAttribute('data-budget', '50000');
  await expect(page.getByTestId('spend-summary-total')).toHaveText('₩5만');

  // ── 이 줄은 계획만 말한다: 지출을 적어도 꿈쩍하지 않는다 ────────────
  await page.getByTestId('tab-board').click();
  await page.getByTestId('board-card').filter({ hasText: '우메다 전망대' }).click();
  await page.getByTestId('card-expense-amount-input').fill('18000');
  await page.getByTestId('card-expense-add').click();
  await page.getByTestId('sheet-close').click();
  await page.getByTestId('tab-timeline').click();

  await expect(sheetFigure).toHaveAttribute('data-budget', '50000');
  await expect(summary).not.toContainText('지출');
  await expect(summary).not.toContainText('1.8만');
  // 지출은 여전히 일자 칩이 말한다 — 사라진 기능이 아니라 옮겨간 질문이다.
  await expect(page.getByTestId('day-spend').first()).toHaveAttribute('data-spent', '18000');

  // 카테고리별: 배치된 만큼의 예산을, 큰 것부터.
  await page.getByTestId('spend-summary-cats-open').click();
  await expect(page.getByTestId('spend-summary-cats')).toBeVisible();
  await expect(page.getByTestId('spend-summary-cats-amount')).toHaveText('₩5만');
  const rows = page.getByTestId('spend-cat-row');
  await expect(rows).toHaveCount(2);
  // 이치란 30,000(두 번) > 우메다 20,000 — 배치가 순서를 바꿨다.
  await expect(rows.first()).toHaveAttribute('data-budget', '30000');
  await expect(rows.nth(1)).toHaveAttribute('data-budget', '20000');
  await expect(page.getByTestId('spend-summary-cats')).not.toContainText('1.8만');
  // Nothing is 미배치 yet, so the footer has nothing to own up to.
  await expect(page.getByTestId('spend-summary-unplaced')).toHaveCount(0);
  await page.getByTestId('spend-summary-cats-open').click();

  // A budgeted card nobody scheduled → the footer says what was left out (B14).
  await page.getByTestId('tab-board').click();
  await addCard(page, 1, '가부키 티켓', '30000');
  await page.getByTestId('tab-timeline').click();
  await page.getByTestId('spend-summary-cats-open').click();
  await expect(page.getByTestId('spend-summary-unplaced')).toHaveText(
    '미배치 카드 1장의 예산은 빠져 있어요',
  );
});

test('현지 통화를 켠 여행이면 필요 예산을 두 통화로 말한다 (M25)', async ({ page }) => {
  // 현지 통화 짝은 여행을 만들 때 함께 켠다 (M7b) — 1 JPY = 9.3 KRW.
  await page.getByTestId('add-trip').click();
  await page.getByTestId('trip-title-input').fill('도쿄 필요 예산');
  await page.getByTestId('trip-local-toggle').click();
  await page.getByTestId('trip-local-currency-select').selectOption('JPY');
  await page.getByTestId('trip-local-rate-input').fill('9.3');
  await page.getByTestId('trip-submit').click();
  await expect(page.getByTestId('trip-form')).toHaveCount(0);
  await page
    .getByTestId('trip-card')
    .filter({ hasText: '도쿄 필요 예산' })
    .getByTestId('trip-open')
    .click();
  await expect(page).toHaveURL(/#\/board$/);

  await addCard(page, 2, '이치란', '20000');
  await page.getByTestId('tab-timeline').click();
  await page.getByTestId('timeline-add-day-empty').click();
  await page.getByTestId('tab-board').click();
  await page.getByTestId('board-card').filter({ hasText: '이치란' }).click();
  await page.getByTestId('card-schedule').click();
  await page.getByTestId('schedule-submit').click();
  await page.getByTestId('tab-timeline').click();

  // 20,000원 ÷ 9.3 = ¥2,151 — 지출 입력이 쓰는 그 환율, 방향만 반대다.
  await expect(page.getByTestId('spend-summary-sheet')).toHaveAttribute(
    'data-local-currency',
    'JPY',
  );
  await expect(page.getByTestId('spend-summary-total')).toHaveText('₩2만');
  await expect(page.getByTestId('spend-summary-total-local')).toHaveText('¥2,151');

  // 팝오버도 같은 두 통화를 다시 말한다 (좁은 화면에서 바가 잘려도 한 탭 거리).
  await page.getByTestId('spend-summary-cats-open').click();
  await expect(page.getByTestId('spend-summary-cats-amount')).toHaveText('₩2만');
  await expect(page.getByTestId('spend-summary-cats-amount-local')).toHaveText('¥2,151');
});

test('현지 통화가 없는 여행은 기준 통화만 말한다 (M25)', async ({ page }) => {
  await createTrip(page, '제주 필요 예산');
  await addCard(page, 2, '흑돼지', '30000');

  await page.getByTestId('tab-timeline').click();
  await page.getByTestId('timeline-add-day-empty').click();
  await page.getByTestId('tab-board').click();
  await page.getByTestId('board-card').filter({ hasText: '흑돼지' }).click();
  await page.getByTestId('card-schedule').click();
  await page.getByTestId('schedule-submit').click();
  await page.getByTestId('tab-timeline').click();

  await expect(page.getByTestId('spend-summary-total')).toHaveText('₩3만');
  // 두 번째 통화도, 그 자리를 지키던 가운뎃점도 없다 — 줄이 늘지 않는다.
  await expect(page.getByTestId('spend-summary-total-local')).toHaveCount(0);
  await expect(page.getByTestId('spend-summary-sheet')).not.toHaveAttribute(
    'data-local-currency',
    'JPY',
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

  test('좁은 화면에서 잘리는 쪽은 시트 절반이고, 오늘 숫자는 끝까지 보인다', async ({ page }) => {
    await createTrip(page, '오사카 좁은 화면');
    await addCard(page, 2, '이치란', '15000');

    await page.getByTestId('tab-timeline').click();
    await page.getByTestId('timeline-add-day-empty').click();
    await expect(page.getByTestId('spend-summary')).toBeVisible();

    // 320 / 360 / 390 — 실제로 쓰는 폭 셋 모두에서 (B5).
    for (const width of [320, 360, 390]) {
      await page.setViewportSize({ width, height: 844 });
      const bar = await page.getByTestId('spend-summary').boundingBox();
      const day = await page.getByTestId('spend-summary-day').boundingBox();
      if (!bar || !day) throw new Error(`${width}px에서 요약 바를 찾지 못했어요`);

      // 일자 칸이 실제로 자리를 차지하고 있고 — 0폭으로 짜부라지지 않았고,
      expect(day.width).toBeGreaterThan(40);
      // 바 오른쪽 밖으로 밀려나지도 않았다.
      expect(day.x).toBeGreaterThanOrEqual(bar.x - 1);
      expect(day.x + day.width).toBeLessThanOrEqual(bar.x + bar.width + 1);
      // 그리고 여전히 한 줄이다.
      expect(Math.round(bar.height)).toBeLessThanOrEqual(41);
    }
  });

  test('두 통화 총액이 붙어도 390px 한 줄에 다 들어간다 (M25)', async ({ page }) => {
    // 이 줄이 가장 붐비는 경우: 현지 통화 + 일자 칸 + 카테고리 다섯.
    await page.getByTestId('add-trip').click();
    await page.getByTestId('trip-title-input').fill('도쿄 모바일');
    await page.getByTestId('trip-local-toggle').click();
    await page.getByTestId('trip-local-currency-select').selectOption('JPY');
    await page.getByTestId('trip-local-rate-input').fill('9.3');
    await page.getByTestId('trip-submit').click();
    await page
      .getByTestId('trip-card')
      .filter({ hasText: '도쿄 모바일' })
      .getByTestId('trip-open')
      .click();
    await expect(page).toHaveURL(/#\/board$/);

    const titles = ['신칸센', '우체국', '이치란', '호텔', '스카이트리'];
    for (const [index, title] of titles.entries()) {
      await addCard(page, index, title, '120000');
    }
    await page.getByTestId('tab-timeline').click();
    await page.getByTestId('timeline-add-day-empty').click();
    for (const title of titles) {
      await page.getByTestId('tab-board').click();
      await page.getByTestId('board-card').filter({ hasText: title }).click();
      await page.getByTestId('card-schedule').click();
      await page.getByTestId('schedule-submit').click();
      await expect(page.getByTestId('schedule-sheet')).toHaveCount(0);
    }
    await page.getByTestId('tab-timeline').click();

    // 60만원 ÷ 9.3 = ¥64,516 → 만 단위로 접혀도 두 통화 다 자리를 잡는다.
    const total = page.getByTestId('spend-summary-total');
    const local = page.getByTestId('spend-summary-total-local');
    await expect(total).toHaveText('₩60만');
    await expect(local).toHaveText('¥6.5만');

    // 320 / 360 / 390 — 실제로 쓰는 폭 셋 모두에서.
    for (const width of [320, 360, 390]) {
      await page.setViewportSize({ width, height: 844 });
      const bar = await page.getByTestId('spend-summary').boundingBox();
      const totalBox = await total.boundingBox();
      const localBox = await local.boundingBox();
      const dayBox = await page.getByTestId('spend-summary-day').boundingBox();
      if (!bar || !totalBox || !localBox || !dayBox) {
        throw new Error(`${width}px에서 요약 바를 찾지 못했어요`);
      }

      // 여전히 한 줄이다 — 두 통화가 붙었다고 바가 두 줄로 자라지 않았다.
      expect(Math.round(bar.height)).toBeLessThanOrEqual(41);
      // 세 숫자 모두 0폭으로 짜부라지지 않았고(B5), 바 안에 들어와 있다.
      for (const box of [totalBox, localBox, dayBox]) {
        expect(box.width).toBeGreaterThan(20);
        expect(box.x).toBeGreaterThanOrEqual(bar.x - 1);
        expect(box.x + box.width).toBeLessThanOrEqual(bar.x + bar.width + 1);
      }
      // 그리고 `overflow-hidden`에 잘려 나간 것도 없다 — 좁아지면 말이 먼저
      // 빠지고 금액은 끝까지 남는다는 규칙이 실제로 지켜졌다는 뜻이다.
      const clipped = await page
        .getByTestId('spend-summary-sheet')
        .evaluate((el) => el.scrollWidth > el.clientWidth + 1);
      expect(clipped).toBe(false);
      // 페이지가 가로로 밀리지도 않는다.
      const overflow = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        inner: window.innerWidth,
      }));
      expect(overflow.scroll).toBeLessThanOrEqual(overflow.inner);
    }
    await page.setViewportSize({ width: 390, height: 844 });

    // 카테고리별 버튼은 40px 줄 안에서 쓸 수 있는 만큼의 타깃을 지킨다
    // (바 자체가 M18 §3의 40px이라 44px 높이는 이 줄에 들어갈 수 없다).
    const catsBox = await page.getByTestId('spend-summary-cats-open').boundingBox();
    expect(catsBox?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(catsBox?.height ?? 0).toBeGreaterThanOrEqual(32);

    // 팝오버는 화면 안에 들어오고, 길어지면 목록만 스크롤한다.
    await page.getByTestId('spend-summary-cats-open').click();
    const pop = page.getByTestId('spend-summary-cats');
    await expect(pop).toBeVisible();
    const popBox = await pop.boundingBox();
    if (!popBox) throw new Error('팝오버를 찾지 못했어요');
    expect(popBox.x).toBeGreaterThanOrEqual(0);
    expect(popBox.x + popBox.width).toBeLessThanOrEqual(390 + 1);
    expect(popBox.y + popBox.height).toBeLessThanOrEqual(844 + 1);
    await expect(pop.getByTestId('spend-cat-row')).toHaveCount(5);
    const scrolls = await pop.locator('ul').evaluate((el) => ({
      overflowY: getComputedStyle(el).overflowY,
      fits: el.scrollHeight <= el.clientHeight,
    }));
    expect(scrolls.overflowY).toBe('auto');
    expect(scrolls.fits).toBe(true);
    // 팝오버가 열려도 페이지는 가로로 밀리지 않는다.
    const openOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    );
    expect(openOverflow).toBe(true);
  });
});
