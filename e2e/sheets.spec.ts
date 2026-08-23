import { expect, test, type Page } from '@playwright/test';

/**
 * 복수 시트 + 항공편 마법사 — M2b.
 *
 * Everything here goes through taps: the wizard is a plain form, and the flight
 * placements it produces are asserted through the day/entry data attributes
 * rather than by dragging anything (M2a already covers the one drag path).
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

/** Adds a card to the column at `columnIndex` through the column's ＋ button. */
async function addCard(page: Page, columnIndex: number, title: string): Promise<void> {
  await page.getByTestId('board-column').nth(columnIndex).getByTestId('add-card').click();
  await page.getByTestId('card-title-input').fill(title);
  await page.getByTestId('card-submit').click();
  await expect(page.getByTestId('card-form')).toHaveCount(0);
}

/** One leg of the wizard form; `prefix` is `wizard-out` or `wizard-in`. */
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

test('항공편 마법사로 만든 시트는 날짜와 항공편 일정을 함께 깔아준다', async ({ page }) => {
  await createTrip(page, '오사카');
  await page.getByTestId('tab-timeline').click();
  await expect(page.getByTestId('timeline-sheet-name')).toHaveText('일정 1');

  await page.getByTestId('sheet-add').click();
  await expect(page.getByTestId('sheet-wizard')).toBeVisible();
  await expect(page.getByTestId('wizard-mode-flight')).toHaveAttribute('aria-pressed', 'true');

  await page.getByTestId('wizard-name-input').fill('본 일정');
  await fillLeg(page, 'wizard-out', {
    date: '2026-05-03',
    dep: '10:00',
    arr: '12:30',
    from: 'ICN',
    to: 'KIX',
  });
  await fillLeg(page, 'wizard-in', { date: '2026-05-07', dep: '18:00', arr: '20:30' });

  await expect(page.getByTestId('wizard-preview')).toHaveText('5월 3일 ~ 5월 7일 · 5일');
  await page.getByTestId('wizard-submit').click();
  await expect(page.getByTestId('sheet-wizard')).toHaveCount(0);

  // 일정 1 was an empty shell, so the wizard filled it instead of parking a
  // second tab beside it (B17). One sheet, and it is the one just described.
  await expect(page.getByTestId('sheet-tab')).toHaveCount(1);
  await expect(page.getByTestId('timeline-sheet-name')).toHaveText('본 일정');

  const days = page.getByTestId('timeline-day');
  await expect(days).toHaveCount(5);
  const headers = page.getByTestId('timeline-day-header');
  await expect(headers.first()).toContainText('1일차');
  await expect(headers.first()).toContainText('5월 3일');
  await expect(headers.last()).toContainText('5월 7일');

  // One entry per leg: 10:00 on the first day, 18:00 on the last, 150분 each.
  const entries = page.getByTestId('timeline-entry');
  await expect(entries).toHaveCount(2);
  const outbound = days.first().getByTestId('timeline-entry');
  await expect(outbound).toHaveAttribute('data-start-min', '600');
  await expect(outbound).toHaveAttribute('data-duration-min', '150');
  await expect(outbound).toContainText('ICN→KIX');
  const inbound = days.last().getByTestId('timeline-entry');
  await expect(inbound).toHaveAttribute('data-start-min', '1080');
  await expect(inbound).toHaveAttribute('data-duration-min', '150');

  // …and the two ✈️ cards live on the board, in 이동수단.
  const railMovement = page.getByTestId('timeline-rail').locator('[data-column-name="이동수단"]');
  await expect(railMovement.getByTestId('board-card')).toHaveCount(2);
  await expect(railMovement.getByTestId('board-card').first()).toContainText('✈️ ICN→KIX');
  await expect(railMovement.getByTestId('board-card').last()).toContainText('✈️ 귀국편');

  // A second wizard run now has a *non*-empty active sheet, so it does add a
  // sibling — and switches to it.
  await page.getByTestId('sheet-add').click();
  await page.getByTestId('wizard-name-input').fill('플랜 B');
  await page.getByTestId('wizard-mode-days').click();
  await page.getByTestId('wizard-submit').click();
  await expect(page.getByTestId('sheet-tab')).toHaveCount(2);
  await expect(page.getByTestId('timeline-sheet-name')).toHaveText('플랜 B');

  await page.getByTestId('sheet-tab').filter({ hasText: '본 일정' }).click();
  await expect(page.getByTestId('timeline-sheet-name')).toHaveText('본 일정');

  // Everything survives a reload — and so does the sheet that was on screen,
  // because 활성 여행/시트 are remembered per device now (B15).
  await waitForPersisted(page, '본 일정');
  await page.reload();
  await expect(page.getByTestId('tab-bar')).toBeVisible();
  await expect(page.getByTestId('timeline-trip-option')).toHaveCount(0);

  await expect(page.getByTestId('sheet-tab')).toHaveCount(2);
  await expect(page.getByTestId('timeline-sheet-name')).toHaveText('본 일정');
  await expect(page.getByTestId('timeline-day')).toHaveCount(5);
  await expect(page.getByTestId('timeline-entry')).toHaveCount(2);
});

test('항공편을 하루 미루면 일자 날짜만 밀리고 배치한 일정은 남는다', async ({ page }) => {
  await createTrip(page, '교토');
  await addCard(page, 1, '유니버설');

  await page.getByTestId('tab-timeline').click();
  await page.getByTestId('sheet-add').click();
  await page.getByTestId('wizard-name-input').fill('본 일정');
  await fillLeg(page, 'wizard-out', { date: '2026-05-03', dep: '10:00', arr: '12:30' });
  await fillLeg(page, 'wizard-in', { date: '2026-05-07', dep: '18:00', arr: '20:30' });
  await page.getByTestId('wizard-submit').click();
  await expect(page.getByTestId('timeline-day')).toHaveCount(5);

  // A sibling for the 일정표 picker to choose *between*. 본 일정 now has days,
  // so this one really is a new sheet rather than a refill (B17).
  await page.getByTestId('sheet-add').click();
  await page.getByTestId('wizard-name-input').fill('플랜 B');
  await page.getByTestId('wizard-mode-days').click();
  await page.getByTestId('wizard-submit').click();
  await expect(page.getByTestId('sheet-tab')).toHaveCount(2);
  await page.getByTestId('sheet-tab').filter({ hasText: '본 일정' }).click();
  await expect(page.getByTestId('timeline-day')).toHaveCount(5);

  // Put a card on the second day through the schedule sheet — which must open
  // on the *active* sheet, not on the trip's first one.
  const activeSheetId = await page
    .locator('[data-testid="sheet-tab"][data-active="true"]')
    .getAttribute('data-sheet-id');

  const railCard = page
    .getByTestId('timeline-rail')
    .getByTestId('board-card')
    .filter({ hasText: '유니버설' });
  await railCard.scrollIntoViewIfNeeded();
  await railCard.click();
  await expect(page.getByTestId('schedule-sheet')).toBeVisible();
  // The picker opens on the sheet the 일정 탭 is showing, not on 일정 1.
  await expect(page.getByTestId('schedule-sheet-select')).toHaveValue(String(activeSheetId));
  await expect(page.getByTestId('schedule-day-option')).toHaveCount(5);
  await page.getByTestId('schedule-day-option').nth(1).click();
  await page.getByTestId('schedule-submit').click();
  await expect(page.getByTestId('schedule-sheet')).toHaveCount(0);

  const days = page.getByTestId('timeline-day');
  await expect(page.getByTestId('timeline-entry')).toHaveCount(3);
  await expect(days.nth(1).getByTestId('timeline-entry')).toContainText('유니버설');

  // The 🗓 badge now breaks its total down per sheet — and tapping it must not
  // open the card underneath.
  const badge = railCard.getByTestId('card-schedule-badge');
  await expect(badge).toHaveAttribute('data-count', '1');
  await badge.click();
  const popoverRow = railCard.getByTestId('card-schedule-popover-row');
  await expect(popoverRow).toHaveCount(1);
  await expect(popoverRow).toContainText('본 일정');
  await expect(popoverRow).toHaveAttribute('data-count', '1');
  await expect(page.getByTestId('schedule-sheet')).toHaveCount(0);
  await badge.click();
  await expect(railCard.getByTestId('card-schedule-popover')).toHaveCount(0);

  // 항공편 수정: the same wizard, prefilled, one day later.
  await page.getByTestId('sheet-menu').click();
  await page.getByTestId('sheet-edit-flights').click();
  await expect(page.getByTestId('sheet-wizard')).toBeVisible();
  await expect(page.getByTestId('wizard-out-date')).toHaveValue('2026-05-03');
  await expect(page.getByTestId('wizard-name-input')).toHaveValue('본 일정');

  await page.getByTestId('wizard-out-date').fill('2026-05-04');
  await page.getByTestId('wizard-in-date').fill('2026-05-08');
  await expect(page.getByTestId('wizard-preview')).toHaveText('5월 4일 ~ 5월 8일 · 5일');
  await page.getByTestId('wizard-submit').click();
  await expect(page.getByTestId('sheet-wizard')).toHaveCount(0);

  // Same five day rows, every date one day later.
  await expect(days).toHaveCount(5);
  const headers = page.getByTestId('timeline-day-header');
  await expect(headers.first()).toContainText('5월 4일');
  await expect(headers.last()).toContainText('5월 8일');

  // The hand-placed entry stayed on its day; the flights were re-laid.
  await expect(page.getByTestId('timeline-entry')).toHaveCount(3);
  await expect(days.nth(1).getByTestId('timeline-entry')).toContainText('유니버설');
  await expect(days.first().getByTestId('timeline-entry')).toHaveAttribute(
    'data-start-min',
    '600',
  );
  await expect(days.last().getByTestId('timeline-entry')).toHaveAttribute(
    'data-start-min',
    '1080',
  );
  // No stale ✈️ cards were left behind by the re-lay.
  const railMovement = page.getByTestId('timeline-rail').locator('[data-column-name="이동수단"]');
  await expect(railMovement.getByTestId('board-card')).toHaveCount(2);
});

test.describe('모바일', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('미배치 트레이를 펼쳐 카드를 탭으로 배치한다', async ({ page }) => {
    await createTrip(page, '부산');
    await addCard(page, 1, '감천문화마을');

    await page.getByTestId('tab-timeline').click();
    await page.getByTestId('sheet-add').click();
    await page.getByTestId('wizard-name-input').fill('본 일정');
    await page.getByTestId('wizard-mode-days').click();
    await page.getByTestId('wizard-submit').click();
    // Below `lg` the grid pages through one day at a time.
    await expect(page.getByTestId('day-pager-label')).toHaveText('1일차');
    await expect(page.getByTestId('timeline-rail')).toHaveCount(0);

    const tray = page.getByTestId('unscheduled-tray');
    await expect(tray).toBeVisible();
    await expect(tray.getByTestId('tray-count')).toHaveAttribute('data-count', '1');
    await expect(tray).toHaveAttribute('data-open', 'false');

    await tray.getByTestId('tray-toggle').click();
    await expect(tray).toHaveAttribute('data-open', 'true');
    await expect(tray.getByTestId('tray-card')).toHaveCount(1);
    // 전체 + the one category that actually holds a 미배치 card.
    await expect(tray.getByTestId('tray-filter')).toHaveCount(2);

    await tray.getByTestId('tray-card').first().click();
    await expect(page.getByTestId('schedule-sheet')).toBeVisible();
    await page.getByTestId('schedule-submit').click();

    await expect(page.getByTestId('timeline-entry')).toHaveCount(1);
    // Placed on the active sheet → out of the tray.
    await expect(tray.getByTestId('tray-count')).toHaveAttribute('data-count', '0');
  });
});

test('일수 모드로 날짜 없는 3일짜리 시트를 만든다', async ({ page }) => {
  await createTrip(page, '강릉');
  await page.getByTestId('tab-timeline').click();

  await page.getByTestId('sheet-add').click();
  await page.getByTestId('wizard-name-input').fill('초안');
  await page.getByTestId('wizard-mode-days').click();
  await expect(page.getByTestId('wizard-days-value')).toHaveText('3일');
  await page.getByTestId('wizard-days-plus').click();
  await expect(page.getByTestId('wizard-preview')).toHaveText('4일');
  await page.getByTestId('wizard-days-minus').click();
  await expect(page.getByTestId('wizard-preview')).toHaveText('3일');
  await page.getByTestId('wizard-submit').click();

  await expect(page.getByTestId('timeline-sheet-name')).toHaveText('초안');
  await expect(page.getByTestId('timeline-day')).toHaveCount(3);
  await expect(page.getByTestId('timeline-day-title').first()).toHaveText('1일차');
  await expect(page.getByTestId('timeline-day-title').last()).toHaveText('3일차');
  // A sheet with no dates can never be "today", whatever the clock says (M7b).
  await expect(page.getByTestId('today-chip')).toHaveCount(0);
  await expect(page.getByTestId('now-bar')).toHaveCount(0);
  // No flights, so no ✈️ cards were created.
  await expect(page.getByTestId('timeline-rail').getByTestId('board-card')).toHaveCount(0);

  // ⋯ 메뉴: 이름 변경, then 시트 삭제 with its cascade warning.
  await page.getByTestId('sheet-menu').click();
  await page.getByTestId('sheet-rename').click();
  await page.getByTestId('sheet-rename-input').fill('플랜 B');
  await page.getByTestId('sheet-rename-submit').click();
  await expect(page.getByTestId('timeline-sheet-name')).toHaveText('플랜 B');

  await page.getByTestId('sheet-menu').click();
  await page.getByTestId('sheet-delete').click();
  await expect(page.getByTestId('sheet-delete-confirm')).toContainText('일자 3개');
  await page.getByTestId('confirm-accept').click();

  // The wizard filled 일정 1 rather than adding a sibling (B17), so that was
  // the trip's only sheet and the 일정 탭 is now empty-handed.
  await expect(page.getByTestId('sheet-tab')).toHaveCount(0);
  await expect(page.getByTestId('timeline-empty')).toBeVisible();

  // 일자 추가 must not be a dead end there: it makes the sheet it needs (B16).
  await expect(page.getByTestId('timeline-add-day-empty')).toBeEnabled();
  await page.getByTestId('timeline-add-day-empty').click();
  await expect(page.getByTestId('sheet-tab')).toHaveCount(1);
  await expect(page.getByTestId('timeline-sheet-name')).toHaveText('일정 1');
  await expect(page.getByTestId('timeline-day')).toHaveCount(1);
  await expect(page.getByTestId('timeline-day-title')).toHaveText('1일차');
});
