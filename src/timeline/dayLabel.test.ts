import { describe, expect, it } from 'vitest';
import type { Day } from '../types/models';
import { dayTitle, daySubtitle, userDayLabel } from './dayLabel';

const day = (over: Partial<Day> = {}): Day => ({
  id: 'd1',
  tripId: 't1',
  sheetId: 's1',
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

describe('dayTitle (B12)', () => {
  it('numbers a plain day from its position', () => {
    expect(dayTitle(day(), 0)).toBe('1일차');
    expect(dayTitle(day(), 2)).toBe('3일차');
  });

  it('numbers a dated day from its position too, not from its date', () => {
    // The date belongs on the second line; the heading answers "which day of
    // the trip is this?", and only `index` knows that.
    expect(dayTitle(day({ date: '2026-05-03' }), 0)).toBe('1일차');
  });

  it("keeps a label the user typed", () => {
    expect(dayTitle(day({ label: '도착일' }), 0)).toBe('도착일');
    expect(dayTitle(day({ label: '  도착일  ' }), 0)).toBe('도착일');
  });

  it('ignores a stored positional label so old data heals itself', () => {
    // Sheets saved before B12 carry `3일차` on what is now the second day.
    expect(dayTitle(day({ label: '3일차' }), 1)).toBe('2일차');
    expect(dayTitle(day({ label: '12일차' }), 0)).toBe('1일차');
    expect(userDayLabel(day({ label: '3일차' }))).toBeUndefined();
  });
});

describe('daySubtitle (B12)', () => {
  it('shows the date under the heading', () => {
    expect(daySubtitle(day({ date: '2026-05-03' }), 0)).toBe('5월 3일 (일)');
    expect(daySubtitle(day({ date: '2026-05-03', label: '도착일' }), 0)).toBe('5월 3일 (일)');
  });

  it('shows the position under a user label when there is no date', () => {
    expect(daySubtitle(day({ label: '도착일' }), 1)).toBe('2일차');
  });

  it('shows nothing rather than repeating the heading', () => {
    // This is the `2일차2일차` the mobile pager used to print.
    expect(daySubtitle(day(), 1)).toBe('');
    expect(daySubtitle(day({ label: '2일차' }), 1)).toBe('');
  });
});
