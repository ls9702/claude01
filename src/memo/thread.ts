/**
 * 메모 스레드의 순서와 날짜 구분 (M21) — the two decisions a chat has to make.
 *
 * `Workspace.memos` is a map, and a conversation is a *list*: what turns one
 * into the other is a total order, and the only honest one is "when it was
 * said". So there is no `memoOrder` array anywhere — nothing to reconcile in
 * `sync/merge`, nothing for two devices to fight over, and a message written
 * offline slots into the right place in the other person's thread the moment it
 * arrives rather than at whichever end pushed last.
 *
 * Pure and React-free, so both the ordering and the 8월 25일 (월) chips are
 * testable without a browser — which is the whole reason they live here and not
 * inside `MemoView`.
 */

import type { Id, MemoMessage, Millis } from '../types/models';
import { todayIso } from '../timeline/today';
import { formatDayDate } from '../utils/time';

/**
 * Total order of a thread: oldest first, ties broken by id.
 *
 * The tiebreak is not decoration. Two messages sent in the same millisecond —
 * one per device, then merged — would otherwise render in whatever order
 * `Object.values` happened to hand them over, and the two phones would disagree
 * about their own conversation.
 */
export function byMemoTime(a: MemoMessage, b: MemoMessage): number {
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** One trip's messages, oldest first. Anything else in the map is ignored. */
export function threadOf(
  memos: Record<Id, MemoMessage> | undefined,
  tripId: Id | undefined,
): MemoMessage[] {
  if (!memos || !tripId) return [];
  return Object.values(memos)
    .filter((memo) => memo.tripId === tripId)
    .sort(byMemoTime);
}

/** A run of messages that share one calendar day, under its own chip. */
export interface MemoDay {
  /** `YYYY-MM-DD` in device-local time — also the React key. */
  date: string;
  /** `8월 25일 (월)`. */
  label: string;
  messages: MemoMessage[];
}

/**
 * Splits an already-ordered thread into day runs (KakaoTalk's date chips).
 *
 * The **calendar** day, not the 05시 window the 일정 tab lives by: a message
 * sent at 새벽 2시 was sent today, and a chat has no day boundary to honour.
 * Local time for the same reason `timeline/today` uses it — the person reading
 * the chip is standing in that timezone.
 */
export function groupByDay(messages: readonly MemoMessage[]): MemoDay[] {
  const days: MemoDay[] = [];
  for (const message of messages) {
    const date = todayIso(new Date(message.createdAt));
    const last = days.at(-1);
    if (last && last.date === date) last.messages.push(message);
    else days.push({ date, label: formatDayDate(date), messages: [message] });
  }
  return days;
}

/** `HH:mm` beside a bubble — the only stamp a chat line needs. */
export function memoClock(at: Millis): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return '';
  const two = (value: number): string => String(value).padStart(2, '0');
  return `${two(date.getHours())}:${two(date.getMinutes())}`;
}

/** True when the message has been soft-deleted (see {@link MemoMessage.removedAt}). */
export const isRemoved = (memo: MemoMessage): boolean =>
  typeof memo.removedAt === 'number' && memo.removedAt > 0;
