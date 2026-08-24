import { expect, test, type Page } from '@playwright/test';

/**
 * 모바일 상단 접기 + 제목 줄바꿈 금지 — M18.
 *
 * 실기기 스크린샷에서 온 요구다: 폰에서 일정 탭을 열면 그리드에 닿기까지 다섯
 * 줄을 지나야 했고, 그 첫 줄에서 「일정」이 옆의 버튼 두 개에 밀려 「일 / 정」
 * 으로 쪼개져 있었다.
 *
 * 그래서 세 가지를 못박는다.
 *
 * 1. **제목은 절대 두 줄이 되지 않는다.** 좁아지면 양보하는 쪽은 버튼이다
 *    (`sm` 아래에서 라벨을 접고 아이콘만 남긴다).
 * 2. **접으면 진짜로 줄어든다.** 시트 탭 줄과 지출 요약 바가 사라지고, 사라진
 *    픽셀이 그리드로 간다 — 「접었는데 그대로」는 접기가 아니다.
 * 3. **페이저는 접어도 남는다.** 1일차에서 2일차로 가는 유일한 길이라, 그것까지
 *    접는 것은 공간 절약이 아니라 고장이다.
 *
 * 데스크톱(≥lg)은 이 기능을 아예 그리지 않는다 — 마지막 테스트가 그것을 지킨다.
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

/** 일정 탭으로 가서 일자 하나를 깐다 — 그리드가 있어야 높이를 잴 수 있다. */
async function seedOneDay(page: Page): Promise<void> {
  await page.getByTestId('tab-timeline').click();
  await page.getByTestId('timeline-add-day-empty').click();
  await expect(page.getByTestId('timeline-day')).toHaveCount(1);
}

/** 뷰포트 맨 위에서 그리드 첫 픽셀까지 — M18이 줄이려는 바로 그 숫자. */
async function gridTop(page: Page): Promise<number> {
  const box = await page.getByTestId('timeline-scroller').boundingBox();
  if (!box) throw new Error('그리드를 찾지 못했어요');
  return box.y;
}

async function gridHeight(page: Page): Promise<number> {
  const box = await page.getByTestId('timeline-scroller').boundingBox();
  if (!box) throw new Error('그리드를 찾지 못했어요');
  return box.height;
}

test.describe('모바일', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('tab-bar')).toBeVisible();
  });

  test('제목은 좁은 화면에서도 한 줄이고, 버튼이 대신 아이콘으로 줄어든다', async ({ page }) => {
    await createTrip(page, '오사카 제목 줄바꿈');
    await seedOneDay(page);

    // 「일정」 한 줄. 두 줄이 되면 높이가 두 배가 되므로 그것으로 잡는다
    // (text-display 24px · line-height 1.24 ≈ 30px).
    const title = page.locator('#view-timeline-title');
    for (const width of [320, 360, 390]) {
      await page.setViewportSize({ width, height: 844 });
      const box = await title.boundingBox();
      if (!box) throw new Error(`${width}px에서 제목을 찾지 못했어요`);
      expect(box.height).toBeLessThan(40);
      // 그리고 제목은 화면 밖으로 밀리지 않는다 — 양보하는 쪽은 버튼이다.
      expect(box.x).toBeGreaterThanOrEqual(0);
    }
    await page.setViewportSize({ width: 390, height: 844 });

    // 라벨을 접은 버튼은 이름을 잃지 않는다.
    const addDay = page.getByTestId('timeline-add-day');
    await expect(addDay).toBeVisible();
    await expect(addDay).toHaveAttribute('aria-label', '일자 추가');
    // 그리고 44px 터치 타깃은 유지된다.
    const addBox = await addDay.boundingBox();
    expect(Math.round(addBox?.width ?? 0)).toBeGreaterThanOrEqual(44);
    expect(Math.round(addBox?.height ?? 0)).toBeGreaterThanOrEqual(44);
  });

  test('접으면 시트 탭·요약 바가 사라지고 그 픽셀이 그리드로 간다', async ({ page }) => {
    await createTrip(page, '오사카 접기');
    await seedOneDay(page);

    const toggle = page.getByTestId('timeline-chrome-toggle');
    await expect(toggle).toBeVisible();

    // 기본값은 **펼침** — 처음 연 사람이 시트 탭의 존재를 발견할 수 있어야 한다.
    await expect(toggle).toHaveAttribute('data-collapsed', 'false');
    await expect(page.getByTestId('sheet-tabs')).toBeVisible();
    await expect(page.getByTestId('spend-summary')).toBeVisible();

    const expandedTop = await gridTop(page);
    const expandedHeight = await gridHeight(page);
    // 펼친 상태에서도 상단 크롬은 190px을 넘지 않는다 (M18 §3).
    expect(expandedTop).toBeLessThanOrEqual(190);

    await toggle.click();

    // 두 줄이 사라졌다…
    await expect(toggle).toHaveAttribute('data-collapsed', 'true');
    await expect(page.getByTestId('sheet-tabs')).toHaveCount(0);
    await expect(page.getByTestId('spend-summary')).toHaveCount(0);
    // …페이저는 남았고(네비게이션이다)…
    await expect(page.getByTestId('day-pager')).toBeVisible();
    await expect(page.getByTestId('day-pager-label')).toHaveText('1일차');
    // …현재 시트 이름도 여전히 화면에 있다.
    await expect(page.getByTestId('timeline-sheet-name')).toHaveText('일정 1');

    // 그리고 그 픽셀은 정말로 그리드가 가져갔다.
    const collapsedTop = await gridTop(page);
    const collapsedHeight = await gridHeight(page);
    expect(collapsedTop).toBeLessThan(expandedTop);
    expect(collapsedTop).toBeLessThanOrEqual(120);
    expect(collapsedHeight).toBeGreaterThan(expandedHeight + 60);

    // 접힘은 이 기기가 기억한다.
    await page.reload();
    await expect(page.getByTestId('timeline-scroller')).toBeVisible();
    await expect(page.getByTestId('timeline-chrome-toggle')).toHaveAttribute(
      'data-collapsed',
      'true',
    );
    await expect(page.getByTestId('sheet-tabs')).toHaveCount(0);
    expect(await gridTop(page)).toBeLessThanOrEqual(120);

    // 다시 펴면 둘 다 돌아온다 — 접기는 삭제가 아니다.
    await page.getByTestId('timeline-chrome-toggle').click();
    await expect(page.getByTestId('timeline-chrome-toggle')).toHaveAttribute(
      'data-collapsed',
      'false',
    );
    await expect(page.getByTestId('sheet-tabs')).toBeVisible();
    await expect(page.getByTestId('spend-summary')).toBeVisible();
    expect(await gridTop(page)).toBe(expandedTop);
  });

  test('접힌 줄의 시트 이름을 누르면 펼쳐진다 — 시트 전환은 언제나 두 탭 안', async ({
    page,
  }) => {
    await createTrip(page, '오사카 두 탭');
    await seedOneDay(page);

    // 시트를 하나 더 만들어 둔다 — 전환할 것이 있어야 하는 테스트다.
    await page.getByTestId('sheet-add').click();
    await page.getByTestId('wizard-name-input').fill('플랜 B');
    await page.getByTestId('wizard-mode-days').click();
    await page.getByTestId('wizard-submit').click();
    await expect(page.getByTestId('sheet-tab')).toHaveCount(2);
    await expect(page.getByTestId('timeline-sheet-name')).toHaveText('플랜 B');

    await page.getByTestId('timeline-chrome-toggle').click();
    await expect(page.getByTestId('sheet-tabs')).toHaveCount(0);

    // 탭 1: 이름을 누른다 → 탭 줄이 돌아온다.
    await page.getByTestId('timeline-chrome-sheet').click();
    await expect(page.getByTestId('sheet-tabs')).toBeVisible();
    await expect(page.getByTestId('timeline-chrome-toggle')).toHaveAttribute(
      'data-collapsed',
      'false',
    );

    // 탭 2: 다른 시트로 넘어간다.
    await page.getByTestId('sheet-tab').filter({ hasText: '일정 1' }).click();
    await expect(page.getByTestId('timeline-sheet-name')).toHaveText('일정 1');
  });

  /**
   * 손가락이 실제로 닿는 자리 — M19 모바일 검수에서 나온 세 건.
   *
   * 1. **시트 알약은 통째로 버튼이다.** 알약은 44px인데 그 안의 `button`은 글자
   *    높이(14px)뿐이라, 시트를 바꾸는 자리는 알약 한가운데의 가느다란 띠
   *    하나였다. 알약 위쪽을 스친 손가락은 아무 일도 일으키지 못했다.
   * 2. **일자 페이저는 44px을 갖는다.** 하루씩 넘기는 유일한 손잡이가 32×32였다.
   * 3. **엔트리 블록은 화면 끝에 닿지 않는다.** 오른쪽 모서리가 마지막 픽셀에
   *    걸려 잘린 것처럼 보였다.
   */
  test('시트 알약·페이저·그리드 오른쪽 끝이 손가락 크기를 지킨다', async ({ page }) => {
    await createTrip(page, '오사카 터치');
    await page.getByTestId('board-column').nth(2).getByTestId('add-card').click();
    await page.getByTestId('card-title-input').fill('이치란');
    await page.getByTestId('card-submit').click();
    await expect(page.getByTestId('card-form')).toHaveCount(0);
    await seedOneDay(page);

    // 1) 시트 탭 버튼 자체가 알약 높이다.
    const tabBox = await page.getByTestId('sheet-tab').first().boundingBox();
    expect(Math.round(tabBox?.height ?? 0)).toBeGreaterThanOrEqual(44);

    // 2) 페이저 화살표는 좌우 44px — 손가락이 흔들리는 방향이다.
    for (const id of ['day-pager-prev', 'day-pager-next']) {
      const box = await page.getByTestId(id).boundingBox();
      expect(Math.round(box?.width ?? 0)).toBeGreaterThanOrEqual(44);
    }

    // 3) 트레이에서 카드를 놓고, 블록이 화면 오른쪽 끝을 비워 두는지 본다.
    const tray = page.getByTestId('unscheduled-tray');
    await tray.getByTestId('tray-toggle').click();
    await tray.getByTestId('tray-card').first().click();
    await expect(page.getByTestId('schedule-sheet')).toBeVisible();
    await page.getByTestId('schedule-submit').click();
    await expect(page.getByTestId('timeline-entry')).toHaveCount(1);
    const entry = await page.getByTestId('timeline-entry').first().boundingBox();
    expect((entry?.x ?? 0) + (entry?.width ?? 0)).toBeLessThanOrEqual(390 - 4);

    // 그리고 알약의 *위쪽 모서리*를 눌러도 시트가 바뀐다 — 좌표로 누른다.
    await page.getByTestId('sheet-add').click();
    await page.getByTestId('wizard-name-input').fill('플랜 B');
    await page.getByTestId('wizard-mode-days').click();
    await page.getByTestId('wizard-submit').click();
    await expect(page.getByTestId('timeline-sheet-name')).toHaveText('플랜 B');

    const pill = page.getByTestId('sheet-tab').first().locator('xpath=..');
    const pillBox = await pill.boundingBox();
    if (!pillBox) throw new Error('시트 알약을 찾지 못했어요');
    await page.mouse.click(pillBox.x + pillBox.width / 2, pillBox.y + 3);
    await expect(page.getByTestId('timeline-sheet-name')).toHaveText('일정 1');
  });
});

test('데스크톱에는 접기 토글이 아예 없다', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await expect(page.getByTestId('tab-bar')).toBeVisible();

  await createTrip(page, '오사카 데스크톱');
  await seedOneDay(page);

  await expect(page.getByTestId('timeline-chrome-toggle')).toHaveCount(0);
  await expect(page.getByTestId('sheet-tabs')).toBeVisible();
  await expect(page.getByTestId('spend-summary')).toBeVisible();
});
