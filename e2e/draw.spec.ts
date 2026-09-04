import { devices, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { startMockApi, type MockApi } from './mock-api';

/**
 * 드로우 탭 (M52a) — 여섯 번째 탭의 스케치북.
 *
 * 이 스펙이 지키는 것은 넷이다.
 *
 * 1. **페이지 살림살이** — 만들기·이름·복제·삭제(실행취소)·순서, 그리고 딥링크.
 * 2. **그리기가 정말 요소를 남긴다** — 마우스로 끈 획이 `draw-element[data-kind]`
 *    하나가 되고, 새로고침해도 살아 있다.
 * 3. **폰의 손가락** — 한 손가락은 그리고 **두 손가락은 팬/줌**이다(페이지가
 *    확대되는 것이 아니라 캔버스의 배율이 바뀐다). Pixel 5 컨텍스트에서 CDP
 *    터치로 확인한다 — 데스크톱 컨텍스트에서는 재현되지 않는 것이 M51의 교훈이다.
 * 4. **탭 줄이 넘치지 않는다** — 여섯 칸이 320/360/384에서 화면을 밀지 않는다.
 *
 * 그리고 마지막 하나: 목 서버를 사이에 둔 **두 기기가 같은 페이지에 동시에**
 * 그리면 두 획이 다 남는다(`sync/merge`의 요소 단위 LWW를 화면 끝에서 확인).
 */

async function createTrip(page: Page, title: string): Promise<void> {
  await page.getByTestId('add-trip').click();
  await page.getByTestId('trip-title-input').fill(title);
  await page.getByTestId('trip-submit').click();
  await expect(page.getByTestId('trip-form')).toHaveCount(0);
  await page.getByTestId('trip-card').filter({ hasText: title }).getByTestId('trip-open').click();
  await expect(page).toHaveURL(/#\/board$/);
}

/** 드로우 탭으로 가서 페이지 목록을 연다. */
async function openDraw(page: Page): Promise<void> {
  await page.getByTestId('tab-draw').click();
  await expect(page).toHaveURL(/#\/draw/);
  await expect(page.getByTestId('view-draw')).toBeVisible();
}

/** 새 페이지를 만들고 편집기가 열릴 때까지 기다린다. */
async function addPage(page: Page): Promise<string> {
  await page.getByTestId('draw-add-page').click();
  const editor = page.getByTestId('draw-editor');
  await expect(editor).toBeVisible();
  return (await editor.getAttribute('data-page-id')) ?? '';
}

/** 편집기에서 목록으로. */
async function backToList(page: Page): Promise<void> {
  await page.getByTestId('draw-back').click();
  await expect(page.getByTestId('draw-page-list')).toBeVisible();
}

/** 캔버스 위에서 마우스로 한 획을 긋는다 (스텝 이동 — M8의 그 규칙). */
async function drawStroke(
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

const pickTool = async (page: Page, tool: string): Promise<void> => {
  await page.getByTestId('draw-tool').and(page.locator(`[data-tool="${tool}"]`)).click();
  await expect(page.getByTestId('draw-canvas')).toHaveAttribute('data-tool', tool);
};

/* ------------------------------------------------------------------ *
 * 1. 페이지 살림살이
 * ------------------------------------------------------------------ */

test('여행을 안 골랐으면 고르는 화면이 뜬다', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('tab-draw').click();

  await expect(page.getByTestId('view-draw')).toBeVisible();
  await expect(page.getByTestId('draw-goto-trips')).toBeVisible();

  await page.getByTestId('draw-goto-trips').click();
  await expect(page).toHaveURL(/#\/trips$/);
});

test('페이지를 만들고 이름을 바꾸고 복제하고 지운다 (실행취소까지)', async ({ page }) => {
  await page.goto('/');
  await createTrip(page, '오사카 드로우');
  await openDraw(page);

  await expect(page.getByTestId('draw-empty')).toBeVisible();
  await addPage(page);
  await expect(page.getByTestId('draw-page-title')).toHaveText('페이지 1');
  await backToList(page);
  await expect(page.getByTestId('draw-page-card')).toHaveCount(1);

  // 이름 바꾸기.
  await page.getByTestId('draw-page-rename').click();
  await page.getByTestId('draw-rename-input').fill('난바 밤');
  await page.getByTestId('draw-rename-submit').click();
  await expect(page.getByTestId('draw-rename-dialog')).toHaveCount(0);
  await expect(page.getByTestId('draw-page-card').first()).toContainText('난바 밤');

  // 복제 — 사본은 원본 **바로 뒤**에 선다.
  await page.getByTestId('draw-page-duplicate').first().click();
  await expect(page.getByTestId('draw-page-card')).toHaveCount(2);
  await expect(page.getByTestId('draw-page-card').nth(1)).toContainText('난바 밤 (복사)');

  // 삭제 + 실행취소.
  await page.getByTestId('draw-page-delete').nth(1).click();
  await expect(page.getByTestId('draw-page-card')).toHaveCount(1);
  const toast = page.getByTestId('undo-toast');
  await expect(toast).toContainText('페이지');
  await page.getByTestId('undo-action').click();
  await expect(page.getByTestId('draw-page-card')).toHaveCount(2);
  await expect(page.getByTestId('draw-page-card').nth(1)).toContainText('난바 밤 (복사)');

  // 순서 바꾸기.
  await page.getByTestId('draw-page-up').nth(1).click();
  await expect(page.getByTestId('draw-page-card').first()).toContainText('난바 밤 (복사)');
});

test('새 페이지의 기본 이름은 「페이지 N」이다', async ({ page }) => {
  await page.goto('/');
  await createTrip(page, '오사카 이름');
  await openDraw(page);

  await addPage(page);
  await backToList(page);
  await addPage(page);
  await expect(page.getByTestId('draw-page-title')).toHaveText('페이지 2');
});

test('딥링크 #/draw/<id>로 그 페이지가 열린다', async ({ page }) => {
  await page.goto('/');
  await createTrip(page, '오사카 링크');
  await openDraw(page);
  const pageId = await addPage(page);

  // 페이지를 열면 주소가 따라온다.
  await expect(page).toHaveURL(new RegExp(`#/draw/${pageId}$`));

  // 그 주소를 다시 열면 그 페이지가 열린다.
  await page.goto(`/#/draw/${pageId}`);
  await expect(page.getByTestId('draw-editor')).toHaveAttribute('data-page-id', pageId);
  await expect(page.getByTestId('draw-page-title')).toHaveText('페이지 1');

  // 없는 페이지를 가리키면 조용히 목록으로 되돌아간다.
  await page.goto('/#/draw/nosuchpage');
  await expect(page.getByTestId('draw-page-list')).toBeVisible();
  await expect(page).toHaveURL(/#\/draw$/);
});

/* ------------------------------------------------------------------ *
 * 2. 그리기
 * ------------------------------------------------------------------ */

test('펜으로 끌면 stroke 요소가 하나 생기고 새로고침해도 남는다', async ({ page }) => {
  await page.goto('/');
  await createTrip(page, '오사카 펜');
  await openDraw(page);
  const pageId = await addPage(page);

  await drawStroke(page, { x: 60, y: 60 }, { x: 200, y: 140 });

  const elements = page.getByTestId('draw-element');
  await expect(elements).toHaveCount(1);
  await expect(elements.first()).toHaveAttribute('data-kind', 'stroke');

  // 새로고침해도 그 획은 그 자리에 있다 (idb에 앉았다).
  await page.goto(`/#/draw/${pageId}`);
  await expect(page.getByTestId('draw-element')).toHaveCount(1);
  await expect(page.getByTestId('draw-element').first()).toHaveAttribute('data-kind', 'stroke');
});

test('형광펜·도형·스티커·글자가 각자 한 요소씩 남는다', async ({ page }) => {
  await page.goto('/');
  await createTrip(page, '오사카 도구');
  await openDraw(page);
  await addPage(page);

  await pickTool(page, 'highlight');
  await drawStroke(page, { x: 60, y: 200 }, { x: 220, y: 200 });

  await pickTool(page, 'rect');
  await drawStroke(page, { x: 60, y: 60 }, { x: 160, y: 120 });

  await pickTool(page, 'arrow');
  await drawStroke(page, { x: 200, y: 60 }, { x: 280, y: 120 });

  // 스티커 — 픽커에서 고르면 도구가 스티커로 바뀐다.
  await page.getByTestId('draw-sticker-open').click();
  await page.getByTestId('draw-sticker-option').and(page.locator('[data-emoji="⭐"]')).click();
  await expect(page.getByTestId('draw-sticker-sheet')).toHaveCount(0);
  await page.getByTestId('draw-canvas').click({ position: { x: 300, y: 200 } });

  // 글자 — 탭한 자리에 시트가 열리고, 넣으면 그 자리에 앉는다.
  await pickTool(page, 'text');
  await page.getByTestId('draw-canvas').click({ position: { x: 120, y: 250 } });
  await page.getByTestId('draw-text-input').fill('여기 어때?');
  await page.getByTestId('draw-text-submit').click();
  await expect(page.getByTestId('draw-text-sheet')).toHaveCount(0);

  const kinds = await page.getByTestId('draw-element').evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('data-kind')),
  );
  expect(kinds).toEqual(['stroke', 'rect', 'arrow', 'sticker', 'text']);
  await expect(page.getByTestId('draw-element').filter({ hasText: '여기 어때?' })).toHaveCount(1);
});

test('선택으로 옮기고 지운다', async ({ page }) => {
  await page.goto('/');
  await createTrip(page, '오사카 선택');
  await openDraw(page);
  await addPage(page);

  await page.getByTestId('draw-sticker-open').click();
  await page.getByTestId('draw-sticker-option').and(page.locator('[data-emoji="📍"]')).click();
  await page.getByTestId('draw-canvas').click({ position: { x: 150, y: 150 } });
  await expect(page.getByTestId('draw-element')).toHaveCount(1);

  const before = await page.getByTestId('draw-element').first().boundingBox();

  await pickTool(page, 'select');
  await drawStroke(page, { x: 150, y: 150 }, { x: 260, y: 210 });
  await expect(page.getByTestId('draw-selection')).toBeVisible();

  const after = await page.getByTestId('draw-element').first().boundingBox();
  expect(after!.x).toBeGreaterThan(before!.x + 50);
  expect(after!.y).toBeGreaterThan(before!.y + 30);

  // 선택한 것을 지운다.
  await page.getByTestId('draw-delete-selected').click();
  await expect(page.getByTestId('draw-element')).toHaveCount(0);
});

test('지우개는 지나간 요소를 지운다', async ({ page }) => {
  await page.goto('/');
  await createTrip(page, '오사카 지우개');
  await openDraw(page);
  await addPage(page);

  await drawStroke(page, { x: 60, y: 100 }, { x: 260, y: 100 });
  await expect(page.getByTestId('draw-element')).toHaveCount(1);

  await pickTool(page, 'eraser');
  await drawStroke(page, { x: 150, y: 90 }, { x: 160, y: 110 });
  await expect(page.getByTestId('draw-element')).toHaveCount(0);
});

test('실행취소와 다시실행 — 획 하나 단위로 되돌아간다', async ({ page }) => {
  await page.goto('/');
  await createTrip(page, '오사카 되돌리기');
  await openDraw(page);
  await addPage(page);

  await drawStroke(page, { x: 60, y: 60 }, { x: 160, y: 60 });
  await drawStroke(page, { x: 60, y: 120 }, { x: 160, y: 120 });
  await expect(page.getByTestId('draw-element')).toHaveCount(2);

  await page.getByTestId('draw-undo').click();
  await expect(page.getByTestId('draw-element')).toHaveCount(1);
  await page.getByTestId('draw-undo').click();
  await expect(page.getByTestId('draw-element')).toHaveCount(0);
  await expect(page.getByTestId('draw-undo')).toBeDisabled();

  await page.getByTestId('draw-redo').click();
  await expect(page.getByTestId('draw-element')).toHaveCount(1);
  await page.getByTestId('draw-redo').click();
  await expect(page.getByTestId('draw-element')).toHaveCount(2);
  await expect(page.getByTestId('draw-redo')).toBeDisabled();
});

test('휠로 확대하면 캔버스만 커진다 — 페이지는 그대로다', async ({ page }) => {
  await page.goto('/');
  await createTrip(page, '오사카 줌');
  await openDraw(page);
  await addPage(page);

  const canvas = page.getByTestId('draw-canvas');
  await expect(canvas).toHaveAttribute('data-scale', '1.000');

  await page.getByTestId('draw-zoom-in').click();
  const zoomed = Number(await canvas.getAttribute('data-scale'));
  expect(zoomed).toBeGreaterThan(1);

  // 그리고 문서는 한 뼘도 넓어지지 않았다 (M51의 그 규칙).
  const fit = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(fit.scrollWidth).toBeLessThanOrEqual(fit.innerWidth);
});

/* ------------------------------------------------------------------ *
 * 3. 폰 — 한 손가락은 그리고 두 손가락은 팬/줌
 * ------------------------------------------------------------------ */

/**
 * `defaultBrowserType`만 걷어 낸 Pixel 5.
 *
 * `test.use`를 describe 안에서 쓸 때 그 키가 들어 있으면 Playwright가 「워커를
 * 새로 띄우라는 뜻이냐」며 거절한다 — 우리 프로젝트는 어차피 chromium 하나이므로
 * 그 한 줄만 빼면 나머지(`isMobile`·`hasTouch`·뷰포트)가 그대로 산다. **그
 * `isMobile: true`가 이 묶음의 전부다**: 데스크톱 컨텍스트의 Chromium은 뷰포트를
 * 320px로 줄여도 폰이 아니다 (M51, HANDOFF §6-10).
 */
const { defaultBrowserType: _pixelBrowser, ...PIXEL_5 } = devices['Pixel 5'];

test.describe('폰 (Pixel 5)', () => {
  test.use(PIXEL_5);

  /** CDP로 손가락 두 개를 실제로 올린다 — Playwright의 touchscreen은 한 개뿐이다. */
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
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: points(from),
    });
    const steps = 5;
    for (let i = 1; i <= steps; i += 1) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: points(from + ((to - from) * i) / steps),
      });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
  }

  test('한 손가락은 그리고, 두 손가락은 팬/줌이다', async ({ page, context }) => {
    await page.goto('/');
    await createTrip(page, '오사카 폰');
    await openDraw(page);
    await addPage(page);

    const canvas = page.getByTestId('draw-canvas');
    const box = (await canvas.boundingBox())!;

    // ① 한 손가락 = 그리기.
    const cdp = await context.newCDPSession(page);
    const finger = (x: number, y: number) => [{ x, y, id: 1 }];
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: finger(box.x + 40, box.y + 40),
    });
    for (let i = 1; i <= 6; i += 1) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: finger(box.x + 40 + i * 15, box.y + 40 + i * 10),
      });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();

    await expect(page.getByTestId('draw-element')).toHaveCount(1);
    await expect(page.getByTestId('draw-element').first()).toHaveAttribute('data-kind', 'stroke');

    // ② 두 손가락을 벌리면 캔버스가 확대된다 — 요소는 그대로 하나다.
    const before = Number(await canvas.getAttribute('data-scale'));
    await pinch(
      context,
      page,
      { x: box.x + box.width / 2, y: box.y + box.height / 2 },
      80,
      220,
    );
    const after = Number(await canvas.getAttribute('data-scale'));
    expect(after).toBeGreaterThan(before * 1.5);
    await expect(page.getByTestId('draw-element')).toHaveCount(1);

    // ③ 그리고 **페이지 자체는** 확대되지 않았다 — M50-fix2가 데인 자리다.
    const fit = await page.evaluate(() => ({
      innerWidth: window.innerWidth,
      visualWidth: window.visualViewport?.width ?? window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(fit.innerWidth).toBe(fit.visualWidth);
    expect(fit.scrollWidth).toBeLessThanOrEqual(fit.innerWidth);
  });

  for (const width of [320, 360, 384]) {
    test(`${width}px — 탭 여섯 칸이 화면을 넘지 않는다`, async ({ page }) => {
      await page.setViewportSize({ width, height: 720 });
      await page.goto('/');
      await createTrip(page, '오사카 탭바');
      await openDraw(page);

      const fit = await page.evaluate(() => ({
        innerWidth: window.innerWidth,
        visualWidth: window.visualViewport?.width ?? window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }));
      expect(fit.innerWidth, `${width}px: 레이아웃 뷰포트가 늘어났다`).toBe(fit.visualWidth);
      expect(fit.scrollWidth, `${width}px: 문서가 가로로 넘친다`).toBeLessThanOrEqual(
        fit.innerWidth,
      );

      const tabs = page.getByTestId('tab-bar').getByRole('tab');
      await expect(tabs).toHaveCount(6);
      // 여섯 칸 전부가 화면 안에서 끝난다.
      for (let i = 0; i < 6; i += 1) {
        const cell = await tabs.nth(i).boundingBox();
        expect(cell!.x + cell!.width, `${width}px: ${i}번째 탭이 화면을 넘는다`).toBeLessThanOrEqual(
          fit.visualWidth + 1,
        );
      }

      // 그리고 편집기를 열어도 도구 바가 화면을 밀지 않고, **탭 바 바로 위**에
      // 화면 안에 선다 (`.tb-vp-bottom` + `--tb-vp-bottom-offset`, M51의 그 규칙).
      await addPage(page);
      const after = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(after, `${width}px: 도구 바가 화면을 넘친다`).toBeLessThanOrEqual(fit.innerWidth);

      const toolbar = page.getByTestId('draw-toolbar');
      await expect(toolbar).toBeVisible();
      const bar = await toolbar.boundingBox();
      const tabBox = await page.getByTestId('tab-bar').boundingBox();
      expect(bar, `${width}px: 도구 바가 없다`).not.toBeNull();
      expect(bar!.x, `${width}px: 도구 바가 왼쪽 밖에 있다`).toBeGreaterThanOrEqual(-1);
      expect(
        bar!.x + bar!.width,
        `${width}px: 도구 바가 오른쪽으로 나갔다`,
      ).toBeLessThanOrEqual(fit.visualWidth + 1);
      expect(
        bar!.y + bar!.height,
        `${width}px: 도구 바가 탭 바를 덮는다`,
      ).toBeLessThanOrEqual(tabBox!.y + 1);

      // 도구를 실제로 누를 수 있다 — 보이는 것과 닿는 것은 다른 질문이다.
      await page.getByTestId('draw-tool').and(page.locator('[data-tool="eraser"]')).click();
      await expect(page.getByTestId('draw-canvas')).toHaveAttribute('data-tool', 'eraser');
    });
  }
});

/* ------------------------------------------------------------------ *
 * 4. 두 기기가 같은 페이지에 동시에
 * ------------------------------------------------------------------ */

test.describe('두 기기 병합', () => {
  let api: MockApi;

  test.beforeAll(async () => {
    api = await startMockApi();
  });

  test.afterAll(async () => {
    await api.stop();
  });

  async function configureSync(page: Page): Promise<void> {
    await page.getByTestId('sync-chip').click();
    await expect(page.getByTestId('sync-settings')).toBeVisible();
    await page.getByTestId('sync-base-url').fill(api.baseUrl);
    await page.getByTestId('sync-token').fill(api.token);
    await page.getByTestId('sync-save').click();
    await expect(page.getByTestId('sync-notice')).toHaveText('저장했어요');
    await page.getByTestId('sheet-close').click();
    await expect(page.getByTestId('sync-settings')).toHaveCount(0);
  }

  async function syncNow(page: Page): Promise<void> {
    await page.getByTestId('sync-chip').click();
    await expect(page.getByTestId('sync-settings')).toBeVisible();
    await page.getByTestId('sync-now').click();
    await expect(page.getByTestId('sync-notice')).toHaveText('동기화했어요');
    await page.getByTestId('sheet-close').click();
    await expect(page.getByTestId('sync-settings')).toHaveCount(0);
  }

  /** 활성 여행이 기기마다 따로이므로, 두 번째 기기는 앱 안에서 걸어 들어간다. */
  async function openPageInApp(page: Page, tripTitle: string): Promise<void> {
    await page.getByTestId('tab-trips').click();
    await page.getByTestId('trip-card').filter({ hasText: tripTitle }).getByTestId('trip-open').click();
    await openDraw(page);
    await page.getByTestId('draw-page-open').first().click();
    await expect(page.getByTestId('draw-editor')).toBeVisible();
  }

  test('둘이 같은 페이지에 그리면 두 획이 다 남는다', async ({ browser }) => {
    api.reset();

    const one = await browser.newContext();
    const two = await browser.newContext();
    const a = await one.newPage();
    const b = await two.newPage();

    try {
      await a.goto('/');
      await expect(a.getByTestId('tab-bar')).toBeVisible();
      await createTrip(a, '오사카 합치기');
      await openDraw(a);
      await addPage(a);
      await drawStroke(a, { x: 60, y: 60 }, { x: 180, y: 60 });
      await expect(a.getByTestId('draw-element')).toHaveCount(1);

      await configureSync(a);
      await expect.poll(() => api.version(), { timeout: 25_000 }).toBeGreaterThanOrEqual(1);

      // B가 같은 워크스페이스를 받아 같은 페이지를 연다 — 새로고침이 아니라
      // 앱 안에서 걸어 들어간다(활성 여행은 기기별이다).
      await b.goto('/');
      await expect(b.getByTestId('tab-bar')).toBeVisible();
      await configureSync(b);
      await openPageInApp(b, '오사카 합치기');
      await expect(b.getByTestId('draw-element')).toHaveCount(1);

      // 둘이 각자 한 획씩 더 긋는다 — 서로의 것을 모르는 채로.
      await drawStroke(a, { x: 60, y: 140 }, { x: 180, y: 140 });
      await drawStroke(b, { x: 60, y: 200 }, { x: 180, y: 200 });
      await expect(a.getByTestId('draw-element')).toHaveCount(2);
      await expect(b.getByTestId('draw-element')).toHaveCount(2);

      // 그리고 합친다. 늦게 올린 쪽이 먼저 올린 쪽을 덮지 않는다.
      await syncNow(a);
      await syncNow(b);
      await syncNow(a);

      await expect(a.getByTestId('draw-element')).toHaveCount(3);
      await expect(b.getByTestId('draw-element')).toHaveCount(3);
    } finally {
      await one.close();
      await two.close();
    }
  });
});
