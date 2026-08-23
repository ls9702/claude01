import { expect, test, type Page } from '@playwright/test';

/**
 * 데이터 안전 (M7a) — 전역 삭제 실행취소 + 백업 넛지 + 오프라인 지도 힌트.
 *
 * Everything here is deterministic by construction: the backup stamps are
 * seeded into `localStorage` before the app boots, `navigator.onLine` is
 * stubbed rather than the network being cut, and the only tile request the
 * suite can make is answered with a 1×1 png. Nothing waits on a wall clock.
 */

const DAY_MS = 24 * 60 * 60 * 1_000;

/** A transparent 1×1 png — enough for Leaflet to count as a loaded tile. */
const TILE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** Creates a trip from the 여행 tab and opens its board. */
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

/**
 * Waits until the workspace blob in IndexedDB mentions `needle`, so a
 * `reload()` cannot race the persist middleware's write.
 */
async function waitForPersisted(page: Page, needle: string): Promise<void> {
  await expect
    .poll(
      () =>
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
                  read.onsuccess = () =>
                    resolve(typeof read.result === 'string' ? read.result : '');
                  read.onerror = () => resolve('');
                } catch {
                  resolve('');
                }
              };
            }),
          'trip-board/workspace',
        ),
      { timeout: 5_000 },
    )
    .toContain(needle);
}

/* ------------------------------------------------------------------ *
 * 전역 삭제 실행취소
 * ------------------------------------------------------------------ */

test('여행을 지워도 실행 취소하면 보드까지 그대로 돌아온다', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('tab-bar')).toBeVisible();

  await createTrip(page, '오사카');
  await addCard(page, 0, '간사이공항 리무진');
  await addCard(page, 2, '이치란 라멘');

  await page.getByTestId('tab-trips').click();
  await page.getByTestId('trip-card').filter({ hasText: '오사카' }).getByTestId('trip-delete').click();
  await expect(page.getByTestId('trip-delete-confirm')).toBeVisible();
  await page.getByTestId('confirm-accept').click();

  // Gone — and the toast is offering it back for 10초, not the usual 4.
  await expect(page.getByTestId('trip-card')).toHaveCount(0);
  await expect(page.getByTestId('trips-empty')).toBeVisible();
  await expect(page.getByTestId('undo-toast')).toBeVisible();
  await expect(page.getByTestId('undo-toast')).toHaveAttribute('data-duration', '10000');
  await expect(page.getByTestId('undo-message')).toHaveText('여행 「오사카」 삭제됨');

  await page.getByTestId('undo-action').click();

  await expect(page.getByTestId('undo-toast')).toHaveCount(0);
  const restored = page.getByTestId('trip-card').filter({ hasText: '오사카' });
  await expect(restored).toHaveCount(1);
  await expect(restored).toContainText('카테고리 5');
  await expect(restored).toContainText('카드 2');

  // The board underneath survived intact, cards in their original columns.
  await restored.getByTestId('trip-open').click();
  const columns = page.getByTestId('board-column');
  await expect(columns).toHaveCount(5);
  await expect(columns.nth(0)).toContainText('간사이공항 리무진');
  await expect(columns.nth(2)).toContainText('이치란 라멘');
});

test('카드와 카테고리 삭제도 같은 토스트로 되돌린다', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('tab-bar')).toBeVisible();

  await createTrip(page, '삿포로');
  await addCard(page, 1, '유심 사기');

  // --- 카드 ---------------------------------------------------------
  await page.getByTestId('board-card').filter({ hasText: '유심 사기' }).click();
  await expect(page.getByTestId('card-form')).toBeVisible();
  await page.getByTestId('card-delete').click();

  await expect(page.getByTestId('board-card')).toHaveCount(0);
  await expect(page.getByTestId('undo-message')).toHaveText('카드 「유심 사기」 삭제됨');
  await page.getByTestId('undo-action').click();
  await expect(page.getByTestId('board-card').filter({ hasText: '유심 사기' })).toHaveCount(1);

  // --- 카테고리 (its cards move away, then move back) -----------------
  await page.getByTestId('board-column').nth(1).getByTestId('edit-column').click();
  await expect(page.getByTestId('column-form')).toBeVisible();
  await page.getByTestId('column-delete').click();
  await expect(page.getByTestId('column-delete-confirm')).toBeVisible();
  await page.getByTestId('confirm-accept').click();

  await expect(page.getByTestId('board-column')).toHaveCount(4);
  await expect(page.getByTestId('undo-message')).toHaveText('카테고리 「할일」 삭제됨');
  await page.getByTestId('undo-action').click();

  const columns = page.getByTestId('board-column');
  await expect(columns).toHaveCount(5);
  await expect(columns.nth(1)).toContainText('할일');
  await expect(columns.nth(1)).toContainText('유심 사기');
  await expect(columns.nth(0).getByTestId('board-card')).toHaveCount(0);
});

/* ------------------------------------------------------------------ *
 * 백업 넛지
 * ------------------------------------------------------------------ */

/** Seeds "last backed up 30 days ago" without clobbering a later snooze. */
async function seedStaleBackup(page: Page, days = 30): Promise<void> {
  await page.addInitScript((stamp: number) => {
    if (!localStorage.getItem('trip-board/backup')) {
      localStorage.setItem('trip-board/backup', JSON.stringify({ lastBackupAt: stamp }));
    }
  }, Date.now() - days * DAY_MS);
}

test('백업이 오래된 데다 데이터가 쌓이면 넛지가 뜨고, 닫으면 일주일 조용해진다', async ({
  page,
}) => {
  await seedStaleBackup(page, 30);
  await page.goto('/');
  await expect(page.getByTestId('tab-bar')).toBeVisible();

  await createTrip(page, '다낭');

  // Four cards is still "just poking at the app" — no nagging.
  for (const title of ['미케비치', '바나힐', '한강다리', '반쎄오']) {
    await addCard(page, 0, title);
  }
  await expect(page.getByTestId('backup-nudge')).toHaveCount(0);

  // The fifth crosses the line.
  await addCard(page, 1, '용다리 불쇼');
  await expect(page.getByTestId('backup-nudge')).toBeVisible();
  await expect(page.getByTestId('backup-nudge')).toContainText('백업한 지 오래됐어요');

  // It opens the settings sheet, which spells the age out.
  await page.getByTestId('backup-nudge-open').click();
  await expect(page.getByTestId('sync-settings')).toBeVisible();
  await expect(page.getByTestId('backup-last')).toHaveAttribute('data-days', '30');
  await expect(page.getByTestId('backup-last')).toHaveText('30일 전');
  await page.getByTestId('sheet-close').click();
  await expect(page.getByTestId('sync-settings')).toHaveCount(0);
  await expect(page.getByTestId('backup-nudge')).toBeVisible();

  // ✕ snoozes it, and the snooze survives a reload.
  await page.getByTestId('backup-nudge-dismiss').click();
  await expect(page.getByTestId('backup-nudge')).toHaveCount(0);

  await waitForPersisted(page, '용다리 불쇼');
  await page.reload();
  await expect(page.getByTestId('tab-bar')).toBeVisible();
  // A reload lands back on 보드; hop to 여행 to prove the workspace rehydrated
  // (an empty one would hide the nudge for the wrong reason).
  await page.getByTestId('tab-trips').click();
  await expect(page.getByTestId('trip-card').filter({ hasText: '다낭' })).toContainText('카드 5');
  await expect(page.getByTestId('backup-nudge')).toHaveCount(0);
});

test('백업한 적 없어도 데이터가 적으면 넛지는 안 뜬다', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('tab-bar')).toBeVisible();

  await createTrip(page, '타이베이');
  await addCard(page, 0, '지우펀');

  await expect(page.getByTestId('backup-nudge')).toHaveCount(0);

  // And with nothing backed up at all the settings sheet says so.
  await page.getByTestId('sync-chip').click();
  await expect(page.getByTestId('backup-last')).toHaveText('없음');
  await expect(page.getByTestId('backup-last')).toHaveAttribute('data-days', '-1');
});

/* ------------------------------------------------------------------ *
 * 오프라인 지도 힌트
 * ------------------------------------------------------------------ */

test('오프라인이면 지도에 한 줄 안내가 뜬다', async ({ page }) => {
  await page.route(/tile\.openstreetmap\.org/, (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: TILE_PNG }),
  );
  await page.goto('/');
  await expect(page.getByTestId('tab-bar')).toBeVisible();

  await createTrip(page, '가고시마');
  await page.getByTestId('tab-map').click();
  await expect(page.getByTestId('map-root')).toBeVisible();
  await expect(page.getByTestId('map-offline-hint')).toHaveCount(0);

  // Stub the flag rather than cutting the network: the hint is about
  // `navigator.onLine`, and a real disconnect would take the preview server
  // with it.
  await page.evaluate(() => {
    Object.defineProperty(window.navigator, 'onLine', { get: () => false, configurable: true });
    window.dispatchEvent(new Event('offline'));
  });

  await expect(page.getByTestId('map-offline-hint')).toHaveText(
    '오프라인이라 지도를 불러올 수 없어요',
  );

  await page.evaluate(() => {
    Object.defineProperty(window.navigator, 'onLine', { get: () => true, configurable: true });
    window.dispatchEvent(new Event('online'));
  });
  await expect(page.getByTestId('map-offline-hint')).toHaveCount(0);
});
