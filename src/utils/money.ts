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
