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
import { DAY_START_MIN, clockToOffset, visualPlacement, type DayAxis } from './dayWindow';
import { byStart } from './route';

const two = (value: number): string => String(value).padStart(2, '0');

/** A `Date` → the local calendar day it falls on, as `YYYY-MM-DD`. */
export function todayIso(date: Date): string {
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
}

/**
 * A `Date` → the `YYYY-MM-DD` of the **day window** it is inside (M16-B).
 *
 * 새벽 2시는 전날 밤이다. Before 05:00 the calendar has already turned over but
 * the day has not, so the window the user is living in is yesterday's — and
 * that is the column 오늘 must select, the column the now line belongs in, and
 * the day 지금/다음 must read.
 *
 * Only the 일정 tab uses this. {@link todayIso} stays the plain calendar day for
 * everything that really means a date (여행 목록의 D-day, 결산 기간).
 */
export function todayWindowIso(date: Date): string {
  if (Number.isNaN(date.getTime())) return '';
  if (nowMin(date) >= DAY_START_MIN) return todayIso(date);
  const yesterday = new Date(date.getTime());
  yesterday.setDate(yesterday.getDate() - 1);
  return todayIso(yesterday);
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

/** Which column 오늘 모드 points at, and where the now line goes inside it. */
export interface TodayFocus {
  /** The day of the active sheet the user is living in. */
  dayId: Id;
  /**
   * Where the red line is **drawn**, `0 … 1440` from the top of that column.
   */
  nowOffsetMin: number;
  /**
   * The same minute **unclamped** — negative in the {@link TodayFocus.dawn}
   * case. 지금/다음 uses this one, exactly as it uses
   * {@link import('./dayWindow').VisualPlacement.rawOffsetMin}: at 04:00 of the
   * first day nothing has started yet, and the first 다음 is that morning's
   * 09:00, not last night's anything.
   */
  nowRawOffsetMin: number;
  /**
   * True when the clock is in the 새벽 *before* the sheet's first window opens.
   * The same edge as a first-day 새벽 entry, and handled the same way: pinned to
   * the top of the column rather than drawn 19 hours down the wrong one.
   */
  dawn: boolean;
}

/**
 * 오늘 모드's one answer: which column, and where the line goes (M16-B, B6).
 *
 * Two passes, because 새벽 and 첫날 can be true at once:
 *
 * 1. the **window** day ({@link todayWindowIso}) — 새벽 2시는 어제 칸이다;
 * 2. failing that, the **calendar** day. This is the trip's 첫날 새벽: at
 *    5월 1일 04:00 of a sheet that starts on 5월 1일, the window the clock is
 *    inside is 4월 30일 — a date the sheet does not have, which used to turn
 *    오늘 모드 off on the very morning the traveller is standing in the trip.
 *    The column is 5월 1일 and the line sits at its top edge.
 *
 * `null` when the sheet holds neither date, which is a plan for another week.
 */
export function todayFocus(
  workspace: Workspace,
  sheetId: Id | undefined,
  now: Date,
): TodayFocus | null {
  const windowDayId = todayDayId(workspace, sheetId, todayWindowIso(now));
  const minute = nowMin(now);
  if (windowDayId) {
    const offset = clockToOffset(minute);
    return { dayId: windowDayId, nowOffsetMin: offset, nowRawOffsetMin: offset, dawn: false };
  }

  const calendarDayId = todayDayId(workspace, sheetId, todayIso(now));
  if (!calendarDayId) return null;
  return {
    dayId: calendarDayId,
    nowOffsetMin: 0,
    // Really is before the window opens — 04:00 is 60분 전이다.
    nowRawOffsetMin: minute - DAY_START_MIN,
    dawn: true,
  };
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

/**
 * 지금 / 다음 over a **window** day — 05시부터 다음 날 05시까지 (M16-B).
 *
 * The same two rules as {@link currentAndNext}, moved into window space: at
 * 01:30 the 지금 is the 23:00 entry that has not finished yet, and the 다음 is
 * the 02:00 one — neither of which the clock-space comparison could see, since
 * `23:00 <= 90` is false and `120 > 90` would have been true for the wrong
 * reason (a different calendar day).
 *
 * `entries` are the entries whose **effective** day is the visual day on
 * screen; `nowClockMin` is the wall clock, unchanged.
 *
 * `nowOffsetMin` overrides the clock → offset step for the one case the clock
 * cannot express: the 새벽 before the sheet's first day, where the honest offset
 * is negative ({@link TodayFocus.nowRawOffsetMin}) rather than 19 hours down.
 */
export function currentAndNextWindowed(
  entries: readonly TimelineEntry[],
  cards: Record<Id, Card>,
  dayOrder: DayAxis,
  nowClockMin: number,
  nowOffsetMin?: number,
): NowNext {
  const now = Number.isFinite(nowOffsetMin)
    ? (nowOffsetMin as number)
    : clockToOffset(Number.isFinite(nowClockMin) ? nowClockMin : 0);

  const live = entries
    .filter((entry) => Boolean(cards[entry.cardId]))
    .map((entry) => ({ entry, at: visualPlacement(entry, dayOrder).rawOffsetMin }))
    .sort((a, b) => a.at - b.at || byStart(a.entry, b.entry));

  const current = live.find(
    (row) => row.at <= now && now < row.at + Math.max(row.entry.durationMin, 1),
  );
  const next = live.find((row) => row.at > now);

  const result: NowNext = {};
  if (current) result.current = current.entry;
  if (next) {
    result.next = next.entry;
    result.gapMin = Math.max(next.at - now, 0);
  }
  return result;
}
