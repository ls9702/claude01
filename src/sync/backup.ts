/**
 * 백업 넛지 — "when did you last take a copy of this out of the browser?" (M7a)
 *
 * Trip Board's real data lives in one IndexedDB blob. On iOS that blob is
 * evictable, on a shared PC the profile gets wiped, and the NAS sync is
 * optional. So the one thing the app should nag about is 내보내기.
 *
 * Like `settings.ts` this is **per-device** `localStorage` state, never part of
 * the synced workspace: "이 기기에서 마지막으로 백업한 시각" is meaningless on
 * another phone. Everything is defensive so Node (vitest) and private windows
 * with storage disabled behave like "never backed up" instead of throwing.
 *
 * The decision logic is split into pure functions ({@link daysBetween},
 * {@link isWorkspaceWorthBacking}, {@link shouldNudgeBackup},
 * {@link formatLastBackup}) so it can be unit-tested without a DOM.
 */

import type { Millis, Workspace } from '../types/models';

const BACKUP_KEY = 'trip-board/backup';

/** A day, in ms. */
const DAY_MS = 24 * 60 * 60 * 1_000;

/** Past this many days without a backup, the nudge is allowed to appear. */
export const BACKUP_STALE_DAYS = 14;

/** 나중에 (dismiss) hides the nudge for this long. */
export const BACKUP_SNOOZE_DAYS = 7;

/** A workspace below this is not worth nagging about — see {@link isWorkspaceWorthBacking}. */
export const BACKUP_MIN_CARDS = 5;

/** What the nudge remembers between reloads. */
export interface BackupState {
  /** When 내보내기 last produced a file on this device. */
  lastBackupAt?: Millis;
  /** When the user last dismissed the nudge. */
  snoozedAt?: Millis;
}

export const EMPTY_BACKUP_STATE: BackupState = {};

/** `localStorage`, or `null` where it is missing or blocked (Node, private mode). */
function storage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

/** Reads a finite number, or `undefined` for anything else. */
const millis = (value: unknown): Millis | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/** Reads the stored stamps, falling back to "never". */
export function loadBackupState(): BackupState {
  const store = storage();
  if (!store) return EMPTY_BACKUP_STATE;
  try {
    const raw = store.getItem(BACKUP_KEY);
    if (!raw) return EMPTY_BACKUP_STATE;
    const parsed = JSON.parse(raw) as Partial<BackupState>;
    return { lastBackupAt: millis(parsed.lastBackupAt), snoozedAt: millis(parsed.snoozedAt) };
  } catch {
    return EMPTY_BACKUP_STATE;
  }
}

/** Persists both stamps. Silently does nothing where storage is unavailable. */
export function saveBackupState(state: BackupState): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(BACKUP_KEY, JSON.stringify(state));
  } catch {
    /* quota / private mode — the nudge is a convenience, never fatal */
  }
}

/**
 * Stamps "backed up just now" and clears any snooze — taking a backup is the
 * thing the nudge was asking for, so the countdown restarts from scratch.
 * Called from {@link exportJson}.
 */
export function markBackedUp(now: Millis = Date.now()): void {
  saveBackupState({ lastBackupAt: now, snoozedAt: undefined });
}

/** Hides the nudge for {@link BACKUP_SNOOZE_DAYS}, keeping `lastBackupAt`. */
export function snoozeBackupNudge(now: Millis = Date.now()): void {
  saveBackupState({ ...loadBackupState(), snoozedAt: now });
}

/** Whole days from `at` to `now`; `null` when `at` is missing. Never negative. */
export function daysBetween(at: Millis | undefined, now: Millis = Date.now()): number | null {
  if (at === undefined || !Number.isFinite(at)) return null;
  return Math.max(0, Math.floor((now - at) / DAY_MS));
}

/** Nudge copy for "you have never taken a backup on this device". */
export const NEVER_BACKED_UP_TEXT = '아직 백업한 적이 없어요';

/** Nudge copy for "the last backup is older than {@link BACKUP_STALE_DAYS}". */
export const STALE_BACKUP_TEXT = '백업한 지 오래됐어요';

/**
 * What the 백업 넛지 should actually say (B20).
 *
 * The chip claimed "백업한 지 오래됐어요" to someone who had never backed up at
 * all, which is both wrong and the less alarming of the two facts. The trigger
 * ({@link shouldNudgeBackup}) is unchanged — only the sentence.
 */
export const backupNudgeText = (at: Millis | undefined): string =>
  daysBetween(at) === null ? NEVER_BACKED_UP_TEXT : STALE_BACKUP_TEXT;

/** `없음` / `오늘` / `3일 전` for the settings sheet. */
export function formatLastBackup(at: Millis | undefined, now: Millis = Date.now()): string {
  const days = daysBetween(at, now);
  if (days === null) return '없음';
  if (days === 0) return '오늘';
  return `${days}일 전`;
}

/**
 * True when there is enough in the workspace that losing it would hurt.
 *
 * One trip with five cards is the line: below that the user is still poking at
 * the app, and a "백업하세요" chip on an empty board is just noise.
 */
export function isWorkspaceWorthBacking(workspace: Workspace): boolean {
  const cardsByTrip = new Map<string, number>();
  for (const card of Object.values(workspace.cards)) {
    cardsByTrip.set(card.tripId, (cardsByTrip.get(card.tripId) ?? 0) + 1);
  }
  for (const tripId of Object.keys(workspace.trips)) {
    if ((cardsByTrip.get(tripId) ?? 0) >= BACKUP_MIN_CARDS) return true;
  }
  return false;
}

/**
 * Should the 백업 nudge chip be on screen?
 *
 * Never backed up, or backed up more than {@link BACKUP_STALE_DAYS} ago, AND
 * the workspace is worth backing up, AND the user has not dismissed it within
 * the last {@link BACKUP_SNOOZE_DAYS}.
 */
export function shouldNudgeBackup(
  state: BackupState,
  worthBacking: boolean,
  now: Millis = Date.now(),
): boolean {
  if (!worthBacking) return false;

  const snoozedDays = daysBetween(state.snoozedAt, now);
  if (snoozedDays !== null && snoozedDays < BACKUP_SNOOZE_DAYS) return false;

  const backedUpDays = daysBetween(state.lastBackupAt, now);
  if (backedUpDays === null) return true;
  return backedUpDays > BACKUP_STALE_DAYS;
}
