import { devices, expect, test, type BrowserContext, type Page } from '@playwright/test';

/**
 * 드로우 3회차 (M53-1) — **고르고 만지는 손**.
 *
 * `draw.spec`이 「그린 것이 남는가」를, `draw2.spec`이 「그 다음 것들」을 지킨다면
 * 이 스펙은 편집기 재설계가 실제로 손에 닿는지를 지킨다:
 *
 * 1. **리사이즈** — 핸들을 끌면 요소의 크기가 진짜로 바뀐다.
 * 2. **다중 선택** — 빈 곳을 끌어 마퀴로 여럿을 고르고, 한 번에 옮긴다.
 * 3. **겹침 순서** — 맨앞/맨뒤가 그리는 순서를 바꾼다.
 * 4. **복사·붙여넣기·복제** — 한 걸음으로 되돌아간다.
 * 5. **키보드** — 화살표 1px / Shift 10px.
 * 6. **폰** — 한 손가락으로 핸들을 끌고, **두 손가락은 여전히 팬/줌**이다.
 */

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

async function addPage(page: Page): Promise<string> {
  await page.getByTestId('draw-add-page').click();
  const editor = page.getByTestId('draw-editor');
  await expect(editor).toBeVisible();
  // M54부터 **기본 도구는 손(이동)**이다. 이 스펙들은 페이지를 열자마자 그리므로
  // 여기서 펜을 한 번 골라 준다 — 앱에서도 그리기는 이제 고르고 하는 일이다.
  await pickTool(page, 'pen');
  return (await editor.getAttribute('data-page-id')) ?? '';
}

/** 캔버스 안에서 끈다 — 좌표는 캔버스의 왼쪽 위 기준(스텝 이동, M8의 그 규칙). */
async function dragOnCanvas(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  steps = 8,
): Promise<void> {
  const box = await page.getByTestId('draw-canvas').boundingBox();
  if (!box) throw new Error('캔버스가 없다');
  await page.mouse.move(box.x + from.x, box.y + from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i += 1) {
    await page.mouse.move(
      box.x + from.x + ((to.x - from.x) * i) / steps,
      box.y + from.y + ((to.y - from.y) * i) / steps,
    );
  }
  await page.mouse.up();
}

const pickTool = async (page: Page, tool: string): Promise<void> => {
  await page.getByTestId('draw-tool').and(page.locator(`[data-tool="${tool}"]`)).click();
  await expect(page.getByTestId('draw-canvas')).toHaveAttribute('data-tool', tool);
};

/** 스티커 하나를 그 자리에 붙인다. */
async function putSticker(page: Page, at: { x: number; y: number }, emoji = '📍'): Promise<void> {
  await page.getByTestId('draw-sticker-open').click();
  await page.getByTestId('draw-sticker-option').and(page.locator(`[data-emoji="${emoji}"]`)).click();
  await expect(page.getByTestId('draw-sticker-sheet')).toHaveCount(0);
  await page.getByTestId('draw-canvas').click({ position: at });
}

/* ------------------------------------------------------------------ *
 * 1. 리사이즈
 * ------------------------------------------------------------------ */

test('핸들을 끌면 크기가 바뀌고, 실행취소 한 번에 돌아온다', async ({ page }) => {
  await page.goto('/');
  await createTrip(page, '오사카 리사이즈');
  await openDraw(page);
  await addPage(page);

  // 도구 바를 피해 아래쪽에 사각형 하나.
  await pickTool(page, 'rect');
  await dragOnCanvas(page, { x: 80, y: 160 }, { x: 220, y: 260 });
  const element = page.getByTestId('draw-element').first();
  await expect(element).toHaveAttribute('data-kind', 'rect');
  const before = (await element.boundingBox())!;

  // 고르면 핸들 여덟 개가 뜬다 (도형은 비균등도 된다).
  await pickTool(page, 'select');
  await page.getByTestId('draw-canvas').click({ position: { x: 80, y: 210 } });
  await expect(page.getByTestId('draw-handle')).toHaveCount(8);

  // 오른쪽 아래 핸들을 바깥으로 끈다.
  const handle = page.getByTestId('draw-handle').and(page.locator('[data-handle="se"]'));
  const grip = (await handle.boundingBox())!;
  const canvas = (await page.getByTestId('draw-canvas').boundingBox())!;
  await dragOnCanvas(
    page,
    { x: grip.x + grip.width / 2 - canvas.x, y: grip.y + grip.height / 2 - canvas.y },
    { x: 340, y: 380 },
  );

  const after = (await element.boundingBox())!;
  expect(after.width).toBeGreaterThan(before.width + 40);
  expect(after.height).toBeGreaterThan(before.height + 40);

  // 끄는 동안 저장은 한 번뿐이었다 — Ctrl+Z 한 번이면 원래 크기다.
  await page.keyboard.press('Control+z');
  const undone = (await element.boundingBox())!;
  expect(Math.abs(undone.width - before.width)).toBeLessThan(4);
  expect(Math.abs(undone.height - before.height)).toBeLessThan(4);
});

test('글자·스티커는 모서리 넷으로 균등하게만 커진다', async ({ page }) => {
  await page.goto('/');
  await createTrip(page, '오사카 균등');
  await openDraw(page);
  await addPage(page);

  await putSticker(page, { x: 200, y: 260 });
  await expect(page.getByTestId('draw-element')).toHaveCount(1);

  await pickTool(page, 'select');
  await page.getByTestId('draw-canvas').click({ position: { x: 200, y: 260 } });
  await expect(page.getByTestId('draw-handle')).toHaveCount(4);
});

/* ------------------------------------------------------------------ *
 * 2. 다중 선택 (마퀴 · Shift)
 * ------------------------------------------------------------------ */

test('빈 곳을 끌면 마퀴로 여럿이 잡히고, 한 번에 옮겨진다', async ({ page }) => {
  await page.goto('/');
  await createTrip(page, '오사카 마퀴');
  await openDraw(page);
  await addPage(page);

  await putSticker(page, { x: 160, y: 240 }, '📍');
  await putSticker(page, { x: 260, y: 300 }, '⭐');
  await expect(page.getByTestId('draw-element')).toHaveCount(2);

  const first = page.getByTestId('draw-element').first();
  const second = page.getByTestId('draw-element').nth(1);
  const beforeA = (await first.boundingBox())!;
  const beforeB = (await second.boundingBox())!;

  // 빈 곳에서 시작해 둘을 감싼다 — **select 도구일 때만** 마퀴다.
  await pickTool(page, 'select');
  await dragOnCanvas(page, { x: 100, y: 180 }, { x: 340, y: 380 });
  await expect(page.getByTestId('draw-selection-bar')).toHaveAttribute('data-count', '2');
  await expect(page.getByTestId('draw-selection-status')).toHaveText('2개 선택됨');
  await expect(page.getByTestId('draw-selection')).toHaveCount(2);

  // 고른 것 하나를 끌면 둘 다 따라온다.
  await dragOnCanvas(page, { x: 160, y: 240 }, { x: 200, y: 280 });
  const afterA = (await first.boundingBox())!;
  const afterB = (await second.boundingBox())!;
  expect(afterA.x - beforeA.x).toBeGreaterThan(30);
  expect(afterB.x - beforeB.x).toBeGreaterThan(30);
  expect(afterB.y - beforeB.y).toBeGreaterThan(30);

  // 그리고 한 걸음이다 — Ctrl+Z 한 번에 둘 다 제자리로.
  await page.keyboard.press('Control+z');
  const undoneB = (await second.boundingBox())!;
  expect(Math.abs(undoneB.x - beforeB.x)).toBeLessThan(4);
});

test('Shift+클릭으로 고른 것을 더하고 뺀다', async ({ page }) => {
  await page.goto('/');
  await createTrip(page, '오사카 시프트');
  await openDraw(page);
  await addPage(page);

  await putSticker(page, { x: 160, y: 240 }, '📍');
  await putSticker(page, { x: 280, y: 240 }, '⭐');

  await pickTool(page, 'select');
  const canvas = page.getByTestId('draw-canvas');
  await canvas.click({ position: { x: 160, y: 240 } });
  await expect(page.getByTestId('draw-selection-bar')).toHaveAttribute('data-count', '1');

  await canvas.click({ position: { x: 280, y: 240 }, modifiers: ['Shift'] });
  await expect(page.getByTestId('draw-selection-bar')).toHaveAttribute('data-count', '2');

  // 다시 누르면 빠진다.
  await canvas.click({ position: { x: 280, y: 240 }, modifiers: ['Shift'] });
  await expect(page.getByTestId('draw-selection-bar')).toHaveAttribute('data-count', '1');
});

/* ------------------------------------------------------------------ *
 * 3. 겹침 순서
 * ------------------------------------------------------------------ */

test('맨앞·맨뒤가 그리는 순서를 바꾼다', async ({ page }) => {
  await page.goto('/');
  await createTrip(page, '오사카 순서');
  await openDraw(page);
  await addPage(page);

  await putSticker(page, { x: 160, y: 240 }, '📍');
  await putSticker(page, { x: 280, y: 240 }, '⭐');

  const kinds = async (): Promise<(string | null)[]> =>
    page.getByTestId('draw-element').evaluateAll((nodes) =>
      nodes.map((node) => node.textContent),
    );
  expect(await kinds()).toEqual(['📍', '⭐']);

  await pickTool(page, 'select');
  await page.getByTestId('draw-canvas').click({ position: { x: 160, y: 240 } });
  await page.getByTestId('draw-order').and(page.locator('[data-where="front"]')).click();
  expect(await kinds()).toEqual(['⭐', '📍']);

  // 한 칸 뒤로 = 원래 자리.
  await page.getByTestId('draw-order').and(page.locator('[data-where="backward"]')).click();
  expect(await kinds()).toEqual(['📍', '⭐']);

  // 겹침도 되돌아간다.
  await page.getByTestId('draw-order').and(page.locator('[data-where="front"]')).click();
  expect(await kinds()).toEqual(['⭐', '📍']);
  await page.keyboard.press('Control+z');
  expect(await kinds()).toEqual(['📍', '⭐']);
});

/* ------------------------------------------------------------------ *
 * 4. 복사·붙여넣기·복제
 * ------------------------------------------------------------------ */

test('복사·붙여넣기는 새 id로 계단을 만들고, 한 걸음으로 되돌아간다', async ({ page }) => {
  await page.goto('/');
  await createTrip(page, '오사카 복붙');
  await openDraw(page);
  await addPage(page);

  await putSticker(page, { x: 160, y: 240 }, '📍');
  await putSticker(page, { x: 260, y: 240 }, '⭐');

  await pickTool(page, 'select');
  await dragOnCanvas(page, { x: 100, y: 180 }, { x: 340, y: 320 });
  await expect(page.getByTestId('draw-selection-bar')).toHaveAttribute('data-count', '2');

  await page.keyboard.press('Control+c');
  await page.keyboard.press('Control+v');
  await expect(page.getByTestId('draw-element')).toHaveCount(4);
  // 붙여넣은 둘이 곧바로 손에 잡혀 있다.
  await expect(page.getByTestId('draw-selection-bar')).toHaveAttribute('data-count', '2');

  // 넷을 붙여넣고 Ctrl+Z 네 번은 사고다 — 한 번이면 된다.
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('draw-element')).toHaveCount(2);

  // 팝오버의 「복제」도 같은 일을 한다 (폰에는 Ctrl이 없다).
  await page.getByTestId('draw-canvas').click({ position: { x: 160, y: 240 } });
  await page.getByTestId('draw-duplicate-selected').click();
  await expect(page.getByTestId('draw-element')).toHaveCount(3);
});

test('클립보드는 페이지 밖에 살아서 다른 페이지에도 붙는다', async ({ page }) => {
  await page.goto('/');
  await createTrip(page, '오사카 페이지간');
  await openDraw(page);
  await addPage(page);

  await putSticker(page, { x: 200, y: 260 }, '📍');
  await pickTool(page, 'select');
  await page.getByTestId('draw-canvas').click({ position: { x: 200, y: 260 } });
  await page.keyboard.press('Control+c');

  // 두 번째 페이지로 걸어간다.
  await page.getByTestId('draw-back').click();
  await addPage(page);
  await expect(page.getByTestId('draw-element')).toHaveCount(0);

  await page.keyboard.press('Control+v');
  await expect(page.getByTestId('draw-element')).toHaveCount(1);
  await expect(page.getByTestId('draw-element').first()).toHaveAttribute('data-kind', 'sticker');
});

/* ------------------------------------------------------------------ *
 * 4-b. 고른 것에 색을 칠하고 글자를 고친다
 * ------------------------------------------------------------------ */

test('고른 게 있으면 색은 그것에 칠해진다 (없으면 다음에 그릴 것)', async ({ page }) => {
  await page.goto('/');
  await createTrip(page, '오사카 색칠');
  await openDraw(page);
  await addPage(page);

  await dragOnCanvas(page, { x: 80, y: 240 }, { x: 260, y: 240 });
  // M53-2에서 손글씨가 `polyline`에서 매끄러운 `path`가 됐다 — 이 스펙이 보는
  // 것은 「고른 것에 색이 칠해지나」이지 태그 이름이 아니다.
  const line = page.getByTestId('draw-element').first().locator('path, polyline').first();
  const before = await line.getAttribute('stroke');

  await pickTool(page, 'select');
  await page.getByTestId('draw-canvas').click({ position: { x: 170, y: 240 } });
  await page.getByTestId('draw-color').and(page.locator('[data-color="#2f9e5f"]')).click();

  await expect(line).toHaveAttribute('stroke', '#2f9e5f');
  expect(before).not.toBe('#2f9e5f');
});

test('선택한 글자를 더블탭하면 그 자리에서 고친다', async ({ page }) => {
  await page.goto('/');
  await createTrip(page, '오사카 글자고침');
  await openDraw(page);
  await addPage(page);

  await pickTool(page, 'text');
  await page.getByTestId('draw-canvas').click({ position: { x: 180, y: 260 } });
  await page.getByTestId('draw-text-input').fill('난바');
  await page.getByTestId('draw-text-submit').click();
  await expect(page.getByTestId('draw-element')).toHaveCount(1);

  await pickTool(page, 'select');
  await page.getByTestId('draw-canvas').dblclick({ position: { x: 190, y: 250 } });
  await expect(page.getByTestId('draw-text-sheet')).toBeVisible();
  await expect(page.getByTestId('draw-text-input')).toHaveValue('난바');

  await page.getByTestId('draw-text-input').fill('도톤보리');
  await page.getByTestId('draw-text-submit').click();
  // 요소가 늘지 않았다 — 새로 넣은 것이 아니라 고친 것이다.
  await expect(page.getByTestId('draw-element')).toHaveCount(1);
  await expect(page.getByTestId('draw-element').first()).toContainText('도톤보리');
});

/* ------------------------------------------------------------------ *
 * 5. 키보드
 * ------------------------------------------------------------------ */

test('화살표로 1px, Shift로 10px 움직인다', async ({ page }) => {
  await page.goto('/');
  await createTrip(page, '오사카 화살표');
  await openDraw(page);
  await addPage(page);

  await putSticker(page, { x: 200, y: 260 });
  await pickTool(page, 'select');
  await page.getByTestId('draw-canvas').click({ position: { x: 200, y: 260 } });

  const element = page.getByTestId('draw-element').first();
  const before = (await element.boundingBox())!;

  await page.keyboard.press('ArrowRight');
  const one = (await element.boundingBox())!;
  expect(one.x - before.x).toBeGreaterThan(0.5);
  expect(one.x - before.x).toBeLessThan(2);

  await page.keyboard.press('Shift+ArrowRight');
  const ten = (await element.boundingBox())!;
  expect(ten.x - one.x).toBeGreaterThan(8);
});

/* ------------------------------------------------------------------ *
 * 6. 폰 — 손가락 하나는 핸들, 두 개는 여전히 팬/줌
 * ------------------------------------------------------------------ */

const { defaultBrowserType: _pixelBrowser, ...PIXEL_5 } = devices['Pixel 5'];

test.describe('폰 (Pixel 5)', () => {
  test.use(PIXEL_5);

  /** 손가락 하나로 끈다 — Playwright의 touchscreen은 탭뿐이라 CDP를 쓴다. */
  async function fingerDrag(
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

  async function pinch(
    context: BrowserContext,
    page: Page,
    center: { x: number; y: number },
    from: number,
    to: number,
  ): Promise<void> {
    const cdp = await context.newCDPSession(page);
    const points = (gap: number) => [
      { x: center.x - gap / 2, y: center.y, id: 1 },
      { x: center.x + gap / 2, y: center.y, id: 2 },
    ];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(from) });
    for (let i = 1; i <= 5; i += 1) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: points(from + ((to - from) * i) / 5),
      });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
  }

  test('손가락 하나로 핸들을 끌어 키우고, 두 손가락은 그대로 팬/줌이다', async ({
    page,
    context,
  }) => {
    await page.goto('/');
    await createTrip(page, '오사카 폰 리사이즈');
    await openDraw(page);
    await addPage(page);

    const canvas = page.getByTestId('draw-canvas');
    const box = (await canvas.boundingBox())!;

    // 사각형 하나 — 손가락으로 그린다.
    await pickTool(page, 'rect');
    await fingerDrag(
      context,
      page,
      { x: box.x + 60, y: box.y + 160 },
      { x: box.x + 180, y: box.y + 260 },
    );
    const element = page.getByTestId('draw-element').first();
    await expect(element).toHaveAttribute('data-kind', 'rect');
    const before = (await element.boundingBox())!;

    // 고르고 오른쪽 아래 핸들을 끈다.
    await pickTool(page, 'select');
    await fingerDrag(
      context,
      page,
      { x: box.x + 60, y: box.y + 210 },
      { x: box.x + 60, y: box.y + 210 },
    );
    await expect(page.getByTestId('draw-handle')).toHaveCount(8);

    const grip = (await page
      .getByTestId('draw-handle')
      .and(page.locator('[data-handle="se"]'))
      .boundingBox())!;
    await fingerDrag(
      context,
      page,
      { x: grip.x + grip.width / 2, y: grip.y + grip.height / 2 },
      { x: box.x + 280, y: box.y + 360 },
    );

    const after = (await element.boundingBox())!;
    expect(after.width).toBeGreaterThan(before.width + 40);

    // **두 손가락은 언제나 팬/줌**이다 — 고른 것이 있어도, 핸들 위에서도.
    const scaleBefore = Number(await canvas.getAttribute('data-scale'));
    await pinch(context, page, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, 80, 220);
    const scaleAfter = Number(await canvas.getAttribute('data-scale'));
    expect(scaleAfter).toBeGreaterThan(scaleBefore * 1.5);
    // 그리고 요소는 늘어난 것 하나 그대로다(핀치가 리사이즈로 새지 않았다).
    await expect(page.getByTestId('draw-element')).toHaveCount(1);
    const afterPinch = (await element.boundingBox())!;
    expect(afterPinch.width).toBeGreaterThan(after.width);

    // 페이지 자체는 확대되지 않았다 (M50-fix2가 데인 자리).
    const fit = await page.evaluate(() => ({
      innerWidth: window.innerWidth,
      visualWidth: window.visualViewport?.width ?? window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(fit.innerWidth).toBe(fit.visualWidth);
    expect(fit.scrollWidth).toBeLessThanOrEqual(fit.innerWidth);
  });
});
