import { expect, test, type Page } from '@playwright/test';

/**
 * 일정표 카드 메모 — M39.
 *
 * 엑셀 셀의 코멘트와 같은 것이다: 일정표에 **놓인 카드 하나하나**에 붙고, 그 자리
 * 에서만 보인다. 카드가 아니라 배치에 붙으므로 같은 가게를 아침에 한 번 저녁에 한
 * 번 놓으면 메모도 둘이고 서로를 모른다 — 그것이 이 기능의 요점이라 아래에서
 * 못박는다.
 *
 * 네 가지를 확인한다.
 *
 * 1. **자국은 적어 둔 것이 있을 때만 선다.** 블록 오른쪽 위 모서리의 접힌 자국
 *    하나(`entry-note-mark`)이고, 블록은 그 때문에 커지지 않는다.
 * 2. **읽는 자리와 쓰는 자리가 같다.** 블록을 누르면 상세 시트가 열리고 메모가
 *    거기 들어 있다. 자국 위를 눌러도 마찬가지다 — 표시가 탭을 가로채지 않는다.
 * 3. **배치마다 따로다.** 같은 카드의 두 번째 배치는 자기 메모를 갖는다.
 * 4. **비우면 자국까지 사라지고**, 그 상태도 새로고침을 건너간다.
 */

test.use({ viewport: { width: 1280, height: 800 } });

const NOTE = '개장 30분 전 도착\n짐은 호텔에 맡기고 출발';
const OTHER_NOTE = '저녁엔 예약 필수';

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

/** Opens 일정 for the active trip and adds one day. */
async function openTimelineWithADay(page: Page): Promise<void> {
  await page.getByTestId('tab-timeline').click();
  await expect(page.getByTestId('view-timeline')).toBeVisible();
  await page.getByTestId('timeline-add-day').click();
  await expect(page.getByTestId('timeline-day')).toHaveCount(1);
}

/**
 * 보드의 첫 카드를 시간표에 한 번 더 놓는다 — 드래그를 쓰지 않는 배치 경로.
 * `startSteps`는 기본 10:00에서 15분씩 미는 횟수다.
 */
async function scheduleFirstCard(page: Page, startSteps: number): Promise<void> {
  await page.getByTestId('tab-board').click();
  await page.getByTestId('board-card').first().click();
  await expect(page.getByTestId('card-form')).toBeVisible();
  await page.getByTestId('card-schedule').click();
  await expect(page.getByTestId('schedule-sheet')).toBeVisible();
  for (let step = 0; step < startSteps; step += 1) {
    await page.getByTestId('schedule-start-plus').click();
  }
  await page.getByTestId('schedule-submit').click();
  await expect(page.getByTestId('schedule-sheet')).toHaveCount(0);
  await page.getByTestId('tab-timeline').click();
}

/** The workspace blob as it actually sits in IndexedDB right now. */
const workspaceBlob = (page: Page): Promise<string> =>
  page.evaluate(
    (key) =>
      new Promise<string>((resolve) => {
        const request = indexedDB.open('trip-board');
        request.onerror = () => resolve('');
        request.onsuccess = () => {
          try {
            const read = request.result
              .transaction('state', 'readonly')
              .objectStore('state')
              .get(key);
            read.onsuccess = () => resolve(typeof read.result === 'string' ? read.result : '');
            read.onerror = () => resolve('');
          } catch {
            resolve('');
          }
        };
      }),
    'trip-board/workspace',
  );

/**
 * Waits until the persisted blob mentions `needle`, so a `reload()` cannot race
 * the persist middleware's write.
 * (Same idea as `timeline.spec.ts` / `board.spec.ts`, for the same reason.)
 */
async function waitForPersisted(page: Page, needle: string): Promise<void> {
  await expect.poll(() => workspaceBlob(page), { timeout: 5_000 }).toContain(needle);
}

/**
 * …and the other direction: waits until the blob **stops** mentioning it.
 *
 * 지우기도 쓰기와 똑같이 비동기로 저장된다. 이걸 기다리지 않고 새로고침하면
 * 방금 지운 메모가 디스크에서 되살아 올라온다 — 앱의 버그가 아니라 스펙의 경주다.
 */
async function waitForGone(page: Page, needle: string): Promise<void> {
  await expect.poll(() => workspaceBlob(page), { timeout: 5_000 }).not.toContain(needle);
}

/** 상세 시트를 열어 메모를 적고 저장한다. */
async function writeNote(page: Page, block: ReturnType<Page['locator']>, text: string) {
  await block.click();
  await expect(page.getByTestId('entry-sheet')).toBeVisible();
  await page.getByTestId('entry-note-input').fill(text);
  await page.getByTestId('entry-save').click();
  await expect(page.getByTestId('entry-sheet')).toHaveCount(0);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('tab-bar')).toBeVisible();
});

test('배치에 메모를 달면 모서리에 자국이 서고, 비우면 사라진다', async ({ page }) => {
  await createTrip(page, '오사카 배치메모');
  await addCard(page, 2, '이치란');
  await openTimelineWithADay(page);
  await scheduleFirstCard(page, 0);

  const block = page.getByTestId('timeline-entry');
  await expect(block).toHaveCount(1);
  // 적어 둔 것이 없으면 자국도 없다.
  await expect(block).toHaveAttribute('data-note', 'false');
  await expect(page.getByTestId('entry-note-mark')).toHaveCount(0);

  // 블록 높이는 메모 때문에 달라지지 않는다 — 자국은 겹쳐 놓은 것이다.
  const before = await block.boundingBox();

  await writeNote(page, block, NOTE);

  await expect(block).toHaveAttribute('data-note', 'true');
  await expect(page.getByTestId('entry-note-mark')).toHaveCount(1);
  const after = await block.boundingBox();
  expect(Math.round(after?.height ?? 0)).toBe(Math.round(before?.height ?? 0));

  // 데스크톱 호버 미리보기는 M47에서 브라우저 기본 툴팁 대신 팝오버가 됐다
  // (`e2e/hovernote.spec.ts`가 그 내용을 검사한다). `title`은 M39 이전처럼
  // 카드 이름과 시각만 말한다 — 둘 다 뜨면 같은 블록 위에 툴팁이 두 개다.
  const tooltip = await block.getAttribute('title');
  expect(tooltip).toContain('이치란');
  expect(tooltip).not.toContain('개장 30분 전 도착');

  // 자국은 탭을 가로채지 않는다 — 그 위를 눌러도 열리는 것은 상세 시트다.
  const markBox = await page.getByTestId('entry-note-mark').boundingBox();
  await page.mouse.click(
    (markBox?.x ?? 0) + (markBox?.width ?? 0) / 2,
    (markBox?.y ?? 0) + (markBox?.height ?? 0) / 2,
  );
  await expect(page.getByTestId('entry-sheet')).toBeVisible();
  await expect(page.getByTestId('entry-note-input')).toHaveValue(NOTE);
  await page.getByTestId('sheet-close').click();
  await expect(page.getByTestId('entry-sheet')).toHaveCount(0);

  // 새로고침을 건너간다.
  await waitForPersisted(page, '짐은 호텔에 맡기고 출발');
  await page.reload();
  await expect(page.getByTestId('timeline-entry')).toHaveCount(1);
  await expect(page.getByTestId('timeline-entry')).toHaveAttribute('data-note', 'true');
  await expect(page.getByTestId('entry-note-mark')).toHaveCount(1);

  // 비우면 자국까지 함께 사라지고, 그 상태도 남는다.
  await writeNote(page, page.getByTestId('timeline-entry'), '   ');
  await expect(page.getByTestId('timeline-entry')).toHaveAttribute('data-note', 'false');
  await expect(page.getByTestId('entry-note-mark')).toHaveCount(0);

  await waitForGone(page, '짐은 호텔에 맡기고 출발');
  await page.reload();
  await expect(page.getByTestId('timeline-entry')).toHaveCount(1);
  await expect(page.getByTestId('timeline-entry')).toHaveAttribute('data-note', 'false');
  await expect(page.getByTestId('entry-note-mark')).toHaveCount(0);
});

test('같은 카드를 두 번 놓으면 메모도 둘이고, 서로를 모른다', async ({ page }) => {
  await createTrip(page, '오사카 배치별메모');
  await addCard(page, 2, '이치란');
  await openTimelineWithADay(page);

  // 10:00과 11:00 — 같은 카드의 두 배치.
  await scheduleFirstCard(page, 0);
  await scheduleFirstCard(page, 4);
  await expect(page.getByTestId('timeline-entry')).toHaveCount(2);

  const morning = page.locator('[data-testid="timeline-entry"][data-start-min="600"]');
  const noon = page.locator('[data-testid="timeline-entry"][data-start-min="660"]');
  await expect(morning).toHaveCount(1);
  await expect(noon).toHaveCount(1);

  // 아침 배치에만 메모를 단다.
  await writeNote(page, morning, NOTE);
  await expect(morning).toHaveAttribute('data-note', 'true');
  await expect(noon).toHaveAttribute('data-note', 'false');
  await expect(page.getByTestId('entry-note-mark')).toHaveCount(1);

  // 두 번째 배치를 열면 **빈 칸**이다 — 첫 배치의 메모가 새어 오지 않는다.
  await noon.click();
  await expect(page.getByTestId('entry-note-input')).toHaveValue('');
  await page.getByTestId('entry-note-input').fill(OTHER_NOTE);
  await page.getByTestId('entry-save').click();
  await expect(page.getByTestId('entry-sheet')).toHaveCount(0);

  // 이제 둘 다 자국이 섰고, 각자의 글을 갖는다.
  await expect(page.getByTestId('entry-note-mark')).toHaveCount(2);
  await morning.click();
  await expect(page.getByTestId('entry-note-input')).toHaveValue(NOTE);
  await page.getByTestId('sheet-close').click();
  await noon.click();
  await expect(page.getByTestId('entry-note-input')).toHaveValue(OTHER_NOTE);
  await page.getByTestId('sheet-close').click();

  // 카드 자체는 손대지 않았다 — 보드의 메모는 여전히 비어 있다.
  await page.getByTestId('tab-board').click();
  await page.getByTestId('board-card').first().click();
  await expect(page.getByTestId('card-memo-input')).toHaveValue('');
});

test.describe('모바일', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('폰에서도 블록을 눌러 메모를 달 수 있고, 줄이 넘치지 않는다', async ({ page }) => {
    await createTrip(page, '오사카 폰배치메모');
    await addCard(page, 2, '이치란');
    await openTimelineWithADay(page);
    await scheduleFirstCard(page, 0);

    const block = page.getByTestId('timeline-entry');
    await expect(block).toHaveCount(1);
    await expect(block).toHaveAttribute('data-note', 'false');

    await block.click();
    await expect(page.getByTestId('entry-sheet')).toBeVisible();
    // 메모 칸은 폰에서도 여러 줄이 들어가는 크기다.
    const inputBox = await page.getByTestId('entry-note-input').boundingBox();
    expect(Math.round(inputBox?.height ?? 0)).toBeGreaterThanOrEqual(44);
    await page.getByTestId('entry-note-input').fill(NOTE);
    await page.getByTestId('entry-save').click();
    await expect(page.getByTestId('entry-sheet')).toHaveCount(0);

    await expect(block).toHaveAttribute('data-note', 'true');
    await expect(page.getByTestId('entry-note-mark')).toHaveCount(1);

    // 자국은 블록 안에 있고, 문서는 가로로 스크롤되지 않는다.
    const blockBox = await block.boundingBox();
    const markBox = await page.getByTestId('entry-note-mark').boundingBox();
    expect((markBox?.x ?? 0) + (markBox?.width ?? 0)).toBeLessThanOrEqual(
      (blockBox?.x ?? 0) + (blockBox?.width ?? 0) + 1,
    );
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
