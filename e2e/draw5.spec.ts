import { devices, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

/**
 * 드로우 M53-fix — **테스터 3기가 확정한 결함 다섯**.
 *
 * 이 파일은 새 기능을 지키지 않는다. 사람이 실제로 부딪힌 다섯 자리를 못박는다:
 *
 * 1. **새 페이지가 (0,0) 구석에서 열렸다** — 뷰 기억이 「아직 뷰가 아닌 값」까지
 *    적어 두는 바람에, 크기가 잡힌 뒤의 중앙 정렬이 그 값을 「지난 방문」으로
 *    읽었다. 4000×4000의 왼쪽 위 구석은 아무것도 없는 자리다.
 * 2. **폰에서 잠근 것을 풀 수 없었다** — 해제 경로가 Shift+클릭 하나뿐이라
 *    Shift가 없는 기기에서는 되돌릴 수 없는 상태였다.
 * 3. **글자 도구가 폰에서 아무 반응이 없었다** — pointerdown이 연 시트를
 *    뒤따르는 합성 click이 곧바로 닫았다.
 * 4. **데스크톱 도구 바의 「확대(+)」가 잘렸다** — 둘째 줄 내용이 상자보다 넓었다.
 * 5. **붙인 사진의 진하기를 조절할 손잡이가 없었다** — 배경에만 있었다.
 *
 * 둘·셋은 **폰 컨텍스트**(`devices['Pixel 5']`)에서만 재현된다 — 데스크톱
 * 컨텍스트의 뷰포트를 줄이는 것으로는 합성 click도 터치 탭도 일어나지 않는다
 * (HANDOFF §6-10의 그 교훈).
 */

const PHOTO = fileURLToPath(new URL('./fixtures/photo.png', import.meta.url));

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

/** 지금 캔버스가 보고 있는 자리와 크기 — `viewBox` 한 줄이 전부 말해 준다. */
async function viewOf(
  page: Page,
): Promise<{ x: number; y: number; w: number; h: number }> {
  return page.evaluate(() => {
    const svg = document.querySelector('[data-testid="draw-canvas"]');
    const [x, y, w, h] = (svg?.getAttribute('viewBox') ?? '0 0 0 0').split(' ').map(Number);
    return { x, y, w, h };
  });
}

/* ------------------------------------------------------------------ *
 * 1. 새 페이지는 한가운데에서 열린다 (M53-fix ①)
 * ------------------------------------------------------------------ */

test('새 페이지는 4000×4000의 한가운데에서 열린다 — 첫 장도, 두 번째 장도', async ({
  page,
}) => {
  test.setTimeout(60_000);

  await page.goto('/');
  await createTrip(page, '오사카 첫뷰');
  await openDraw(page);
  const firstId = await addPage(page);

  const first = await viewOf(page);
  // 원점은 「페이지 한가운데에서 화면 절반을 뺀 자리」다 — 그래야 한가운데가
  // 화면 한가운데에 온다. 구석(0,0)은 아무것도 없는 자리다.
  expect(Math.abs(first.x - (DRAW_PAGE_SIZE / 2 - first.w / 2))).toBeLessThan(2);
  expect(Math.abs(first.y - (DRAW_PAGE_SIZE / 2 - first.h / 2))).toBeLessThan(2);

  // 이 페이지를 옮겨 놓는다 — 「지난 방문의 자리」가 생긴다.
  await pickTool(page, 'hand');
  await dragOnCanvas(page, { x: 600, y: 400 }, { x: 400, y: 300 });
  const panned = await viewOf(page);
  expect(panned.x).toBeGreaterThan(first.x + 100);

  // 두 번째 페이지도 한가운데다 — **여기가 회귀가 살던 자리**다. 첫 장의
  // 자리채움 뷰가 서랍에 적혀 있으면 이 장이 (0,0)에서 열린다.
  await page.getByTestId('draw-back').click();
  await addPage(page);
  const second = await viewOf(page);
  expect(Math.abs(second.x - (DRAW_PAGE_SIZE / 2 - second.w / 2))).toBeLessThan(2);
  expect(Math.abs(second.y - (DRAW_PAGE_SIZE / 2 - second.h / 2))).toBeLessThan(2);

  // 그리고 옮겨 놓은 페이지로 돌아오면 **그 자리**다 (M52b의 뷰 기억은 그대로).
  await page.getByTestId('draw-back').click();
  await page
    .locator(`[data-testid="draw-page-card"][data-page-id="${firstId}"]`)
    .getByTestId('draw-page-open')
    .click();
  await expect(page.getByTestId('draw-editor')).toBeVisible();
  const again = await viewOf(page);
  expect(Math.abs(again.x - panned.x)).toBeLessThan(2);
  expect(Math.abs(again.y - panned.y)).toBeLessThan(2);
});

/* ------------------------------------------------------------------ *
 * 4. 도구 바 둘째 줄은 어느 폭에서도 잘리지 않는다 (M53-fix ④)
 * ------------------------------------------------------------------ */

test('도구 바 둘째 줄 — 1280·1024·900 어디서도 「확대」가 잘리지 않는다', async ({
  page,
}) => {
  test.setTimeout(60_000);

  await page.goto('/');
  await createTrip(page, '오사카 도구바');
  await openDraw(page);
  await addPage(page);

  for (const width of [1280, 1024, 900]) {
    await page.setViewportSize({ width, height: 800 });
    // 레이아웃이 새 폭을 잡을 때까지.
    await expect(page.getByTestId('draw-zoom-in')).toBeVisible();
    const measured = await page.evaluate(() => {
      const zoomIn = document.querySelector('[data-testid="draw-zoom-in"]');
      const row = document.querySelector('[data-testid="draw-toolbar-styles"]');
      if (!row || !zoomIn) return null;
      const rowBox = row.getBoundingClientRect();
      const buttonBox = zoomIn.getBoundingClientRect();
      return {
        // 둘째 줄이 자기 상자를 넘지 않는다(가로 스크롤로 숨은 것이 없다).
        overflow: row.scrollWidth - row.clientWidth,
        // 그리고 마지막 버튼이 실제로 그 상자 안에 그려져 있다.
        clipped: Math.max(0, Math.round(buttonBox.right - rowBox.right)),
        offScreen: Math.max(0, Math.round(buttonBox.right - window.innerWidth)),
      };
    });
    expect(measured, `${width}px에서 도구 바를 못 읽었다`).not.toBeNull();
    expect(measured!.overflow, `${width}px: 둘째 줄이 ${measured!.overflow}px 넘쳤다`).toBe(0);
    expect(measured!.clipped, `${width}px: 확대 버튼이 ${measured!.clipped}px 잘렸다`).toBe(0);
    expect(measured!.offScreen, `${width}px: 확대 버튼이 화면 밖이다`).toBe(0);
  }
});

/* ------------------------------------------------------------------ *
 * 5. 붙인 사진의 진하기 (M53-fix ⑤)
 * ------------------------------------------------------------------ */

test('붙인 사진의 진하기 — 슬라이더 한 번이 실행취소 한 걸음', async ({ page }) => {
  test.setTimeout(90_000);

  await page.goto('/');
  await createTrip(page, '오사카 진하기');
  await openDraw(page);
  await addPage(page);

  await page.getByTestId('draw-image-input').setInputFiles(PHOTO);
  const image = page.getByTestId('draw-image');
  await expect(image).toBeVisible({ timeout: 15_000 });
  await expect(image).toHaveAttribute('opacity', '1');

  // 넣은 사진은 이미 골라져 있고, 그 팝오버에 「진하기」 문이 있다.
  await expect(page.getByTestId('draw-selection-bar')).toBeVisible();
  await page.getByTestId('draw-image-opacity-open').click();
  const slider = page.getByTestId('draw-image-opacity');
  await expect(slider).toBeVisible();

  // 슬라이더의 왼쪽 셋째 지점을 누른다 — 누르는 순간 값이 바뀌고, 손을 떼는
  // 순간 실행취소 한 걸음이 남는다.
  const track = (await slider.boundingBox())!;
  await slider.click({ position: { x: track.width * 0.3, y: track.height / 2 } });
  const faded = Number(await image.getAttribute('opacity'));
  expect(faded).toBeLessThan(1);
  // 아래 한계는 0이 아니라 0.2다 — 0까지 내려가는 슬라이더는 「사진이 사라졌다」로 끝난다.
  expect(faded).toBeGreaterThanOrEqual(0.2);
  await expect(page.getByTestId('draw-image-opacity-value')).toHaveText(
    `${Math.round(faded * 100)}%`,
  );

  // Ctrl+Z **한 번**이면 원래 진하기다 — 끄는 동안의 수십 번은 걸음이 아니다.
  await page.getByTestId('sheet-close').click();
  await expect(page.getByTestId('draw-style-sheet')).toHaveCount(0);
  await page.keyboard.press('Control+z');
  await expect(image).toHaveAttribute('opacity', '1');
});

/* ------------------------------------------------------------------ *
 * 2·3. 폰에서만 나는 둘 (M53-fix ②·③)
 * ------------------------------------------------------------------ */

/** `defaultBrowserType`은 새 워커를 강제하므로 뺀다 (`draw4.spec`의 그 규칙). */
const { defaultBrowserType: _pixelBrowser, ...PIXEL_5 } = devices['Pixel 5'];

test.describe('폰 (Pixel 5)', () => {
  test.use(PIXEL_5);

  /** CDP로 진짜 손가락을 흘린다 (`draw4.spec`의 그 패턴) — 탭은 0px 끌기다. */
  async function fingerDrag(
    context: BrowserContext,
    page: Page,
    from: { x: number; y: number },
    to: { x: number; y: number },
    steps = 6,
  ): Promise<void> {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: from.x, y: from.y }],
    });
    for (let i = 1; i <= steps; i += 1) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [
          {
            x: from.x + ((to.x - from.x) * i) / steps,
            y: from.y + ((to.y - from.y) * i) / steps,
          },
        ],
      });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
  }

  const fingerTap = (
    context: BrowserContext,
    page: Page,
    at: { x: number; y: number },
  ): Promise<void> => fingerDrag(context, page, at, at, 1);

  test('잠근 것을 탭하면 「풀기」 한 줄이 뜨고, 그 한 줄이 폰의 Shift+클릭이다', async ({
    page,
    context,
  }) => {
    test.setTimeout(90_000);

    await page.goto('/');
    await createTrip(page, '오사카 폰잠금');
    await openDraw(page);
    await addPage(page);

    const canvas = page.getByTestId('draw-canvas');
    await pickTool(page, 'rect');
    const box = (await canvas.boundingBox())!;
    const corner = { x: box.x + box.width * 0.1, y: box.y + box.height * 0.5 };
    const far = { x: box.x + box.width * 0.5, y: box.y + box.height * 0.75 };
    await fingerDrag(context, page, corner, far);

    // 잠근다 — 이제 이 요소는 손에 안 잡힌다.
    await pickTool(page, 'select');
    await fingerTap(context, page, { x: corner.x, y: (corner.y + far.y) / 2 });
    await expect(page.getByTestId('draw-selection-bar')).toBeVisible();
    await page.getByTestId('draw-lock-selected').click();
    await expect(page.getByTestId('draw-element').first()).toHaveAttribute('data-locked', 'true');

    // 빈 곳을 탭해 선택을 놓는다.
    await fingerTap(context, page, { x: box.x + box.width * 0.85, y: box.y + box.height * 0.9 });
    await expect(page.getByTestId('draw-selection-bar')).toHaveCount(0);

    // 잠긴 것을 탭하면 — 잡히지는 않지만(그것이 잠금이 하는 일이다) 왜 안
    // 잡히는지와 푸는 길이 한 줄로 뜬다.
    await fingerTap(context, page, { x: corner.x, y: (corner.y + far.y) / 2 });
    await expect(page.getByTestId('draw-locked-hint')).toBeVisible();
    await expect(page.getByTestId('draw-selection-bar')).toHaveCount(0);

    // 「풀기」 한 번이면 풀리고, 풀린 것은 곧바로 손에 잡혀 있다.
    await page.getByTestId('draw-locked-unlock').click();
    await expect(page.getByTestId('draw-locked-hint')).toHaveCount(0);
    await expect(page.getByTestId('draw-element').first()).toHaveAttribute('data-locked', 'false');
    await expect(page.getByTestId('draw-selection-bar')).toBeVisible();

    // 그리고 그 한 걸음은 되돌릴 수 있다 — 잠금은 다시 채워진다.
    await expect(page.getByTestId('draw-undo')).toBeEnabled();
    await page.getByTestId('draw-undo').click();
    await expect(page.getByTestId('draw-element').first()).toHaveAttribute('data-locked', 'true');
  });

  test('글자 도구로 캔버스 위쪽을 탭해도 시트가 살아 있다', async ({ page, context }) => {
    test.setTimeout(90_000);

    await page.goto('/');
    await createTrip(page, '오사카 폰글자');
    await openDraw(page);
    await addPage(page);

    await pickTool(page, 'text');
    const box = (await page.getByTestId('draw-canvas').boundingBox())!;
    // 캔버스 위쪽 25% — 시트가 열리는 자리와 손가락이 가장 멀리 떨어진 곳이라,
    // 뒤따르는 합성 click이 오버레이에 떨어지던 바로 그 자리다.
    await fingerTap(context, page, { x: box.x + box.width * 0.5, y: box.y + box.height * 0.25 });

    const sheet = page.getByTestId('draw-text-sheet');
    await expect(sheet).toBeVisible();
    // 열린 채로 남는다 — 합성 click은 이미 지나갔다.
    await page.waitForTimeout(400);
    await expect(sheet).toBeVisible();

    await page.getByTestId('draw-text-input').fill('난바');
    await page.getByTestId('draw-text-submit').click();
    await expect(sheet).toHaveCount(0);
    await expect(page.getByTestId('draw-element')).toHaveCount(1);
    await expect(page.getByTestId('draw-element').first()).toHaveAttribute('data-kind', 'text');
  });
});
