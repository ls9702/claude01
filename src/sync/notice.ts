/**
 * 공지 (M47) — the one line the administrator can put above every tab.
 *
 * The banner itself is dumb: the server hands the app `{text, at}` on every
 * `?meta=1` probe and the app draws it. The only decision worth a module is
 * **when a dismissed notice comes back**, and the answer is: when it is a
 * different notice.
 *
 * "Different" is the *text*, not the timestamp. Re-posting the same sentence
 * because a phone was off is not news, and a `at`-based rule would make it news
 * every time. Editing the sentence is news, and so is taking one down and
 * putting a new one up. So this device remembers the text it dismissed — one
 * short string in `localStorage`, per device, never merged, never synced.
 */

import type { ServerNotice } from './api';

/** Where this device remembers the 공지 it closed. */
export const NOTICE_DISMISSED_KEY = 'trip-board/notice-dismissed';

function storage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

/** The notice text this device has closed, or `null`. */
export function loadDismissedNotice(): string | null {
  try {
    return storage()?.getItem(NOTICE_DISMISSED_KEY) ?? null;
  } catch {
    return null;
  }
}

/** Remembers that this exact text has been closed here. */
export function saveDismissedNotice(text: string): void {
  try {
    storage()?.setItem(NOTICE_DISMISSED_KEY, text);
  } catch {
    /* private mode — the banner simply comes back on the next reload */
  }
}

/** Forgets the dismissal (tests, and 해제). */
export function clearDismissedNotice(): void {
  try {
    storage()?.removeItem(NOTICE_DISMISSED_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Should the banner be on screen? The whole rule, as a pure function.
 *
 * Blank text is not a notice — that is how "내리기" reaches a device that never
 * saw the notice go up.
 */
export function shouldShowNotice(
  notice: ServerNotice | null | undefined,
  dismissed: string | null,
): boolean {
  const text = notice?.text?.trim() ?? '';
  if (text === '') return false;
  return text !== dismissed;
}
