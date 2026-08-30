import { expect, test, type Page } from '@playwright/test';

/**
 * 메모 호버 미리보기 (M47) — 데스크톱 전용.
 *
 * The board card and the 일정 block both already say *that* a note exists (a
 * truncated line, a folded corner). On a machine with a pointer there is room
 * to say *what* it is, so hovering shows the note itself.
 *
 * Two things worth proving in a browser: the popover really appears for both
 * kinds of thing, and it appears **only after a pause** — without the delay,
 * dragging a card across a board would open and close a dozen of them on the
 * way. The touch path is untouched by construction (the handler ignores
 * `pointerType: 'touch'`), and the geometry is a unit test
 * (`utils/hoverPopover.test.ts`) because placement is the one part hovering
 * cannot check.
 */

const NOTE = '개장 30분 전 도착\n짐은 호텔에 맡기고 출발';

async function createTrip(page: Page, title: string): Promise<void> {
  await page.getByTestId('add-trip').click();
  await page.getByTestId('trip-title-input').fill(title);
  await page.getByTestId('trip-submit').click();
  await expect(page.getByTestId('trip-form')).toHaveCount(0);
  await page.getByTestId('trip-card').filter({ hasText: title }).getByTestId('trip-open').click();
  await expect(page).toHaveURL(/#\/board$/);
}

/** Adds a card to the `columnIndex`-th column, with or without a memo. */
async function addCard(
  page: Page,
  columnIndex: number,
  title: string,
  memo?: string,
): Promise<void> {
  await page.getByTestId('board-column').nth(columnIndex).getByTestId('add-card').click();
  await page.getByTestId('card-title-input').fill(title);
  if (memo) await page.getByTestId('card-memo-input').fill(memo);
  await page.getByTestId('card-submit').click();
  await expect(page.getByTestId('card-form')).toHaveCount(0);
  await expect(page.getByTestId('board-card').filter({ hasText: title })).toBeVisible();
}

test('보드 카드에 마우스를 올리면 메모가 뜬다', async ({ page }) => {
  await page.goto('/');
  await createTrip(page, '호버 메모');
  await addCard(page, 2, '이치란', NOTE);

  const card = page.getByTestId('board-card').filter({ hasText: '이치란' });
  await card.hover();

  const popover = page.getByTestId('card-note-hover');
  await expect(popover).toBeVisible();
  await expect(popover).toContainText('개장 30분 전 도착');
  await expect(popover).toContainText('짐은 호텔에 맡기고 출발');
  // 화면 밖으로 나가지 않는다 — 자리 계산은 순수 함수가 정한다.
  await expect(popover).toHaveAttribute('data-side', /right|left/);

  // 떠나면 사라진다.
  await page.mouse.move(4, 4);
  await expect(popover).toHaveCount(0);
});

test('메모가 없는 카드에는 아무것도 뜨지 않는다', async ({ page }) => {
  await page.goto('/');
  await createTrip(page, '메모 없음');

  await addCard(page, 2, '메모 없는 카드');

  await page.getByTestId('board-card').filter({ hasText: '메모 없는 카드' }).hover();
  await page.waitForTimeout(600);
  await expect(page.getByTestId('card-note-hover')).toHaveCount(0);
});

test('스쳐 지나가는 것만으로는 뜨지 않는다', async ({ page }) => {
  await page.goto('/');
  await createTrip(page, '지연');
  await addCard(page, 2, '통천각', NOTE);

  const card = page.getByTestId('board-card').filter({ hasText: '통천각' });
  const box = await card.boundingBox();
  await page.mouse.move((box?.x ?? 0) + 10, (box?.y ?? 0) + 10);
  // 카드를 보드 건너로 끌 때 팝오버 열두 개가 따라 열리면 안 된다.
  await page.waitForTimeout(120);
  await expect(page.getByTestId('card-note-hover')).toHaveCount(0);

  await page.waitForTimeout(400);
  await expect(page.getByTestId('card-note-hover')).toBeVisible();
});

/* ------------------------------------------------------------------ *
 * 일정 블록 (M39의 메모, M47의 미리보기)
 * ------------------------------------------------------------------ */

/** Opens 일정 for the active trip and adds one day. */
async function openTimelineWithADay(page: Page): Promise<void> {
  await page.getByTestId('tab-timeline').click();
  await expect(page.getByTestId('view-timeline')).toBeVisible();
  await page.getByTestId('timeline-add-day').click();
  await expect(page.getByTestId('timeline-day')).toHaveCount(1);
}

/** Places the board's first card on the grid without dragging. */
async function scheduleFirstCard(page: Page): Promise<void> {
  await page.getByTestId('tab-board').click();
  await page.getByTestId('board-card').first().click();
  await expect(page.getByTestId('card-form')).toBeVisible();
  await page.getByTestId('card-schedule').click();
  await expect(page.getByTestId('schedule-sheet')).toBeVisible();
  await page.getByTestId('schedule-submit').click();
  await expect(page.getByTestId('schedule-sheet')).toHaveCount(0);
  await page.getByTestId('tab-timeline').click();
}

test('일정 블록에 마우스를 올리면 배치 메모가 뜬다', async ({ page }) => {
  await page.goto('/');
  await createTrip(page, '일정 호버');
  await addCard(page, 2, '이치란');
  await openTimelineWithADay(page);
  await scheduleFirstCard(page);

  const block = page.getByTestId('timeline-entry');
  await expect(block).toHaveCount(1);

  // 배치 메모는 카드 메모와 다른 것이다 (M39) — 같은 카드를 두 번 놓으면
  // 메모도 둘이다.
  await block.click();
  await expect(page.getByTestId('entry-sheet')).toBeVisible();
  await page.getByTestId('entry-note-input').fill(NOTE);
  await page.getByTestId('entry-save').click();
  await expect(page.getByTestId('entry-sheet')).toHaveCount(0);

  await expect(block).toHaveAttribute('data-note', 'true');
  await block.hover();

  const popover = page.getByTestId('entry-note-hover');
  await expect(popover).toBeVisible();
  await expect(popover).toContainText('개장 30분 전 도착');
  await expect(popover).toContainText('짐은 호텔에 맡기고 출발');
});
