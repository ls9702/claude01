import { expect, test, type Page } from '@playwright/test';

/**
 * 휴지통 — 일정에서만 빼기 (M34).
 *
 * 배치된 블록을 끌면 화면 아래에 휴지통 바가 나오고, 거기에 놓으면 그 **배치**
 * 하나가 일정에서 빠진다. 카드는 보드에 그대로 남는다 — 이 스펙이 매번 다시
 * 확인하는 것이 바로 그 한 문장이다.
 *
 * 드래그는 스텝 이동으로만 만든다(§4.6): 8px 임계를 진짜로 넘겨야 센서가 깨어나고,
 * dnd-kit이 드롭 타깃을 정하는 데도 몇 프레임이 걸린다.
 */

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

/** Opens 일정 for the active trip and lays down one day. */
async function seedOneDay(page: Page): Promise<void> {
  await page.getByTestId('tab-timeline').click();
  await expect(page.getByTestId('view-timeline')).toBeVisible();
  await page.getByTestId('timeline-add-day-empty').click();
  await expect(page.getByTestId('timeline-day')).toHaveCount(1);
}

/**
 * Places `title` on 1일차 at 10:00 through the card sheet — the tap path, which
 * both widths have. This spec is about the *drag off*, not the drag on.
 */
async function placeCard(page: Page, title: string): Promise<void> {
  await page.getByTestId('tab-board').click();
  await page.getByTestId('board-card').filter({ hasText: title }).click();
  await expect(page.getByTestId('card-form')).toBeVisible();
  await page.getByTestId('card-schedule').click();
  await expect(page.getByTestId('schedule-sheet')).toBeVisible();
  await page.getByTestId('schedule-submit').click();
  await expect(page.getByTestId('schedule-sheet')).toHaveCount(0);
  await page.getByTestId('tab-timeline').click();
  await expect(page.getByTestId('timeline-entry')).toHaveCount(1);
}

/** Walks the mouse from `from` to `to` in steps, without pressing or releasing. */
async function stepTo(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  for (const step of [0.15, 0.35, 0.55, 0.75, 0.9, 1]) {
    await page.mouse.move(from.x + (to.x - from.x) * step, from.y + (to.y - from.y) * step);
  }
}

const centerOf = (box: { x: number; y: number; width: number; height: number }) => ({
  x: box.x + box.width / 2,
  y: box.y + box.height / 2,
});

/**
 * Picks the entry up and carries it onto the 휴지통, asserting the bar on the
 * way: it is not there before the lift, it is there during, and it lights up
 * when the pointer is on it. Leaves the button **down** — the caller drops.
 */
async function carryEntryToTrash(page: Page): Promise<void> {
  const entry = page.getByTestId('timeline-entry').first();
  const entryBox = await entry.boundingBox();
  if (!entryBox) throw new Error('일정 블록의 위치를 찾지 못했어요');

  // 드래그 전에는 휴지통이 없다 — 화면에 상시로 서 있는 바가 아니다.
  await expect(page.getByTestId('entry-trash')).toHaveCount(0);

  const grab = { x: entryBox.x + entryBox.width / 2, y: entryBox.y + 8 };
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  // 8px 임계를 넘기며 블록을 든다.
  await stepTo(page, grab, { x: grab.x, y: grab.y + 36 });

  const trash = page.getByTestId('entry-trash');
  await expect(trash).toBeVisible();
  await expect(trash).toHaveAttribute('data-over', 'false');
  await expect(trash).toContainText('일정에서');
  // 카드가 아니라 일정에서 빠진다는 것을 바 스스로 말한다.
  await expect(trash).toContainText('카드는 보드에 그대로 남아요');

  const trashBox = await trash.boundingBox();
  if (!trashBox) throw new Error('휴지통의 위치를 찾지 못했어요');
  // 끌던 중에 노려서 누를 수 있는 크기여야 한다.
  expect(trashBox.height).toBeGreaterThanOrEqual(56);

  await stepTo(page, { x: grab.x, y: grab.y + 36 }, centerOf(trashBox));
  await expect(trash).toHaveAttribute('data-over', 'true');
}

/**
 * 손가락으로 같은 일을 한다 — 실기기의 그 제스처 그대로.
 *
 * 마우스가 아니라 **터치**여야 하는 이유는 센서가 다르기 때문이다: 폰에서는
 * `TouchSensor`의 250ms 롱프레스가 스크롤과 들어올리기를 가른다(`PlanDndContext`).
 * 그래서 시작점에서 350ms 가만히 있고, 그 다음에야 움직인다 — 8px보다 먼저
 * 움직이면 그건 드래그가 아니라 스크롤이다.
 *
 * Playwright의 `touchscreen`은 탭밖에 없어서 CDP로 직접 터치를 쏜다.
 */
async function carryEntryToTrashByTouch(page: Page): Promise<() => Promise<void>> {
  const entry = page.getByTestId('timeline-entry').first();
  const entryBox = await entry.boundingBox();
  if (!entryBox) throw new Error('일정 블록의 위치를 찾지 못했어요');

  await expect(page.getByTestId('entry-trash')).toHaveCount(0);

  const client = await page.context().newCDPSession(page);
  const x = entryBox.x + entryBox.width / 2;
  const y = entryBox.y + 8;
  const touch = async (type: 'touchStart' | 'touchMove' | 'touchEnd', at?: { y: number }) => {
    await client.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: at ? [{ x, y: at.y }] : [],
    });
  };

  await touch('touchStart', { y });
  // 롱프레스(250ms)가 끝나기 전에 8px 넘게 움직이면 들리지 않는다. 컨테이너가
  // 바쁠 때는 페이지의 타이머가 실제 시간보다 늦게 돌므로, ① 넉넉히 기다리고
  // ② 센서가 아직 안 깨어났어도 취소되지 않도록 **허용 오차(8px) 이내**로만
  // 꼼지락거리며 ③ 휴지통이 진짜로 나타날 때까지 재시도한다 — 고정 대기 한
  // 번에 거는 것이 이 테스트가 부하에서 눕던 이유였다.
  await page.waitForTimeout(600);
  const trash = page.getByTestId('entry-trash');
  await expect(async () => {
    await touch('touchMove', { y: y + 4 });
    await page.waitForTimeout(60);
    await touch('touchMove', { y: y + 7 });
    await expect(trash).toBeVisible({ timeout: 700 });
  }).toPass({ timeout: 8_000 });
  // 이제 들렸다 — 큰 걸음은 지금부터.
  for (let step = 1; step <= 6; step += 1) {
    await touch('touchMove', { y: y + step * 12 });
    await page.waitForTimeout(40);
  }
  const trashBox = await trash.boundingBox();
  if (!trashBox) throw new Error('휴지통의 위치를 찾지 못했어요');

  const from = y + 72;
  const to = trashBox.y + trashBox.height / 2;
  for (const step of [0.3, 0.6, 0.9, 1]) {
    await touch('touchMove', { y: from + (to - from) * step });
    await page.waitForTimeout(40);
  }
  await expect(trash).toHaveAttribute('data-over', 'true');

  return () => touch('touchEnd');
}

test.describe('데스크톱', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('tab-bar')).toBeVisible();
  });

  test('일정 블록을 휴지통에 놓으면 배치만 빠지고 카드는 보드에 남는다', async ({ page }) => {
    await createTrip(page, '오사카 휴지통');
    await addCard(page, 0, '츠텐카쿠');
    await seedOneDay(page);
    await placeCard(page, '츠텐카쿠');

    const rail = page.getByTestId('timeline-rail');
    await expect(rail.getByTestId('card-schedule-badge')).toHaveText(/1/);

    await carryEntryToTrash(page);
    await page.mouse.up();

    // 배치는 사라지고…
    await expect(page.getByTestId('timeline-entry')).toHaveCount(0);
    // …휴지통도 드래그와 함께 사라진다.
    await expect(page.getByTestId('entry-trash')).toHaveCount(0);
    // …카드는 보드(레일)에 그대로다. 배지만 없어진다.
    await expect(rail.getByTestId('board-card')).toHaveCount(1);
    await expect(rail.getByTestId('board-card')).toContainText('츠텐카쿠');
    await expect(rail.getByTestId('card-schedule-badge')).toHaveCount(0);

    // 손이 미끄러진 경우를 위한 되돌리기 — 시트의 삭제와 같은 문구, 같은 복원.
    const toast = page.getByTestId('undo-toast');
    await expect(toast).toContainText('삭제됨');
    await expect(toast).toContainText('츠텐카쿠');
    await page.getByTestId('undo-action').click();

    const entry = page.getByTestId('timeline-entry');
    await expect(entry).toHaveCount(1);
    await expect(entry).toHaveAttribute('data-start-min', '600');
    await expect(entry).toHaveAttribute('data-duration-min', '60');
    await expect(rail.getByTestId('card-schedule-badge')).toHaveText(/1/);
  });

  test('블록을 그리드 안에 놓으면 예전처럼 옮겨지기만 한다', async ({ page }) => {
    await createTrip(page, '오사카 이동');
    await addCard(page, 0, '우메다');
    await seedOneDay(page);
    await placeCard(page, '우메다');

    const entry = page.getByTestId('timeline-entry').first();
    const box = await entry.boundingBox();
    if (!box) throw new Error('일정 블록의 위치를 찾지 못했어요');

    const grab = { x: box.x + box.width / 2, y: box.y + 8 };
    await page.mouse.move(grab.x, grab.y);
    await page.mouse.down();
    // 한 시간 아래로 — 휴지통은 화면 맨 아래에 있고, 여기는 그 근처도 아니다.
    await stepTo(page, grab, { x: grab.x, y: grab.y + 54 });
    await expect(page.getByTestId('entry-trash')).toHaveAttribute('data-over', 'false');
    await page.mouse.up();

    await expect(entry).toHaveCount(1);
    // 아래로 갔고, 15분 격자에 맞춰 섰다 — 지우지 않고 옮기기만 한 것이다.
    await expect.poll(async () => Number(await entry.getAttribute('data-start-min'))).toBeGreaterThan(600);
    const moved = Number(await entry.getAttribute('data-start-min'));
    expect(moved % 15).toBe(0);
    expect(moved).toBeLessThanOrEqual(780);
    await expect(page.getByTestId('undo-toast')).toContainText('일정 이동됨');
  });

  test('레일의 카드를 끌 때는 휴지통이 나오지 않는다', async ({ page }) => {
    await createTrip(page, '오사카 배치 드래그');
    await addCard(page, 0, '난바');
    await seedOneDay(page);

    const railCard = page.getByTestId('timeline-rail').getByTestId('board-card').first();
    await railCard.scrollIntoViewIfNeeded();
    const cardBox = await railCard.boundingBox();
    const gridBox = await page.getByTestId('timeline-day-grid').first().boundingBox();
    if (!cardBox || !gridBox) throw new Error('드래그 대상의 위치를 찾지 못했어요');

    const grab = centerOf(cardBox);
    await page.mouse.move(grab.x, grab.y);
    await page.mouse.down();
    await stepTo(page, grab, { x: gridBox.x + gridBox.width / 2, y: gridBox.y + 120 });

    // 카드는 정말로 들려 있고(레일의 원본이 반투명해진다)…
    await expect(railCard).toHaveClass(/opacity-40/);
    // …그런데도 휴지통은 없다: 아직 일정에서 뺄 것이 없기 때문이다.
    await expect(page.getByTestId('entry-trash')).toHaveCount(0);

    await page.mouse.up();
    await expect(page.getByTestId('timeline-entry')).toHaveCount(1);
    await expect(page.getByTestId('entry-trash')).toHaveCount(0);
  });
});

test.describe('모바일 390px', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('tab-bar')).toBeVisible();
  });

  test('휴지통이 탭 바 위 엄지 자리에 서고, 놓으면 카드가 트레이로 돌아온다', async ({
    page,
  }) => {
    await createTrip(page, '오사카 폰 휴지통');
    await addCard(page, 0, '신세카이');
    await seedOneDay(page);
    await placeCard(page, '신세카이');

    // M33 — 배치된 카드는 트레이에 남고 미배치 수는 0이다.
    await expect(page.getByTestId('tray-count')).toHaveAttribute('data-count', '0');

    const gridBefore = await page.getByTestId('timeline-scroller').boundingBox();
    await carryEntryToTrash(page);

    const trash = page.getByTestId('entry-trash');
    const trashBox = await trash.boundingBox();
    const tabBox = await page.getByTestId('tab-bar').boundingBox();
    if (!trashBox || !tabBox || !gridBefore) throw new Error('휴지통의 위치를 찾지 못했어요');

    // 탭 바 **위**에 선다 — 화면을 떠나는 길은 절대 덮지 않는다.
    expect(Math.round(trashBox.y + trashBox.height)).toBeLessThanOrEqual(Math.round(tabBox.y) + 1);
    // 엄지가 닿는 아래쪽 3분의 1 안이다.
    expect(trashBox.y).toBeGreaterThan(844 * 0.66);
    // 가로로 넘치지 않는다.
    expect(trashBox.x).toBeGreaterThanOrEqual(0);
    expect(Math.round(trashBox.x + trashBox.width)).toBeLessThanOrEqual(390);

    // 그리고 그리드를 밀어 올리지 않는다 — 드롭 타깃이 손가락 밑에서 움직이면
    // 그건 도움이 아니라 사고다 (떠 있는 바이지 형제 요소가 아니다).
    const gridDuring = await page.getByTestId('timeline-scroller').boundingBox();
    expect(Math.round(gridDuring?.y ?? -1)).toBe(Math.round(gridBefore.y));
    expect(Math.round(gridDuring?.height ?? -1)).toBe(Math.round(gridBefore.height));

    await page.mouse.up();

    await expect(page.getByTestId('timeline-entry')).toHaveCount(0);
    await expect(page.getByTestId('entry-trash')).toHaveCount(0);
    // 카드는 살아 있다: 미배치로 트레이에 돌아온다 (M33의 그 자리).
    await expect(page.getByTestId('tray-count')).toHaveAttribute('data-count', '1');
    await page.getByTestId('tray-toggle').click();
    await expect(page.getByTestId('tray-card')).toHaveCount(1);
    await expect(page.getByTestId('tray-card')).toContainText('신세카이');

    // 문서가 가로로 넘치지도 않았다.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe('모바일 390px · 손가락', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('tab-bar')).toBeVisible();
  });

  test('길게 눌러 끌어다 휴지통에 놓으면 일정에서 빠지고 되돌릴 수 있다', async ({ page }) => {
    await createTrip(page, '오사카 손가락');
    await addCard(page, 0, '통천각');
    await seedOneDay(page);
    await placeCard(page, '통천각');

    const drop = await carryEntryToTrashByTouch(page);
    await drop();

    // 실행 취소 토스트는 4초짜리다 — 확인할 것들을 그 앞에 줄 세우면 부하가
    // 조금만 있어도 클릭이 만료와 경합한다. 지웠다는 사실 하나만 보고 바로
    // 되돌리고, 나머지는 복원 뒤에 천천히 확인한다.
    await expect(page.getByTestId('timeline-entry')).toHaveCount(0);
    await expect(page.getByTestId('undo-toast')).toContainText('통천각');
    // 터치 드래그 직후의 첫 클릭은 dnd-kit이 한 번 삼킬 수 있다 — 보드 스펙이
    // M15에서 배운 그대로, 살아날 때까지 dispatchEvent로 다시 두드린다.
    await expect(async () => {
      await page.getByTestId('undo-action').dispatchEvent('click');
      await expect(page.getByTestId('timeline-entry')).toHaveCount(1, { timeout: 700 });
    }).toPass({ timeout: 3_500 });
    await expect(page.getByTestId('timeline-entry')).toHaveAttribute('data-start-min', '600');
    // 드래그가 끝났으니 휴지통도 없고, 카드는 다시 배치 상태라 미배치 0.
    await expect(page.getByTestId('entry-trash')).toHaveCount(0);
    await expect(page.getByTestId('tray-count')).toHaveAttribute('data-count', '0');
  });
});
