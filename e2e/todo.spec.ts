import { expect, test, type Page } from '@playwright/test';

/**
 * 할 일 체크리스트 (M29).
 *
 * 세 가지를 확인한다: 보드의 체크박스(와 새로고침 뒤에도 남는 체크), 일정 탭의
 * 「할 일」 시트(양방향 토글·가라앉기·개수), 그리고 자동 이행 — 「할일」이라는
 * 이름은 붙었는데 플래그는 없는 칸이 다음 로드에서 체크리스트가 되는지.
 */

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
 * Waits until the workspace blob actually sitting in IndexedDB mentions
 * `needle`, so a `reload()` cannot race the persist middleware's write.
 * (Same helper as `board.spec.ts` / `memo.spec.ts`, for the same reason.)
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

/** 카테고리 편집을 열어 이름/체크리스트 토글을 바꾸고 저장한다. */
async function editColumn(
  page: Page,
  columnIndex: number,
  options: { name?: string; todo?: boolean },
): Promise<void> {
  await page.getByTestId('board-column').nth(columnIndex).getByTestId('edit-column').click();
  await expect(page.getByTestId('column-form')).toBeVisible();
  if (options.name !== undefined) {
    await page.getByTestId('column-name-input').fill(options.name);
  }
  if (options.todo !== undefined) {
    const toggle = page.getByTestId('column-todo-toggle');
    const on = (await toggle.getAttribute('data-on')) === 'true';
    if (on !== options.todo) await toggle.click();
  }
  await page.getByTestId('column-submit').click();
  await expect(page.getByTestId('column-form')).toHaveCount(0);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('tab-bar')).toBeVisible();
});

/* ------------------------------------------------------------------ *
 * 1. 보드의 체크박스
 * ------------------------------------------------------------------ */

test('새 여행의 할일 칸에서만 체크박스가 보이고, 체크는 새로고침을 견딘다', async ({ page }) => {
  await createTrip(page, '오사카 할일');
  await addCard(page, 1, '환전하기');
  await addCard(page, 2, '이치란 라멘');

  const todoColumn = page.getByTestId('board-column').nth(1);
  const foodColumn = page.getByTestId('board-column').nth(2);

  // 「할일」은 씨앗부터 체크리스트다 — 「식사」는 아니다.
  await expect(todoColumn.getByTestId('card-done-toggle')).toHaveCount(1);
  await expect(foodColumn.getByTestId('card-done-toggle')).toHaveCount(0);

  const box = todoColumn.getByTestId('card-done-toggle');
  await expect(box).toHaveAttribute('data-done', 'false');
  const title = todoColumn.getByTestId('board-card').locator('h3');
  await expect(title).toHaveAttribute('data-done', 'false');

  await box.click();
  // 체크는 카드를 열지 않는다 — 드래그와도, 카드 열기와도 싸우지 않는다.
  await expect(page.getByTestId('card-form')).toHaveCount(0);
  await expect(box).toHaveAttribute('data-done', 'true');
  await expect(title).toHaveAttribute('data-done', 'true');
  await expect(title).toHaveCSS('text-decoration-line', 'line-through');

  await waitForPersisted(page, 'doneAt');
  await page.reload();
  await expect(page.getByTestId('board-column')).toHaveCount(5);
  const afterReload = page.getByTestId('board-column').nth(1).getByTestId('card-done-toggle');
  await expect(afterReload).toHaveAttribute('data-done', 'true');

  // 다시 누르면 풀린다.
  await afterReload.click();
  await expect(afterReload).toHaveAttribute('data-done', 'false');
});

test('카테고리 편집의 토글로 체크리스트를 켜고 끈다', async ({ page }) => {
  await createTrip(page, '삿포로 준비물');
  await addCard(page, 3, '우산');

  const column = page.getByTestId('board-column').nth(3);
  await expect(column.getByTestId('card-done-toggle')).toHaveCount(0);

  await editColumn(page, 3, { name: '준비물', todo: true });
  await expect(column).toContainText('준비물');
  await expect(column.getByTestId('card-done-toggle')).toHaveCount(1);

  await editColumn(page, 3, { todo: false });
  await expect(column.getByTestId('card-done-toggle')).toHaveCount(0);
});

/* ------------------------------------------------------------------ *
 * 2. 일정 탭의 「할 일」 시트
 * ------------------------------------------------------------------ */

test('일정 탭의 할 일 버튼이 남은 수를 말하고, 시트에서 켜면 보드가 따라온다', async ({
  page,
}) => {
  await createTrip(page, '후쿠오카 할일');
  await addCard(page, 1, '환전하기');
  await addCard(page, 1, '유심 사기');
  await addCard(page, 1, '숙소 예약');

  await page.getByTestId('tab-timeline').click();
  await expect(page.getByTestId('view-timeline')).toBeVisible();

  const openButton = page.getByTestId('todo-open');
  await expect(openButton).toHaveAttribute('data-remaining', '3');
  await expect(page.getByTestId('todo-open-count')).toHaveText('3');

  await openButton.click();
  await expect(page.getByTestId('todo-sheet')).toBeVisible();
  await expect(page.getByTestId('todo-progress')).toHaveText('0/3');
  // 칸이 하나뿐이면 칸 이름을 되풀이하지 않는다.
  await expect(page.getByTestId('todo-group-name')).toHaveCount(0);
  await expect(page.getByTestId('todo-row')).toHaveCount(3);

  const rows = page.getByTestId('todo-row');
  await expect(rows.nth(0)).toContainText('환전하기');
  await rows.nth(0).click();

  // 끝난 줄은 사라지지 않고 제 묶음의 **맨 아래**로 가라앉는다.
  await expect(page.getByTestId('todo-progress')).toHaveText('1/3');
  await expect(rows.nth(2)).toContainText('환전하기');
  await expect(rows.nth(2)).toHaveAttribute('data-done', 'true');
  await expect(rows.nth(0)).toContainText('유심 사기');

  await page.getByTestId('sheet-close').click();
  await expect(page.getByTestId('todo-sheet')).toHaveCount(0);
  await expect(openButton).toHaveAttribute('data-remaining', '2');
  await expect(page.getByTestId('todo-open-count')).toHaveText('2');

  // 보드가 같은 이야기를 한다 — 같은 스토어이므로 맞춰 주는 코드가 없다.
  await page.getByTestId('tab-board').click();
  const boardBox = page
    .getByTestId('board-column')
    .nth(1)
    .getByTestId('board-card')
    .filter({ hasText: '환전하기' })
    .getByTestId('card-done-toggle');
  await expect(boardBox).toHaveAttribute('data-done', 'true');

  // 반대 방향도 같다: 보드에서 풀면 시트의 개수가 돌아온다.
  await boardBox.click();
  await page.getByTestId('tab-timeline').click();
  await expect(page.getByTestId('todo-open')).toHaveAttribute('data-remaining', '3');
  await page.getByTestId('todo-open').click();
  await expect(page.getByTestId('todo-progress')).toHaveText('0/3');
});

test('체크리스트 칸이 둘이면 칸 이름이 붙고, 하나도 없으면 빈 자리를 말한다', async ({
  page,
}) => {
  await createTrip(page, '교토 두칸');

  // 아직 카드가 없다 — 「할일」은 체크리스트지만 비어 있다.
  await page.getByTestId('tab-timeline').click();
  await expect(page.getByTestId('todo-open')).toHaveAttribute('data-remaining', '0');
  await expect(page.getByTestId('todo-open-count')).toHaveCount(0);
  await page.getByTestId('todo-open').click();
  await expect(page.getByTestId('todo-empty')).toBeVisible();
  await expect(page.getByTestId('todo-row')).toHaveCount(0);
  await page.getByTestId('sheet-close').click();

  await page.getByTestId('tab-board').click();
  await addCard(page, 1, '환전하기');
  await addCard(page, 3, '우산');
  await editColumn(page, 3, { name: '준비물', todo: true });

  await page.getByTestId('tab-timeline').click();
  await page.getByTestId('todo-open').click();
  await expect(page.getByTestId('todo-progress')).toHaveText('0/2');
  await expect(page.getByTestId('todo-group')).toHaveCount(2);
  await expect(page.getByTestId('todo-group-name')).toHaveText(['할일', '준비물']);
});

/* ------------------------------------------------------------------ *
 * 3. 자동 이행
 * ------------------------------------------------------------------ */

test('이름이 할 일인 옛 칸은 다음 로드에서 스스로 체크리스트가 된다', async ({ page }) => {
  await createTrip(page, '나고야 이행');
  await addCard(page, 0, '공항버스');

  // 이름만 바꾼 칸에는 플래그가 붙지 않는다 — M29 이전 워크스페이스와 똑같은
  // 모양이다. 그래서 이 칸이 곧 「옛 할일 칸」이다.
  await editColumn(page, 0, { name: '할 일' });
  const column = page.getByTestId('board-column').nth(0);
  await expect(column.getByTestId('card-done-toggle')).toHaveCount(0);

  await waitForPersisted(page, '할 일');
  await page.reload();
  await expect(page.getByTestId('board-column')).toHaveCount(5);
  await expect(
    page.getByTestId('board-column').nth(0).getByTestId('card-done-toggle'),
  ).toHaveCount(1);
});

test('사람이 직접 끈 칸은 이행이 되살리지 않는다', async ({ page }) => {
  await createTrip(page, '고베 명시적끄기');
  await addCard(page, 1, '환전하기');

  // 씨앗 「할일」 칸을 끈다 — 이름은 그대로 「할일」이다.
  await editColumn(page, 1, { todo: false });
  const column = page.getByTestId('board-column').nth(1);
  await expect(column.getByTestId('card-done-toggle')).toHaveCount(0);

  await waitForPersisted(page, '"todo":false');
  await page.reload();
  await expect(page.getByTestId('board-column')).toHaveCount(5);
  await expect(
    page.getByTestId('board-column').nth(1).getByTestId('card-done-toggle'),
  ).toHaveCount(0);
});

/* ------------------------------------------------------------------ *
 * 4. 좁은 화면
 * ------------------------------------------------------------------ */

test.describe('좁은 화면', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('390px에서 할 일 시트가 가로로 넘치지 않고 줄은 44px을 지킨다', async ({ page }) => {
    await createTrip(page, '오사카 모바일');
    await addCard(page, 1, '환전하기 — 공항 도착하자마자 ATM에서 뽑아 두기');
    await addCard(page, 1, '유심 사기');

    await page.getByTestId('tab-timeline').click();
    // 상단 메뉴를 접어도 버튼은 살아 있다 (접기는 숨기기가 아니다).
    await page.getByTestId('timeline-chrome-toggle').click();
    await expect(page.getByTestId('timeline-header')).toHaveAttribute('data-collapsed', 'true');
    await expect(page.getByTestId('todo-open')).toBeVisible();

    await page.getByTestId('todo-open').click();
    await expect(page.getByTestId('todo-sheet')).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    const row = page.getByTestId('todo-row').first();
    const box = await row.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect((box?.width ?? 9999) + (box?.x ?? 0)).toBeLessThanOrEqual(390);

    await row.click();
    await expect(page.getByTestId('todo-progress')).toHaveText('1/2');
  });
});
