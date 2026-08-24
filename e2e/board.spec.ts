import { expect, test, type Locator, type Page } from '@playwright/test';

const SEED_COLUMN_NAMES = ['이동수단', '할일', '식사', '숙소', '볼거리'];

/** Creates a trip from the 여행 tab and opens its board. */
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

/**
 * Card titles inside one column, in board order.
 *
 * The card's own `innerText` is not the title: it also carries the chips and,
 * since M13, the author avatar's initials (`렌터카 예약\nS`). Reads the heading.
 */
async function cardTitles(column: Locator): Promise<string[]> {
  return column.getByTestId('board-card').locator('h3').allInnerTexts();
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

test('여행을 만들면 보드에 기본 카테고리 5개가 생긴다', async ({ page }) => {
  await createTrip(page, '오사카 3박4일');

  const columns = page.getByTestId('board-column');
  await expect(columns).toHaveCount(5);
  await expect(columns).toContainText(SEED_COLUMN_NAMES);
  await expect(page.getByTestId('board-trip-title')).toHaveText('오사카 3박4일');
  await expect(page.getByTestId('add-column')).toBeVisible();
});

test('서로 다른 칸에 카드를 추가하고 드래그로 옮긴다', async ({ page }) => {
  await createTrip(page, '삿포로');

  await addCard(page, 0, '렌터카 예약');
  await addCard(page, 1, '유심 사기');

  const first = page.getByTestId('board-column').nth(0);
  const second = page.getByTestId('board-column').nth(1);
  await expect(first.getByTestId('board-card')).toHaveCount(1);
  await expect(second.getByTestId('board-card')).toHaveCount(1);
  expect(await cardTitles(first)).toContain('렌터카 예약');

  // Drag '렌터카 예약' from column 1 into column 2. PointerSensor needs more
  // than 8px of movement, so walk there in steps instead of one jump.
  const card = first.getByTestId('board-card').first();
  const source = await card.boundingBox();
  const targetCard = second.getByTestId('board-card').first();
  const destination = await targetCard.boundingBox();
  if (!source || !destination) throw new Error('드래그 대상의 위치를 찾지 못했어요');

  const from = { x: source.x + source.width / 2, y: source.y + source.height / 2 };
  const to = { x: destination.x + destination.width / 2, y: destination.y + destination.height / 2 };

  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (const step of [0.15, 0.35, 0.6, 0.85, 1]) {
    await page.mouse.move(from.x + (to.x - from.x) * step, from.y + (to.y - from.y) * step);
  }
  await page.mouse.up();

  await expect(second.getByTestId('board-card')).toHaveCount(2);
  await expect(first.getByTestId('board-card')).toHaveCount(0);
  expect((await cardTitles(second)).join('|')).toContain('렌터카 예약');
  await expect(second).toContainText('유심 사기');
  await expect(first.getByTestId('column-empty')).toBeVisible();
  await expect(second.getByTestId('column-count')).toHaveText('2');
});

test('새로고침해도 IndexedDB에 저장된 보드가 남아 있다', async ({ page }) => {
  await createTrip(page, '다낭');
  await addCard(page, 2, '반쎄오 맛집');
  await waitForPersisted(page, '반쎄오 맛집');

  await page.reload();
  await expect(page.getByTestId('tab-bar')).toBeVisible();

  // 활성 여행은 이 기기에 남으므로(B15) 새로고침해도 고르는 화면이 아니라
  // 그 여행의 보드로 곧장 돌아온다.
  await expect(page).toHaveURL(/#\/board$/);
  await expect(page.getByTestId('board-trip-option')).toHaveCount(0);

  const columns = page.getByTestId('board-column');
  await expect(columns).toHaveCount(5);
  await expect(columns.nth(2).getByTestId('board-card')).toHaveCount(1);
  await expect(columns.nth(2)).toContainText('반쎄오 맛집');

  await page.getByTestId('tab-trips').click();
  await expect(page.getByTestId('trip-card').filter({ hasText: '다낭' })).toContainText('카드 1');
});

test('카드 편집 시트에서 메모 · 예산 · 소요 시간을 저장한다', async ({ page }) => {
  await createTrip(page, '가고시마');
  await addCard(page, 4, '사쿠라지마');

  const card = page.getByTestId('board-card').first();
  await card.click();
  await expect(page.getByTestId('card-form')).toBeVisible();
  await page.getByTestId('card-memo-input').fill('페리 시간 확인');
  await page.getByTestId('card-budget-input').fill('12000');
  await page.getByTestId('duration-chip-90').click();
  await page.getByTestId('card-submit').click();

  await expect(page.getByTestId('card-chip-duration')).toContainText('1시간 30분');
  await expect(page.getByTestId('card-chip-budget')).toContainText('12,000원');
  await expect(card).toContainText('페리 시간 확인');
});

test('＋ 카테고리로 칸을 추가한다', async ({ page }) => {
  await createTrip(page, '타이베이');

  await page.getByTestId('add-column').click();
  await page.getByTestId('column-name-input').fill('쇼핑');
  await page.getByTestId('column-color-teal').click();
  await page.getByTestId('add-column-submit').click();

  const columns = page.getByTestId('board-column');
  await expect(columns).toHaveCount(6);
  await expect(columns.nth(5)).toContainText('쇼핑');
});

/**
 * 카테고리 접기 — M15 §2.
 *
 * The fold is a *per-device* preference in `localStorage`, so it has to
 * survive a reload while never travelling to another phone; both halves are
 * checked here. The count on the header is what a folded column has to keep
 * saying, otherwise folding hides the fact that anything is in there.
 */
test('카테고리 헤더를 눌러 접고, 새로고침해도 접힌 채로 열린다', async ({ page }) => {
  await createTrip(page, '치앙마이');
  await addCard(page, 2, '카오소이');
  await addCard(page, 2, '망고밥');
  await waitForPersisted(page, '카오소이');

  const column = page.getByTestId('board-column').nth(2);
  const toggle = column.getByTestId('column-collapse');
  await expect(toggle).toHaveAttribute('data-collapsed', 'false');
  await expect(column.getByTestId('board-card')).toHaveCount(2);

  await toggle.click();
  await expect(toggle).toHaveAttribute('data-collapsed', 'true');
  await expect(column).toHaveAttribute('data-collapsed', 'true');
  // 카드는 숨고, 몇 장인지는 계속 보인다.
  await expect(column.getByTestId('board-card')).toHaveCount(0);
  await expect(column.getByTestId('add-card-footer')).toHaveCount(0);
  await expect(column.getByTestId('column-count')).toHaveText('2');
  // 옆 칸은 그대로다 — 접힘은 칸마다 따로다.
  await expect(page.getByTestId('board-column').nth(3)).toHaveAttribute('data-collapsed', 'false');

  await page.reload();
  await expect(page.getByTestId('tab-bar')).toBeVisible();
  const reopened = page.getByTestId('board-column').nth(2);
  await expect(reopened.getByTestId('column-collapse')).toHaveAttribute('data-collapsed', 'true');
  await expect(reopened.getByTestId('board-card')).toHaveCount(0);
  await expect(reopened.getByTestId('column-count')).toHaveText('2');

  await reopened.getByTestId('column-collapse').click();
  await expect(reopened.getByTestId('column-collapse')).toHaveAttribute('data-collapsed', 'false');
  await expect(reopened.getByTestId('board-card')).toHaveCount(2);
});

/**
 * 접힌 칸으로도 카드를 떨어뜨릴 수 있어야 한다 — 접힘이 dnd를 깨지 않는지.
 */
test('접힌 카테고리 위로 카드를 끌어다 놓아도 멀쩡히 옮겨진다', async ({ page }) => {
  await createTrip(page, '방콕');
  await addCard(page, 1, '유심 사기');

  const source = page.getByTestId('board-column').nth(1);
  const target = page.getByTestId('board-column').nth(2);
  await target.getByTestId('column-collapse').click();
  await expect(target).toHaveAttribute('data-collapsed', 'true');

  const card = source.getByTestId('board-card').first();
  const from = await card.boundingBox();
  const to = await target.getByTestId('column-collapse').boundingBox();
  if (!from || !to) throw new Error('드래그 대상의 위치를 찾지 못했어요');

  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  for (const step of [0.15, 0.35, 0.6, 0.85, 1]) {
    await page.mouse.move(
      from.x + from.width / 2 + (to.x + to.width / 2 - from.x - from.width / 2) * step,
      from.y + from.height / 2 + (to.y + to.height / 2 - from.y - from.height / 2) * step,
    );
  }
  await page.mouse.up();

  // 접힌 칸이 카드를 받아 갔고(개수만 늘고), 화면은 멀쩡하다.
  await expect(target.getByTestId('column-count')).toHaveText('1');
  await expect(source.getByTestId('column-count')).toHaveText('0');
  await expect(target.getByTestId('board-card')).toHaveCount(0);

  await target.getByTestId('column-collapse').click();
  await expect(target.getByTestId('board-card')).toHaveCount(1);
  await expect(target).toContainText('유심 사기');
});
