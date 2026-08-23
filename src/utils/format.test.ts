import { describe, expect, it } from 'vitest';
import { COLORS, COLOR_HEX, COLOR_TOKENS, colorClasses, colorHex } from './colors';
import { formatBudget } from './money';
import { formatClock, formatDuration } from './time';

describe('formatDuration', () => {
  it('formats minutes the Korean way', () => {
    expect(formatDuration(30)).toBe('30분');
    expect(formatDuration(60)).toBe('1시간');
    expect(formatDuration(90)).toBe('1시간 30분');
    expect(formatDuration(180)).toBe('3시간');
    expect(formatDuration(1445)).toBe('24시간 5분');
  });

  it('degrades gracefully', () => {
    expect(formatDuration(0)).toBe('0분');
    expect(formatDuration(-10)).toBe('0분');
    expect(formatDuration(Number.NaN)).toBe('0분');
  });
});

describe('formatClock', () => {
  it('renders minutes from midnight as HH:mm', () => {
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(545)).toBe('09:05');
    expect(formatClock(1440)).toBe('00:00');
  });
});

describe('formatBudget', () => {
  it('uses a Korean suffix where it reads better', () => {
    expect(formatBudget(12000, 'KRW')).toBe('12,000원');
    expect(formatBudget(1500, 'JPY')).toBe('1,500엔');
    expect(formatBudget(30, 'USD')).toBe('30 USD');
  });
});

describe('colors', () => {
  it('exposes eight tokens with a full class bundle each', () => {
    expect(COLOR_TOKENS).toHaveLength(8);
    for (const token of COLOR_TOKENS) {
      const bundle = COLORS[token];
      for (const key of ['label', 'chip', 'accent', 'header', 'surface', 'dot'] as const) {
        expect(bundle[key].length).toBeGreaterThan(0);
      }
      // Static class strings only — Tailwind must be able to see them.
      expect(bundle.chip).toContain(token);
      expect(bundle.accent).toBe(`border-l-${token}-400`);
    }
  });

  it('falls back to slate for unknown tokens', () => {
    expect(colorClasses('sky')).toBe(COLORS.sky);
    expect(colorClasses('chartreuse')).toBe(COLORS.slate);
  });

  it('carries a hex twin for every token (map pins cannot use classes)', () => {
    for (const token of COLOR_TOKENS) {
      expect(COLOR_HEX[token]).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(colorHex('violet')).toBe(COLOR_HEX.violet);
    expect(colorHex('chartreuse')).toBe(COLOR_HEX.slate);
  });
});
