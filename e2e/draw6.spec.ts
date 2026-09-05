import { devices, expect, test, type BrowserContext, type Page } from '@playwright/test';

/**
 * 드로우 M54 — **기본은 손, 그리고 돌아오는 문 하나**.
 *
 * 이 파일이 지키는 것은 둘이다.
 *
 * 1. **기본 도구가 손(이동)이다.** 페이지를 처음 열고 화면을 끌면 선이 그어지는
 *    것이 아니라 화면이 옮겨진다 — 폰에서 「옆으로 넘기려다 그었다」가 M53까지의
 *    첫 경험이었다. 그리기는 이제 **펜을 골라서** 하는 일이다.
 * 2. **「가운데」 하나로 돌아온다.** 4000×4000은 몇 번의 손짓이면 아무것도 없는
 *    벌판이 되고, 거기서 축소로 자기 그림을 되짚는 것은 길이 아니다. 버튼
 *    (`draw-recenter`)과 키보드 `0`이 **같은 자리**(새 페이지가 열리는 그 자리)로
 *    한 번에 데려다 놓는다.
 *
 * 폰 묶음이 따로 있는 이유는 M51·M53-fix의 그 교훈이다(HANDOFF §6-10): 데스크톱
 * 컨텍스트의 뷰포트를 줄이는 것으로는 **터치가 일어나지 않는다**. 사용자가 실제로
 * 부딪힌 자리는 손가락 하나였으므로, 손가락 하나로 확인한다.
 */

/** 페이지 한 변 — `draw/tools.DRAW_PAGE_SIZE`와 같은 값이어야 한다. */
const DRAW_PAGE_SIZE = 4000;

async function createTrip(page: Page, title: string): Promise<void> {
  await page.getByTestId('add-trip').click();
  await page.getByTestId('trip-title-input').fill(title);
  await page.getByTestId('trip-submit').click();
  await expect(page.getByTestId('trip-form')).toHaveCount(0);
  await page.getByTestId('trip-card').filter({ hasText: title }).getByTestId('trip-open').click();
  await expect(page).toHaveURL(/#\/board$/);
}

async function openDraw(page: Page): Promise<void> {
  await page.getByTestId('tab-draw').click();
  await expect(page.getByTestId('view-draw')).toBeVisible();
}

/**
 * 새 페이지를 연다 — **도구를 고르지 않는다**.
 *
 * 다른 드로우 스펙의 같은 이름 헬퍼는 여기서 펜을 한 번 고른다. 이 파일은
 * 「고르지 않았을 때 무엇이 기본인가」를 묻는 곳이라 그 한 줄이 있으면 안 된다.
 */
async function addPage(page: Page): Promise<string> {
  await page.getByTestId('draw-add-page').click();
  const editor = page.getByTestId('draw-editor');
  await expect(editor).toBeVisible();
  return (await editor.getAttribute('data-page-id')) ?? '';
}

const pickTool = async (page: Page, tool: string): Promise<void> => {
  await page.getByTestId('draw-tool').and(page.locator(`[data-tool="${tool}"]`)).click();
  await expect(page.getByTestId('draw-canvas')).toHaveAttribute('data-tool', tool);
};

/** 캔버스 위에서 마우스로 한 번 끈다 (스텝 이동 — M8의 그 규칙). */
async function dragOnCanvas(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  const box = await page.getByTestId('draw-canvas').boundingBox();
  if (!box) throw new Error('캔버스가 없다');
  await page.mouse.move(box.x + from.x, box.y + from.y);
  await page.mouse.down();
  const steps = 8;
  for (let i = 1; i <= steps; i += 1) {
    await page.mouse.move(
      box.x + from.x + ((to.x - from.x) * i) / steps,
      box.y + from.y + ((to.y - from.y) * i) / steps,
    );
  }
  await page.mouse.up();
}

/** 지금 캔버스가 보고 있는 자리와 크기 — `viewBox` 한 줄이 전부 말해 준다. */
async function viewOf(page: Page): Promise<{ x: number; y: number; w: number; h: number }> {
  return page.evaluate(() => {
    const svg = document.querySelector('[data-testid="draw-canvas"]');
    const [x, y, w, h] = (svg?.getAttribute('viewBox') ?? '0 0 0 0').split(' ').map(Number);
    return { x, y, w, h };
  });
}

/** 「가운데」가 데려다 놓아야 하는 자리 — `draw/tools.centeredView`와 같은 계산이다. */
async function expectCentered(page: Page): Promise<void> {
  await expect(page.getByTestId('draw-canvas')).toHaveAttribute('data-scale', '1.000');
  const view = await viewOf(page);
  expect(Math.abs(view.x - (DRAW_PAGE_SIZE / 2 - view.w / 2))).toBeLessThan(2);
  expect(Math.abs(view.y - (DRAW_PAGE_SIZE / 2 - view.h / 2))).toBeLessThan(2);
}

/* ------------------------------------------------------------------ *
 * 1. 기본은 손 — 끌어도 아무것도 남지 않는다
 * ------------------------------------------------------------------ */

test('새 페이지의 기본 도구는 손이다 — 끌면 그려지지 않고 화면이 옮겨진다', async ({
  page,
}) => {
  await page.goto('/');
  await createTrip(page, '오사카 기본손');
  await openDraw(page);
  await addPage(page);

  const canvas = page.getByTestId('draw-canvas');
  await expect(canvas).toHaveAttribute('data-tool', 'hand');

  const before = await viewOf(page);
  await dragOnCanvas(page, { x: 320, y: 240 }, { x: 120, y: 160 });

  // ① 아무것도 그려지지 않았다 — 이것이 M54의 전부다.
  await expect(page.getByTestId('draw-element')).toHaveCount(0);
  // ② 대신 화면이 옮겨졌다(왼쪽으로 끌었으니 보는 자리는 오른쪽으로 간다).
  const after = await viewOf(page);
  expect(after.x).toBeGreaterThan(before.x + 100);
  expect(after.y).toBeGreaterThan(before.y + 50);
  // ③ 배율은 손대지 않았다 — 끄는 것은 팬이지 줌이 아니다.
  await expect(canvas).toHaveAttribute('data-scale', '1.000');
  // ④ 그리고 실행취소할 것도 없다(그은 적이 없으니까).
  await expect(page.getByTestId('draw-undo')).toBeDisabled();
});

/* ------------------------------------------------------------------ *
 * 2. 「가운데」 버튼 — 어디에 있든 배율 1의 한가운데로
 * ------------------------------------------------------------------ */

test('가운데 버튼 — 두 번 확대하고 멀리 옮겨도 한 번에 돌아온다', async ({ page }) => {
  await page.goto('/');
  await createTrip(page, '오사카 가운데');
  await openDraw(page);
  await addPage(page);

  const canvas = page.getByTestId('draw-canvas');
  await expectCentered(page);

  await page.getByTestId('draw-zoom-in').click();
  await page.getByTestId('draw-zoom-in').click();
  expect(Number(await canvas.getAttribute('data-scale'))).toBeGreaterThan(1.4);

  // 기본이 손이므로 끌면 그대로 팬이다 — 벌판으로 나가 본다.
  await dragOnCanvas(page, { x: 340, y: 260 }, { x: 80, y: 120 });
  const lost = await viewOf(page);
  expect(Math.abs(lost.x - (DRAW_PAGE_SIZE / 2 - lost.w / 2))).toBeGreaterThan(50);

  await page.getByTestId('draw-recenter').click();
  await expectCentered(page);
});

/* ------------------------------------------------------------------ *
 * 3. 키보드 0 — 같은 문, 손이 마우스에서 떠나지 않을 때
 * ------------------------------------------------------------------ */

test('키보드 0도 가운데로 데려다 놓는다 (도구 번호는 1부터라 0이 비어 있었다)', async ({
  page,
}) => {
  await page.goto('/');
  await createTrip(page, '오사카 영키');
  await openDraw(page);
  await addPage(page);

  const canvas = page.getByTestId('draw-canvas');
  await page.getByTestId('draw-zoom-out').click();
  await dragOnCanvas(page, { x: 120, y: 140 }, { x: 340, y: 280 });
  expect(Number(await canvas.getAttribute('data-scale'))).toBeLessThan(1);

  await page.keyboard.press('0');
  await expectCentered(page);

  // 그리고 「0」은 도구를 바꾸지 않았다 — 자리만 바꾸는 키다.
  await expect(canvas).toHaveAttribute('data-tool', 'hand');
});

/* ------------------------------------------------------------------ *
 * 4. 펜은 그대로 그린다 — 기본이 바뀐 것이지 없어진 것이 아니다
 * ------------------------------------------------------------------ */

test('펜을 고르면 예전처럼 그려지고, 다시 손으로 바꾸면 또 안 그려진다', async ({ page }) => {
  await page.goto('/');
  await createTrip(page, '오사카 펜복귀');
  await openDraw(page);
  await addPage(page);

  await pickTool(page, 'pen');
  await dragOnCanvas(page, { x: 60, y: 60 }, { x: 200, y: 140 });
  await expect(page.getByTestId('draw-element')).toHaveCount(1);
  await expect(page.getByTestId('draw-element').first()).toHaveAttribute('data-kind', 'stroke');

  // 손으로 돌아오면 다시 아무것도 남지 않는다 — 요소는 여전히 하나다.
  await pickTool(page, 'hand');
  await dragOnCanvas(page, { x: 260, y: 200 }, { x: 100, y: 100 });
  await expect(page.getByTestId('draw-element')).toHaveCount(1);
});

/* ------------------------------------------------------------------ *
 * 5. 폰 — 사용자가 실제로 부딪힌 자리는 손가락 하나였다
 * ------------------------------------------------------------------ */

const { defaultBrowserType: _pixelBrowser, ...PIXEL_5 } = devices['Pixel 5'];

test.describe('폰 (Pixel 5)', () => {
  test.use(PIXEL_5);

  /** 손가락 하나로 끈다 — Playwright의 터치는 탭뿐이라 CDP로 직접 올린다. */
  async function swipe(
    context: BrowserContext,
    page: Page,
    from: { x: number; y: number },
    to: { x: number; y: number },
  ): Promise<void> {
    const cdp = await context.newCDPSession(page);
    const finger = (x: number, y: number) => [{ x, y, id: 1 }];
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: finger(from.x, from.y),
    });
    const steps = 6;
    for (let i = 1; i <= steps; i += 1) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: finger(
          from.x + ((to.x - from.x) * i) / steps,
          from.y + ((to.y - from.y) * i) / steps,
        ),
      });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
  }

  test('손가락 하나로 옆으로 넘겨도 선이 그어지지 않는다', async ({ page, context }) => {
    await page.goto('/');
    await createTrip(page, '오사카 폰기본');
    await openDraw(page);
    await addPage(page);

    const canvas = page.getByTestId('draw-canvas');
    await expect(canvas).toHaveAttribute('data-tool', 'hand');
    const box = (await canvas.boundingBox())!;
    const before = await viewOf(page);

    await swipe(
      context,
      page,
      { x: box.x + box.width - 40, y: box.y + box.height / 2 },
      { x: box.x + 40, y: box.y + box.height / 2 },
    );

    await expect(page.getByTestId('draw-element')).toHaveCount(0);
    const after = await viewOf(page);
    expect(after.x).toBeGreaterThan(before.x + 100);

    // 「가운데」는 폰에서도 눌린다 — 도구 바 둘째 줄의 끝이라 가로 스크롤 안이다.
    await page.getByTestId('draw-recenter').scrollIntoViewIfNeeded();
    await page.getByTestId('draw-recenter').click();
    await expectCentered(page);
  });
});
