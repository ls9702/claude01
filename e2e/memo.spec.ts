import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

/**
 * 메모 탭 — M21.
 *
 * The tab is a chat: what these specs pin down is the shape of a conversation
 * rather than the shape of a form. Whose bubble is on which side, that the
 * input empties when a line is sent, that the thread survives a reload (the
 * messages are ordinary workspace entities, so this is the same proof the sync
 * milestones lean on), that a photo really goes through the app's own compress
 * → blob → thumbnail pipeline, and that a delete leaves the stub the other
 * person will see rather than a hole in the thread.
 */

const PHOTO = fileURLToPath(new URL('./fixtures/photo.png', import.meta.url));

/** Creates a trip from the 여행 tab and lands on its board. */
async function createTrip(page: Page, title: string): Promise<void> {
  await page.getByTestId('add-trip').click();
  await page.getByTestId('trip-title-input').fill(title);
  await page.getByTestId('trip-submit').click();
  await expect(page.getByTestId('trip-form')).toHaveCount(0);
  await page.getByTestId('trip-card').filter({ hasText: title }).getByTestId('trip-open').click();
  await expect(page).toHaveURL(/#\/board$/);
}

/** Opens the 메모 tab of the trip that is already active. */
async function openMemo(page: Page): Promise<void> {
  await page.getByTestId('tab-memo').click();
  await expect(page).toHaveURL(/#\/memo$/);
  await expect(page.getByTestId('memo-thread')).toBeVisible();
}

/** Types one line and sends it, then waits for its bubble. */
async function send(page: Page, text: string): Promise<void> {
  await page.getByTestId('memo-input').fill(text);
  await page.getByTestId('memo-send').click();
  await expect(page.getByTestId('memo-msg').filter({ hasText: text })).toHaveCount(1);
}

/**
 * Waits until the workspace blob in IndexedDB mentions `needle`, so a
 * `reload()` cannot race the persist middleware's write. (Same helper as
 * `photos.spec.ts` / `safety.spec.ts`, for the same reason.)
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

/** Switches the device's profile through 설정 (see `profile.spec.ts`). */
async function switchProfile(page: Page, profile: 'song' | 'hoyabom'): Promise<void> {
  await page.getByTestId('sync-chip').click();
  await expect(page.getByTestId('sync-settings')).toBeVisible();
  await page.getByTestId('profile-switch').click();
  await page.locator(`[data-testid="profile-option"][data-profile="${profile}"]`).click();
  await expect(page.getByTestId('profile-current')).toHaveAttribute('data-profile', profile);
  await page.getByTestId('sheet-close').click();
  await expect(page.getByTestId('sync-settings')).toHaveCount(0);
}

test('메모 탭에서 보낸 글이 내 말풍선으로 서고, 입력칸은 비워진다', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('tab-bar')).toBeVisible();

  await createTrip(page, '오사카');
  await openMemo(page);

  // 빈 스레드는 빈 스레드라고 말한다.
  await expect(page.getByTestId('memo-empty')).toBeVisible();
  await expect(page.getByTestId('memo-send')).toBeDisabled();

  await send(page, '내일 우메다 어때?');

  const bubble = page.getByTestId('memo-msg');
  await expect(bubble).toHaveCount(1);
  await expect(bubble).toHaveAttribute('data-own', 'true');
  // 내 말풍선에는 아바타가 없다 — 내가 누구인지는 나도 안다.
  await expect(bubble.getByTestId('avatar')).toHaveCount(0);
  await expect(bubble.getByTestId('memo-msg-time')).toHaveText(/^\d{2}:\d{2}$/);
  await expect(page.getByTestId('memo-day')).toHaveCount(1);
  await expect(page.getByTestId('memo-empty')).toHaveCount(0);

  // 보내고 나면 입력칸은 비어 있고, 보내기는 다시 잠긴다.
  await expect(page.getByTestId('memo-input')).toHaveValue('');
  await expect(page.getByTestId('memo-send')).toBeDisabled();
});

test('메시지는 순서대로 쌓이고, 새로고침해도 그대로다', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('tab-bar')).toBeVisible();

  await createTrip(page, '삿포로');
  await openMemo(page);

  await send(page, '스프카레 먼저');
  await send(page, '그다음 시내 구경');
  await expect(page.getByTestId('memo-msg')).toHaveCount(2);

  // 메시지는 평범한 워크스페이스 엔티티다 — 그래서 새로고침을 견딘다.
  await waitForPersisted(page, '그다음 시내 구경');
  await page.reload();
  await expect(page.getByTestId('tab-bar')).toBeVisible();
  await expect(page).toHaveURL(/#\/memo$/);

  const bubbles = page.getByTestId('memo-msg');
  await expect(bubbles).toHaveCount(2);
  await expect(bubbles.nth(0)).toContainText('스프카레 먼저');
  await expect(bubbles.nth(1)).toContainText('그다음 시내 구경');
  // 하루에 보낸 두 줄은 날짜 칩 하나를 나눠 쓴다.
  await expect(page.getByTestId('memo-day')).toHaveCount(1);
});

test('사진을 붙여 보내면 말풍선에 뜨고, 눌러서 크게 볼 수 있다', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('tab-bar')).toBeVisible();

  await createTrip(page, '다낭');
  await openMemo(page);

  // 사진은 붙인 순간 압축·저장되고, 보내기 전까지는 입력줄에 대기한다.
  await page.getByTestId('memo-photo-input').setInputFiles(PHOTO);
  await expect(page.getByTestId('memo-staged-photo')).toHaveCount(1, { timeout: 15_000 });
  await expect(page.getByTestId('memo-send')).toBeEnabled();

  await page.getByTestId('memo-input').fill('여기 미케비치');
  await page.getByTestId('memo-send').click();

  const bubble = page.getByTestId('memo-msg');
  await expect(bubble).toHaveCount(1);
  await expect(bubble).toContainText('여기 미케비치');
  await expect(page.getByTestId('memo-staged-photo')).toHaveCount(0);

  const thumb = page.getByTestId('memo-photo');
  await expect(thumb).toHaveCount(1);
  await expect(thumb).toHaveAttribute('data-loaded', 'true', { timeout: 15_000 });
  const photoId = await thumb.getAttribute('data-photo-id');
  expect(photoId).toBeTruthy();

  await thumb.click();
  await expect(page.getByTestId('photo-lightbox')).toBeVisible();
  await expect(page.getByTestId('photo-lightbox-image')).toHaveAttribute(
    'data-photo-id',
    photoId as string,
  );
  // 메모 사진은 메시지째로 지운다 — 라이트박스에는 삭제 버튼이 없다.
  await expect(page.getByTestId('photo-lightbox-delete')).toHaveCount(0);
  await page.getByTestId('photo-lightbox-close').click();
  await expect(page.getByTestId('photo-lightbox')).toHaveCount(0);
});

test('클립보드의 그림을 Ctrl+V로 붙이면 첨부로 대기한다 (M26)', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('tab-bar')).toBeVisible();

  await createTrip(page, '나고야');
  await openMemo(page);

  // 진짜 클립보드는 헤드리스에서 만질 수 없으니, 같은 이벤트를 손으로 만들어
  // 던진다 — 컴포저가 듣는 것은 window의 `paste` 하나뿐이다.
  const { readFileSync } = await import('node:fs');
  const base64 = readFileSync(PHOTO).toString('base64');
  await page.evaluate((data) => {
    const bytes = Uint8Array.from(atob(data), (ch) => ch.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], 'screenshot.png', { type: 'image/png' }));
    window.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true }),
    );
  }, base64);

  await expect(page.getByTestId('memo-staged-photo')).toHaveCount(1, { timeout: 15_000 });

  // 붙인 그림도 보내면 여느 사진 메시지와 같다.
  await page.getByTestId('memo-input').fill('이 가게 어때?');
  await page.getByTestId('memo-send').click();
  const bubble = page.getByTestId('memo-msg');
  await expect(bubble).toHaveCount(1);
  await expect(bubble).toContainText('이 가게 어때?');
  await expect(bubble.getByTestId('memo-photo')).toHaveCount(1);
});

test('내 메시지를 지우면 「삭제된 메시지」 자리만 남는다', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('tab-bar')).toBeVisible();

  await createTrip(page, '타이베이');
  await openMemo(page);

  await send(page, '지우펀 오후에');
  await send(page, '오타 났다');

  // 지울 수 있는 건 내 메시지뿐이고, 지우기 전에 한 번 묻는다.
  await page.getByTestId('memo-msg-menu').nth(1).click();
  await expect(page.getByTestId('memo-msg-menu-panel')).toBeVisible();
  await page.getByTestId('memo-msg-delete').click();
  await expect(page.getByTestId('memo-delete-confirm')).toBeVisible();
  await page.getByTestId('confirm-accept').click();

  const bubbles = page.getByTestId('memo-msg');
  await expect(bubbles).toHaveCount(2);
  await expect(bubbles.nth(0)).toContainText('지우펀 오후에');
  // 스텁은 자리를 지킨다 — 대화에 구멍이 나지 않는다.
  await expect(bubbles.nth(1)).toHaveAttribute('data-removed', 'true');
  await expect(bubbles.nth(1)).toContainText('삭제된 메시지예요');
  await expect(bubbles.nth(1)).not.toContainText('오타 났다');
  // 지워진 줄에는 더 지울 것이 없다.
  await expect(page.getByTestId('memo-msg-menu')).toHaveCount(1);
});

test('한글 조합 중의 Enter는 전송이 아니다 — 마지막 글자가 따로 가지 않는다 (M23)', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('tab-bar')).toBeVisible();

  await createTrip(page, '교토');
  await openMemo(page);

  // IME가 마지막 음절을 확정하며 쏘는 keydown — `isComposing`이 그 표식이다.
  // 예전에는 이걸 전송으로 받아들여 "…있어요"가 먼저 가고 "오"가 뒤따랐다.
  await page.getByTestId('memo-input').fill('료칸 예약했어요');
  await page.getByTestId('memo-input').evaluate((node) => {
    node.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
        isComposing: true,
      }),
    );
  });
  await expect(page.getByTestId('memo-msg')).toHaveCount(0);
  await expect(page.getByTestId('memo-input')).toHaveValue('료칸 예약했어요');

  // 조합이 끝난 뒤의 진짜 Enter는 여전히 보낸다 — 한 줄, 통째로.
  await page.getByTestId('memo-input').press('Enter');
  const bubble = page.getByTestId('memo-msg');
  await expect(bubble).toHaveCount(1);
  await expect(bubble).toContainText('료칸 예약했어요');
  await expect(page.getByTestId('memo-input')).toHaveValue('');
});

test('내 말풍선을 길게 누르면(우클릭) 삭제 메뉴가 뜬다 (M23)', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('tab-bar')).toBeVisible();

  await createTrip(page, '하코다테');
  await openMemo(page);
  await send(page, '야경은 로프웨이로');

  // 마우스의 우클릭은 터치의 길게 누르기와 같은 `contextmenu` 경로를 탄다.
  await page.getByTestId('memo-bubble').click({ button: 'right' });
  await expect(page.getByTestId('memo-msg-menu-panel')).toBeVisible();
  await page.getByTestId('memo-msg-delete').click();
  await expect(page.getByTestId('memo-delete-confirm')).toBeVisible();
  await page.getByTestId('confirm-accept').click();

  const bubbles = page.getByTestId('memo-msg');
  await expect(bubbles).toHaveCount(1);
  await expect(bubbles).toHaveAttribute('data-removed', 'true');
});

test('상대가 쓴 메시지는 아바타를 달고 왼쪽에 선다', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('tab-bar')).toBeVisible();

  await createTrip(page, '오키나와');
  await openMemo(page);
  await send(page, '츄라우미 가고 싶어');

  // 이 기기가 다른 사람이 되면, 방금 그 줄은 「상대의 말」이 된다.
  await switchProfile(page, 'hoyabom');
  await openMemo(page);

  const theirs = page.getByTestId('memo-msg').first();
  await expect(theirs).toHaveAttribute('data-own', 'false');
  await expect(theirs.getByTestId('avatar')).toHaveAttribute('data-profile', 'song');
  await expect(theirs.getByTestId('memo-msg-author')).toHaveText('songlee');
  // 남의 말풍선에는 삭제 메뉴가 없다.
  await expect(theirs.getByTestId('memo-msg-menu')).toHaveCount(0);

  await send(page, '나도');
  const mine = page.getByTestId('memo-msg').nth(1);
  await expect(mine).toHaveAttribute('data-own', 'true');
  await expect(mine.getByTestId('avatar')).toHaveCount(0);
});
