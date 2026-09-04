import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

/**
 * 카드 사진 첨부 (M10).
 *
 * The point of the milestone is that the pixels live **outside** the workspace
 * blob, so the load-bearing assertion in here is a `reload()`: a thumbnail that
 * comes back after the page has been thrown away proves the bytes really are in
 * their own IndexedDB store and really were keyed by the id the card carries.
 *
 * The fixtures are two tiny committed PNGs. They go in through the real file
 * input, get decoded, downscaled and JPEG-encoded by the app's own pipeline —
 * nothing about the add path is stubbed.
 */

const PHOTO = fileURLToPath(new URL('./fixtures/photo.png', import.meta.url));
const PHOTO_2 = fileURLToPath(new URL('./fixtures/photo2.png', import.meta.url));

async function createTrip(page: Page, title: string): Promise<void> {
  await page.getByTestId('add-trip').click();
  await page.getByTestId('trip-title-input').fill(title);
  await page.getByTestId('trip-submit').click();
  await expect(page.getByTestId('trip-form')).toHaveCount(0);
  await page.getByTestId('trip-card').filter({ hasText: title }).getByTestId('trip-open').click();
  await expect(page).toHaveURL(/#\/board$/);
}

async function addCard(page: Page, columnIndex: number, title: string): Promise<void> {
  await page.getByTestId('board-column').nth(columnIndex).getByTestId('add-card').click();
  await page.getByTestId('card-title-input').fill(title);
  await page.getByTestId('card-submit').click();
  await expect(page.getByTestId('card-form')).toHaveCount(0);
}

/** Opens a card's edit sheet from the board. */
async function openCard(page: Page, title: string): Promise<void> {
  await page.getByTestId('board-card').filter({ hasText: title }).first().click();
  await expect(page.getByTestId('card-form')).toBeVisible();
  await expect(page.getByTestId('card-photos')).toBeVisible();
}

/** Attaches one file and waits for its thumbnail to finish loading. */
async function attach(page: Page, path: string, expected: number): Promise<void> {
  await page.getByTestId('card-photo-input').setInputFiles(path);
  await expect(page.getByTestId('card-photo-thumb')).toHaveCount(expected, { timeout: 15_000 });
  await expect(page.getByTestId('card-photo-thumb').nth(expected - 1)).toHaveAttribute(
    'data-loaded',
    'true',
    { timeout: 15_000 },
  );
}

/**
 * Waits until the workspace blob in IndexedDB mentions `needle`, so a
 * `reload()` cannot race the persist middleware's write. (Same helper as
 * `safety.spec.ts` — the reason it exists is the same too.)
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
      { timeout: 8_000 },
    )
    .toContain(needle);
}

test('카드에 사진을 붙이면 칩이 서고, 새로고침해도 남아 있다', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('tab-bar')).toBeVisible();

  await createTrip(page, '오사카');
  await addCard(page, 4, '츠텐카쿠');
  await openCard(page, '츠텐카쿠');

  await expect(page.getByTestId('card-photo-count')).toHaveText('0/12');
  await attach(page, PHOTO, 1);
  await expect(page.getByTestId('card-photo-count')).toHaveText('1/12');

  const photoId = await page.getByTestId('card-photo-thumb').getAttribute('data-photo-id');
  expect(photoId).toBeTruthy();

  await page.getByTestId('sheet-close').click();
  await expect(page.getByTestId('card-form')).toHaveCount(0);
  await expect(page.getByTestId('card-chip-photos')).toHaveText('1장');

  // --- the load-bearing bit: the bytes are not in the workspace blob --------
  await waitForPersisted(page, photoId as string);
  await page.reload();
  await expect(page.getByTestId('tab-bar')).toBeVisible();
  await expect(page.getByTestId('card-chip-photos')).toHaveText('1장');

  await openCard(page, '츠텐카쿠');
  const thumb = page.getByTestId('card-photo-thumb');
  await expect(thumb).toHaveCount(1);
  await expect(thumb).toHaveAttribute('data-photo-id', photoId as string);
  await expect(thumb).toHaveAttribute('data-loaded', 'true', { timeout: 15_000 });
});

test('라이트박스에서 넘겨 보고, 지우면 카드까지 줄어든다', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('tab-bar')).toBeVisible();

  await createTrip(page, '삿포로');
  await addCard(page, 2, '스프카레');
  await openCard(page, '스프카레');

  await attach(page, PHOTO, 1);
  await attach(page, PHOTO_2, 2);
  await expect(page.getByTestId('card-photo-count')).toHaveText('2/12');

  const ids = await page.getByTestId('card-photo-thumb').evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('data-photo-id')),
  );

  // --- 열기 · 넘기기 --------------------------------------------------
  await page.getByTestId('card-photo-thumb').first().click();
  const box = page.getByTestId('photo-lightbox');
  await expect(box).toBeVisible();
  await expect(page.getByTestId('photo-lightbox-counter')).toHaveText('1 / 2');
  await expect(page.getByTestId('photo-lightbox-image')).toHaveAttribute(
    'data-photo-id',
    ids[0] as string,
  );

  await page.getByTestId('photo-lightbox-next').click();
  await expect(page.getByTestId('photo-lightbox-counter')).toHaveText('2 / 2');
  await expect(page.getByTestId('photo-lightbox-image')).toHaveAttribute(
    'data-photo-id',
    ids[1] as string,
  );

  await page.getByTestId('photo-lightbox-prev').click();
  await expect(page.getByTestId('photo-lightbox-counter')).toHaveText('1 / 2');

  // 키보드도 같은 길이다.
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('photo-lightbox-counter')).toHaveText('2 / 2');

  // --- 삭제는 되돌릴 수 없으니 먼저 묻는다 -----------------------------
  await page.getByTestId('photo-lightbox-delete').click();
  await expect(page.getByTestId('photo-delete-confirm')).toBeVisible();
  await expect(page.getByTestId('photo-delete-confirm')).toContainText('사진을 삭제할까요?');
  await page.getByTestId('confirm-accept').click();

  await expect(page.getByTestId('photo-lightbox-counter')).toHaveText('1 / 1');
  await page.getByTestId('photo-lightbox-close').click();
  await expect(page.getByTestId('photo-lightbox')).toHaveCount(0);

  await expect(page.getByTestId('card-photo-thumb')).toHaveCount(1);
  await expect(page.getByTestId('card-photo-count')).toHaveText('1/12');

  await page.getByTestId('sheet-close').click();
  await expect(page.getByTestId('card-chip-photos')).toHaveText('1장');
});

test('마지막 한 장을 지우면 라이트박스가 닫히고 칩도 사라진다', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('tab-bar')).toBeVisible();

  await createTrip(page, '다낭');
  await addCard(page, 0, '미케비치');
  await openCard(page, '미케비치');
  await attach(page, PHOTO, 1);

  await page.getByTestId('card-photo-thumb').click();
  await expect(page.getByTestId('photo-lightbox')).toBeVisible();
  await page.getByTestId('photo-lightbox-delete').click();
  await page.getByTestId('confirm-accept').click();

  await expect(page.getByTestId('photo-lightbox')).toHaveCount(0);
  await expect(page.getByTestId('card-photo-thumb')).toHaveCount(0);
  await expect(page.getByTestId('card-photo-count')).toHaveText('0/12');

  await page.getByTestId('sheet-close').click();
  await expect(page.getByTestId('card-chip-photos')).toHaveCount(0);
});

test('사진 포함 백업으로 내보내고, 지운 여행을 사진까지 되살린다', async ({ page }) => {
  test.setTimeout(90_000);

  await page.goto('/');
  await expect(page.getByTestId('tab-bar')).toBeVisible();

  await createTrip(page, '오키나와');
  await addCard(page, 0, '츄라우미 수족관');
  await openCard(page, '츄라우미 수족관');
  await attach(page, PHOTO, 1);
  const photoId = await page.getByTestId('card-photo-thumb').getAttribute('data-photo-id');
  await page.getByTestId('sheet-close').click();

  // --- 사진 포함 내보내기 ---------------------------------------------
  await page.getByTestId('sync-chip').click();
  await expect(page.getByTestId('sync-settings')).toBeVisible();
  await expect(page.getByTestId('photo-usage')).toHaveAttribute('data-count', '1');

  const downloading = page.waitForEvent('download');
  await page.getByTestId('sync-export-photos').click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/-photos\.json$/);
  const backupPath = await download.path();
  await expect(page.getByTestId('sync-notice')).toContainText('사진 1장');
  await page.getByTestId('sheet-close').click();

  // --- 여행 삭제, 실행취소 기회는 흘려보낸다 ---------------------------
  await page.getByTestId('tab-trips').click();
  await page
    .getByTestId('trip-card')
    .filter({ hasText: '오키나와' })
    .getByTestId('trip-delete')
    .click();
  await page.getByTestId('confirm-accept').click();
  await expect(page.getByTestId('trips-empty')).toBeVisible();
  await expect(page.getByTestId('undo-toast')).toHaveCount(0, { timeout: 15_000 });

  // --- 가져오기 -------------------------------------------------------
  await page.getByTestId('sync-chip').click();
  await expect(page.getByTestId('sync-settings')).toBeVisible();
  await page.getByTestId('sync-import-input').setInputFiles(backupPath);

  const ask = page.getByTestId('import-restore-confirm');
  if (await ask.isVisible().catch(() => false)) {
    await page.getByTestId('confirm-accept').click();
  }
  // Decoding a photo-bearing backup and writing its blobs takes longer than
  // the 5s default under a loaded full-suite run — the same 15s the thumbnail
  // assertions in this file already allow for the same reason.
  // M51: 15s도 전체 스위트 부하에서 세 번 모자랐다(단독 실행은 매번 14s 안에
  // 끝난다). 사진 blob upsert까지 포함한 가져오기라 30s를 준다 — 기다림이지
  // 건너뜀이 아니다.
  await expect(page.getByTestId('sync-notice')).toContainText('가져왔어요 — 여행 1개', {
    timeout: 30_000,
  });
  await page.getByTestId('sheet-close').click();

  // --- 사진까지 돌아왔다 -----------------------------------------------
  const restored = page.getByTestId('trip-card').filter({ hasText: '오키나와' });
  await expect(restored).toHaveCount(1);
  await restored.getByTestId('trip-open').click();
  await expect(page.getByTestId('card-chip-photos')).toHaveText('1장');

  await openCard(page, '츄라우미 수족관');
  const thumb = page.getByTestId('card-photo-thumb');
  await expect(thumb).toHaveCount(1);
  await expect(thumb).toHaveAttribute('data-photo-id', photoId as string);
  await expect(thumb).toHaveAttribute('data-loaded', 'true', { timeout: 15_000 });
});

test('사진 없는 예전 백업도 그대로 가져와진다', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('tab-bar')).toBeVisible();

  await createTrip(page, '타이베이');
  await addCard(page, 0, '지우펀');

  await page.getByTestId('sync-chip').click();
  const downloading = page.waitForEvent('download');
  await page.getByTestId('sync-export').click();
  const download = await downloading;
  // The plain export is unchanged: no `-photos` suffix, no photo payload.
  expect(download.suggestedFilename()).not.toMatch(/-photos\.json$/);
  const backupPath = await download.path();
  await expect(page.getByTestId('sync-notice')).toHaveText('백업 파일을 내려받았어요');

  await page.getByTestId('sync-import-input').setInputFiles(backupPath as string);
  await expect(page.getByTestId('sync-notice')).toContainText('가져왔어요 — 여행 1개');
});
