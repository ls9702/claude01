import { devices, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * 드로우 4회차 (M53-2) — **사진과 색**.
 *
 * `draw3.spec`이 「고르고 만지는 손」을 지킨다면 이 스펙은 그 손이 다루는 물건들을
 * 지킨다:
 *
 * 1. **붙인 사진** — 요소가 되고, 커지고, PNG에 담기고, **GC 두 번을 넘고**,
 *    사진 포함 백업으로 왕복한다. (빠뜨리면 30초 뒤에 사진이 사라진다.)
 * 2. **컬러 보드** — 41색 팔레트·최근 색·직접 고른 색이 고른 것에 칠해진다.
 * 3. **채우기·점선·양쪽 화살표** — 「고른 게 없으면 다음에 그릴 것, 있으면 그것」.
 * 4. **종이와 스냅** — 무늬는 페이지에 저장되고, 스냅은 이 기기의 손버릇이다.
 * 5. **잠금** — 잠긴 것은 잡히지 않고 Shift+클릭으로만 풀린다.
 * 6. **지우개 크기** — 굵기 선택이 지우개에서는 크기로 읽힌다.
 * 7. **폰** — 손가락으로 사진을 넣고 옮긴다.
 */

const PHOTO = fileURLToPath(new URL('./fixtures/photo.png', import.meta.url));
const PHOTO_B64 = readFileSync(PHOTO).toString('base64');

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

const pickTool = async (page: Page, tool: string): Promise<void> => {
  await page.getByTestId('draw-tool').and(page.locator(`[data-tool="${tool}"]`)).click();
  await expect(page.getByTestId('draw-canvas')).toHaveAttribute('data-tool', tool);
};

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

/** 도구 바의 「사진」 버튼으로 한 장 넣는다 — 붙여넣기·드롭과 같은 문을 지난다. */
async function addImage(page: Page): Promise<void> {
  const before = await page.getByTestId('draw-element').count();
  await page.getByTestId('draw-image-input').setInputFiles(PHOTO);
  await expect(page.getByTestId('draw-element')).toHaveCount(before + 1, { timeout: 15_000 });
  await expect(page.getByTestId('draw-image').last()).toBeVisible({ timeout: 15_000 });
}

/** PNG 파일의 IHDR에서 크기를 읽는다 — 내보낸 그림이 무엇을 감쌌는지의 증거다. */
function pngSize(buffer: Buffer): { w: number; h: number } {
  return { w: buffer.readUInt32BE(16), h: buffer.readUInt32BE(20) };
}

/* ------------------------------------------------------------------ *
 * 1. 붙인 사진 — 요소가 되고, 커지고, 파일에 담기고, GC를 넘는다
 * ------------------------------------------------------------------ */

test('사진을 넣으면 요소가 되고, 키우고, PNG에 담기고, GC 두 번을 넘는다', async ({ page }) => {
  test.setTimeout(90_000);

  await page.goto('/');
  await createTrip(page, '오사카 사진요소');
  await openDraw(page);
  const pageId = await addPage(page);

  await addImage(page);

  // 요소 하나다 — 배경이 아니라 **요소**다(배경은 그대로 없다).
  const element = page.getByTestId('draw-element').first();
  await expect(element).toHaveAttribute('data-kind', 'image');
  await expect(page.getByTestId('draw-canvas')).toHaveAttribute('data-background', 'false');
  // 넣자마자 손에 잡힌다 — 그러려고 넣었다.
  await expect(page.getByTestId('draw-canvas')).toHaveAttribute('data-tool', 'select');
  await expect(page.getByTestId('draw-handle')).toHaveCount(8);
  // PNG가 바이트를 갈아 끼울 때 보는 그 속성.
  await expect(page.getByTestId('draw-image')).toHaveAttribute('data-photo-id', /.+/);

  // ① 리사이즈 — 도형과 같은 여덟 핸들, 비균등도 된다.
  const before = (await element.boundingBox())!;
  const grip = (await page
    .getByTestId('draw-handle')
    .and(page.locator('[data-handle="se"]'))
    .boundingBox())!;
  const canvas = (await page.getByTestId('draw-canvas').boundingBox())!;
  await dragOnCanvas(
    page,
    { x: grip.x + grip.width / 2 - canvas.x, y: grip.y + grip.height / 2 - canvas.y },
    { x: grip.x + grip.width / 2 - canvas.x + 120, y: grip.y + grip.height / 2 - canvas.y + 60 },
  );
  const after = (await element.boundingBox())!;
  expect(after.width).toBeGreaterThan(before.width + 60);

  // ② PNG — 내보낸 그림의 크기가 「사진 + 여백 40 두 겹」의 2배다. 사진이 경계에
  //    들지 않았으면 이 숫자가 나올 수 없다.
  const w = Number(await page.getByTestId('draw-image').getAttribute('width'));
  const h = Number(await page.getByTestId('draw-image').getAttribute('height'));
  const downloading = page.waitForEvent('download');
  await page.getByTestId('draw-menu').click();
  await page.getByTestId('draw-png').click();
  const download = await downloading;
  const file = await download.path();
  expect(file).toBeTruthy();
  const size = pngSize(readFileSync(file!));
  expect(size.w).toBe(Math.round((w + 80) * 2));
  expect(size.h).toBe(Math.round((h + 80) * 2));

  // ③ **GC 두 번** — 요소가 「참조」로 인정되지 않으면 여기서 바이트가 지워진다.
  const swept = await page.evaluate(async () => {
    const sweep = (window as unknown as { __tripBoardSweepPhotos: () => Promise<string[]> })
      .__tripBoardSweepPhotos;
    const first = await sweep();
    const second = await sweep();
    return [...first, ...second];
  });
  expect(swept, '붙인 사진이 GC에 쓸려 갔다').toEqual([]);

  // ④ 새로고침을 넘는다 — 바이트는 워크스페이스 밖에 산다.
  await page.goto(`/#/draw/${pageId}`);
  await expect(page.getByTestId('draw-image')).toBeVisible({ timeout: 15_000 });
});

test('복사한 사진은 같은 바이트를 나눠 쓰고, 원본을 지워도 살아남는다', async ({ page }) => {
  test.setTimeout(90_000);

  await page.goto('/');
  await createTrip(page, '오사카 사진복사');
  await openDraw(page);
  await addPage(page);
  await addImage(page);

  // 붙인 사진이 선택된 채다 — 복제 버튼 하나가 폰의 Ctrl+D다.
  await page.getByTestId('draw-duplicate-selected').click();
  await expect(page.getByTestId('draw-element')).toHaveCount(2);

  const ids = await page.getByTestId('draw-image').evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('data-photo-id')),
  );
  expect(ids[0]).toBe(ids[1]);

  // 방금 붙인 사본이 선택된 채다 — 하나를 지운다. 남은 하나가 같은 바이트를
  // 가리키므로 GC는 여전히 아무것도 쓸지 않아야 한다(둘이 나눠 쓰는 블롭 하나).
  await page.keyboard.press('Delete');
  await expect(page.getByTestId('draw-element')).toHaveCount(1);

  const swept = await page.evaluate(async () => {
    const sweep = (window as unknown as { __tripBoardSweepPhotos: () => Promise<string[]> })
      .__tripBoardSweepPhotos;
    const first = await sweep();
    const second = await sweep();
    return [...first, ...second];
  });
  expect(swept).toEqual([]);
  await expect(page.getByTestId('draw-image')).toHaveCount(1);

  // 지운 것도 실행취소 한 번이면 사진째 돌아온다 — 바이트가 아직 있기 때문이다.
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('draw-image')).toHaveCount(2, { timeout: 15_000 });
});

test('붙여넣기와 캔버스 드롭도 같은 문을 지난다', async ({ page }) => {
  test.setTimeout(60_000);

  await page.goto('/');
  await createTrip(page, '오사카 붙여넣기');
  await openDraw(page);
  await addPage(page);

  // ① 붙여넣기 (데스크톱) — 배경 시트가 닫혀 있으면 **요소**로 들어간다.
  await page.evaluate(async (b64) => {
    const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
    const data = new DataTransfer();
    data.items.add(new File([blob], 'paste.png', { type: 'image/png' }));
    window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }));
  }, PHOTO_B64);
  await expect(page.getByTestId('draw-element')).toHaveCount(1, { timeout: 15_000 });
  await expect(page.getByTestId('draw-element').first()).toHaveAttribute('data-kind', 'image');

  // ② 드롭 — 막지 않으면 브라우저가 그 파일을 탭에서 열어 버리는 자리다.
  const dropped = await page.evaluateHandle(async (b64) => {
    const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
    const data = new DataTransfer();
    data.items.add(new File([blob], 'drop.png', { type: 'image/png' }));
    return data;
  }, PHOTO_B64);
  await page.getByTestId('draw-canvas').dispatchEvent('drop', { dataTransfer: dropped });
  await expect(page.getByTestId('draw-element')).toHaveCount(2, { timeout: 15_000 });
  await expect(page).toHaveURL(/#\/draw\/.+/);
});

test('사진 포함 백업이 붙인 사진까지 싣고, 지운 여행을 그림째 되살린다', async ({ page }) => {
  test.setTimeout(120_000);

  await page.goto('/');
  await expect(page.getByTestId('tab-bar')).toBeVisible();
  await createTrip(page, '오키나와 그림백업');
  await openDraw(page);
  await addPage(page);
  await addImage(page);
  await page.getByTestId('draw-back').click();

  // --- 사진 포함 내보내기 ---------------------------------------------
  await page.getByTestId('sync-chip').click();
  await expect(page.getByTestId('sync-settings')).toBeVisible();
  const downloading = page.waitForEvent('download');
  await page.getByTestId('sync-export-photos').click();
  const download = await downloading;
  const backupPath = await download.path();
  // 「사진 0장」이면 요소의 photoId가 백업의 참조 수집에서 빠진 것이다.
  await expect(page.getByTestId('sync-notice')).toContainText('사진 1장');
  await page.getByTestId('sheet-close').click();

  // --- 여행 삭제 -------------------------------------------------------
  await page.getByTestId('tab-trips').click();
  await page
    .getByTestId('trip-card')
    .filter({ hasText: '오키나와 그림백업' })
    .getByTestId('trip-delete')
    .click();
  await page.getByTestId('confirm-accept').click();
  await expect(page.getByTestId('trips-empty')).toBeVisible();
  await expect(page.getByTestId('undo-toast')).toHaveCount(0, { timeout: 15_000 });

  // --- 가져오기 --------------------------------------------------------
  await page.getByTestId('sync-chip').click();
  await expect(page.getByTestId('sync-settings')).toBeVisible();
  await page.getByTestId('sync-import-input').setInputFiles(backupPath!);
  const ask = page.getByTestId('import-restore-confirm');
  if (await ask.isVisible().catch(() => false)) {
    await page.getByTestId('confirm-accept').click();
  }
  // `photos.spec`이 그러듯 30초를 준다 — 사진 blob upsert까지 포함한 가져오기다.
  await expect(page.getByTestId('sync-notice')).toContainText('가져왔어요 — 여행 1개', {
    timeout: 30_000,
  });
  await page.getByTestId('sheet-close').click();

  // --- 그림 안의 사진까지 돌아왔다 --------------------------------------
  const restored = page.getByTestId('trip-card').filter({ hasText: '오키나와 그림백업' });
  await expect(restored).toHaveCount(1);
  await restored.getByTestId('trip-open').click();
  await openDraw(page);
  await page.getByTestId('draw-page-open').first().click();
  await expect(page.getByTestId('draw-image')).toBeVisible({ timeout: 30_000 });
});

/* ------------------------------------------------------------------ *
 * 2. 컬러 보드 (C)
 * ------------------------------------------------------------------ */

test('색 시트 — 팔레트와 직접 고른 색이 고른 것에 칠해지고, 최근 색에 남는다', async ({
  page,
}) => {
  await page.goto('/');
  await createTrip(page, '오사카 컬러보드');
  await openDraw(page);
  await addPage(page);

  await dragOnCanvas(page, { x: 80, y: 240 }, { x: 260, y: 240 });
  const ink = page.getByTestId('draw-element').first().locator('path, polyline').first();

  await pickTool(page, 'select');
  await page.getByTestId('draw-canvas').click({ position: { x: 170, y: 240 } });

  // ① 팔레트 41색 — 도구 바의 여섯 뒤에 있는 서랍이다.
  await page.getByTestId('draw-color-more').click();
  await expect(page.getByTestId('draw-color-sheet')).toBeVisible();
  await expect(page.getByTestId('draw-palette-color')).toHaveCount(41);
  await page.getByTestId('draw-palette-color').and(page.locator('[data-color="#a844b3"]')).click();
  await expect(ink).toHaveAttribute('stroke', '#a844b3');

  // ② 직접 고르기 — 값은 소문자 `#rrggbb`로 정규화되어 저장된다.
  await page.getByTestId('draw-custom-color').evaluate((node) => {
    const input = node as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, '#FF00AA');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(ink).toHaveAttribute('stroke', '#ff00aa');

  // ③ 최근 색에 둘 다 남았다 — 같은 색이 두 벌로 세어지지 않는다.
  await expect(page.getByTestId('draw-recent-color')).toHaveCount(2);
  await page.getByTestId('draw-recent-color').and(page.locator('[data-color="#a844b3"]')).click();
  await expect(ink).toHaveAttribute('stroke', '#a844b3');
  await expect(page.getByTestId('draw-recent-color')).toHaveCount(2);

  await page.getByTestId('sheet-close').click();

  // ④ 고른 게 없으면 **다음에 그릴 것**의 색이다 (규칙 하나).
  await page.keyboard.press('Escape');
  await pickTool(page, 'pen');
  await dragOnCanvas(page, { x: 80, y: 300 }, { x: 260, y: 300 });
  const second = page.getByTestId('draw-element').nth(1).locator('path').first();
  await expect(second).toHaveAttribute('stroke', '#a844b3');
});

test('채우기 — 도형에 색을 채우고 「없음」으로 되돌린다', async ({ page }) => {
  await page.goto('/');
  await createTrip(page, '오사카 채우기');
  await openDraw(page);
  await addPage(page);

  await pickTool(page, 'rect');
  await dragOnCanvas(page, { x: 80, y: 200 }, { x: 240, y: 300 });
  const shape = page.getByTestId('draw-element').first().locator('rect').first();
  await expect(shape).toHaveAttribute('fill', 'none');

  await pickTool(page, 'select');
  await page.getByTestId('draw-canvas').click({ position: { x: 80, y: 250 } });

  await page.getByTestId('draw-style-open').click();
  await expect(page.getByTestId('draw-style-sheet')).toBeVisible();
  await page.getByTestId('draw-fill-color').and(page.locator('[data-color="#2f9e5f"]')).click();
  await expect(shape).toHaveAttribute('fill', '#2f9e5f');

  // 41색 서랍으로 넘어가면 스타일 시트는 닫힌다 — 폰에서 시트 둘을 겹쳐 쌓으면
  // 「닫기」를 두 번 눌러야 한다.
  await page.getByTestId('draw-fill-more').click();
  await expect(page.getByTestId('draw-style-sheet')).toHaveCount(0);
  await expect(page.getByTestId('draw-color-sheet')).toBeVisible();
  await page.getByTestId('draw-palette-color').and(page.locator('[data-color="#8f2b2b"]')).click();
  await expect(shape).toHaveAttribute('fill', '#8f2b2b');

  // 「채우기 없음」으로 되돌린다(같은 시트 안에서).
  await page.getByTestId('draw-fill-none').click();
  await expect(shape).toHaveAttribute('fill', 'none');
  await page.getByTestId('sheet-close').click();
});

test('점선과 양쪽 화살표 — 다음에 그릴 것에도, 이미 고른 것에도', async ({ page }) => {
  await page.goto('/');
  await createTrip(page, '오사카 선모양');
  await openDraw(page);
  await addPage(page);

  // ① 먼저 켜 두면 **다음에 그릴 것**이 그렇게 나온다.
  await page.getByTestId('draw-style-open').click();
  await page.getByTestId('draw-dash').click();
  await page.getByTestId('draw-heads').click();
  await page.getByTestId('sheet-close').click();

  await pickTool(page, 'arrow');
  await dragOnCanvas(page, { x: 80, y: 220 }, { x: 280, y: 220 });
  const arrow = page.getByTestId('draw-element').first();
  await expect(arrow.locator('line')).toHaveAttribute('stroke-dasharray', /\d/);
  // 촉이 둘이다 — 「가는 길과 오는 길」.
  await expect(arrow.locator('polyline')).toHaveCount(2);
  // 촉 자신은 점선이 아니다(끊긴 촉은 촉으로 보이지 않는다).
  await expect(arrow.locator('[data-head="end"]')).not.toHaveAttribute('stroke-dasharray', /.+/);

  // ② 꺼 두고 그린 뒤, 고른 것에 나중에 얹어도 같은 결과다.
  await page.getByTestId('draw-style-open').click();
  await page.getByTestId('draw-dash').click();
  await page.getByTestId('draw-heads').click();
  await page.getByTestId('sheet-close').click();

  await pickTool(page, 'line');
  await dragOnCanvas(page, { x: 80, y: 300 }, { x: 280, y: 300 });
  const straight = page.getByTestId('draw-element').nth(1).locator('line');
  await expect(straight).not.toHaveAttribute('stroke-dasharray', /.+/);

  await pickTool(page, 'select');
  await page.getByTestId('draw-canvas').click({ position: { x: 180, y: 300 } });
  await page.getByTestId('draw-style-open').click();
  await page.getByTestId('draw-dash').click();
  await page.getByTestId('sheet-close').click();
  await expect(straight).toHaveAttribute('stroke-dasharray', /\d/);
});

/* ------------------------------------------------------------------ *
 * 3. 종이 · 스냅 · 잠금 · 지우개
 * ------------------------------------------------------------------ */

test('종이 무늬는 페이지에 저장되고, 스냅은 8px 격자에 붙인다', async ({ page }) => {
  await page.goto('/');
  await createTrip(page, '오사카 종이');
  await openDraw(page);
  const pageId = await addPage(page);

  // ① 종이 — 페이지의 껍데기라 새로고침을 넘는다.
  await expect(page.getByTestId('draw-paper')).toHaveCount(0);
  await page.getByTestId('draw-menu').click();
  await page.getByTestId('draw-paper-open').click();
  await page.getByTestId('draw-paper-option').and(page.locator('[data-paper="grid"]')).click();
  await expect(page.getByTestId('draw-paper')).toHaveAttribute('data-paper', 'grid');
  await page.getByTestId('sheet-close').click();

  await page.goto(`/#/draw/${pageId}`);
  await expect(page.getByTestId('draw-paper')).toHaveAttribute('data-paper', 'grid');

  // ② 스냅 — 도형의 좌표가 8의 배수로 떨어진다.
  await page.getByTestId('draw-snap').click();
  await expect(page.getByTestId('draw-snap')).toHaveAttribute('data-active', 'true');

  await pickTool(page, 'rect');
  await dragOnCanvas(page, { x: 83, y: 205 }, { x: 246, y: 307 });
  const box = page.getByTestId('draw-element').first().locator('rect').first();
  for (const attr of ['x', 'y', 'width', 'height']) {
    const value = Number(await box.getAttribute(attr));
    expect(value % 8, `${attr}=${value}가 격자에 붙지 않았다`).toBe(0);
  }
});

test('잠근 것은 잡히지 않고, Shift+클릭으로만 다시 골라 풀 수 있다', async ({ page }) => {
  test.setTimeout(60_000);

  await page.goto('/');
  await createTrip(page, '오사카 잠금');
  await openDraw(page);
  await addPage(page);

  await pickTool(page, 'rect');
  await dragOnCanvas(page, { x: 80, y: 180 }, { x: 300, y: 340 });
  await pickTool(page, 'select');
  await page.getByTestId('draw-canvas').click({ position: { x: 80, y: 260 } });
  await expect(page.getByTestId('draw-selection-bar')).toBeVisible();

  // 잠근다 — 화면에서 달라 보이지는 않는다.
  await page.getByTestId('draw-lock-selected').click();
  await expect(page.getByTestId('draw-element').first()).toHaveAttribute('data-locked', 'true');
  await page.keyboard.press('Escape');

  // ① 평범한 클릭으로는 잡히지 않는다.
  await page.getByTestId('draw-canvas').click({ position: { x: 80, y: 260 } });
  await expect(page.getByTestId('draw-selection-bar')).toHaveCount(0);

  // ② 지우개도 그것을 못 지운다.
  await pickTool(page, 'eraser');
  await page.getByTestId('draw-canvas').click({ position: { x: 80, y: 260 } });
  await expect(page.getByTestId('draw-element')).toHaveCount(1);

  // ③ Shift+클릭만이 그것을 본다 — 그래서 다시 풀 수 있다.
  await pickTool(page, 'select');
  await page.getByTestId('draw-canvas').click({ position: { x: 80, y: 260 }, modifiers: ['Shift'] });
  await expect(page.getByTestId('draw-selection-bar')).toBeVisible();
  await expect(page.getByTestId('draw-lock-selected')).toHaveAttribute('data-locked', 'true');
  await page.getByTestId('draw-lock-selected').click();
  await expect(page.getByTestId('draw-element').first()).toHaveAttribute('data-locked', 'false');

  // 풀린 것은 다시 평범하게 잡힌다.
  await page.keyboard.press('Escape');
  await page.getByTestId('draw-canvas').click({ position: { x: 80, y: 260 } });
  await expect(page.getByTestId('draw-selection-bar')).toBeVisible();
});

test('지우개 크기 — 굵기 세 단이 지우개에서는 크기로 읽힌다', async ({ page }) => {
  await page.goto('/');
  await createTrip(page, '오사카 지우개');
  await openDraw(page);
  await addPage(page);

  await dragOnCanvas(page, { x: 80, y: 240 }, { x: 280, y: 240 });
  await expect(page.getByTestId('draw-element')).toHaveCount(1);

  // 지우개를 고르면 굵기 칩이 「지우개 크기」로 바뀐다 — 값은 하나뿐이다.
  await pickTool(page, 'eraser');
  await expect(page.getByTestId('draw-eraser-size')).toHaveCount(3);
  await expect(page.getByTestId('draw-width')).toHaveCount(0);

  // 「작게」로는 획에서 24px 떨어진 자리가 안 닿는다.
  await page.getByTestId('draw-eraser-size').and(page.locator('[data-width="2"]')).click();
  await page.getByTestId('draw-canvas').click({ position: { x: 180, y: 264 } });
  await expect(page.getByTestId('draw-element')).toHaveCount(1);

  // 「크게」로는 같은 자리가 닿는다 — 폰에서 실제로 불편했던 지점이다.
  await page.getByTestId('draw-eraser-size').and(page.locator('[data-width="8"]')).click();
  await page.getByTestId('draw-canvas').click({ position: { x: 180, y: 264 } });
  await expect(page.getByTestId('draw-element')).toHaveCount(0);

  // 다른 도구로 돌아오면 같은 값이 다시 굵기다.
  await pickTool(page, 'pen');
  await expect(page.getByTestId('draw-width').and(page.locator('[data-width="8"]'))).toHaveAttribute(
    'data-active',
    'true',
  );
});

/* ------------------------------------------------------------------ *
 * 4. 폰 (Pixel 5) — 실기에서만 드러나는 자리 (M51의 교훈)
 * ------------------------------------------------------------------ */

/** `defaultBrowserType`은 새 워커를 강제하므로 뺀다 (`draw3.spec`의 그 규칙). */
const { defaultBrowserType: _pixelBrowser, ...PIXEL_5 } = devices['Pixel 5'];

test.describe('폰 (Pixel 5)', () => {
  test.use(PIXEL_5);

  /** CDP로 진짜 터치를 흘린다 (`draw3.spec`의 그 패턴). */
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

  test('사진을 넣고 손가락으로 옮긴다 — 도구 바가 화면을 넘지 않는다', async ({
    page,
    context,
  }) => {
    test.setTimeout(90_000);

    await page.goto('/');
    await createTrip(page, '오사카 폰사진');
    await openDraw(page);
    await addPage(page);
    await addImage(page);

    const image = page.getByTestId('draw-element').first();
    await expect(image).toHaveAttribute('data-kind', 'image');
    const before = (await image.boundingBox())!;

    // 넣은 사진은 이미 선택돼 있다 — 그 위를 손가락으로 끌면 따라온다.
    await fingerDrag(
      context,
      page,
      { x: before.x + before.width / 2, y: before.y + before.height / 2 },
      { x: before.x + before.width / 2 - 60, y: before.y + before.height / 2 - 40 },
    );
    const after = (await image.boundingBox())!;
    expect(Math.abs(after.x - (before.x - 60))).toBeLessThan(12);

    // 폰에서 도구 바가 가로로 넘치지 않는다 (M51의 그 규칙 — 줄마다 가로 스크롤).
    const fit = await page.evaluate(() => ({
      innerWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(fit.scrollWidth).toBeLessThanOrEqual(fit.innerWidth);
  });

  test('폰에서도 색 시트와 잠금이 손에 닿는다', async ({ page }) => {
    test.setTimeout(60_000);

    await page.goto('/');
    await createTrip(page, '오사카 폰색');
    await openDraw(page);
    await addPage(page);

    await pickTool(page, 'rect');
    await dragOnCanvas(page, { x: 40, y: 120 }, { x: 200, y: 240 });
    await pickTool(page, 'select');
    await page.getByTestId('draw-canvas').click({ position: { x: 40, y: 180 } });

    await page.getByTestId('draw-color-more').click();
    await expect(page.getByTestId('draw-color-sheet')).toBeVisible();
    await page.getByTestId('draw-palette-color').and(page.locator('[data-color="#1c4886"]')).click();
    await page.getByTestId('sheet-close').click();
    await expect(page.getByTestId('draw-element').first().locator('rect').first()).toHaveAttribute(
      'stroke',
      '#1c4886',
    );

    await page.getByTestId('draw-lock-selected').click();
    await expect(page.getByTestId('draw-element').first()).toHaveAttribute('data-locked', 'true');
  });
});
