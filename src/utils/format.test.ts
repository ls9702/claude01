import { describe, expect, it } from 'vitest';
import { COLORS, COLOR_HEX, COLOR_TOKENS, colorClasses, colorHex } from './colors';
import {
  MAX_AMOUNT,
  dualAmount,
  formatBudget,
  formatCompactAmount,
  formatLocalAmount,
  formatSymbolAmount,
  hasLocalRate,
  isValidBudget,
  isValidExpenseAmount,
  symbolFor,
  toLocalAmount,
} from './money';
import { formatClock, formatDuration, formatStamp } from './time';

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

describe('formatCompactAmount', () => {
  it('breaks 원/엔 at 만', () => {
    expect(formatCompactAmount(123_000, 'KRW')).toBe('12.3만');
    expect(formatCompactAmount(120_000, 'KRW')).toBe('12만');
    expect(formatCompactAmount(10_000, 'JPY')).toBe('1만');
    expect(formatCompactAmount(1_500_000, 'KRW')).toBe('150만');
  });

  it('leaves small amounts spelled out', () => {
    expect(formatCompactAmount(9_999, 'KRW')).toBe('9,999원');
    expect(formatCompactAmount(0, 'KRW')).toBe('0원');
  });

  it('falls back to k for currencies with no suffix', () => {
    expect(formatCompactAmount(1_500, 'USD')).toBe('1.5k USD');
    expect(formatCompactAmount(999, 'USD')).toBe('999 USD');
  });

  it('degrades gracefully', () => {
    expect(formatCompactAmount(Number.NaN, 'KRW')).toBe('');
    expect(formatCompactAmount(-123_000, 'KRW')).toBe('-12.3만');
  });
});

describe('formatStamp', () => {
  it('renders a year-less month/day + clock', () => {
    expect(formatStamp(new Date(2026, 7, 23, 9, 5).getTime())).toBe('8/23 09:05');
    expect(formatStamp(new Date(2026, 11, 1, 23, 59).getTime())).toBe('12/1 23:59');
  });

  it('returns an empty string for a garbled stamp', () => {
    expect(formatStamp(Number.NaN)).toBe('');
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

describe('symbolFor / formatLocalAmount', () => {
  it('knows the handful of symbols the 현지 통화 toggle needs', () => {
    expect(symbolFor('JPY')).toBe('¥');
    expect(symbolFor('usd')).toBe('$');
    expect(symbolFor('EUR')).toBe('€');
    expect(symbolFor('KRW')).toBe('₩');
    expect(symbolFor('GBP')).toBe('£');
  });

  it('falls back to the code plus a space, so it still glues onto a number', () => {
    expect(symbolFor('THB')).toBe('THB ');
    expect(`${symbolFor('THB')}1,200`).toBe('THB 1,200');
    expect(symbolFor('')).toBe('');
  });

  it('formats the label prefix a 지출 keeps', () => {
    expect(formatLocalAmount(1200, 'JPY')).toBe('¥1,200');
    expect(formatLocalAmount(12.5, 'USD')).toBe('$12.5');
    expect(formatLocalAmount(Number.NaN, 'JPY')).toBe('');
  });
});

/* ------------------------------------------------------------------ *
 * M25 — 두 통화 동시 표기
 * ------------------------------------------------------------------ */

describe('formatSymbolAmount', () => {
  it('기호를 앞에 두고 만/k 줄임은 그대로 쓴다', () => {
    expect(formatSymbolAmount(81_000, 'KRW')).toBe('₩8.1만');
    expect(formatSymbolAmount(1_500_000, 'KRW')).toBe('₩150만');
    expect(formatSymbolAmount(8_710, 'JPY')).toBe('¥8,710');
    expect(formatSymbolAmount(12_000, 'JPY')).toBe('¥1.2만');
    expect(formatSymbolAmount(1_500, 'USD')).toBe('$1.5k');
  });

  it('작은 금액과 0도 기호를 잃지 않는다', () => {
    expect(formatSymbolAmount(9_999, 'KRW')).toBe('₩9,999');
    expect(formatSymbolAmount(0, 'KRW')).toBe('₩0');
    // 기호가 없는 통화는 코드+공백으로 붙는다.
    expect(formatSymbolAmount(1_200, 'THB')).toBe('THB 1.2k');
  });

  it('망가진 금액은 빈 문자열이다', () => {
    expect(formatSymbolAmount(Number.NaN, 'KRW')).toBe('');
  });
});

describe('hasLocalRate / toLocalAmount', () => {
  it('두 짝이 다 있어야 현지 통화다', () => {
    expect(hasLocalRate({ localCurrency: 'JPY', fxRate: 9.3 })).toBe(true);
    expect(hasLocalRate({ localCurrency: 'JPY' })).toBe(false);
    expect(hasLocalRate({ fxRate: 9.3 })).toBe(false);
    expect(hasLocalRate({ localCurrency: 'JPY', fxRate: 0 })).toBe(false);
    expect(hasLocalRate(undefined)).toBe(false);
  });

  it('환율은 「1 현지 = N 기준」 하나뿐이다 — 들어올 땐 곱하고 나갈 땐 나눈다', () => {
    // 지출 입력이 하는 계산: ¥1,200 × 9.3 = 11,160원.
    expect(1_200 * 9.3).toBeCloseTo(11_160, 5);
    // 그 역이 이 함수다.
    expect(toLocalAmount(11_160, 9.3)).toBeCloseTo(1_200, 5);
  });
});

describe('dualAmount', () => {
  it('현지 통화가 있으면 두 금액을 함께 준다', () => {
    expect(dualAmount(81_000, 'KRW', { localCurrency: 'JPY', fxRate: 9.3 })).toEqual({
      base: '₩8.1만',
      local: '¥8,710',
    });
  });

  it('현지 통화가 없으면 기준 통화만 준다 — 줄이 늘지 않는다', () => {
    expect(dualAmount(81_000, 'KRW')).toEqual({ base: '₩8.1만' });
    expect(dualAmount(81_000, 'KRW', { localCurrency: 'JPY' })).toEqual({ base: '₩8.1만' });
    expect(dualAmount(81_000, 'KRW', { localCurrency: 'JPY', fxRate: 0 })).toEqual({
      base: '₩8.1만',
    });
  });

  it('0원도 두 통화로 말한다', () => {
    expect(dualAmount(0, 'KRW', { localCurrency: 'JPY', fxRate: 9.3 })).toEqual({
      base: '₩0',
      local: '¥0',
    });
  });

  it('망가진 금액은 환산하지 않는다', () => {
    expect(dualAmount(Number.NaN, 'KRW', { localCurrency: 'JPY', fxRate: 9.3 })).toEqual({
      base: '',
    });
  });
});

describe('금액 검증 (B18)', () => {
  it('accepts a real 지출 and refuses 0, negatives and slipped digits', () => {
    expect(isValidExpenseAmount(1)).toBe(true);
    expect(isValidExpenseAmount(15_000)).toBe(true);
    expect(isValidExpenseAmount(MAX_AMOUNT)).toBe(true);

    expect(isValidExpenseAmount(0)).toBe(false);
    expect(isValidExpenseAmount(-8_000)).toBe(false);
    expect(isValidExpenseAmount(1e9)).toBe(false);
    expect(isValidExpenseAmount(MAX_AMOUNT + 1)).toBe(false);
    expect(isValidExpenseAmount(Number.NaN)).toBe(false);
    expect(isValidExpenseAmount(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isValidExpenseAmount(undefined)).toBe(false);
  });

  it('lets a 예산 be zero or absent but never negative', () => {
    expect(isValidBudget(undefined)).toBe(true);
    expect(isValidBudget(0)).toBe(true);
    expect(isValidBudget(20_000)).toBe(true);
    expect(isValidBudget(MAX_AMOUNT)).toBe(true);

    expect(isValidBudget(-1)).toBe(false);
    expect(isValidBudget(1e9)).toBe(false);
    expect(isValidBudget(Number.NaN)).toBe(false);
  });
});
