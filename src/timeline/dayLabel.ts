/**
 * 일자 헤더의 두 줄 — 제목과 부제 (M8-2, B12).
 *
 * A day used to be *born* with a `N일차` label baked into it, which turned an
 * insert or a delete into a lie: `2일차 · 3일차 · 3일차`. Position is the only
 * honest source for that number, so it is derived here, at render time, and
 * never stored.
 *
 * Old sheets still carry those baked-in labels. {@link AUTO_DAY_LABEL_RE}
 * recognises them and lets position win, so existing data heals itself the
 * moment it is drawn — no migration, and a label the *user* typed ("도착일")
 * still outranks everything.
 *
 * Pure and React-free so both the desktop day header and the mobile pager can
 * read the same two lines.
 */

import type { Day } from '../types/models';
import { dayLabelAt } from '../utils/flights';
import { formatDayDate } from '../utils/time';

/** A label the app generated from a position: `1일차`, `12일차`, … */
export const AUTO_DAY_LABEL_RE = /^\d+일차$/;

/** The user's own label, or `undefined` for a blank/auto-generated one. */
export function userDayLabel(day: Day): string | undefined {
  const label = day.label?.trim();
  if (!label || AUTO_DAY_LABEL_RE.test(label)) return undefined;
  return label;
}

/** Heading of a day column: the user's label, else `N일차` from `index`. */
export function dayTitle(day: Day, index: number): string {
  return userDayLabel(day) ?? dayLabelAt(index);
}

/**
 * The line under the heading: the date when there is one, else `N일차` beside a
 * user label — and **nothing** when that would just repeat the heading.
 */
export function daySubtitle(day: Day, index: number): string {
  if (day.date) return formatDayDate(day.date);
  return userDayLabel(day) ? dayLabelAt(index) : '';
}
