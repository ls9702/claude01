import { expect, test, type Page } from '@playwright/test';

/**
 * M50 — 6기 버그 헌터가 실기로 확정한 것들의 회귀 방지.
 *
 * 여기 있는 것은 전부 **브라우저에서만 거짓이 되는** 계약이다: 겹친 층 위의
 * Escape, 닫히는 중인 시트의 두 번째 클릭, 팝오버가 사라진 자리로 다시 겨냥되는
 * 클릭, 창(일자)이 바뀌었는데 따라가지 않는 페이저. 순수 계산으로 지킬 수 있는
 * 것들은 단위 테스트에 두었다 — `utils/time.test.ts`(이동 클램프),
 * `dnd/autoScroll.test.ts`(자동 스크롤의 문), `components/map/mapLayerSlots.test.ts`
 * (두 지도 층의 자리 합의), `stores/memoDraft.test.ts`(메모 초안).
 */

async function createTrip(page: Page, title: string): Promise<void> {
  await page.getByTestId('add-trip').click();
  await page.getByTestId('trip-title-input').fill(title);
  await page.getByTestId('trip-submit').click();
  await expect(page.getByTestId('trip-form')).toHaveCount(0);
  await page.getByTestId('trip-card').filter({ hasText: title }).getByTestId('trip-open').click();
  await expect(page).toHaveURL(/#\/board$/);
}

async function addCard(page: Page, columnIndex: number, title: string, memo?: string): Promise<void> {
  await page.getByTestId('board-column').nth(columnIndex).getByTestId('add-card').click();
  await page.getByTestId('card-title-input').fill(title);
  if (memo) await page.getByTestId('card-memo-input').fill(memo);
  await page.getByTestId('card-submit').click();
  await expect(page.getByTestId('card-form')).toHaveCount(0);
}

/** 일정 탭으로 옮기고 `days`개의 일자를 만든다. */
async function seedDays(page: Page, days: number): Promise<void> {
  await page.getByTestId('tab-timeline').click();
  await expect(page.getByTestId('view-timeline')).toBeVisible();
  for (let i = 0; i < days; i += 1) {
    const empty = page.getByTestId('timeline-add-day-empty');
    if (await empty.count()) await empty.click();
    else await page.getByTestId('timeline-add-day').click();
    await expect(page.getByTestId('timeline-day')).toHaveCount(i + 1);
  }
}

/** 트레이/레일의 카드를 `dayIndex` 일자에 배치한다 (ScheduleSheet 경로). */
async function place(page: Page, title: string, dayIndex = 0): Promise<void> {
  const toggle = page.getByTestId('tray-toggle');
  if (await toggle.count()) {
    if ((await toggle.first().getAttribute('aria-expanded')) === 'false') await toggle.first().click();
  }
  await page
    .locator('[data-testid="tray-card"], [data-testid="board-card"]')
    .filter({ hasText: title })
    .first()
    .click();
  await expect(page.getByTestId('schedule-sheet')).toBeVisible();
  const options = page.getByTestId('schedule-day-option');
  if ((await options.count()) > dayIndex) await options.nth(dayIndex).click();
  await page.getByTestId('schedule-submit').click();
  await expect(page.getByTestId('schedule-sheet')).toHaveCount(0);
}

/* ------------------------------------------------------------------ *
 * #3 — Escape는 한 층만 닫는다 (헌터D2 #1)
 * ------------------------------------------------------------------ */

test('시트 위의 확인 대화상자에서 Escape는 그 대화상자만 닫는다', async ({ page }) => {
  await page.goto('/');
  await createTrip(page, '이스케이프');
  await addCard(page, 4, '금각사');
  await seedDays(page, 3);
  await place(page, '금각사', 2);

  // 시트 마법사의 「일정이 삭제돼요」는 **시트가 열린 채** 그 위에 뜬다 —
  // 두 층이 동시에 살아 있는, Escape가 둘을 함께 닫던 바로 그 모양이다.
  // (칸 삭제 물음은 이 모양이 아니다: 그쪽은 확인이 뜨면서 칸 수정 시트가
  // 언마운트되므로 겹친 적이 없다.)
  const wizard = page.getByTestId('sheet-wizard');
  await page.getByTestId('sheet-menu').click();
  await page.getByTestId('sheet-edit-flights').click();
  await expect(wizard).toBeVisible();
  await page.getByTestId('wizard-mode-days').click();
  for (let i = 0; i < 2; i += 1) await page.getByTestId('wizard-days-minus').click();
  await page.getByTestId('wizard-submit').click();

  const confirm = page.getByTestId('wizard-shrink-confirm');
  await expect(confirm).toBeVisible();

  await page.keyboard.press('Escape');

  // 물음만 사라지고, 하던 일(마법사)은 그대로 남는다.
  await expect(confirm).toHaveCount(0);
  await expect(wizard).toBeVisible();
  // 아무것도 지워지지 않았다 — 「아니오」가 일자를 날리면 안 된다.
  await expect(page.getByTestId('wizard-days-value')).toBeVisible();

  // 두 번째 Escape가 비로소 시트를 닫는다.
  await page.keyboard.press('Escape');
  await expect(wizard).toHaveCount(0);
  await expect(page.getByTestId('timeline-day')).toHaveCount(3);
  await expect(page.getByTestId('timeline-entry')).toHaveCount(1);
});

/* ------------------------------------------------------------------ *
 * #10 · #11 — 더블클릭이 둘을 만들지 않는다 (헌터D2 #2·#3)
 * ------------------------------------------------------------------ */

test('카드 추가를 두 번 눌러도 카드는 한 장만 생긴다', async ({ page }) => {
  await page.goto('/');
  await createTrip(page, '더블클릭 카드');

  await page.getByTestId('board-column').nth(2).getByTestId('add-card').click();
  await page.getByTestId('card-title-input').fill('이치란');
  // 닫히는 애니메이션 동안 버튼은 아직 화면에 있다 — 그 틈을 노린다.
  await page.getByTestId('card-submit').dblclick();
  await expect(page.getByTestId('card-form')).toHaveCount(0);

  await expect(page.getByTestId('board-card').filter({ hasText: '이치란' })).toHaveCount(1);
});

test('배치 버튼을 두 번 눌러도 배치는 하나만 생긴다', async ({ page }) => {
  await page.goto('/');
  await createTrip(page, '더블클릭 배치');
  await addCard(page, 2, '스시 다이');
  await seedDays(page, 1);

  const toggle = page.getByTestId('tray-toggle');
  if (await toggle.count()) {
    if ((await toggle.first().getAttribute('aria-expanded')) === 'false') await toggle.first().click();
  }
  await page
    .locator('[data-testid="tray-card"], [data-testid="board-card"]')
    .filter({ hasText: '스시 다이' })
    .first()
    .click();
  await expect(page.getByTestId('schedule-sheet')).toBeVisible();
  await page.getByTestId('schedule-submit').dblclick();
  await expect(page.getByTestId('schedule-sheet')).toHaveCount(0);

  await expect(page.getByTestId('timeline-entry')).toHaveCount(1);
});

/* ------------------------------------------------------------------ *
 * #1 · #9 — 이동은 길이를 깎지 않는다 (헌터A #1·#2·#5)
 * ------------------------------------------------------------------ */

test('시작을 자정 쪽으로 밀어도 소요 시간은 그대로다', async ({ page }) => {
  await page.goto('/');
  await createTrip(page, '시간 절단');
  await addCard(page, 2, '이치란');
  await seedDays(page, 2);
  await place(page, '이치란', 0);

  await page.getByTestId('timeline-entry').first().click();
  await expect(page.getByTestId('entry-sheet')).toBeVisible();

  // 3시간으로 늘린다 (60 → 180).
  for (let i = 0; i < 8; i += 1) await page.getByTestId('entry-duration-plus').click();
  await expect(page.getByTestId('entry-duration-value')).toHaveText('3시간');

  // 자정 너머로 계속 민다 — 시작은 21:00에서 서고 길이는 3시간 그대로.
  for (let i = 0; i < 60; i += 1) await page.getByTestId('entry-start-plus').click();
  await expect(page.getByTestId('entry-duration-value')).toHaveText('3시간');
  await expect(page.getByTestId('entry-range')).toHaveText('21:00–24:00');

  // 되돌아오는 길에도 깎인 것이 없다 — 예전에는 15분만 남았다.
  for (let i = 0; i < 20; i += 1) await page.getByTestId('entry-start-minus').click();
  await expect(page.getByTestId('entry-duration-value')).toHaveText('3시간');
  await expect(page.getByTestId('entry-range')).toHaveText('16:00–19:00');
});

/* ------------------------------------------------------------------ *
 * #12 — 수정 ON에서도 짧은 블록의 본체를 누를 수 있다 (헌터A #6)
 * ------------------------------------------------------------------ */

test('수정을 켜도 15분짜리 블록을 눌러 상세를 열 수 있다', async ({ page }) => {
  await page.goto('/');
  await createTrip(page, '짧은 블록');
  await addCard(page, 2, '커피');
  await seedDays(page, 1);
  await place(page, '커피', 0);

  // 15분으로 줄인다.
  await page.getByTestId('timeline-entry').first().click();
  for (let i = 0; i < 4; i += 1) await page.getByTestId('entry-duration-minus').click();
  await expect(page.getByTestId('entry-duration-value')).toHaveText('15분');
  await page.getByTestId('entry-save').click();
  await expect(page.getByTestId('entry-sheet')).toHaveCount(0);

  await page.getByTestId('timeline-edit-toggle').click();

  // 손잡이가 블록을 통째로 덮으면 여기서 아무 일도 일어나지 않는다.
  const block = page.getByTestId('timeline-entry').first();
  await expect(block.getByTestId('entry-resize')).toHaveCount(0);
  await block.click();
  await expect(page.getByTestId('entry-sheet')).toBeVisible();
});

/* ------------------------------------------------------------------ *
 * #5 — 일수를 줄여 배치가 사라질 때는 먼저 묻는다 (헌터A #4)
 * ------------------------------------------------------------------ */

test('시트 일수를 줄여 배치가 사라지면 확인을 받고, 되돌릴 수 있다', async ({ page }) => {
  await page.goto('/');
  await createTrip(page, '일수 축소');
  await addCard(page, 4, '금각사');
  await seedDays(page, 3);
  await place(page, '금각사', 2);
  await expect(page.getByTestId('timeline-entry')).toHaveCount(1);

  const shrinkTo = async (minusClicks: number): Promise<void> => {
    await page.getByTestId('sheet-menu').click();
    await page.getByTestId('sheet-edit-flights').click();
    await expect(page.getByTestId('sheet-wizard')).toBeVisible();
    await page.getByTestId('wizard-mode-days').click();
    for (let i = 0; i < minusClicks; i += 1) await page.getByTestId('wizard-days-minus').click();
    await page.getByTestId('wizard-submit').click();
  };

  await shrinkTo(2);

  // 저장이 곧 삭제이기도 하다는 사실은 눌러 보고 알 일이 아니다.
  const confirm = page.getByTestId('wizard-shrink-confirm');
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText('배치 1개가 있는 일자 2개가 삭제됩니다');

  // 취소는 아무것도 건드리지 않는다.
  await page.getByTestId('confirm-cancel').click();
  await expect(confirm).toHaveCount(0);
  await page.getByTestId('sheet-close').click();
  await expect(page.getByTestId('timeline-day')).toHaveCount(3);
  await expect(page.getByTestId('timeline-entry')).toHaveCount(1);

  // 승낙하면 지워지되, 되돌릴 길이 함께 온다.
  await shrinkTo(2);
  await page.getByTestId('confirm-accept').click();
  await expect(page.getByTestId('timeline-day')).toHaveCount(1);
  await expect(page.getByTestId('undo-message')).toContainText('일자 2개 삭제됨');

  await page.getByTestId('undo-action').click();
  await expect(page.getByTestId('timeline-day')).toHaveCount(3);
  await expect(page.getByTestId('timeline-entry')).toHaveCount(1);
});

/* ------------------------------------------------------------------ *
 * #7 — 기준 통화와 현지 통화가 같아지면 짝을 치운다 (헌터B #3)
 * ------------------------------------------------------------------ */

test('기준 통화를 현지 통화와 같게 바꾸면 환율 짝이 사라진다', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('add-trip').click();
  await page.getByTestId('trip-title-input').fill('통화');
  await page.getByTestId('trip-local-toggle').click();
  await page.getByTestId('trip-local-currency-select').selectOption('JPY');
  await page.getByTestId('trip-local-rate-input').fill('9.3');
  await expect(page.getByTestId('trip-local-toggle')).toContainText('JPY · 9.3');

  // 기준을 JPY로 — 「1 JPY = 9.3 JPY」는 아무 뜻도 없는 환산이다.
  await page.getByTestId('trip-currency-select').selectOption('JPY');
  await expect(page.getByTestId('trip-local-toggle')).toContainText('없음');
  await expect(page.getByTestId('trip-local-rate-input')).toHaveValue('');

  await page.getByTestId('trip-submit').click();
  await expect(page.getByTestId('trip-form')).toHaveCount(0);

  // 저장된 여행에도 짝이 남지 않는다.
  await page.getByTestId('trip-card').filter({ hasText: '통화' }).getByTestId('trip-edit').click();
  await expect(page.getByTestId('trip-local-toggle')).toContainText('없음');
});

/* ------------------------------------------------------------------ *
 * #18 — 「직접 입력」은 누르면 바로 칸이 뜬다 (헌터A #7)
 * ------------------------------------------------------------------ */

test('프리셋이 눌린 상태에서 「직접 입력」을 켜면 입력칸이 곧바로 뜬다', async ({ page }) => {
  await page.goto('/');
  await createTrip(page, '직접 입력');

  await page.getByTestId('board-column').nth(2).getByTestId('add-card').click();
  await page.getByTestId('card-title-input').fill('라멘');
  await page.getByTestId('duration-chip-60').click();
  await expect(page.getByTestId('duration-chip-60')).toHaveAttribute('aria-pressed', 'true');

  await page.getByTestId('duration-custom-toggle').click();
  // 예전에는 버튼만 켜지고 칸은 나타나지 않았다.
  await expect(page.getByTestId('card-duration-custom')).toBeVisible();
  await expect(page.getByTestId('duration-chip-60')).toHaveAttribute('aria-pressed', 'false');
});
