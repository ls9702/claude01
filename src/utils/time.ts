/** Duration helpers shared by the board (card chips) and, later, the timeline. */

const MIN_PER_HOUR = 60;

/** Quick-pick durations offered in the card editor, in minutes. */
export const DURATION_PRESETS: readonly number[] = [30, 60, 90, 120, 180];

/**
 * Human duration in Korean: `90` → `"1시간 30분"`, `60` → `"1시간"`,
 * `45` → `"45분"`. Invalid/negative input degrades to `"0분"`.
 */
export function formatDuration(min: number): string {
  if (!Number.isFinite(min)) return '0분';
  const total = Math.max(0, Math.round(min));
  const hours = Math.floor(total / MIN_PER_HOUR);
  const minutes = total % MIN_PER_HOUR;
  if (hours === 0) return `${minutes}분`;
  if (minutes === 0) return `${hours}시간`;
  return `${hours}시간 ${minutes}분`;
}

/** `600` → `"10:00"`. Minutes from midnight, wrapped into a single day. */
export function formatClock(minFromMidnight: number): string {
  const total = ((Math.round(minFromMidnight) % 1440) + 1440) % 1440;
  const h = Math.floor(total / MIN_PER_HOUR);
  const m = total % MIN_PER_HOUR;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/* ------------------------------------------------------------------ *
 * Timeline grid math (M2a)
 * ------------------------------------------------------------------ */

/** Minutes in one timeline day. A day column spans `0 … DAY_MIN`. */
export const DAY_MIN = 1440;

/**
 * 하루의 시작 — 05:00 (M16).
 *
 * 「1일차 = 1일차 05시부터 2일차 05시까지」. The *data* never learns about this:
 * `TimelineEntry.startMin` stays `0 … 1440` relative to the entry's own
 * calendar day, exactly as it was in M2a, and `schemaVersion` does not move.
 * What changes is the **window** the grid draws and the aggregations count in:
 * a day column now renders the 1440 minutes that start at `DAY_START_MIN` of
 * its own date, so 새벽 1시 sits at the bottom of the previous night's column
 * instead of at the top of a column nobody has woken up in yet.
 *
 * It lives here, in the lowest layer, because both the grid
 * (`timeline/layout.ts`, the components) and the money/route aggregations
 * (`utils/spend.ts`, `timeline/route.ts`) have to agree on it, and neither of
 * those may import the other. See `src/timeline/dayWindow.ts` for the mapping
 * built on top of it.
 */
export const DAY_START_MIN = 300;

/** Every start time and every duration lands on this grid. */
export const SNAP_MIN = 15;

/** Shortest entry the grid can express. */
export const MIN_ENTRY_MIN = 15;

/**
 * Rounds to the nearest `step`-minute grid line. `step` is coerced to a sane
 * positive integer so a bad caller cannot produce `NaN` start times.
 */
export function snapMin(min: number, step: number = SNAP_MIN): number {
  const size = Number.isFinite(step) && step >= 1 ? Math.round(step) : SNAP_MIN;
  if (!Number.isFinite(min)) return 0;
  return Math.round(min / size) * size;
}

/** A start/duration pair that is guaranteed to fit inside one day. */
export interface EntrySpan {
  startMin: number;
  durationMin: number;
}

/**
 * Forces `(startMin, durationMin)` inside `0 … DAY_MIN`:
 *
 * - `startMin` lands in `[0, DAY_MIN - MIN_ENTRY_MIN]`;
 * - `durationMin` is at least {@link MIN_ENTRY_MIN} and never runs past
 *   midnight — an entry that would overflow gets shortened, never moved.
 */
export function clampEntry(startMin: number, durationMin: number): EntrySpan {
  const rawStart = Number.isFinite(startMin) ? Math.round(startMin) : 0;
  const start = Math.min(Math.max(rawStart, 0), DAY_MIN - MIN_ENTRY_MIN);

  const rawDuration = Number.isFinite(durationMin) ? Math.round(durationMin) : MIN_ENTRY_MIN;
  const duration = Math.min(Math.max(rawDuration, MIN_ENTRY_MIN), DAY_MIN - start);

  return { startMin: start, durationMin: duration };
}

/**
 * The **move** twin of {@link clampEntry}: 이동은 길이를 깎지 않는다 (M50).
 *
 * `clampEntry` is a *resize/create* rule — it pins the start and shortens
 * whatever would run past midnight. Applied to a drag or a 시작 시각 stepper
 * that is exactly backwards: a 3시간 block nudged toward midnight lost a
 * quarter hour on every step and never got it back on the way down, so the
 * only record of how long the thing was supposed to take quietly evaporated
 * (헌터A #1·#2·#5).
 *
 * Moving keeps the duration and stops the **start** at the last minute the
 * block still fits: `[0, DAY_MIN - durationMin]`. A block cannot be pushed
 * across midnight because a `TimelineEntry` is anchored to one calendar day
 * (see `clampEntry` and `dayWindow.ts`) — that is a model constraint, and the
 * honest way to express it is for the start to stop, not for the length to
 * rot.
 */
export function clampMove(startMin: number, durationMin: number): EntrySpan {
  const rawDuration = Number.isFinite(durationMin) ? Math.round(durationMin) : MIN_ENTRY_MIN;
  const duration = Math.min(Math.max(rawDuration, MIN_ENTRY_MIN), DAY_MIN);

  const rawStart = Number.isFinite(startMin) ? Math.round(startMin) : 0;
  const start = Math.min(Math.max(rawStart, 0), DAY_MIN - duration);

  return { startMin: start, durationMin: duration };
}

/** Minutes from midnight → pixels from the top of a day column. */
export function minToY(min: number, pxPerMin: number): number {
  if (!Number.isFinite(min) || !Number.isFinite(pxPerMin)) return 0;
  return min * pxPerMin;
}

/** Pixels from the top of a day column → minutes from midnight (unsnapped). */
export function yToMin(y: number, pxPerMin: number): number {
  if (!Number.isFinite(y) || !Number.isFinite(pxPerMin) || pxPerMin === 0) return 0;
  return y / pxPerMin;
}

/**
 * `formatTimeRange(570, 90)` → `"09:30–11:00"`. An entry that ends exactly at
 * midnight reads `"24:00"` rather than wrapping to `"00:00"`.
 */
export function formatTimeRange(startMin: number, durationMin: number): string {
  const start = Number.isFinite(startMin) ? Math.round(startMin) : 0;
  const end = start + (Number.isFinite(durationMin) ? Math.round(durationMin) : 0);
  const endText = end === DAY_MIN ? '24:00' : formatClock(end);
  return `${formatClock(start)}–${endText}`;
}

const two = (value: number): string => String(value).padStart(2, '0');

/**
 * `"10/12 14:30"` — the stamp under a 지출 / 코멘트 row (M6).
 *
 * Deliberately year-less and locale-free: these rows sit inside a trip that is
 * days long, and a bare `Intl` call would render differently per device.
 */
export function formatStamp(at: number): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getMonth() + 1}/${date.getDate()} ${two(date.getHours())}:${two(date.getMinutes())}`;
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'] as const;

/** `"2026-08-23"` → `"8월 23일 (일)"`. Unparseable input is echoed back. */
export function formatDayDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!match) return iso;
  const [, y, m, d] = match;
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  if (Number.isNaN(date.getTime())) return iso;
  return `${Number(m)}월 ${Number(d)}일 (${WEEKDAYS[date.getDay()]})`;
}
