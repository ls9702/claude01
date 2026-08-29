import { expect, test, type Page } from '@playwright/test';

/**
 * 「수정」 토글과 드롭 자석 — M45.
 *
 * 실사용 신고 두 건이 이 파일의 전부다.
 *
 * 1. *「살짝 클릭 했는데 시간 조절이 됨」* — 블록 아래 12px 띠(리사이즈 손잡이)는
 *    활성화 거리가 0이라 스치기만 해도 길이를 바꿨다. 이제 손잡이는 「수정」이
 *    켜졌을 때만 **그려진다**: 꺼져 있으면 DOM에 없으므로 스칠 것 자체가 없다.
 *    잠기는 것은 길이 하나다 — 이동도 탭도 그대로여야 한다.
 * 2. *「기본적으로 0분과 30분에 자석처럼 달라붙게」* — 끌어다 놓은 자리는 언제나
 *    「10시 7분」쯤이고, 그 7분은 계획이 아니라 손의 떨림이다.
 *
 * 자석은 **드래그 드롭에만** 걸린다. 시트의 ± 스테퍼는 15분 그대로다(그 손가락은
 * 정확하다) — 마지막 한 건이 그것을 못박는다.
 */

/** Grid geometry — must match `src/timeline/layout.ts`. */
const PX_PER_MIN = 0.9;
/** 05:00 (M16-B) — 한 칸의 첫 픽셀이 가리키는 시각. */
const DAY_START_MIN = 300;

test.use({ viewport: { width: 1280, height: 800 } });

async function createTrip(page: Page, title: string): Promise<void> {
  await page.getByTestId('add-trip').click();
  await page.getByTestId('trip-title-input').fill(title);
  await page.getByTestId('trip-submit').click();
  await expect(page.getByTestId('trip-form')).toHaveCount(0);
  await page.getByTestId('trip-card').filter({ hasText: title }).getByTestId('trip-open').click();
  await expect(page).toHaveURL(/#\/board$/);
}

async function addCard(page: Page, columnIndex: number, title: string): Promise<void> {
  await page.getByTestId('board-column').nth(columnIndex).getByTestId('add-card').click();
  await page.getByTestId('card-title-input').fill(title);
  await page.getByTestId('card-submit').click();
  await expect(page.getByTestId('card-form')).toHaveCount(0);
}

async function openTimelineWithADay(page: Page): Promise<void> {
  await page.getByTestId('tab-timeline').click();
  await expect(page.getByTestId('view-timeline')).toBeVisible();
  await page.getByTestId('timeline-add-day').click();
  await expect(page.getByTestId('timeline-day')).toHaveCount(1);
}

/** 보드에서 카드를 시간표에 올린다 — 드래그를 쓰지 않는 배치 경로 (10:00). */
async function scheduleCard(page: Page, title: string): Promise<void> {
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

/** dnd-kit은 8px 넘는 이동과 몇 프레임을 필요로 한다. */
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

const startMinOf = (page: Page): Promise<number> =>
  page
    .getByTestId('timeline-entry')
    .first()
    .getAttribute('data-start-min')
    .then((value) => Number(value));

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('tab-bar')).toBeVisible();
});

/* ------------------------------------------------------------------ *
 * 1. 「수정」 토글
 * ------------------------------------------------------------------ */

test('「수정」이 꺼져 있으면 길이 손잡이가 아예 없다 — 스칠 것이 없다', async ({ page }) => {
  await createTrip(page, '오사카 잠금');
  await addCard(page, 0, '츠텐카쿠');
  await openTimelineWithADay(page);
  await scheduleCard(page, '츠텐카쿠');

  const toggle = page.getByTestId('timeline-edit-toggle');
  await expect(toggle).toBeVisible();
  // 기본값은 **꺼짐**: 처음 여는 사람에게 사고가 나서는 안 된다.
  await expect(toggle).toHaveAttribute('data-on', 'false');
  await expect(page.getByTestId('entry-resize')).toHaveCount(0);

  const entry = page.getByTestId('timeline-entry').first();
  await expect(entry).toHaveAttribute('data-duration-min', '60');
  await expect(entry).toHaveAttribute('data-start-min', '600');

  // 신고된 그 몸짓 그대로: 블록 **아래 12px 띠**를 살짝 눌렀다 뗀다. 드래그
  // 문턱(8px)에도 못 미치는 움직임이라, 예전에는 이것만으로 길이가 바뀌었다.
  const box = await entry.boundingBox();
  if (!box) throw new Error('일정 블록의 위치를 찾지 못했어요');
  const x = box.x + box.width / 2;
  await page.mouse.move(x, box.y + box.height - 10);
  await page.mouse.down();
  await page.mouse.move(x, box.y + box.height - 4);
  await page.mouse.up();

  // 길이도 시각도 그대로다 — 그 자리에는 이제 아무것도 없다.
  await expect(entry).toHaveAttribute('data-duration-min', '60');
  await expect(entry).toHaveAttribute('data-start-min', '600');
  // 그리고 그 탭은 **상세를 연다** — 잠근 것은 길이 하나다.
  await expect(page.getByTestId('entry-sheet')).toBeVisible();
});

test('「수정」을 켜면 손잡이가 서고 길이가 바뀌며, 그 상태를 기기가 기억한다', async ({
  page,
}) => {
  await createTrip(page, '오사카 수정');
  await addCard(page, 0, '우메다 전망대');
  await openTimelineWithADay(page);
  await scheduleCard(page, '우메다 전망대');

  const toggle = page.getByTestId('timeline-edit-toggle');
  await toggle.click();
  await expect(toggle).toHaveAttribute('data-on', 'true');

  const entry = page.getByTestId('timeline-entry').first();
  const handle = page.getByTestId('entry-resize');
  await expect(handle).toHaveCount(1);

  const box = await handle.boundingBox();
  if (!box) throw new Error('길이 조절 손잡이를 찾지 못했어요');
  // 한 시간만큼 아래로 — 60분 블록이 두 시간이 된다.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  for (const step of [0.25, 0.5, 0.75, 1]) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 60 * PX_PER_MIN * step);
  }
  await page.mouse.up();

  await expect
    .poll(async () => Number(await entry.getAttribute('data-duration-min')))
    .toBeGreaterThan(60);
  const duration = Number(await entry.getAttribute('data-duration-min'));
  expect(duration % 15).toBe(0);

  // 이 기기는 켠 상태를 기억한다 — 다시 열 때마다 켜지 않아도 된다.
  await page.reload();
  await expect(page.getByTestId('tab-bar')).toBeVisible();
  await expect(page.getByTestId('timeline-edit-toggle')).toHaveAttribute('data-on', 'true');
  await expect(page.getByTestId('entry-resize')).toHaveCount(1);

  // 끄면 다시 사라진다.
  await page.getByTestId('timeline-edit-toggle').click();
  await expect(page.getByTestId('entry-resize')).toHaveCount(0);
});

/* ------------------------------------------------------------------ *
 * 2. 드롭 자석
 * ------------------------------------------------------------------ */

test('레일에서 끌어다 놓으면 가장 가까운 :00 / :30에 달라붙는다', async ({ page }) => {
  await createTrip(page, '오사카 자석');
  await addCard(page, 0, '난바 파크스');
  await openTimelineWithADay(page);

  const railCard = page.getByTestId('timeline-rail').getByTestId('board-card').first();
  await railCard.scrollIntoViewIfNeeded();

  const grid = page.getByTestId('timeline-day-grid').first();
  const gridBox = await grid.boundingBox();
  const cardBox = await railCard.boundingBox();
  if (!gridBox || !cardBox) throw new Error('드래그 대상의 위치를 찾지 못했어요');

  // 손가락은 10시 7분을 가리켰다 — 자석이 10시로 당긴다.
  await dragMouse(
    page,
    { x: cardBox.x + cardBox.width / 2, y: cardBox.y + cardBox.height / 2 },
    { x: gridBox.x + gridBox.width / 2, y: gridBox.y + (607 - DAY_START_MIN) * PX_PER_MIN },
  );

  await expect(page.getByTestId('timeline-entry')).toHaveCount(1);
  await expect(page.getByTestId('timeline-entry')).toHaveAttribute('data-start-min', '600');

  // 그 블록을 23분 아래로 밀면 10시 30분에 선다 — 이동도 같은 자석을 쓴다.
  const entryBox = await page.getByTestId('timeline-entry').first().boundingBox();
  if (!entryBox) throw new Error('일정 블록의 위치를 찾지 못했어요');
  await dragMouse(
    page,
    { x: entryBox.x + entryBox.width / 2, y: entryBox.y + 8 },
    { x: entryBox.x + entryBox.width / 2, y: entryBox.y + 8 + 23 * PX_PER_MIN },
  );

  await expect.poll(() => startMinOf(page)).toBe(630);
});

test('시트의 ± 스테퍼는 15분 그대로다 — 자석은 드래그의 것이다', async ({ page }) => {
  await createTrip(page, '오사카 스테퍼');
  await addCard(page, 0, '신사이바시');
  await openTimelineWithADay(page);
  await scheduleCard(page, '신사이바시');

  // 10:00에서 한 칸 당기면 09:45다 — 09:30이 아니다.
  await page.getByTestId('timeline-entry').first().click();
  await expect(page.getByTestId('entry-sheet')).toBeVisible();
  await expect(page.getByTestId('entry-range')).toHaveText('10:00–11:00');
  await page.getByTestId('entry-start-minus').click();
  await expect(page.getByTestId('entry-range')).toHaveText('09:45–10:45');
  await page.getByTestId('entry-save').click();
  await expect(page.getByTestId('entry-sheet')).toHaveCount(0);
  await expect(page.getByTestId('timeline-entry').first()).toHaveAttribute(
    'data-start-min',
    '585',
  );
});
