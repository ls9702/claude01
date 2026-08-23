/**
 * 오늘 모드 — the 일정 tab pointed at the minute the user is actually living in
 * (M7b).
 *
 * Everything here is pure and takes the clock as an argument (`Date` / a
 * `YYYY-MM-DD` string / minutes from midnight), the way `sync/backup.ts` takes
 * its `now`: the component owns the timer, these functions own the arithmetic,
 * and the tests own a fixed clock.
 *
 * "Today" is deliberately the **device's local calendar day**, not UTC: a
 * traveller in Osaka wants the day they are standing in, and the day rows they
 * are matched against were typed in as local dates too.
 */

import type { Card, Id, TimelineEntry, Workspace } from '../types/models';
import { isIsoDate } from '../utils/flights';
import { byStart } from './route';

const two = (value: number): string => String(value).padStart(2, '0');

/** A `Date` → the local calendar day it falls on, as `YYYY-MM-DD`. */
export function todayIso(date: Date): string {
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
}

/** A `Date` → minutes from local midnight (`09:30` → `570`). */
export function nowMin(date: Date): number {
  if (Number.isNaN(date.getTime())) return 0;
  return date.getHours() * 60 + date.getMinutes();
}

/**
 * The day of `sheetId` whose `date` is `today`, or `null` when the sheet has
 * none — a plan for next month, or a dateless 일수 sheet.
 *
 * Only the active sheet is searched: two sheets may well both cover today (플랜
 * A / 플랜 B), and jumping the user to the other one would be a surprise.
 */
export function todayDayId(
  workspace: Workspace,
  sheetId: Id | undefined,
  today: string,
): Id | null {
  if (!sheetId || !isIsoDate(today)) return null;
  const sheet = workspace.sheets[sheetId];
  if (!sheet) return null;

  for (const dayId of sheet.dayOrder) {
    const day = workspace.days[dayId];
    if (day && day.date === today) return day.id;
  }
  return null;
}

/** What the 「지금 / 다음」 bar shows. Every field is absent when it has no answer. */
export interface NowNext {
  /** The entry the clock is inside right now. */
  current?: TimelineEntry;
  /** The first entry that has not started yet. */
  next?: TimelineEntry;
  /** Minutes from now until {@link NowNext.next} starts. Absent with no next. */
  gapMin?: number;
}

/**
 * Splits one day's entries into 지금 / 다음 around `minute`.
 *
 * - **current** = the first entry (in start order) whose span contains the
 *   minute; an entry that ends exactly now has already ended.
 * - **next** = the first entry that starts strictly after the minute, so an
 *   entry starting this very minute is 지금, never 다음.
 *
 * Entries whose card has been deleted are skipped — the bar has nothing to
 * title them with, and a dangling entry is not a plan.
 */
export function currentAndNext(
  entries: readonly TimelineEntry[],
  cards: Record<Id, Card>,
  minute: number,
): NowNext {
  const now = Number.isFinite(minute) ? minute : 0;
  const live = entries.filter((entry) => Boolean(cards[entry.cardId])).sort(byStart);

  const current = live.find(
    (entry) => entry.startMin <= now && now < entry.startMin + Math.max(entry.durationMin, 1),
  );
  const next = live.find((entry) => entry.startMin > now);

  const result: NowNext = {};
  if (current) result.current = current;
  if (next) {
    result.next = next;
    result.gapMin = Math.max(next.startMin - now, 0);
  }
  return result;
}
