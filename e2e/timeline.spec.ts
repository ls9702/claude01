import { expect, test, type Page } from '@playwright/test';

/**
 * 일정 (timeline) — M2a.
 *
 * Exactly **one** spec drags something, and it is the flow that cannot be
 * exercised any other way: a board card from the desktop rail onto a minute of
 * a day column. Everything else goes through taps and sheets, which are far
 * less flaky than synthetic pointer streams.
 */

/** Grid geometry — must match `src/timeline/layout.ts`. */
const PX_PER_MIN = 0.9;

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

/** Opens 일정 for the active trip and adds one day. */
async function openTimelineWithADay(page: Page): Promise<void> {
  await page.getByTestId('tab-timeline').click();
  await expect(page.getByTestId('view-timeline')).toBeVisible();
  await page.getByTestId('timeline-add-day').click();
  await expect(page.getByTestId('timeline-day')).toHaveCount(1);
}

/**
 * Walks the mouse from `from` to `to` in steps — the PointerSensor needs more
 * than 8px of travel before it starts a drag, and dnd-kit needs a few frames
 * to settle on a droppable.
 */
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

const startMinOf = async (entry: ReturnType<Page['getByTestId']>): Promise<number> =>
  Number(await entry.getAttribute('data-start-min'));

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('tab-bar')).toBeVisible();
});

test('여행을 열면 일정 탭에 시트가 생기고 일자를 추가할 수 있다', async ({ page }) => {
  await createTrip(page, '교토');

  await page.getByTestId('tab-timeline').click();
  await expect(page).toHaveURL(/#\/timeline$/);
  await expect(page.getByTestId('view-timeline')).toBeVisible();
  // The first visit seeds '일정 1' so there is always somewhere to add a day.
  await expect(page.getByTestId('timeline-sheet-name')).toHaveText('일정 1');
  await expect(page.getByTestId('timeline-empty')).toBeVisible();

  await page.getByTestId('timeline-add-day-empty').click();
  await expect(page.getByTestId('timeline-day')).toHaveCount(1);
  await expect(page.getByTestId('timeline-day-title').first()).toHaveText('1일차');
  await expect(page.getByTestId('time-axis')).toContainText('06:00');
  // Desktop keeps the board rail beside the grid inside one drag context.
  await expect(page.getByTestId('timeline-rail')).toBeVisible();

  await page.getByTestId('timeline-add-day').click();
  await expect(page.getByTestId('timeline-day')).toHaveCount(2);
});

test('보드 레일의 카드를 하루 칸으로 끌어다 10시쯤에 배치한다', async ({ page }) => {
  await createTrip(page, '오사카');
  await addCard(page, 0, '츠텐카쿠');
  await openTimelineWithADay(page);

  const railCard = page.getByTestId('timeline-rail').getByTestId('board-card').first();
  await expect(railCard).toBeVisible();
  // The rail scrolls on its own — a card below the fold would report a
  // bounding box that no pointer can actually reach.
  await railCard.scrollIntoViewIfNeeded();

  const grid = page.getByTestId('timeline-day-grid').first();
  const gridBox = await grid.boundingBox();
  const cardBox = await railCard.boundingBox();
  if (!gridBox || !cardBox) throw new Error('드래그 대상의 위치를 찾지 못했어요');

  // The grid opens scrolled to 06:00, so 10:00 is on screen without scrolling.
  const scrollTop = await page
    .getByTestId('timeline-scroller')
    .evaluate((element) => element.scrollTop);
  expect(Math.round(scrollTop)).toBe(Math.round(360 * PX_PER_MIN));

  // `boundingBox()` is already viewport-relative, so minute 0 is `gridBox.y`.
  const targetY = gridBox.y + 600 * PX_PER_MIN;

  await dragMouse(
    page,
    { x: cardBox.x + cardBox.width / 2, y: cardBox.y + cardBox.height / 2 },
    { x: gridBox.x + gridBox.width / 2, y: targetY },
  );

  const entry = page.getByTestId('timeline-entry');
  await expect(entry).toHaveCount(1);

  const placed = await startMinOf(entry.first());
  expect(placed % 15).toBe(0);
  // The pointer was put on 10:00; one grid step of slack keeps this honest
  // without making it brittle.
  expect(Math.abs(placed - 600)).toBeLessThanOrEqual(15);
  await expect(entry.first()).toHaveAttribute('data-duration-min', '60');
  await expect(entry.first()).toContainText('츠텐카쿠');

  // A drag placement is undoable for a few seconds.
  await expect(page.getByTestId('undo-toast')).toBeVisible();

  // The card on the board now carries a 🗓 badge.
  await expect(railCard.getByTestId('card-schedule-badge')).toHaveText(/1/);

  // Drag the entry itself an hour lower.
  const entryBox = await entry.first().boundingBox();
  if (!entryBox) throw new Error('일정 블록의 위치를 찾지 못했어요');
  await dragMouse(
    page,
    { x: entryBox.x + entryBox.width / 2, y: entryBox.y + 8 },
    { x: entryBox.x + entryBox.width / 2, y: entryBox.y + 8 + 60 * PX_PER_MIN },
  );

  await expect
    .poll(() => startMinOf(entry.first()))
    .toBeGreaterThan(placed);
  const moved = await startMinOf(entry.first());
  expect(moved % 15).toBe(0);

  // …and it survives a reload.
  await waitForPersisted(page, '츠텐카쿠');
  await page.reload();
  await expect(page.getByTestId('tab-bar')).toBeVisible();
  // 새로고침해도 보던 여행의 시간표로 곧장 돌아온다 (B15).
  await expect(page.getByTestId('timeline-trip-option')).toHaveCount(0);
  await expect(page.getByTestId('timeline-entry')).toHaveCount(1);
  await expect(page.getByTestId('timeline-entry')).toHaveAttribute(
    'data-start-min',
    String(moved),
  );
});

test('카드 편집 시트의 시간표에 추가로 배치하고 되돌린다', async ({ page }) => {
  await createTrip(page, '삿포로');
  await addCard(page, 1, '유심 사기');
  await openTimelineWithADay(page);

  // Back to the board: schedule through the card sheet (the touch path).
  await page.getByTestId('tab-board').click();
  await page.getByTestId('board-card').first().click();
  await expect(page.getByTestId('card-form')).toBeVisible();
  await page.getByTestId('card-schedule').click();

  await expect(page.getByTestId('schedule-sheet')).toBeVisible();
  await expect(page.getByTestId('schedule-start-value')).toHaveText('10:00');
  await page.getByTestId('schedule-start-plus').click();
  await page.getByTestId('schedule-start-plus').click();
  await expect(page.getByTestId('schedule-start-value')).toHaveText('10:30');
  await page.getByTestId('schedule-duration-plus').click();
  await expect(page.getByTestId('schedule-preview')).toHaveText('10:30–11:45');
  await page.getByTestId('schedule-submit').click();

  await expect(page.getByTestId('schedule-sheet')).toHaveCount(0);
  await expect(page.getByTestId('card-schedule-badge')).toHaveText(/1/);

  await page.getByTestId('tab-timeline').click();
  const entry = page.getByTestId('timeline-entry');
  await expect(entry).toHaveAttribute('data-start-min', '630');
  await expect(entry).toHaveAttribute('data-duration-min', '75');

  // Tap the entry → detail sheet → nudge, then delete with 실행 취소.
  await entry.click();
  await expect(page.getByTestId('entry-sheet')).toBeVisible();
  await expect(page.getByTestId('entry-range')).toHaveText('10:30–11:45');
  await page.getByTestId('entry-start-minus').click();
  await expect(page.getByTestId('entry-range')).toHaveText('10:15–11:30');
  await page.getByTestId('entry-duration-minus').click();
  await expect(page.getByTestId('entry-range')).toHaveText('10:15–11:15');
  await page.getByTestId('entry-note-input').fill('공항 도착 직후');
  await page.getByTestId('entry-save').click();
  await expect(page.getByTestId('entry-sheet')).toHaveCount(0);

  await entry.click();
  await expect(page.getByTestId('entry-note-input')).toHaveValue('공항 도착 직후');
  await page.getByTestId('entry-delete').click();
  await expect(page.getByTestId('timeline-entry')).toHaveCount(0);

  await expect(page.getByTestId('undo-toast')).toContainText('삭제됨');
  await page.getByTestId('undo-action').click();
  await expect(page.getByTestId('timeline-entry')).toHaveCount(1);
  await expect(page.getByTestId('timeline-entry')).toHaveAttribute('data-start-min', '615');
});

test('겹치는 일정은 나란히 놓이고, 일자를 지우면 함께 사라진다', async ({ page }) => {
  await createTrip(page, '다낭');
  await addCard(page, 0, '바나힐');
  await addCard(page, 2, '반쎄오');
  await openTimelineWithADay(page);

  // Two entries at overlapping times, both through the schedule sheet.
  for (const [title, clicks] of [
    ['바나힐', 0],
    ['반쎄오', 1],
  ] as const) {
    await page.getByTestId('tab-board').click();
    await page.getByTestId('board-card').filter({ hasText: title }).click();
    await page.getByTestId('card-schedule').click();
    for (let i = 0; i < clicks; i += 1) await page.getByTestId('schedule-start-plus').click();
    await page.getByTestId('schedule-submit').click();
    await expect(page.getByTestId('schedule-sheet')).toHaveCount(0);
  }

  await page.getByTestId('tab-timeline').click();
  const entries = page.getByTestId('timeline-entry');
  await expect(entries).toHaveCount(2);

  // Overlapping entries split the column: neither is full width, and they do
  // not sit on top of one another.
  const first = await entries.nth(0).boundingBox();
  const second = await entries.nth(1).boundingBox();
  const grid = await page.getByTestId('timeline-day-grid').first().boundingBox();
  if (!first || !second || !grid) throw new Error('일정 블록의 위치를 찾지 못했어요');
  expect(first.width).toBeLessThan(grid.width * 0.75);
  expect(Math.abs(first.x - second.x)).toBeGreaterThan(10);

  await expect(page.getByTestId('timeline-day-count').first()).toHaveText('2');

  // Deleting the day takes its entries with it.
  await page.getByTestId('day-menu').first().click();
  await page.getByTestId('day-delete').click();
  await expect(page.getByTestId('day-delete-confirm')).toBeVisible();
  await page.getByTestId('confirm-accept').click();

  await expect(page.getByTestId('timeline-day')).toHaveCount(0);
  await expect(page.getByTestId('timeline-empty')).toBeVisible();
  await page.getByTestId('tab-board').click();
  await expect(page.getByTestId('card-schedule-badge')).toHaveCount(0);
});
