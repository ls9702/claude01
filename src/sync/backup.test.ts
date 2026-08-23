import { describe, expect, it } from 'vitest';
import { emptyWorkspace, type Card, type Trip, type Workspace } from '../types/models';
import {
  BACKUP_MIN_CARDS,
  BACKUP_SNOOZE_DAYS,
  BACKUP_STALE_DAYS,
  NEVER_BACKED_UP_TEXT,
  STALE_BACKUP_TEXT,
  backupNudgeText,
  daysBetween,
  formatLastBackup,
  isWorkspaceWorthBacking,
  shouldNudgeBackup,
} from './backup';

/** A fixed "now" so nothing in here depends on the wall clock. */
const NOW = Date.UTC(2026, 7, 23, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1_000;
const daysAgo = (days: number): number => NOW - days * DAY;

/** A workspace with one trip carrying `cardCount` cards. */
function workspaceWith(cardCount: number, tripCount = 1): Workspace {
  const ws = emptyWorkspace();
  for (let t = 0; t < tripCount; t += 1) {
    const tripId = `trip-${t}`;
    const trip: Trip = {
      id: tripId,
      title: `여행 ${t}`,
      currency: 'KRW',
      columnOrder: [],
      sheetOrder: [],
      createdAt: NOW,
      updatedAt: NOW,
    };
    ws.trips[tripId] = trip;
    for (let c = 0; c < cardCount; c += 1) {
      const cardId = `card-${t}-${c}`;
      const card: Card = {
        id: cardId,
        tripId,
        columnId: 'column-0',
        title: `카드 ${c}`,
        createdAt: NOW,
        updatedAt: NOW,
      };
      ws.cards[cardId] = card;
    }
  }
  return ws;
}

describe('daysBetween', () => {
  it('counts whole days and floors partials', () => {
    expect(daysBetween(NOW, NOW)).toBe(0);
    expect(daysBetween(NOW - DAY / 2, NOW)).toBe(0);
    expect(daysBetween(daysAgo(1), NOW)).toBe(1);
    expect(daysBetween(daysAgo(30), NOW)).toBe(30);
    expect(daysBetween(NOW - (30 * DAY + DAY / 2), NOW)).toBe(30);
  });

  it('returns null for a missing or nonsense stamp', () => {
    expect(daysBetween(undefined, NOW)).toBeNull();
    expect(daysBetween(Number.NaN, NOW)).toBeNull();
  });

  it('never goes negative for a clock that jumped backwards', () => {
    expect(daysBetween(NOW + 5 * DAY, NOW)).toBe(0);
  });
});

describe('formatLastBackup', () => {
  it('reads 없음 / 오늘 / N일 전', () => {
    expect(formatLastBackup(undefined, NOW)).toBe('없음');
    expect(formatLastBackup(NOW, NOW)).toBe('오늘');
    expect(formatLastBackup(daysAgo(1), NOW)).toBe('1일 전');
    expect(formatLastBackup(daysAgo(21), NOW)).toBe('21일 전');
  });
});

describe('isWorkspaceWorthBacking', () => {
  it('is false for an empty workspace', () => {
    expect(isWorkspaceWorthBacking(emptyWorkspace())).toBe(false);
  });

  it(`needs one trip with ${BACKUP_MIN_CARDS} cards`, () => {
    expect(isWorkspaceWorthBacking(workspaceWith(BACKUP_MIN_CARDS - 1))).toBe(false);
    expect(isWorkspaceWorthBacking(workspaceWith(BACKUP_MIN_CARDS))).toBe(true);
  });

  it('does not add cards up across trips', () => {
    // Three trips of two cards is six cards, but no single trip is worth it.
    expect(isWorkspaceWorthBacking(workspaceWith(2, 3))).toBe(false);
  });

  it('ignores cards whose trip is gone', () => {
    const ws = workspaceWith(BACKUP_MIN_CARDS);
    delete ws.trips['trip-0'];
    expect(isWorkspaceWorthBacking(ws)).toBe(false);
  });
});

describe('shouldNudgeBackup', () => {
  it('says nothing while the workspace is trivial', () => {
    expect(shouldNudgeBackup({}, false, NOW)).toBe(false);
    expect(shouldNudgeBackup({ lastBackupAt: daysAgo(400) }, false, NOW)).toBe(false);
  });

  it('nudges when there is real data and no backup ever', () => {
    expect(shouldNudgeBackup({}, true, NOW)).toBe(true);
  });

  it(`stays quiet until the backup is older than ${BACKUP_STALE_DAYS}일`, () => {
    expect(shouldNudgeBackup({ lastBackupAt: NOW }, true, NOW)).toBe(false);
    expect(shouldNudgeBackup({ lastBackupAt: daysAgo(BACKUP_STALE_DAYS) }, true, NOW)).toBe(false);
    expect(shouldNudgeBackup({ lastBackupAt: daysAgo(BACKUP_STALE_DAYS + 1) }, true, NOW)).toBe(
      true,
    );
  });

  it(`a dismissal snoozes it for ${BACKUP_SNOOZE_DAYS}일`, () => {
    const stale = { lastBackupAt: daysAgo(90) };

    expect(shouldNudgeBackup({ ...stale, snoozedAt: NOW }, true, NOW)).toBe(false);
    expect(
      shouldNudgeBackup({ ...stale, snoozedAt: daysAgo(BACKUP_SNOOZE_DAYS - 1) }, true, NOW),
    ).toBe(false);
    expect(
      shouldNudgeBackup({ ...stale, snoozedAt: daysAgo(BACKUP_SNOOZE_DAYS) }, true, NOW),
    ).toBe(true);
  });

  it('a snooze also silences the never-backed-up case', () => {
    expect(shouldNudgeBackup({ snoozedAt: daysAgo(1) }, true, NOW)).toBe(false);
    expect(shouldNudgeBackup({ snoozedAt: daysAgo(30) }, true, NOW)).toBe(true);
  });
});

describe('backupNudgeText (B20)', () => {
  it('says "never" when this device has never produced a file', () => {
    expect(backupNudgeText(undefined)).toBe(NEVER_BACKED_UP_TEXT);
    expect(backupNudgeText(Number.NaN)).toBe(NEVER_BACKED_UP_TEXT);
    expect(NEVER_BACKED_UP_TEXT).toBe('아직 백업한 적이 없어요');
  });

  it('says "a while ago" only when there really was a last time', () => {
    expect(backupNudgeText(daysAgo(BACKUP_STALE_DAYS + 1))).toBe(STALE_BACKUP_TEXT);
    expect(STALE_BACKUP_TEXT).toBe('백업한 지 오래됐어요');
  });
});
