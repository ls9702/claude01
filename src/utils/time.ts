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
