import { describe, expect, it } from 'vitest';
import {
  DAY_MIN,
  MIN_ENTRY_MIN,
  clampEntry,
  formatDayDate,
  formatTimeRange,
  minToY,
  snapMin,
  yToMin,
} from './time';

describe('snapMin', () => {
  it('rounds to the nearest quarter hour', () => {
    expect(snapMin(0)).toBe(0);
    expect(snapMin(7)).toBe(0);
    expect(snapMin(8)).toBe(15);
    expect(snapMin(22)).toBe(15);
    expect(snapMin(23)).toBe(30);
    expect(snapMin(607)).toBe(600);
    expect(snapMin(613)).toBe(615);
  });

  it('honours a custom step and survives nonsense input', () => {
    expect(snapMin(50, 30)).toBe(60);
    expect(snapMin(44, 30)).toBe(30);
    expect(snapMin(100, 0)).toBe(105); // bad step falls back to 15
    expect(snapMin(Number.NaN)).toBe(0);
    expect(snapMin(-7)).toBe(-0);
  });
});

describe('clampEntry', () => {
  it('leaves a well-formed span alone', () => {
    expect(clampEntry(570, 90)).toEqual({ startMin: 570, durationMin: 90 });
  });

  it('pins the start inside the day', () => {
    expect(clampEntry(-60, 60)).toEqual({ startMin: 0, durationMin: 60 });
    // The last placeable start is 23:45.
    expect(clampEntry(2000, 60)).toEqual({ startMin: DAY_MIN - 15, durationMin: 15 });
  });

  it('shortens rather than moves an entry that would run past midnight', () => {
    expect(clampEntry(1380, 120)).toEqual({ startMin: 1380, durationMin: 60 });
    expect(clampEntry(1425, 600)).toEqual({ startMin: 1425, durationMin: 15 });
  });

  it('enforces the 15-minute floor', () => {
    expect(clampEntry(600, 0)).toEqual({ startMin: 600, durationMin: MIN_ENTRY_MIN });
    expect(clampEntry(600, -30)).toEqual({ startMin: 600, durationMin: MIN_ENTRY_MIN });
    expect(clampEntry(Number.NaN, Number.NaN)).toEqual({
      startMin: 0,
      durationMin: MIN_ENTRY_MIN,
    });
  });
});

describe('minToY / yToMin', () => {
  it('round-trips through a pixel scale', () => {
    expect(minToY(600, 0.9)).toBe(540);
    expect(yToMin(540, 0.9)).toBeCloseTo(600, 6);
    expect(minToY(0, 0.9)).toBe(0);
  });

  it('never returns NaN', () => {
    expect(yToMin(100, 0)).toBe(0);
    expect(minToY(Number.NaN, 0.9)).toBe(0);
    expect(yToMin(Number.NaN, 0.9)).toBe(0);
  });
});

describe('formatTimeRange', () => {
  it('renders start–end on the clock', () => {
    expect(formatTimeRange(570, 90)).toBe('09:30–11:00');
    expect(formatTimeRange(0, 15)).toBe('00:00–00:15');
  });

  it('says 24:00 rather than wrapping at midnight', () => {
    expect(formatTimeRange(1425, 15)).toBe('23:45–24:00');
  });
});

describe('formatDayDate', () => {
  it('renders a Korean date with its weekday', () => {
    // 2026-08-23 is a Sunday.
    expect(formatDayDate('2026-08-23')).toBe('8월 23일 (일)');
    expect(formatDayDate('2026-01-05')).toBe('1월 5일 (월)');
  });

  it('echoes anything it cannot parse', () => {
    expect(formatDayDate('내일')).toBe('내일');
    expect(formatDayDate('')).toBe('');
  });
});
