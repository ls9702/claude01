import { expect, test, type Page } from '@playwright/test';

/**
 * 메모 표식 탭 — M48. 폰에서 메모를 빨리 보는 길.
 *
 * M47의 호버 미리보기는 `(hover: hover) and (pointer: fine)`에서만 산다. 폰에는
 * 그 조건이 없고, 카드의 남은 제스처도 이미 임자가 있다 — 탭은 편집/상세를 열고
 * 롱프레스(250ms)는 드래그다. 그래서 M48은 **표식 자신을 탭 타깃으로** 만든다:
 * 일정 블록의 접힌 모서리(M39)와 보드 카드의 메모 줄이 그것이고, 누르면 호버와
 * **같은 팝오버**가 같은 자리 계산으로 뜬다.
 *
 * 여기서 못박는 것은 넷이다.
 *
 * 1. 표식을 누르면 팝오버가 뜨고 메모가 통째로 보인다.
 * 2. 그 탭이 **본체로 새지 않는다** — 상세 시트도 카드 편집도 열리지 않고,
 *    드래그 센서도 깨어나지 않는다(블록은 제자리에 있다).
 * 3. 바깥을 누르면 닫힌다.
 * 4. 같은 표식을 다시 누르면 닫힌다.
 *
 * 자리 계산(좁은 폭에서 화면 안으로 밀어 넣기)은 `utils/hoverPopover.test.ts`의
 * 단위 테스트가 본다 — 브라우저가 확인할 수 있는 것은 「떴다/닫혔다」다.
 */

test.use({ viewport: { width: 390, height: 844 } });

const NOTE = '개장 30분 전 도착\n짐은 호텔에 맡기고 출발';

/** Creates a trip from the 여행 tab and lands on its board. */
async function createTrip(page: Page, title: string): Promise<void> {
  await page.getByTestId('add-trip').click();
  await page.getByTestId('trip-title-input').fill(title);
  await page.getByTestId('trip-submit').click();
  await expect(page.getByTestId('trip-form')).toHaveCount(0);
  await page.getByTestId('trip-card').filter({ hasText: title }).getByTestId('trip-open').click();
  await expect(page).toHaveURL(/#\/board$/);
}

/** Adds a card to the `columnIndex`-th column, with or without a memo. */
async function addCard(page: Page, columnIndex: number, title: string, memo?: string): Promise<void> {
  await page.getByTestId('board-column').nth(columnIndex).getByTestId('add-card').click();
  await page.getByTestId('card-title-input').fill(title);
  if (memo) await page.getByTestId('card-memo-input').fill(memo);
  await page.getByTestId('card-submit').click();
  await expect(page.getByTestId('card-form')).toHaveCount(0);
  await expect(page.getByTestId('board-card').filter({ hasText: title })).toBeVisible();
}

/** Opens 일정 for the active trip and adds one day. */
async function openTimelineWithADay(page: Page): Promise<void> {
  await page.getByTestId('tab-timeline').click();
  await expect(page.getByTestId('view-timeline')).toBeVisible();
  await page.getByTestId('timeline-add-day').click();
  await expect(page.getByTestId('timeline-day')).toHaveCount(1);
}

/** Places the board's first card on the grid at 10:00 without dragging. */
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

test('폰에서 보드 카드의 메모 줄을 누르면 메모가 뜨고, 바깥을 누르면 닫힌다', async ({
  page,
}) => {
  await page.goto('/');
  await createTrip(page, '폰 메모 카드');
  await addCard(page, 2, '이치란', NOTE);

  const card = page.getByTestId('board-card').filter({ hasText: '이치란' });
  const mark = card.getByTestId('card-note-mark');
  await expect(mark).toBeVisible();

  // 손가락으로 겨눌 수 있는 크기여야 한다.
  const markBox = await mark.boundingBox();
  expect(Math.round(markBox?.width ?? 0)).toBeGreaterThanOrEqual(32);
  expect(Math.round(markBox?.height ?? 0)).toBeGreaterThanOrEqual(32);

  // 그러면서 카드 가운데는 여전히 카드의 것이다 — 눌러 편집이 열리고, 닫는다.
  await card.click();
  await expect(page.getByTestId('card-form')).toBeVisible();
  await page.getByTestId('sheet-close').click();
  await expect(page.getByTestId('card-form')).toHaveCount(0);

  await mark.click();

  const popover = page.getByTestId('card-note-hover');
  await expect(popover).toBeVisible();
  await expect(popover).toContainText('개장 30분 전 도착');
  await expect(popover).toContainText('짐은 호텔에 맡기고 출발');
  // 탭이 카드 본체로 새지 않았다 — 편집 시트는 열리지 않는다.
  await expect(page.getByTestId('card-form')).toHaveCount(0);

  // 바깥 — 카드 바로 아래, 칸 안의 빈 자리.
  const cardBox = await card.boundingBox();
  await page.mouse.click((cardBox?.x ?? 0) + 20, (cardBox?.y ?? 0) + (cardBox?.height ?? 0) + 4);
  await expect(popover).toHaveCount(0);
  await expect(page.getByTestId('card-form')).toHaveCount(0);

  // 같은 표식을 다시 누르면 닫힌다 — 한 번에 하나만 열린다는 규칙의 가장 짧은 형태.
  await mark.click();
  await expect(popover).toBeVisible();
  await mark.click();
  await expect(popover).toHaveCount(0);
});

test('폰에서 일정 블록의 접힌 모서리를 누르면 메모가 뜨고, 상세 시트는 열리지 않는다', async ({
  page,
}) => {
  await page.goto('/');
  await createTrip(page, '폰 메모 블록');
  await addCard(page, 2, '이치란');
  await openTimelineWithADay(page);
  await scheduleFirstCard(page);

  const block = page.getByTestId('timeline-entry');
  await expect(block).toHaveCount(1);

  // 배치 메모는 상세 시트에서 적는다 (M39) — 읽는 길만 하나 늘었다.
  await block.click();
  await expect(page.getByTestId('entry-sheet')).toBeVisible();
  await page.getByTestId('entry-note-input').fill(NOTE);
  await page.getByTestId('entry-save').click();
  await expect(page.getByTestId('entry-sheet')).toHaveCount(0);
  await expect(block).toHaveAttribute('data-note', 'true');

  // 접힌 자국은 9px 그대로고, 그 위에 32px짜리 투명한 손가락 자리가 있다.
  const tap = page.getByTestId('entry-note-tap');
  const tapBox = await tap.boundingBox();
  expect(Math.round(tapBox?.width ?? 0)).toBeGreaterThanOrEqual(32);
  expect(Math.round(tapBox?.height ?? 0)).toBeGreaterThanOrEqual(32);
  const markBox = await page.getByTestId('entry-note-mark').boundingBox();
  expect(Math.round(markBox?.width ?? 0)).toBe(9);

  await tap.click();

  const popover = page.getByTestId('entry-note-hover');
  await expect(popover).toBeVisible();
  await expect(popover).toContainText('개장 30분 전 도착');
  await expect(popover).toContainText('짐은 호텔에 맡기고 출발');
  // 본체로 새지 않았다: 상세 시트도 열리지 않고, 드래그도 시작되지 않았다.
  await expect(page.getByTestId('entry-sheet')).toHaveCount(0);
  await expect(block).toHaveAttribute('data-start-min', '600');

  // 바깥 — 시간 눈금 칸에는 아무 손잡이도 없다.
  const blockBox = await block.boundingBox();
  await page.mouse.click(10, (blockBox?.y ?? 0) + (blockBox?.height ?? 0) + 20);
  await expect(popover).toHaveCount(0);
  await expect(page.getByTestId('entry-sheet')).toHaveCount(0);

  // 블록 본체를 누르는 길은 그대로다 — 메모를 고치는 자리는 여전히 상세 시트다.
  await block.click();
  await expect(page.getByTestId('entry-sheet')).toBeVisible();
  await expect(page.getByTestId('entry-note-input')).toHaveValue(NOTE);
});
