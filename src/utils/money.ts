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

/**
 * Currency symbols used to *prefix* an amount, e.g. `` `${symbolFor('JPY')}1,200` ``
 * → `¥1,200` (M7b, 현지 통화).
 *
 * A code with no symbol falls back to the code plus a space — `THB 1,200` —
 * so the result is always something that can be glued straight onto a number.
 */
const SYMBOLS: Record<string, string> = {
  JPY: '¥',
  CNY: '¥',
  USD: '$',
  EUR: '€',
  KRW: '₩',
  GBP: '£',
};

/** `'JPY'` → `'¥'`; an unknown code → `'THB '` (code + space). */
export function symbolFor(code: string): string {
  const upper = (code || '').trim().toUpperCase();
  if (!upper) return '';
  return SYMBOLS[upper] ?? `${upper} `;
}

/** `1200` + `'JPY'` → `"¥1,200"` — the 현지 통화 half of a 지출 label. */
export function formatLocalAmount(amount: number, code: string): string {
  if (!Number.isFinite(amount)) return '';
  const rounded = Math.round(amount * 100) / 100;
  return `${symbolFor(code)}${rounded.toLocaleString('ko-KR')}`;
}

/* ------------------------------------------------------------------ *
 * 현지 통화 쌍 (M7b) + 두 통화 동시 표기 (M25)
 * ------------------------------------------------------------------ */

/** The trip's 현지 통화 pair, when it has one. */
export interface LocalRate {
  /** e.g. `JPY`. */
  localCurrency?: string;
  /** 기준통화 per 1 local unit — `9.3` means `1 JPY = 9.3 KRW`. */
  fxRate?: number;
}

/** True when both halves are usable — a rate of 0 is not a rate. */
export const hasLocalRate = (rate: LocalRate | undefined): boolean =>
  Boolean(rate?.localCurrency) && Number.isFinite(rate?.fxRate) && (rate?.fxRate as number) > 0;

/**
 * 기준통화 금액 → 현지 금액, with the **one** rate the app has ever had.
 *
 * `fxRate` is 기준통화 per 1 local unit, so the 지출 입력 multiplies by it
 * (`¥1,200 × 9.3 = 11,160원`, see `CardLedger`) and this — the only other
 * direction — divides by it. No second rate, no second convention.
 */
export const toLocalAmount = (baseAmount: number, fxRate: number): number =>
  baseAmount / fxRate;

/**
 * `81000` + `'KRW'` → `"₩8.1만"`; `8710` + `'JPY'` → `"¥8,710"`.
 *
 * {@link formatCompactAmount} with the **symbol in front instead of the word
 * behind**: the moment two currencies stand side by side, `8.1만 · 8,710엔`
 * reads as one amount cut in half, and `₩`/`¥` are what tell them apart at a
 * glance in an 11px row.
 */
export function formatSymbolAmount(amount: number, code: string): string {
  if (!Number.isFinite(amount)) return '';
  const upper = (code || 'KRW').toUpperCase();
  return `${symbolFor(upper)}${compactValue(amount, upper)}`;
}

/** 기준 통화 한 줄, 그리고 현지 통화가 있으면 그 옆줄 — 둘 다 이미 포맷된 문자열. */
export interface DualAmount {
  /** e.g. `₩8.1만` — always present. */
  base: string;
  /** e.g. `¥8,710` — absent when the trip has no 현지 통화 pair. */
  local?: string;
}

/**
 * One amount, said in both currencies the traveller thinks in (M25).
 *
 * The 필요 예산 bar answers "얼마 들고 가야 하나" — a question with two right
 * answers on a trip to Japan: the 원 that leaves the bank account and the 엔
 * that comes out of the wallet. A trip with no 현지 통화 configured gets
 * exactly what it got before: one number, `local` absent.
 */
export function dualAmount(
  amount: number,
  currency: string,
  rate: LocalRate | undefined = undefined,
): DualAmount {
  const base = formatSymbolAmount(amount, currency);
  if (!hasLocalRate(rate) || !Number.isFinite(amount)) return { base };
  const local = toLocalAmount(amount, rate?.fxRate as number);
  return { base, local: formatSymbolAmount(local, rate?.localCurrency as string) };
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
/* ------------------------------------------------------------------ *
 * 금액 검증 (M8-2, B18)
 * ------------------------------------------------------------------ */

/**
 * Ceiling for a single amount — a hundred million minus one.
 *
 * Not a currency judgement, a typo guard: `1e9` in the 금액 field was almost
 * certainly a slipped keypress, and it drags every chip and bar on the screen
 * along with it.
 */
export const MAX_AMOUNT = 99_999_999;

/**
 * A 지출 must be a real, positive amount within {@link MAX_AMOUNT}.
 *
 * `0` and negatives are rejected outright: a receipt for nothing is not a
 * receipt, and there is no 환불 concept to spend a negative on.
 */
export const isValidExpenseAmount = (amount: number | undefined): amount is number =>
  amount !== undefined && Number.isFinite(amount) && amount > 0 && amount <= MAX_AMOUNT;

/**
 * A 예산 may be `0` ("planned to cost nothing") but never negative, and obeys
 * the same ceiling. An absent budget is valid — the field is optional.
 */
export const isValidBudget = (budget: number | undefined): boolean =>
  budget === undefined || (Number.isFinite(budget) && budget >= 0 && budget <= MAX_AMOUNT);

/**
 * The bare short *value* — `"12.3만"`, `"1.5k"`, `"9,999"` — with no currency
 * mark of any kind. {@link formatCompactAmount} hangs the Korean word behind
 * it, {@link formatSymbolAmount} the symbol in front of it.
 */
function compactValue(amount: number, code: string): string {
  const abs = Math.abs(amount);
  if (SUFFIX[code] && abs >= 10_000) {
    const man = amount / 10_000;
    const text = Math.abs(man) >= 100 ? Math.round(man).toLocaleString('ko-KR') : oneDecimal(man);
    return `${text}만`;
  }
  if (!SUFFIX[code] && abs >= 1_000) return `${oneDecimal(amount / 1_000)}k`;
  return Math.round(amount).toLocaleString('ko-KR');
}

export function formatCompactAmount(amount: number, currency: string): string {
  if (!Number.isFinite(amount)) return '';
  const code = (currency || 'KRW').toUpperCase();
  const suffix = SUFFIX[code];
  const abs = Math.abs(amount);

  if (suffix && abs >= 10_000) return compactValue(amount, code);
  if (!suffix && abs >= 1_000) return `${compactValue(amount, code)} ${code}`;
  return formatBudget(amount, currency);
}
