/**
 * 이동 갭 — the straight-line fact between two consecutive located stops (M7b).
 *
 * This module states **only what it can measure**: how far apart two places
 * are, and how many minutes the plan leaves between them. It deliberately does
 * not estimate travel time, guess a mode of transport, or suggest a fix — a
 * wrong "20분 걸려요" is worse than no number at all, and the app has no
 * routing data to be right with.
 *
 * The ordering comes from {@link dayRoute} so the chips can never disagree with
 * the arrows on the map; a leg that already carries a 이동수단 card
 * (`transportCardId`) is skipped, because the user has answered the question.
 */

import type { Id, TimelineEntry, Workspace } from '../types/models';
import { byStart, dayRoute, haversineKm, type RouteStop } from './route';

/** One hop between two located stops of a day. */
export interface DayGap {
  /** The entry the chip is drawn under — the earlier of the two stops. */
  afterEntryId: Id;
  /** Straight-line distance between the two places, in kilometres. */
  distanceKm: number;
  /**
   * Minutes between the end of the earlier entry and the start of the later
   * one. Negative when the two overlap — kept raw rather than clamped, so the
   * caller sees the plan as it really is.
   */
  gapMin: number;
  /** {@link IMPOSSIBLE_GAP_MIN} or less to cross more than {@link IMPOSSIBLE_KM}. */
  impossible: boolean;
}

/** At or below this many minutes, a hop of any real length is a warning. */
export const IMPOSSIBLE_GAP_MIN = 5;

/** Above this many kilometres, no minute-count of 5 or less is plausible. */
export const IMPOSSIBLE_KM = 1;

/**
 * Straight-line gaps of one day, in schedule order.
 *
 * A row exists only when **both** ends are located (that is what a
 * {@link RouteStop} is) and no 이동수단 card sits between them. An unknown day,
 * a day with one stop, or a day whose every leg carries a ride → `[]`.
 */
export function dayGaps(workspace: Workspace, dayId: Id): DayGap[] {
  const route = dayRoute(workspace, dayId);
  if (route.legs.length === 0) return [];

  /**
   * `dayRoute` built its stops by walking the day's entries in `byStart` order
   * and keeping the located ones, so walking that same list with a cursor maps
   * every stop back onto the exact entry that produced it — including the case
   * where one card is placed on the day twice.
   */
  const entries = Object.values(workspace.entries)
    .filter((entry) => entry.dayId === dayId)
    .sort(byStart);

  const entryOfStop = new Map<RouteStop, TimelineEntry>();
  let cursor = 0;
  for (const stop of route.stops) {
    while (
      cursor < entries.length &&
      !(entries[cursor].cardId === stop.cardId && entries[cursor].startMin === stop.startMin)
    ) {
      cursor += 1;
    }
    if (cursor >= entries.length) break;
    entryOfStop.set(stop, entries[cursor]);
    cursor += 1;
  }

  const gaps: DayGap[] = [];
  for (const leg of route.legs) {
    if (leg.transportCardId) continue;

    const from = entryOfStop.get(leg.from);
    const to = entryOfStop.get(leg.to);
    if (!from || !to) continue;

    const distanceKm = haversineKm(leg.from, leg.to);
    const gapMin = to.startMin - (from.startMin + from.durationMin);
    gaps.push({
      afterEntryId: from.id,
      distanceKm,
      gapMin,
      impossible: gapMin <= IMPOSSIBLE_GAP_MIN && distanceKm > IMPOSSIBLE_KM,
    });
  }
  return gaps;
}
