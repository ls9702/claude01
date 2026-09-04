import { devices, expect, test, type Page } from '@playwright/test';

/**
 * 화면에 들어맞는가 — M51.
 *
 * ## 이 파일이 왜 생겼나
 *
 * 253개의 e2e가 전부 **데스크톱 컨텍스트**(`Desktop Chrome`, `isMobile: false`)
 * 였다. 그 컨텍스트에서 Chromium은 `<meta name="viewport">`를 **읽지 않고**,
 * 모바일 스케일링(최소 배율·레이아웃 뷰포트 확대)도 일어나지 않는다. 좁은
 * 뷰포트로 줄여 놓아도 그것은 「작은 데스크톱 창」이지 폰이 아니다.
 *
 * 그래서 실기기(삼성 인터넷/안드로이드)에서 사용자가 겪은 사고 — **하단 탭 바가
 * 화면 밖으로 사라지고 시트가 오른쪽으로 잘림** — 을 253개 중 하나도 잡지
 * 못했다. 그 연쇄는 이렇다:
 *
 *   1. AI를 켠 384px 폰에서 일정 헤더 액션 줄이 356px가 되어 뷰포트를 39px 넘김
 *   2. Blink가 「내용 폭 맞춤」 최소 배율을 잡고 **레이아웃 뷰포트를 423px로 늘림**
 *   3. `h-dvh`인 셸은 가시 영역(384×747)에 남는데 `fixed`인 탭 바·시트는 늘어난
 *      레이아웃 뷰포트(423×823)를 쓰므로, 탭 바가 화면 63px 아래에 그려짐
 *
 * 이 스펙은 `isMobile: true` 컨텍스트에서 그 세 단계를 각각 못박는다. 세 층의
 * 방어가 있고, 각 층을 따로 지킨다:
 *
 * | 층 | 무엇 | 여기서 지키는 단언 |
 * |---|---|---|
 * | 1 | 일정·보드 헤더의 **폭 예산** (`TimelineView`의 표) | `scrollWidth <= innerWidth` |
 * | 2 | 셸의 `overflow-x: clip` (`AppShell`) | 강제로 넘쳐도 `innerWidth === visualViewport.width` |
 * | 3 | fixed 요소의 `dvw`/`dvh` 앵커 (`index.css`) | 탭 바·시트 푸터가 가시 영역 안 |
 */

test.use({ ...devices['Pixel 5'] });

/** 실기기에서 신고가 온 폭, 그리고 그보다 좁은 폭. */
const SIZES = [
  { width: 384, height: 747, name: '384×747 (삼성 인터넷 실측)' },
  { width: 360, height: 640, name: '360×640' },
];

/** A transparent 1×1 png — enough for Leaflet to count as a loaded tile. */
const TILE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** 지도 탭이 바깥 두 호스트를 부르지 않게 한다 (map.spec의 그 레시피). */
async function stubNetwork(page: Page): Promise<void> {
  await page.route('**/nominatim.openstreetmap.org/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.route(/tile\.openstreetmap\.org/, (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: TILE_PNG }),
  );
}

/**
 * AI 도우미를 켠 기기인 척한다.
 *
 * 세 조건(토글·동기화 설정·서버의 키)을 `ai.spec`처럼 UI로 걷는 대신, 저장된
 * 상태 두 줄과 `ai.php?ping=1` 한 번으로 세운다 — 여기서 검사하는 것은 AI가
 * **무엇을 답하나**가 아니라 AI 버튼 두 개가 **줄에 서면 폭이 어떻게 되나**이기
 * 때문이다.
 */
async function pretendAiIsOn(page: Page): Promise<void> {
  await page.route('**/ai.php**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, ai: true }),
    }),
  );
  await page.route('**/data.php**', (route) =>
    route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'not found' }),
    }),
  );
  await page.addInitScript(() => {
    localStorage.setItem('trip-board/ai', JSON.stringify({ enabled: true }));
    localStorage.setItem(
      'trip-board/sync-settings',
      JSON.stringify({ baseUrl: 'http://127.0.0.1:59999/api', token: 'viewportfit' }),
    );
  });
}

async function createTrip(page: Page, title: string): Promise<void> {
  await page.getByTestId('add-trip').click();
  await page.getByTestId('trip-title-input').fill(title);
  await page.getByTestId('trip-submit').click();
  await expect(page.getByTestId('trip-form')).toHaveCount(0);
  await page.getByTestId('trip-card').filter({ hasText: title }).getByTestId('trip-open').click();
  await expect(page).toHaveURL(/#\/board$/);
}

/** 카드 하나를 만들어 일정에 배치한다 — 「AI 검토」는 놓인 카드가 있어야 뜬다. */
async function seedPlacedCard(page: Page, title: string): Promise<void> {
  await page.getByTestId('board-column').first().getByTestId('add-card').click();
  await page.getByTestId('card-title-input').fill(title);
  await page.getByTestId('card-submit').click();
  await expect(page.getByTestId('card-form')).toHaveCount(0);

  await page.getByTestId('tab-timeline').click();
  await page.getByTestId('timeline-add-day-empty').click();
  await expect(page.getByTestId('timeline-day')).toHaveCount(1);

  // 폰에서 미배치 트레이는 접힌 채로 시작한다 — 카드를 집으려면 먼저 편다.
  const tray = page.getByTestId('unscheduled-tray');
  if ((await tray.count()) > 0 && (await tray.getAttribute('data-open')) !== 'true') {
    await page.getByTestId('tray-toggle').click();
    await expect(tray).toHaveAttribute('data-open', 'true');
  }

  await page.getByTestId('tray-card').filter({ hasText: title }).first().click();
  await page.getByTestId('schedule-submit').click();
  await expect(page.getByTestId('schedule-sheet')).toHaveCount(0);
  await expect(page.getByTestId('timeline-entry')).toHaveCount(1);
}

/** 한 프레임의 세 뷰포트 숫자 + 탭 바의 자리. */
interface Fit {
  innerWidth: number;
  innerHeight: number;
  visualWidth: number;
  visualHeight: number;
  scrollWidth: number;
}

async function readFit(page: Page): Promise<Fit> {
  return page.evaluate(() => ({
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    visualWidth: window.visualViewport?.width ?? window.innerWidth,
    visualHeight: window.visualViewport?.height ?? window.innerHeight,
    scrollWidth: document.documentElement.scrollWidth,
  }));
}

/**
 * 한 화면이 지켜야 하는 것 전부.
 *
 * 1. 레이아웃 뷰포트 == 가시 뷰포트 (2번 단계가 일어나지 않았다)
 * 2. 문서가 가로로 넘치지 않는다 (1번 단계가 일어나지 않았다)
 * 3. 탭 바가 **가시** 영역 안에 있다 (3번 단계가 일어나지 않았다)
 */
async function expectFits(page: Page, label: string): Promise<void> {
  const fit = await readFit(page);
  expect(fit.innerWidth, `${label}: 레이아웃 뷰포트가 가시 뷰포트보다 넓다`).toBe(fit.visualWidth);
  expect(fit.scrollWidth, `${label}: 문서가 가로로 넘친다`).toBeLessThanOrEqual(fit.innerWidth);

  const tabBar = await page.getByTestId('tab-bar').boundingBox();
  expect(tabBar, `${label}: 탭 바가 없다`).not.toBeNull();
  expect(tabBar!.y + tabBar!.height, `${label}: 탭 바가 화면 아래로 나갔다`).toBeLessThanOrEqual(
    fit.visualHeight + 1,
  );
  expect(tabBar!.x + tabBar!.width, `${label}: 탭 바가 화면 오른쪽으로 나갔다`).toBeLessThanOrEqual(
    fit.visualWidth + 1,
  );
}

test.beforeEach(async ({ page }) => {
  await stubNetwork(page);
});

for (const size of SIZES) {
  test(`${size.name} — 여섯 탭 어디서도 화면을 넘지 않는다 (AI 켬)`, async ({ page }) => {
    await pretendAiIsOn(page);
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.goto('/');
    await expect(page.getByTestId('tab-bar')).toBeVisible();

    await createTrip(page, '오사카 뷰포트');
    await seedPlacedCard(page, '오사카성 천수각');

    // M52a — 드로우 탭이 붙어 여섯 칸이 됐다. 320/360/384에서 탭 줄이
    // 넘치지 않는지는 `draw.spec`의 전용 시험이 폭 셋에서 따로 지킨다.
    for (const tab of ['trips', 'board', 'timeline', 'map', 'memo', 'draw'] as const) {
      await page.getByTestId(`tab-${tab}`).click();
      await expect(page.getByTestId(`tab-${tab}`)).toHaveAttribute('aria-selected', 'true');
      await expectFits(page, `${size.name} / ${tab} 탭`);
    }
  });

  test(`${size.name} — 시트를 열어도 푸터 버튼이 화면 안에 있다`, async ({ page }) => {
    await pretendAiIsOn(page);
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.goto('/');
    await createTrip(page, '오사카 시트');
    await seedPlacedCard(page, '난카이 라피트');

    await page.getByTestId('timeline-entry').first().click();
    const save = page.getByTestId('entry-save');
    await expect(save).toBeVisible();

    await expectFits(page, `${size.name} / 엔트리 시트`);

    const fit = await readFit(page);
    const box = await save.boundingBox();
    expect(box, '저장 버튼이 없다').not.toBeNull();
    // 시트의 「저장」은 시트가 답하는 질문의 끝이다 — 화면 밖에 있으면 시트가
    // 열리지 않은 것과 같다. 실기기에서 정확히 이것이 안 보였다.
    expect(box!.y + box!.height, '저장 버튼이 화면 아래에 있다').toBeLessThanOrEqual(
      fit.visualHeight + 1,
    );
    expect(box!.x + box!.width, '저장 버튼이 화면 오른쪽에 있다').toBeLessThanOrEqual(
      fit.visualWidth + 1,
    );
    expect(box!.x, '저장 버튼이 화면 왼쪽 밖에 있다').toBeGreaterThanOrEqual(-1);
  });
}

test('일정 헤더는 AI를 켜든 끄든 화면 안에서 끝난다', async ({ page }) => {
  // 접기 chevron은 이 줄의 **마지막** 요소라, 그것이 화면 안에 있으면 줄 전체가
  // 화면 안에 있다. AI를 켜면 이 줄에 버튼 두 개가 더 서므로, 그 두 상태를
  // 같은 폭들에서 나란히 잰다 (`TimelineView`의 폭 예산 표).
  await pretendAiIsOn(page);
  await page.setViewportSize({ width: 384, height: 747 });
  await page.goto('/');
  await createTrip(page, '오사카 헤더');
  await seedPlacedCard(page, '히요리 호텔');

  const toggle = page.getByTestId('timeline-chrome-toggle');

  for (const width of [320, 360, 384, 412, 430]) {
    await page.setViewportSize({ width, height: 747 });
    await expect(toggle).toBeVisible();
    const box = await toggle.boundingBox();
    expect(box, `${width}px에서 접기 버튼이 없다`).not.toBeNull();
    expect(box!.x + box!.width, `${width}px에서 헤더가 화면을 넘는다 (AI 켬)`).toBeLessThanOrEqual(
      width,
    );
    await expectFits(page, `${width}px / AI 켬`);
  }

  // 그리고 AI를 끈 같은 기기에서도 같다 — 예산 규칙이 한쪽만 고치고 다른 쪽을
  // 깨뜨리지 않았음을 본다.
  await page.evaluate(() => localStorage.setItem('trip-board/ai', JSON.stringify({ enabled: false })));
  await page.reload();
  await page.getByTestId('tab-timeline').click();
  for (const width of [320, 360, 384, 412, 430]) {
    await page.setViewportSize({ width, height: 747 });
    await expect(toggle).toBeVisible();
    const box = await toggle.boundingBox();
    expect(box!.x + box!.width, `${width}px에서 헤더가 화면을 넘는다 (AI 끔)`).toBeLessThanOrEqual(
      width,
    );
    await expectFits(page, `${width}px / AI 끔`);
  }
});

test('헤더를 강제로 넘치게 만들어도 탭 바는 화면 안에 남는다', async ({ page }) => {
  /* 그물이 그물인지 보는 시험 (`AppShell`의 `overflow-x: clip`).
   *
   * 위 두 시험은 「넘치지 않게 고쳤다」를 지키고, 이것은 「그래도 넘치면?」을
   * 지킨다. 다음 마일스톤이 이 줄에 버튼을 하나 더 얹어 예산을 깨더라도, 탭
   * 바는 화면 안에 남아야 한다 — 출구는 마지막까지 열려 있어야 하기 때문이다.
   *
   * 재현 방식은 debateA/repro2.mjs 그대로다: 헤더 액션 묶음에 왼쪽 여백을
   * 강제로 밀어 넣어 뷰포트를 넘기고, 최소 배율까지 축소를 시도한다. */
  await page.setViewportSize({ width: 384, height: 747 });
  await page.goto('/');
  await createTrip(page, '오사카 강제 오버플로');
  await seedPlacedCard(page, '도톤보리');

  await page.addStyleTag({
    content: '[data-testid="timeline-header"] > div:last-child{padding-left:120px}',
  });
  // 액션 묶음은 실제로 넘쳤다 — 시험이 아무것도 하지 않는 시험이 아님을 본다.
  const actions = page.locator('[data-testid="timeline-header"] > div:last-child');
  const actionsBox = await actions.boundingBox();
  expect(actionsBox!.x + actionsBox!.width).toBeGreaterThan(384);

  await expectFits(page, '강제 오버플로 / 일정 탭');

  // 시트도 마찬가지다.
  await page.getByTestId('timeline-entry').first().click();
  await expect(page.getByTestId('entry-save')).toBeVisible();
  await expectFits(page, '강제 오버플로 / 엔트리 시트');

  const fit = await readFit(page);
  const sheet = await page.getByTestId('entry-sheet').boundingBox();
  expect(sheet, '엔트리 시트가 없다').not.toBeNull();
  expect(sheet!.x + sheet!.width, '시트가 오른쪽으로 잘렸다').toBeLessThanOrEqual(
    fit.visualWidth + 1,
  );
});
