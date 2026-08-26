import { expect, test, type Page } from '@playwright/test';

/**
 * 지출 리포트 — M32.
 *
 * 일정 탭의 「리포트」 버튼이 여는 시트 한 장, 표 두 장. 이 스펙이 지키는 것은
 * 결국 하나다: **표의 합계가 요약 바의 숫자와 같아야 한다.** 카테고리별로 쪼개든
 * 일자별로 쪼개든, 그리고 숙소가 4박이든 식사가 두 번이든.
 *
 * 미확정 카드는 어느 표에도 없다 — 보드에 남은 카드는 아이디어이지 일정이 아니고,
 * 요약 바도 같은 이유로 그것을 빼고 센다.
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

/** Adds a card (optionally with a 예산) to the column at `columnIndex`. */
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

/** Opens the edit sheet of the board card whose title contains `text`. */
async function openCard(page: Page, text: string): Promise<void> {
  await page.getByTestId('board-card').filter({ hasText: text }).first().click();
  await expect(page.getByTestId('card-form')).toBeVisible();
}

/** One leg of the 항공편 마법사; `prefix` is `wizard-out` or `wizard-in`. */
async function fillLeg(
  page: Page,
  prefix: 'wizard-out' | 'wizard-in',
  leg: { date: string; dep: string; arr: string; from?: string; to?: string },
): Promise<void> {
  await page.getByTestId(`${prefix}-date`).fill(leg.date);
  await page.getByTestId(`${prefix}-dep`).fill(leg.dep);
  await page.getByTestId(`${prefix}-arr`).fill(leg.arr);
  if (leg.from) await page.getByTestId(`${prefix}-from`).fill(leg.from);
  if (leg.to) await page.getByTestId(`${prefix}-to`).fill(leg.to);
}

/** Puts the open card on the `dayIndex`-th day of the active sheet. */
async function scheduleOpenCard(page: Page, dayIndex: number): Promise<void> {
  await page.getByTestId('card-schedule').click();
  await expect(page.getByTestId('schedule-sheet')).toBeVisible();
  await page.getByTestId('schedule-day-option').nth(dayIndex).click();
  await page.getByTestId('schedule-submit').click();
  await expect(page.getByTestId('schedule-sheet')).toHaveCount(0);
}

/** Sums a `data-*` number over every row carrying `testId`. */
async function sumAttr(page: Page, testId: string, attr: string): Promise<number> {
  const values = await page.getByTestId(testId).evaluateAll(
    (nodes, name) => nodes.map((node) => Number(node.getAttribute(name) ?? 0)),
    `data-${attr}`,
  );
  return values.reduce((total, value) => total + value, 0);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('tab-bar')).toBeVisible();
});

/**
 * 항공편 마법사로 5일짜리 시트를 깔고, 그 위에 숙소 하나(2박)·식사 하나(2회)·
 * 미확정 하나를 올린 여행. 두 표가 이 여행을 어떻게 말하는지가 이 테스트다.
 */
test('리포트가 시트의 돈을 카테고리별·일자별 두 표로 말하고, 합계는 요약 바와 같다', async ({
  page,
}) => {
  await createTrip(page, '오사카 리포트');

  // 1) 항공편 마법사로 시트를 만든다 (M2b의 그 흐름).
  await page.getByTestId('tab-timeline').click();
  await page.getByTestId('sheet-add').click();
  await expect(page.getByTestId('sheet-wizard')).toBeVisible();
  await page.getByTestId('wizard-name-input').fill('본 일정');
  await fillLeg(page, 'wizard-out', {
    date: '2026-05-03',
    dep: '10:00',
    arr: '12:30',
    from: 'ICN',
    to: 'KIX',
  });
  await fillLeg(page, 'wizard-in', { date: '2026-05-07', dep: '18:00', arr: '20:30' });
  await page.getByTestId('wizard-submit').click();
  await expect(page.getByTestId('sheet-wizard')).toHaveCount(0);
  await expect(page.getByTestId('timeline-day')).toHaveCount(5);

  // 2) 마법사가 만든 항공권 카드에 값을 적는다.
  await page.getByTestId('tab-board').click();
  await openCard(page, 'ICN→KIX');
  await page.getByTestId('card-budget-input').fill('300000');
  await page.getByTestId('card-submit').click();
  await expect(page.getByTestId('card-form')).toHaveCount(0);

  // 3) 숙소 — 예산 40만, 이미 38만 결제, 2박에 걸침 (예산은 그래도 한 번).
  await addCard(page, 3, '난바 호텔', '400000');
  await openCard(page, '난바 호텔');
  await page.getByTestId('card-expense-amount-input').fill('380000');
  await page.getByTestId('card-expense-add').click();
  await expect(page.getByTestId('card-expense-total')).toHaveAttribute('data-total', '380000');
  await scheduleOpenCard(page, 0);
  await openCard(page, '난바 호텔');
  await scheduleOpenCard(page, 1);

  // 4) 식사 — 2만원짜리를 두 날에 걸었으니 필요한 돈은 4만원 (M25).
  await addCard(page, 2, '이치란', '20000');
  await openCard(page, '이치란');
  await scheduleOpenCard(page, 1);
  await openCard(page, '이치란');
  await scheduleOpenCard(page, 2);

  // 5) 미확정 — 보드에만 있고 시간표에는 없다.
  await addCard(page, 4, '유니버설', '90000');

  // ── 요약 바가 말하는 두 숫자 ─────────────────────────────
  await page.getByTestId('tab-timeline').click();
  const bar = page.getByTestId('spend-summary-sheet');
  await expect(bar).toHaveAttribute('data-budget', '740000');
  await expect(page.getByTestId('spend-summary-spent')).toHaveAttribute('data-spent', '380000');

  // ── 표 1: 카테고리별 ─────────────────────────────────────
  await expect(page.getByTestId('report-open')).toBeVisible();
  await page.getByTestId('report-open').click();
  await expect(page.getByTestId('report-sheet')).toBeVisible();
  await expect(page.getByTestId('report-view-toggle')).toHaveAttribute('data-view', 'cats');

  // 돈이 걸린 카테고리만, 보드 순서대로.
  const cats = page.getByTestId('report-cat');
  await expect(cats).toHaveCount(3);
  await expect(cats.nth(0)).toContainText('이동수단');
  await expect(cats.nth(1)).toContainText('식사');
  await expect(cats.nth(2)).toContainText('숙소');

  const rows = page.getByTestId('report-row');
  // 귀국편은 예산도 지출도 없어 줄을 얻지 못한다: 항공권 1 + 숙소 1 + 식사 1.
  await expect(rows).toHaveCount(3);
  await expect(rows.filter({ hasText: '유니버설' })).toHaveCount(0);

  const stayRow = rows.filter({ hasText: '난바 호텔' });
  // 2박이어도 예산은 한 번 (M31), 영수증도 카드마다 하나 (M6).
  await expect(stayRow).toHaveAttribute('data-budget', '400000');
  await expect(stayRow).toHaveAttribute('data-spent', '380000');
  const mealRow = rows.filter({ hasText: '이치란' });
  await expect(mealRow).toHaveAttribute('data-budget', '40000');

  // 총계는 바가 말한 그 숫자다.
  const total = page.getByTestId('report-total');
  await expect(total).toHaveAttribute('data-budget', '740000');
  await expect(total).toHaveAttribute('data-spent', '380000');
  await expect(total).toContainText('740,000원');
  // 카테고리 소계를 더해도 같은 곳에 떨어진다.
  expect(await sumAttr(page, 'report-cat', 'budget')).toBe(740_000);
  expect(await sumAttr(page, 'report-cat', 'spent')).toBe(380_000);

  // ── 표 2: 일자별 ─────────────────────────────────────────
  await page.getByTestId('report-view-days').click();
  await expect(page.getByTestId('report-view-toggle')).toHaveAttribute('data-view', 'days');

  // 숙소비와 항공권은 어느 날에도 속하지 않고, 맨 위에 한 번씩만 선다.
  const pinned = page.getByTestId('report-pinned');
  await expect(pinned).toHaveCount(2);
  await expect(pinned.nth(0)).toHaveAttribute('data-kind', 'stay');
  await expect(pinned.nth(0)).toContainText('숙소비');
  await expect(pinned.nth(0)).toHaveAttribute('data-budget', '400000');
  await expect(pinned.nth(0)).toHaveAttribute('data-spent', '380000');
  await expect(pinned.nth(1)).toHaveAttribute('data-kind', 'flight');
  await expect(pinned.nth(1)).toContainText('항공권');
  await expect(pinned.nth(1)).toHaveAttribute('data-budget', '300000');
  // 출발편·귀국편 두 장이 한 줄로 접힌다.
  await expect(pinned.nth(1)).toHaveAttribute('data-count', '2');

  // 그 아래로 1일차부터 5일차까지.
  const days = page.getByTestId('report-day');
  await expect(days).toHaveCount(5);
  await expect(days.nth(0)).toContainText('1일차');
  await expect(days.nth(4)).toContainText('5일차');
  // 못 박힌 것을 뺀 나머지 — 식사만 2·3일차에 2만원씩.
  await expect(days.nth(1)).toHaveAttribute('data-budget', '20000');
  await expect(days.nth(2)).toHaveAttribute('data-budget', '20000');
  await expect(days.nth(0)).toHaveAttribute('data-budget', '0');

  // 불변식: 못 박힌 줄 + 일자들 = 총계.
  expect(
    (await sumAttr(page, 'report-pinned', 'budget')) + (await sumAttr(page, 'report-day', 'budget')),
  ).toBe(740_000);
  expect(
    (await sumAttr(page, 'report-pinned', 'spent')) + (await sumAttr(page, 'report-day', 'spent')),
  ).toBe(380_000);

  await expect(page.getByTestId('report-total')).toHaveAttribute('data-budget', '740000');
  // 그리고 사용자가 따로 물은 숫자: 지출 + 예산.
  const combined = page.getByTestId('report-total-combined');
  await expect(combined).toHaveAttribute('data-total', '1120000');
  await expect(combined).toContainText('1,120,000원');

  // 다시 카테고리별로 미끄러져 돌아온다.
  await page.getByTestId('report-view-cats').click();
  await expect(page.getByTestId('report-view-toggle')).toHaveAttribute('data-view', 'cats');
  await expect(page.getByTestId('report-cat')).toHaveCount(3);

  await page.getByTestId('sheet-close').click();
  await expect(page.getByTestId('report-sheet')).toHaveCount(0);
});

test('배치된 카드가 없으면 표 대신 이유를 말한다', async ({ page }) => {
  await createTrip(page, '빈 리포트');
  await page.getByTestId('tab-timeline').click();
  await page.getByTestId('timeline-add-day-empty').click();
  await expect(page.getByTestId('timeline-day')).toHaveCount(1);

  await page.getByTestId('report-open').click();
  await expect(page.getByTestId('report-empty')).toBeVisible();
  await expect(page.getByTestId('report-table')).toHaveCount(0);

  // 일자별 표는 여전히 하루치 줄을 보여준다 — 0원인 하루도 하루다.
  await page.getByTestId('report-view-days').click();
  await expect(page.getByTestId('report-day')).toHaveCount(1);
  await expect(page.getByTestId('report-total-combined')).toHaveAttribute('data-total', '0');
});

/* ------------------------------------------------------------------ *
 * 좁은 화면
 * ------------------------------------------------------------------ */

test.describe('좁은 화면', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('헤더 버튼이 물러난 폭에서도 예산 바 팝오버로 리포트에 닿는다', async ({ page }) => {
    // AI가 켜진 390px 폰이 실제 이 경우다 — 여기서는 폭 자체를 더 좁혀
    // 헤더 버튼이 물러난 상황을 만든다 (`roomForReport`의 실측 기준선).
    await page.setViewportSize({ width: 344, height: 844 });
    await createTrip(page, '교토 팝오버');
    await addCard(page, 2, '니시키 시장', '30000');

    await page.getByTestId('tab-timeline').click();
    await page.getByTestId('timeline-add-day-empty').click();
    await expect(page.getByTestId('timeline-day')).toHaveCount(1);

    await page.getByTestId('tab-board').click();
    await openCard(page, '니시키');
    await scheduleOpenCard(page, 0);

    await page.getByTestId('tab-timeline').click();
    await expect(page.getByTestId('report-open')).toHaveCount(0);

    // 돈을 보러 연 팝오버의 맨 아랫줄이 두 번째 진입점이다 (M32).
    await page.getByTestId('spend-summary-cats-open').click();
    await page.getByTestId('report-open-popover').click();
    await expect(page.getByTestId('spend-summary-cats')).toHaveCount(0);
    await expect(page.getByTestId('report-sheet')).toBeVisible();
    await expect(page.getByTestId('report-total')).toHaveAttribute('data-budget', '30000');
  });

  test('390px에서 리포트 표가 가로로 넘치지 않는다', async ({ page }) => {
    await createTrip(page, '오사카 모바일');
    await addCard(page, 3, '난바 호텔 — 도톤보리 강 바로 앞의 그 방', '400000');
    await addCard(page, 2, '이치란 라멘 본점', '20000');

    await page.getByTestId('tab-timeline').click();
    await page.getByTestId('timeline-add-day-empty').click();
    await expect(page.getByTestId('timeline-day')).toHaveCount(1);

    await page.getByTestId('tab-board').click();
    await openCard(page, '난바 호텔');
    await scheduleOpenCard(page, 0);
    await openCard(page, '이치란');
    await scheduleOpenCard(page, 0);

    await page.getByTestId('tab-timeline').click();
    // 상단 메뉴를 접어도 버튼은 살아 있다 (접기는 숨기기가 아니다 — M29의 규칙).
    await page.getByTestId('timeline-chrome-toggle').click();
    await expect(page.getByTestId('timeline-header')).toHaveAttribute('data-collapsed', 'true');
    await expect(page.getByTestId('report-open')).toBeVisible();

    await page.getByTestId('report-open').click();
    await expect(page.getByTestId('report-sheet')).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    // 표 자체도 시트 안에서 끝난다 — 긴 카드 이름은 잘리고 숫자는 제자리다.
    const table = page.getByTestId('report-table');
    const box = await table.boundingBox();
    expect((box?.x ?? 0) + (box?.width ?? 9999)).toBeLessThanOrEqual(390);
    const scrolls = await table.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    expect(scrolls).toBe(false);

    await page.getByTestId('report-view-days').click();
    await expect(page.getByTestId('report-day')).toHaveCount(1);
    const daysOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(daysOverflow).toBeLessThanOrEqual(0);
  });
});
