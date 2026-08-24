import { expect, test, type Page } from '@playwright/test';
import { startMockApi, type MockApi } from './mock-api';

/**
 * AI 도우미, end to end, against the canned Gemini stand-in in `mock-api.ts`.
 *
 * The point of these tests is the **gate**, not the model: three separate
 * conditions have to line up before a single ✨ appears, and the failure mode
 * that matters is an AI button showing up on a build that cannot run it (the
 * GitHub Pages copy has no server at all). So the first test asserts absence,
 * loudly, and the rest walk the happy path once the gate is open.
 */

let api: MockApi;

test.beforeAll(async () => {
  api = await startMockApi();
});

test.afterAll(async () => {
  await api.stop();
});

test.beforeEach(() => {
  api.reset();
});

/** Points the device at the mock server through the settings sheet. */
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

/** Flips 「AI 도우미」 on and waits for the status line to say it is ready. */
async function enableAi(page: Page): Promise<void> {
  await page.getByTestId('sync-chip').click();
  await expect(page.getByTestId('sync-settings')).toBeVisible();
  await expect(page.getByTestId('ai-toggle')).toHaveAttribute('data-on', 'false');
  await page.getByTestId('ai-toggle').click();
  await expect(page.getByTestId('ai-toggle')).toHaveAttribute('data-on', 'true');
  await expect(page.getByTestId('ai-status')).toHaveAttribute('data-state', 'ready');
  await expect(page.getByTestId('ai-status')).toHaveText('사용 준비 완료');
  await page.getByTestId('sheet-close').click();
  await expect(page.getByTestId('sync-settings')).toHaveCount(0);
}

async function createTrip(page: Page, title: string): Promise<void> {
  await page.getByTestId('add-trip').click();
  await page.getByTestId('trip-title-input').fill(title);
  await page.getByTestId('trip-submit').click();
  await expect(page.getByTestId('trip-form')).toHaveCount(0);
  await page.getByTestId('trip-card').filter({ hasText: title }).getByTestId('trip-open').click();
  await expect(page).toHaveURL(/#\/board$/);
}

test('토글이 꺼져 있으면 AI 버튼이 어디에도 없다', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('tab-bar')).toBeVisible();

  await createTrip(page, '오사카');
  await configureSync(page);

  // Sync is configured and the server *does* have a key — the toggle alone is
  // holding the gate shut, and that has to be enough.
  await expect(page.getByTestId('ai-suggest-open')).toHaveCount(0);
  await expect(page.getByTestId('ai-ask-open')).toHaveCount(0);

  await page.getByTestId('tab-timeline').click();
  await expect(page.getByTestId('view-timeline')).toBeVisible();
  await expect(page.getByTestId('ai-review-open')).toHaveCount(0);

  // And the settings line says what turning it on would do.
  await page.getByTestId('sync-chip').click();
  await expect(page.getByTestId('ai-status')).toHaveAttribute('data-state', 'off');
  await expect(page.getByTestId('ai-status')).toHaveText(
    'AI 기능을 켜면 보드·일정에 AI 버튼이 나타나요',
  );
});

test('동기화가 없으면 켜도 쓸 수 없다고 말한다', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('tab-bar')).toBeVisible();

  await page.getByTestId('sync-chip').click();
  await page.getByTestId('ai-toggle').click();

  await expect(page.getByTestId('ai-status')).toHaveAttribute('data-state', 'unconfigured');
  await expect(page.getByTestId('ai-status')).toHaveText('동기화(NAS) 연결 후 사용할 수 있어요');

  await page.getByTestId('sheet-close').click();
  await expect(page.getByTestId('ai-ask-open')).toHaveCount(0);
});

test('서버에 키가 없으면 그렇다고 말한다', async ({ page }) => {
  api.setAiAvailable(false);

  await page.goto('/');
  await expect(page.getByTestId('tab-bar')).toBeVisible();
  await createTrip(page, '삿포로');
  await configureSync(page);

  await page.getByTestId('sync-chip').click();
  await page.getByTestId('ai-toggle').click();

  await expect(page.getByTestId('ai-status')).toHaveAttribute('data-state', 'no-key');
  await expect(page.getByTestId('ai-status')).toHaveText('서버에 AI 키가 설정되지 않았어요');

  await page.getByTestId('sheet-close').click();
  await expect(page.getByTestId('ai-suggest-open')).toHaveCount(0);
});

test('추천을 받아 카드를 보드에 올린다', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('tab-bar')).toBeVisible();

  await createTrip(page, '오사카');
  await configureSync(page);
  await enableAi(page);

  // The gate is open, so the board grows a ✨.
  await expect(page.getByTestId('ai-suggest-open')).toBeVisible();
  await page.getByTestId('ai-suggest-open').click();
  await expect(page.getByTestId('ai-suggest')).toBeVisible();

  await page.getByTestId('ai-suggest-wish').fill('라멘과 건담을 좋아해요');
  await page.getByTestId('ai-suggest-run').click();

  await expect(page.getByTestId('ai-suggestion')).toHaveCount(3);
  await expect(page.getByTestId('ai-suggestion').first()).toContainText('이치란 라멘 도톤보리');

  // The wish and the board context actually reached the proxy.
  const [call] = api.aiCalls();
  expect(call.kind).toBe('suggest');
  expect(call.prompt).toContain('라멘과 건담을 좋아해요');
  expect(call.prompt).toContain('🍽️ 식사');
  expect(call.schema).toBeTruthy();
  expect(call.grounding).toBeUndefined();

  // `식사` is one of the seeded columns, so the chip names it rather than
  // falling back — that match is the whole reason columnName exists.
  await expect(
    page.getByTestId('ai-suggestion').first().getByTestId('ai-suggestion-column'),
  ).toContainText('식사');

  await page.getByTestId('ai-suggestion-add').first().click();
  await expect(page.getByTestId('ai-suggestion-add').first()).toHaveText('추가됨');
  await expect(page.getByTestId('ai-suggestion-add').first()).toBeDisabled();

  await page.getByTestId('sheet-close').click();
  await expect(page.getByTestId('ai-suggest')).toHaveCount(0);

  const eatColumn = page.getByTestId('board-column').filter({ hasText: '식사' }).first();
  await expect(eatColumn.getByTestId('board-card').filter({ hasText: '이치란 라멘 도톤보리' })).toHaveCount(1);
});

test('「모두 추가」는 칸을 못 찾은 제안도 첫 칸에 넣는다', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('tab-bar')).toBeVisible();

  await createTrip(page, '오사카');
  await configureSync(page);
  await enableAi(page);

  await page.getByTestId('ai-suggest-open').click();
  await page.getByTestId('ai-suggest-run').click();
  await expect(page.getByTestId('ai-suggestion')).toHaveCount(3);

  await page.getByTestId('ai-suggest-add-all').click();
  await expect(page.getByTestId('ai-suggestion-add').nth(2)).toHaveText('추가됨');
  await page.getByTestId('sheet-close').click();

  await expect(page.getByTestId('board-card')).toHaveCount(3);
  // `없는칸` matches nothing, so it lands in the first column (이동수단)
  // rather than being silently dropped.
  await expect(
    page.getByTestId('board-column').first().getByTestId('board-card').filter({ hasText: '야시장 구경' }),
  ).toHaveCount(1);
});

test('검색 기반 질문은 답과 출처를 함께 보여준다', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('tab-bar')).toBeVisible();

  await createTrip(page, '오사카');
  await configureSync(page);
  await enableAi(page);

  await expect(page.getByTestId('ai-ask-open')).toBeVisible();
  await page.getByTestId('ai-ask-open').click();
  await expect(page.getByTestId('ai-ask')).toBeVisible();

  await page.getByTestId('ai-ask-grounding').check();
  await page.getByTestId('ai-ask-input').fill('비 오는 날 어디 가요?');
  await page.getByTestId('ai-ask-submit').click();

  await expect(page.getByTestId('ai-ask-answer')).toHaveCount(1);
  // Two text parts, joined — a client that took `parts[0]` would fail here.
  await expect(page.getByTestId('ai-ask-answer')).toContainText('우메다 스카이빌딩');
  await expect(page.getByTestId('ai-ask-answer')).toContainText('우산은 편의점에서');

  await expect(page.getByTestId('ai-ask-citation')).toHaveCount(2);
  const first = page.getByTestId('ai-ask-citation').first();
  await expect(first).toHaveAttribute('href', 'https://osaka-info.jp/');
  await expect(first).toHaveAttribute('target', '_blank');
  await expect(first).toHaveAttribute('rel', /noopener/);

  const ask = api.aiCalls().find((call) => call.kind === 'ask');
  expect(ask?.grounding).toBe(true);
  // Grounding and a schema cannot travel together.
  expect(ask?.schema).toBeUndefined();
  expect(ask?.prompt).toContain('비 오는 날 어디 가요?');

  // The input clears and a second turn stacks under the first (session memory).
  await expect(page.getByTestId('ai-ask-input')).toHaveValue('');
  await page.getByTestId('ai-ask-input').fill('환전은요?');
  await page.getByTestId('ai-ask-submit').click();
  await expect(page.getByTestId('ai-ask-turn')).toHaveCount(2);

  // …and is forgotten on close. Nothing about a chat is persisted.
  await page.getByTestId('sheet-close').click();
  await page.getByTestId('ai-ask-open').click();
  await expect(page.getByTestId('ai-ask-turn')).toHaveCount(0);
});

test('일정에 카드가 있어야 AI 검토가 나타난다', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('tab-bar')).toBeVisible();

  await createTrip(page, '오사카');
  await configureSync(page);
  await enableAi(page);

  // A card on the board, then a day, then the card onto the day.
  await page.getByTestId('board-column').nth(4).getByTestId('add-card').click();
  await page.getByTestId('card-title-input').fill('유니버설');
  await page.getByTestId('card-submit').click();
  await expect(page.getByTestId('card-form')).toHaveCount(0);

  await page.getByTestId('tab-timeline').click();
  await expect(page.getByTestId('view-timeline')).toBeVisible();

  // An empty sheet has nothing to review, so the button is not there yet.
  await expect(page.getByTestId('ai-review-open')).toHaveCount(0);

  await page.getByTestId('timeline-add-day-empty').click();
  await expect(page.getByTestId('timeline-day')).toHaveCount(1);
  await expect(page.getByTestId('ai-review-open')).toHaveCount(0);

  await page.getByTestId('tab-board').click();
  await page.getByTestId('board-card').filter({ hasText: '유니버설' }).first().click();
  await expect(page.getByTestId('card-form')).toBeVisible();
  await page.getByTestId('card-schedule').click();
  await expect(page.getByTestId('schedule-sheet')).toBeVisible();
  await page.getByTestId('schedule-submit').click();
  await expect(page.getByTestId('schedule-sheet')).toHaveCount(0);

  await page.getByTestId('tab-timeline').click();
  await expect(page.getByTestId('ai-review-open')).toBeVisible();

  await page.getByTestId('ai-review-open').click();
  await expect(page.getByTestId('ai-review')).toBeVisible();
  await expect(page.getByTestId('ai-review-result')).toBeVisible();
  await expect(page.getByTestId('ai-review-result').locator('li')).toHaveCount(3);
  // The bullet markers are stripped; the sentences survive.
  await expect(page.getByTestId('ai-review-result')).toContainText('첫날 오전에 일정이 세 개');
  await expect(page.getByTestId('ai-review-result')).not.toContainText('- 첫날');
  await expect(page.getByTestId('ai-review')).toContainText('AI 제안은 참고용이에요');

  const review = api.aiCalls().find((call) => call.kind === 'review');
  expect(review?.prompt).toContain('유니버설');
  expect(review?.grounding).toBeUndefined();
});
