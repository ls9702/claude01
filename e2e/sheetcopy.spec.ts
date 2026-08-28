import { expect, test, type Page } from '@playwright/test';

/**
 * 시트 복제 — M40.
 *
 * 백로그 1순위였던 것(M7 토론)이고, 요점은 시나리오 비교다: 같은 카드를 다르게
 * 배치한 두 안을 나란히 놓고 고른다. 그래서 여기서 못박는 것은 「복사됐다」가
 * 아니라 **「둘이 서로를 모른다」**이다.
 *
 * 1. ⋯ 메뉴의 「복제」가 일자·배치·메모를 그대로 든 사본을 만들고, 화면이 그
 *    사본으로 넘어간다.
 * 2. 사본을 고쳐도 원본은 그대로다.
 * 3. 사본을 지워도 원본은 그대로다 — 카드도 보드에 남는다.
 */

test.use({ viewport: { width: 1280, height: 800 } });

const NOTE = '개장 30분 전 도착';
const COPY_NOTE = '사본에서만 고친 메모';

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

/** 보드의 첫 카드를 시간표에 놓는다 — 드래그를 쓰지 않는 배치 경로. */
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

/** 상세 시트를 열어 메모를 적고 저장한다. */
async function writeNote(page: Page, block: ReturnType<Page['locator']>, text: string) {
  await block.click();
  await expect(page.getByTestId('entry-sheet')).toBeVisible();
  await page.getByTestId('entry-note-input').fill(text);
  await page.getByTestId('entry-save').click();
  await expect(page.getByTestId('entry-sheet')).toHaveCount(0);
}

/** ⋯ 메뉴에서 「복제」를 누른다. */
async function duplicateActiveSheet(page: Page): Promise<void> {
  await page.getByTestId('sheet-menu').click();
  await expect(page.getByTestId('sheet-menu-panel')).toBeVisible();
  await page.getByTestId('sheet-duplicate').click();
  await expect(page.getByTestId('sheet-menu-panel')).toHaveCount(0);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('tab-bar')).toBeVisible();
});

test('시트를 복제하면 배치와 메모를 든 사본이 서고, 둘은 서로를 모른다', async ({ page }) => {
  await createTrip(page, '오사카 시트복제');
  await addCard(page, 2, '이치란');
  await openTimelineWithADay(page);
  await scheduleFirstCard(page);
  await writeNote(page, page.getByTestId('timeline-entry'), NOTE);

  await expect(page.getByTestId('sheet-tab')).toHaveCount(1);
  await expect(page.getByTestId('timeline-sheet-name')).toHaveText('일정 1');

  await duplicateActiveSheet(page);

  // 사본이 옆에 서고, 화면은 그 사본을 보고 있다.
  await expect(page.getByTestId('sheet-tab')).toHaveCount(2);
  await expect(page.getByTestId('timeline-sheet-name')).toHaveText('일정 1 (복사)');

  // 같은 일자, 같은 배치, 같은 메모.
  await expect(page.getByTestId('timeline-day')).toHaveCount(1);
  const copyBlock = page.getByTestId('timeline-entry');
  await expect(copyBlock).toHaveCount(1);
  await expect(copyBlock).toContainText('이치란');
  await expect(copyBlock).toHaveAttribute('data-start-min', '600');
  await expect(copyBlock).toHaveAttribute('data-note', 'true');
  await copyBlock.click();
  await expect(page.getByTestId('entry-note-input')).toHaveValue(NOTE);
  await page.getByTestId('sheet-close').click();

  // 카드는 여행 것이라 복사되지 않는다 — 보드에 「이치란」은 여전히 한 장이다.
  await page.getByTestId('tab-board').click();
  await expect(page.getByTestId('board-card').filter({ hasText: '이치란' })).toHaveCount(1);
  await page.getByTestId('tab-timeline').click();
  await expect(page.getByTestId('timeline-sheet-name')).toHaveText('일정 1 (복사)');

  // 사본을 고친다 — 시각과 메모 둘 다.
  await writeNote(page, page.getByTestId('timeline-entry'), COPY_NOTE);
  await expect(page.getByTestId('timeline-entry')).toHaveAttribute('data-note', 'true');

  // 원본은 손대지 않은 그대로다.
  await page.getByTestId('sheet-tab').filter({ hasText: '일정 1' }).first().click();
  await expect(page.getByTestId('timeline-sheet-name')).toHaveText('일정 1');
  const originalBlock = page.getByTestId('timeline-entry');
  await expect(originalBlock).toHaveCount(1);
  await expect(originalBlock).toHaveAttribute('data-start-min', '600');
  await originalBlock.click();
  await expect(page.getByTestId('entry-note-input')).toHaveValue(NOTE);
  await page.getByTestId('sheet-close').click();

  // 한 번 더 복제하면 이름이 겹치지 않고 번호가 붙는다.
  await duplicateActiveSheet(page);
  await expect(page.getByTestId('sheet-tab')).toHaveCount(3);
  await expect(page.getByTestId('timeline-sheet-name')).toHaveText('일정 1 (복사 2)');

  // 사본을 지워도 원본은 그대로 — 배치도 메모도 카드도.
  await page.getByTestId('sheet-menu').click();
  await page.getByTestId('sheet-delete').click();
  await expect(page.getByTestId('sheet-delete-confirm')).toBeVisible();
  await page.getByTestId('confirm-accept').click();
  await expect(page.getByTestId('sheet-tab')).toHaveCount(2);

  await page.getByTestId('sheet-tab').filter({ hasText: '일정 1' }).first().click();
  await expect(page.getByTestId('timeline-sheet-name')).toHaveText('일정 1');
  await expect(page.getByTestId('timeline-entry')).toHaveCount(1);
  await expect(page.getByTestId('timeline-entry')).toHaveAttribute('data-note', 'true');
  await page.getByTestId('tab-board').click();
  await expect(page.getByTestId('board-card').filter({ hasText: '이치란' })).toHaveCount(1);
});

test.describe('모바일', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('폰의 ⋯ 메뉴에서도 복제가 실제로 눌린다', async ({ page }) => {
    await createTrip(page, '부산 시트복제');
    await page.getByTestId('tab-timeline').click();
    await expect(page.getByTestId('timeline-sheet-name')).toHaveText('일정 1');

    await page.getByTestId('sheet-menu').click();
    const panel = page.getByTestId('sheet-menu-panel');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('복제');

    // M15 §1과 같은 확인: 그 줄 위에 아무것도 덮여 있지 않다.
    const onTop = await page.evaluate(() => {
      const row = document.querySelector('[data-testid="sheet-duplicate"]');
      if (!row) return 'no row';
      const rect = row.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return hit && row.contains(hit) ? 'row' : 'something else';
    });
    expect(onTop).toBe('row');

    const rowBox = await page.getByTestId('sheet-duplicate').boundingBox();
    expect(rowBox?.height ?? 0).toBeGreaterThanOrEqual(44);
    await page.mouse.click(
      (rowBox?.x ?? 0) + (rowBox?.width ?? 0) / 2,
      (rowBox?.y ?? 0) + (rowBox?.height ?? 0) / 2,
    );

    await expect(page.getByTestId('sheet-tab')).toHaveCount(2);
    await expect(page.getByTestId('timeline-sheet-name')).toHaveText('일정 1 (복사)');

    // 시트 줄이 늘어도 문서는 가로로 스크롤되지 않는다.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
