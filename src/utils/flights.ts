/**
 * Flight → day-range math for the 시트 마법사 (M2b).
 *
 * Pure and React-/store-free (like `src/timeline/layout.ts`) so the awkward
 * parts — a red-eye that lands the next morning, a one-way trip that only
 * knows how many days it lasts — can be unit-tested without a workspace.
 *
 * Dates are handled as `YYYY-MM-DD` strings throughout and all arithmetic runs
 * in UTC, so a summer-time boundary can never shift a day by one.
 */

import type { FlightLeg } from '../types/models';
import { DAY_MIN, MIN_ENTRY_MIN, snapMin } from './time';

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const HM_RE = /^(\d{1,2}):([0-5]\d)$/;

/** Longest sheet the wizard will generate — a guard against a fat-fingered 일수. */
export const MAX_SHEET_DAYS = 60;

/** Milliseconds in one day (UTC — no DST inside the epoch). */
const DAY_MS = 86_400_000;

/** `"2026-05-03"` → epoch ms at UTC midnight, or `null` when unparseable. */
function isoToUtc(iso: string): number | null {
  const match = ISO_RE.exec(iso.trim());
  if (!match) return null;
  const [, y, m, d] = match;
  const ms = Date.UTC(Number(y), Number(m) - 1, Number(d));
  const back = new Date(ms);
  // Rejects `2026-02-31` and friends — `Date.UTC` would roll them over.
  if (back.getUTCMonth() !== Number(m) - 1 || back.getUTCDate() !== Number(d)) return null;
  return ms;
}

/** Epoch ms → `YYYY-MM-DD`. */
function utcToIso(ms: number): string {
  const date = new Date(ms);
  const y = String(date.getUTCFullYear()).padStart(4, '0');
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** True for a real calendar date written as `YYYY-MM-DD`. */
export const isIsoDate = (value: string | undefined): value is string =>
  typeof value === 'string' && isoToUtc(value) !== null;

/** `addDaysIso('2026-05-03', 2)` → `'2026-05-05'`. Bad input is echoed back. */
export function addDaysIso(iso: string, days: number): string {
  const ms = isoToUtc(iso);
  if (ms === null || !Number.isFinite(days)) return iso;
  return utcToIso(ms + Math.trunc(days) * DAY_MS);
}

/** Calendar days from `from` to `to` (`to - from`); `0` when either is bad. */
export function diffDaysIso(from: string, to: string): number {
  const a = isoToUtc(from);
  const b = isoToUtc(to);
  if (a === null || b === null) return 0;
  return Math.round((b - a) / DAY_MS);
}

/** `"09:05"` → `545` minutes from midnight; `null` when unparseable. */
export function parseHm(value: string | undefined): number | null {
  if (typeof value !== 'string') return null;
  const match = HM_RE.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  if (hours > 23) return null;
  return hours * 60 + Number(match[2]);
}

/**
 * How long a leg is in the air, in minutes.
 *
 * `arrNextDay` adds a day, so `23:40 → 06:20 (+1)` reads as 400 minutes rather
 * than a negative one. Anything that still comes out non-positive (times the
 * user has not filled in yet) falls back to {@link MIN_ENTRY_MIN}.
 */
export function legDurationMin(leg: FlightLeg): number {
  const dep = parseHm(leg.depTime);
  const arr = parseHm(leg.arrTime);
  if (dep === null || arr === null) return MIN_ENTRY_MIN;
  const raw = arr - dep + (leg.arrNextDay ? DAY_MIN : 0);
  return raw >= MIN_ENTRY_MIN ? raw : MIN_ENTRY_MIN;
}

/** The calendar date a leg lands on — `date`, plus one when it crosses midnight. */
export function legArrivalDate(leg: FlightLeg): string {
  return leg.arrNextDay ? addDaysIso(leg.date, 1) : leg.date;
}

/** One piece of a leg as it lands on the calendar. */
export interface LegPlacement {
  /** `YYYY-MM-DD` of the day this piece belongs on. */
  date: string;
  /** Minutes from that day's midnight. */
  startMin: number;
  durationMin: number;
}

/**
 * How a leg occupies the grid: **one** piece for a same-day flight, **two** for
 * a leg that crosses midnight (M8-2, B10).
 *
 * A timeline entry cannot span two day columns — `clampEntry` shortens anything
 * that would run past midnight. So a 심야 leg (`23:40 → 06:20 +1일`) used to
 * collapse into a 15-minute stub while its card still claimed 6시간 40분. Split
 * instead: the departure day keeps the tail (snapped 출발 시각 → 24:00) and the
 * arrival day gets the head (00:00 → 도착 시각). Together they read as the one
 * flight they are, on the two days it actually touches.
 *
 * The head is dropped when the leg lands exactly at midnight — there is no
 * arrival day to draw. The caller decides whether the sheet even *holds* the
 * arrival day; a leg landing outside the sheet keeps only its tail.
 */
export function legPlacements(leg: FlightLeg): LegPlacement[] {
  const dep = parseHm(leg.depTime);
  const arr = parseHm(leg.arrTime);
  const startMin = dep ?? 0;
  const head = [{ date: leg.date, startMin, durationMin: legDurationMin(leg) }];

  if (!leg.arrNextDay || dep === null || arr === null || arr === 0) return head;

  // The tail is snapped here rather than left to the caller, so `startMin +
  // durationMin` really is midnight — an off-grid start would leave a sliver.
  const tailStart = snapMin(startMin);
  return [
    {
      date: leg.date,
      startMin: tailStart,
      durationMin: Math.max(DAY_MIN - tailStart, MIN_ENTRY_MIN),
    },
    {
      date: addDaysIso(leg.date, 1),
      startMin: 0,
      durationMin: Math.max(snapMin(arr), MIN_ENTRY_MIN),
    },
  ];
}

/** What the wizard knows about a sheet: two optional legs and/or a length. */
export interface SheetFlightOpts {
  outbound?: FlightLeg;
  inbound?: FlightLeg;
  /** Length in days; used when the flights alone cannot pin the end down. */
  dayCount?: number;
}

/** The day list a {@link SheetFlightOpts} asks for. */
export interface SheetPlan {
  /** One `YYYY-MM-DD` per day, or `undefined` for a dateless (일수) sheet. */
  dates?: string[];
  /** How many days the sheet should hold; `0` means "leave the days alone". */
  count: number;
}

/**
 * Turns the wizard's answers into the exact day list a sheet should hold.
 *
 * - both legs → `outbound.date … inbound` arrival date, inclusive;
 * - outbound only (+ `dayCount`) → `dayCount` days from the departure date;
 * - no dates at all → `dayCount` dateless days;
 * - an inbound that lands before the outbound leaves collapses to one day
 *   rather than producing an empty sheet.
 */
export function planSheetDays(opts: SheetFlightOpts): SheetPlan {
  const outDate = opts.outbound && isIsoDate(opts.outbound.date) ? opts.outbound.date : undefined;
  const inDate = opts.inbound && isIsoDate(opts.inbound.date) ? opts.inbound.date : undefined;
  const start = outDate ?? inDate;

  const requested = Number.isFinite(opts.dayCount)
    ? Math.trunc(opts.dayCount as number)
    : undefined;

  if (!start) {
    const count = requested === undefined ? 0 : Math.min(Math.max(requested, 0), MAX_SHEET_DAYS);
    return { count };
  }

  const end =
    opts.inbound && inDate
      ? legArrivalDate(opts.inbound)
      : requested !== undefined && requested > 0
        ? addDaysIso(start, requested - 1)
        : start;

  const span = Math.max(diffDaysIso(start, end) + 1, 1);
  const count = Math.min(span, MAX_SHEET_DAYS);
  return { count, dates: Array.from({ length: count }, (_, i) => addDaysIso(start, i)) };
}

/** Label of the `index`-th day of a sheet: `1일차`, `2일차`, … */
export const dayLabelAt = (index: number): string => `${index + 1}일차`;

/** Which leg of the pair a card/entry belongs to. */
export type LegKind = 'outbound' | 'inbound';

/** Title prefix marking a card the flight wizard created. */
export const FLIGHT_CARD_PREFIX = '✈️';

const FALLBACK_TITLE: Record<LegKind, string> = {
  outbound: `${FLIGHT_CARD_PREFIX} 출발편`,
  inbound: `${FLIGHT_CARD_PREFIX} 귀국편`,
};

/**
 * `✈️ ICN→KIX OZ112`, degrading gracefully: a leg with neither route nor
 * flight number reads `✈️ 출발편` / `✈️ 귀국편`.
 */
export function flightCardTitle(leg: FlightLeg, kind: LegKind): string {
  const from = leg.from?.trim();
  const to = leg.to?.trim();
  const flightNo = leg.flightNo?.trim();
  const parts: string[] = [];
  if (from || to) parts.push(`${from ?? '?'}→${to ?? '?'}`);
  if (flightNo) parts.push(flightNo);
  return parts.length > 0 ? `${FLIGHT_CARD_PREFIX} ${parts.join(' ')}` : FALLBACK_TITLE[kind];
}

/** `"2026-05-03"` → `"5월 3일"` (no weekday — the preview line is tight). */
export function formatShortDate(iso: string): string {
  const match = ISO_RE.exec(iso.trim());
  if (!match) return iso;
  return `${Number(match[2])}월 ${Number(match[3])}일`;
}

/**
 * The wizard's live preview: `"5월 3일 ~ 5월 7일 · 5일"`, or just `"3일"` when
 * the sheet has no dates. Empty for a plan that would create nothing.
 */
export function formatSheetPlan(plan: SheetPlan): string {
  if (plan.count <= 0) return '';
  const nights = `${plan.count}일`;
  const dates = plan.dates;
  if (!dates || dates.length === 0) return nights;
  const first = formatShortDate(dates[0]);
  const last = formatShortDate(dates[dates.length - 1]);
  return first === last ? `${first} · ${nights}` : `${first} ~ ${last} · ${nights}`;
}
