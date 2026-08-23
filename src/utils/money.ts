/** Budget formatting + the currency list offered when creating a trip. */

export interface CurrencyOption {
  code: string;
  label: string;
}

/** Currencies offered in the trip form. `KRW` is the default. */
export const CURRENCIES: readonly CurrencyOption[] = [
  { code: 'KRW', label: '원 (KRW)' },
  { code: 'JPY', label: '엔 (JPY)' },
  { code: 'USD', label: '달러 (USD)' },
  { code: 'EUR', label: '유로 (EUR)' },
  { code: 'THB', label: '바트 (THB)' },
  { code: 'VND', label: '동 (VND)' },
  { code: 'TWD', label: '대만달러 (TWD)' },
];

/** Currencies that read better with a Korean suffix than with their code. */
const SUFFIX: Record<string, string> = {
  KRW: '원',
  JPY: '엔',
};

/**
 * `formatBudget(12000, 'KRW')` → `"12,000원"`;
 * `formatBudget(30, 'USD')` → `"30 USD"`.
 */
export function formatBudget(amount: number, currency: string): string {
  if (!Number.isFinite(amount)) return '';
  const value = Math.round(amount).toLocaleString('ko-KR');
  const code = (currency || 'KRW').toUpperCase();
  const suffix = SUFFIX[code];
  return suffix ? `${value}${suffix}` : `${value} ${code}`;
}

/** `12.3` → `"12.3"`, `12.0` → `"12"` — one decimal, never a trailing `.0`. */
const oneDecimal = (value: number): string =>
  (Math.round(value * 10) / 10).toFixed(1).replace(/\.0$/, '');

/**
 * Short form for the timeline chips, where a full `123,000원` would not fit:
 * `formatCompactAmount(123000, 'KRW')` → `"12.3만"`,
 * `formatCompactAmount(1500, 'USD')` → `"1.5k USD"`.
 *
 * 원/엔 break at 만 (10,000) the way Korean actually reads amounts; everything
 * else falls back to a `k` above a thousand. Small amounts are left alone and
 * go through {@link formatBudget}.
 */
export function formatCompactAmount(amount: number, currency: string): string {
  if (!Number.isFinite(amount)) return '';
  const code = (currency || 'KRW').toUpperCase();
  const suffix = SUFFIX[code];
  const abs = Math.abs(amount);

  if (suffix && abs >= 10_000) {
    const man = amount / 10_000;
    const text = Math.abs(man) >= 100 ? Math.round(man).toLocaleString('ko-KR') : oneDecimal(man);
    return `${text}만`;
  }
  if (!suffix && abs >= 1_000) return `${oneDecimal(amount / 1_000)}k ${code}`;
  return formatBudget(amount, currency);
}
