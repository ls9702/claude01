import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { startMockApi, type MockApi } from './mock-api';

/**
 * 드로우 2회차 (M52a-fix · M52b).
 *
 * `draw.spec`이 「그린 것이 남는가」를 지킨다면, 이 스펙은 **그 다음 것들**을
 * 지킨다:
 *
 * 1. **딥링크가 다른 탭에서도 산다** (M52a-fix ②) — 보드에서 `#/draw/<id>`를
 *    밟으면 그 페이지가 열리고 주소가 그대로다. 예전에는 탭을 먼저 바꾸는 바람에
 *    구독자가 id를 지워 버렸다.
 * 2. **배경 사진** — 새로고침을 넘고, 복제본과 사진을 나눠 쓰고, **GC 두 번을
 *    견딘다**(참조로 인정되지 않으면 30초 뒤 지워진다).
 * 3. **카드 🎨 연결** — 카드에서 페이지를 만들고, 칩으로 건너가고, 페이지 쪽에서
 *    카드로 돌아온다.
 * 4. **PNG 저장** — 메뉴 한 줄이 진짜 파일 하나를 만든다.
 * 5. **단축키와 상태 유지** — 데스크톱의 손, 그리고 탭을 다녀와도 그대로인 뷰.
 * 6. **이름이 상대의 획에 덮이지 않는다** (M52a-fix ①) — 두 기기·목 서버.
 */

const PHOTO = fileURLToPath(new URL('./fixtures/photo.png', import.meta.url));

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
  // M54부터 **기본 도구는 손(이동)**이다. 이 스펙은 페이지를 열자마자 그리므로
  // 여기서 펜을 한 번 골라 준다 — 앱에서도 그리기는 이제 고르고 하는 일이다.
  await page.getByTestId('draw-tool').and(page.locator('[data-tool="pen"]')).click();
  await expect(page.getByTestId('draw-canvas')).toHaveAttribute('data-tool', 'pen');
  return (await editor.getAttribute('data-page-id')) ?? '';
}

async function drawStroke(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  const box = await page.getByTestId('draw-canvas').boundingBox();
  if (!box) throw new Error('캔버스가 없다');
  await page.mouse.move(box.x + from.x, box.y + from.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i += 1) {
    await page.mouse.move(
      box.x + from.x + ((to.x - from.x) * i) / 8,
      box.y + from.y + ((to.y - from.y) * i) / 8,
    );
  }
  await page.mouse.up();
}

/** 배경 사진을 깔고 `<image>`가 실제로 그려질 때까지 기다린다. */
async function setBackground(page: Page): Promise<void> {
  await page.getByTestId('draw-menu').click();
  await page.getByTestId('draw-background-open').click();
  await expect(page.getByTestId('draw-bg-sheet')).toBeVisible();
  await page.getByTestId('draw-bg-input').setInputFiles(PHOTO);
  await expect(page.getByTestId('draw-bg-sheet')).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByTestId('draw-background')).toBeVisible({ timeout: 15_000 });
}

/* ------------------------------------------------------------------ *
 * 1. 딥링크 — 다른 탭에서 밟아도 산다 (M52a-fix ②)
 * ------------------------------------------------------------------ */

test('보드 탭에서 #/draw/<id>를 밟으면 그 페이지가 열리고 주소가 남는다', async ({ page }) => {
  await page.goto('/');
  await createTrip(page, '오사카 딥링크');
  await openDraw(page);
  const pageId = await addPage(page);
  await drawStroke(page, { x: 60, y: 60 }, { x: 180, y: 60 });
  await page.getByTestId('draw-back').click();

  await page.getByTestId('tab-board').click();
  await expect(page).toHaveURL(/#\/board$/);

  // `<a href="#/draw/<id>">`를 누른 것과 **같은 일**이다.
  await page.evaluate((id) => {
    window.location.hash = `#/draw/${id}`;
  }, pageId);

  await expect(page.getByTestId('draw-editor')).toHaveAttribute('data-page-id', pageId);
  await expect(page).toHaveURL(new RegExp(`#/draw/${pageId}$`));
  await expect(page.getByTestId('draw-element')).toHaveCount(1);
});

/* ------------------------------------------------------------------ *
 * 2. 배경 사진 (M52b)
 * ------------------------------------------------------------------ */

test('배경 사진 — 새로고침·복제·GC 두 번을 넘어 살아남는다', async ({ page }) => {
  test.setTimeout(90_000);

  await page.goto('/');
  await createTrip(page, '오사카 배경');
  await openDraw(page);
  const pageId = await addPage(page);
  await setBackground(page);

  // 진하기 슬라이더는 0.2~1 사이의 값을 그대로 그림에 싣는다.
  await page.getByTestId('draw-menu').click();
  await page.getByTestId('draw-background-open').click();
  await page.getByTestId('draw-bg-opacity').fill('0.5');
  await page.getByTestId('sheet-close').click();
  await expect(page.getByTestId('draw-background')).toHaveAttribute('opacity', '0.5');

  // ① 새로고침 — 사진의 바이트는 워크스페이스 **밖**에 산다.
  await page.goto(`/#/draw/${pageId}`);
  await expect(page.getByTestId('draw-background')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('draw-background')).toHaveAttribute('opacity', '0.5');

  // ② 복제한 페이지는 같은 사진을 나눠 쓴다(불변 블롭이라 안전하다).
  await page.getByTestId('draw-back').click();
  await page.getByTestId('draw-page-duplicate').first().click();
  await expect(page.getByTestId('draw-page-card')).toHaveCount(2);
  await page.getByTestId('draw-page-open').nth(1).click();
  await expect(page.getByTestId('draw-background')).toBeVisible({ timeout: 15_000 });

  // ③ **GC 두 번** — 배경이 「참조」로 인정되지 않으면 여기서 지워진다.
  const swept = await page.evaluate(async () => {
    const sweep = (window as unknown as { __tripBoardSweepPhotos: () => Promise<string[]> })
      .__tripBoardSweepPhotos;
    const first = await sweep();
    const second = await sweep();
    return [...first, ...second];
  });
  expect(swept, '배경 사진이 GC에 쓸려 갔다').toEqual([]);

  await page.reload();
  await expect(page.getByTestId('draw-background')).toBeVisible({ timeout: 15_000 });

  // ④ 빼면 화면에서 사라진다.
  await page.getByTestId('draw-menu').click();
  await page.getByTestId('draw-background-open').click();
  await page.getByTestId('draw-bg-remove').click();
  await expect(page.getByTestId('draw-background')).toHaveCount(0);
});

/* ------------------------------------------------------------------ *
 * 3. 카드 🎨 연결 (M52b)
 * ------------------------------------------------------------------ */

test('카드에서 페이지를 만들어 붙이고, 칩으로 건너가고, 페이지에서 카드로 돌아온다', async ({
  page,
}) => {
  test.setTimeout(60_000);

  await page.goto('/');
  await createTrip(page, '오사카 카드연결');

  await page.getByTestId('board-column').first().getByTestId('add-card').click();
  await page.getByTestId('card-title-input').fill('난바 산책');
  await page.getByTestId('card-draw-new').click();
  await expect(page.getByTestId('card-draw-name')).toContainText('난바 산책');
  await page.getByTestId('card-submit').click();
  await expect(page.getByTestId('card-form')).toHaveCount(0);

  // 칩이 섰다 — 그리고 그것을 누르면 그 페이지가 열린다.
  const chip = page.getByTestId('card-chip-draw');
  await expect(chip).toBeVisible();
  await chip.click();
  await expect(page.getByTestId('draw-editor')).toBeVisible();
  await expect(page).toHaveURL(/#\/draw\/.+/);
  await expect(page.getByTestId('draw-page-title')).toHaveText('난바 산책');

  // 페이지 쪽에서도 「연결된 카드 1」이 보이고, 누르면 그 카드가 열린다.
  await expect(page.getByTestId('draw-links')).toHaveAttribute('data-count', '1');
  await page.getByTestId('draw-links').click();
  await page.getByTestId('draw-link-card').click();
  await expect(page.getByTestId('card-form')).toBeVisible();
  await expect(page.getByTestId('card-title-input')).toHaveValue('난바 산책');

  // 해제하면 칩도 사라진다.
  await page.getByTestId('card-draw-clear').click();
  await page.getByTestId('card-submit').click();
  await expect(page.getByTestId('card-chip-draw')).toHaveCount(0);
});

test('카드 링크 칸에 앱 자신의 주소를 넣으면 새 탭이 아니라 앱 안에서 열린다', async ({ page }) => {
  await page.goto('/');
  await createTrip(page, '오사카 링크칸');
  await openDraw(page);
  const pageId = await addPage(page);
  await page.getByTestId('draw-back').click();

  await page.getByTestId('tab-board').click();
  await page.getByTestId('board-column').first().getByTestId('add-card').click();
  await page.getByTestId('card-title-input').fill('스케치 링크');
  await page.getByTestId('card-url-input').fill(`#/draw/${pageId}`);
  await page.getByTestId('card-submit').click();

  const link = page.getByTestId('card-link');
  // `target=_blank`가 붙지 않았다 — 새 탭이 아니라 같은 문서 안의 이동이다.
  await expect(link).toHaveAttribute('href', `#/draw/${pageId}`);
  expect(await link.getAttribute('target')).toBeNull();

  await link.click();
  await expect(page.getByTestId('draw-editor')).toHaveAttribute('data-page-id', pageId);
});

/* ------------------------------------------------------------------ *
 * 4. PNG (M52b)
 * ------------------------------------------------------------------ */

test('PNG로 저장 — 메뉴 한 줄이 파일 하나를 만든다', async ({ page }) => {
  test.setTimeout(60_000);

  await page.goto('/');
  await createTrip(page, '오사카 그림');
  await openDraw(page);
  await addPage(page);
  await page.getByTestId('draw-page-title').waitFor();

  await drawStroke(page, { x: 60, y: 60 }, { x: 200, y: 140 });
  await expect(page.getByTestId('draw-element')).toHaveCount(1);

  // 한글 제목 그대로 한 번 (파일이 정말 나오는가), 그리고 이름까지 한 번.
  const downloading = page.waitForEvent('download');
  await page.getByTestId('draw-menu').click();
  await page.getByTestId('draw-png').click();
  const download = await downloading;
  expect(await download.path()).toBeTruthy();
  await expect(page.getByTestId('draw-notice')).toContainText('저장');

  // 파일 이름은 페이지 제목이다. **여기서만 영문 제목을 쓰는 이유**: 컨테이너의
  // 헤드리스 크로미움은 `<a download>`의 비ASCII 이름을 버리고 `download`를
  // 내려 준다(실기 크롬·사파리는 한글 이름을 그대로 쓴다). 규칙 자체를 못 박는
  // 것이 목적이므로 그 자리만 피한다 — 이름 규칙은 `draw/png.test.ts`가 한글까지
  // 지킨다.
  await page.getByTestId('draw-back').click();
  await page.getByTestId('draw-page-rename').click();
  await page.getByTestId('draw-rename-input').fill('namba');
  await page.getByTestId('draw-rename-submit').click();
  await page.getByTestId('draw-page-open').first().click();

  const downloading2 = page.waitForEvent('download');
  await page.getByTestId('draw-menu').click();
  await page.getByTestId('draw-png').click();
  const download2 = await downloading2;
  expect(download2.suggestedFilename()).toBe('namba.png');
});

/* ------------------------------------------------------------------ *
 * 5. 단축키와 상태 유지 (M52b)
 * ------------------------------------------------------------------ */

test('단축키 — 숫자로 도구, Ctrl+Z/Shift+Z, Delete, Esc', async ({ page }) => {
  await page.goto('/');
  await createTrip(page, '오사카 단축키');
  await openDraw(page);
  await addPage(page);

  const canvas = page.getByTestId('draw-canvas');

  // 숫자키가 도구 바의 순서 그대로다 — M54에서 손이 맨 앞으로 오면서 한 칸씩
  // 밀렸다 (1=손, 2=펜 … 4=지우개).
  await page.keyboard.press('4');
  await expect(canvas).toHaveAttribute('data-tool', 'eraser');
  await page.keyboard.press('1');
  await expect(canvas).toHaveAttribute('data-tool', 'hand');
  await page.keyboard.press('2');
  await expect(canvas).toHaveAttribute('data-tool', 'pen');

  await drawStroke(page, { x: 60, y: 60 }, { x: 160, y: 60 });
  await drawStroke(page, { x: 60, y: 120 }, { x: 160, y: 120 });
  await expect(page.getByTestId('draw-element')).toHaveCount(2);

  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('draw-element')).toHaveCount(1);
  await page.keyboard.press('Control+Shift+z');
  await expect(page.getByTestId('draw-element')).toHaveCount(2);

  // 선택 → Delete로 지우고, Esc로 선택을 푼다.
  await page.keyboard.press('5');
  await expect(canvas).toHaveAttribute('data-tool', 'select');
  await canvas.click({ position: { x: 110, y: 60 } });
  await expect(page.getByTestId('draw-selection')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('draw-selection')).toHaveCount(0);

  await canvas.click({ position: { x: 110, y: 60 } });
  await expect(page.getByTestId('draw-selection')).toBeVisible();
  await page.keyboard.press('Delete');
  await expect(page.getByTestId('draw-element')).toHaveCount(1);
});

test('다른 탭에 다녀와도 배율·도구·실행취소가 그대로다 (새로고침은 초기화)', async ({ page }) => {
  await page.goto('/');
  await createTrip(page, '오사카 상태유지');
  await openDraw(page);
  const pageId = await addPage(page);

  await drawStroke(page, { x: 60, y: 60 }, { x: 160, y: 60 });
  await page.getByTestId('draw-zoom-in').click();
  await page.getByTestId('draw-tool').and(page.locator('[data-tool="highlight"]')).click();

  const canvas = page.getByTestId('draw-canvas');
  const scale = await canvas.getAttribute('data-scale');
  expect(Number(scale)).toBeGreaterThan(1);

  // 지도에 다녀온다 — 편집기는 언마운트되지만 서랍은 남는다.
  await page.getByTestId('tab-map').click();
  await expect(page.getByTestId('draw-editor')).toHaveCount(0);
  await page.getByTestId('tab-draw').click();
  await expect(page.getByTestId('draw-editor')).toHaveAttribute('data-page-id', pageId);
  await expect(canvas).toHaveAttribute('data-scale', scale!);
  await expect(canvas).toHaveAttribute('data-tool', 'highlight');
  await expect(page.getByTestId('draw-undo')).toBeEnabled();

  // 새로고침은 초기화다 — 그건 데이터가 아니라 손의 자리다(의도).
  // 초기화된 도구는 **손**이다 (M54).
  await page.reload();
  await expect(page.getByTestId('draw-editor')).toBeVisible();
  await expect(canvas).toHaveAttribute('data-scale', '1.000');
  await expect(canvas).toHaveAttribute('data-tool', 'hand');
  await expect(page.getByTestId('draw-undo')).toBeDisabled();
  // 그림 자체는 그대로다.
  await expect(page.getByTestId('draw-element')).toHaveCount(1);
});

/* ------------------------------------------------------------------ *
 * 6. 두 기기 — 이름이 상대의 획에 덮이지 않는다 (M52a-fix ①)
 * ------------------------------------------------------------------ */

test.describe('두 기기 병합 (M52a-fix)', () => {
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

  test('이름을 바꾼 뒤 상대가 그려도 이름이 남는다', async ({ browser }) => {
    test.setTimeout(120_000);
    api.reset();

    const one = await browser.newContext();
    const two = await browser.newContext();
    const a = await one.newPage();
    const b = await two.newPage();

    try {
      await a.goto('/');
      await expect(a.getByTestId('tab-bar')).toBeVisible();
      await createTrip(a, '오사카 이름지키기');
      await openDraw(a);
      await addPage(a);
      await a.getByTestId('draw-back').click();
      await configureSync(a);
      await expect.poll(() => api.version(), { timeout: 25_000 }).toBeGreaterThanOrEqual(1);

      // B가 같은 워크스페이스를 받아 그 페이지를 연다.
      await b.goto('/');
      await expect(b.getByTestId('tab-bar')).toBeVisible();
      await configureSync(b);
      await b.getByTestId('tab-trips').click();
      await b
        .getByTestId('trip-card')
        .filter({ hasText: '오사카 이름지키기' })
        .getByTestId('trip-open')
        .click();
      await openDraw(b);
      await b.getByTestId('draw-page-open').first().click();
      await expect(b.getByTestId('draw-editor')).toBeVisible();
      // B도 그릴 참이다 — M54의 기본 도구는 손이라 펜을 골라 준다.
      await b.getByTestId('draw-tool').and(b.locator('[data-tool="pen"]')).click();
      await expect(b.getByTestId('draw-canvas')).toHaveAttribute('data-tool', 'pen');

      // A: 이름을 바꾼다(먼저). B: 획을 하나 긋는다(나중).
      await a.getByTestId('draw-page-rename').click();
      await a.getByTestId('draw-rename-input').fill('난바 밤');
      await a.getByTestId('draw-rename-submit').click();
      await expect(a.getByTestId('draw-page-card').first()).toContainText('난바 밤');

      await b.waitForTimeout(1200);
      await drawStroke(b, { x: 60, y: 60 }, { x: 180, y: 60 });
      await expect(b.getByTestId('draw-element')).toHaveCount(1);

      await syncNow(a);
      await syncNow(b);
      await syncNow(a);

      // 이름도 획도 둘 다 남는다 — 껍데기와 속은 따로 갈린다.
      await expect(a.getByTestId('draw-page-card').first()).toContainText('난바 밤');
      await expect(b.getByTestId('draw-page-title')).toHaveText('난바 밤');
      await expect(b.getByTestId('draw-element')).toHaveCount(1);
      await a.getByTestId('draw-page-open').first().click();
      await expect(a.getByTestId('draw-element')).toHaveCount(1);
    } finally {
      await one.close();
      await two.close();
    }
  });
});
