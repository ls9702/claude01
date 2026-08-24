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
import { windowedDayEntries, type DayAxis } from './dayWindow';
import {
  byStart,
  dayRoute,
  dayRouteWindowed,
  haversineKm,
  type DayRoute,
  type RouteStop,
} from './route';

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
  const entries = Object.values(workspace.entries)
    .filter((entry) => entry.dayId === dayId)
    .sort(byStart);
  // Calendar semantics: an entry's own `startMin` is its position on the day.
  return gapsOf(dayRoute(workspace, dayId), entries, (entry) => entry.startMin);
}

/**
 * The same gaps over a **window** day — 05시부터 다음 날 05시까지 (M16-B).
 *
 * The minute arithmetic moves into window space with the stops: `23:40 +
 * 40분 → 00:20` is a zero-minute gap on one night, where the calendar version
 * would have computed `20 - 1460 = -1440분` and called it an overlap.
 */
export function dayGapsWindowed(
  workspace: Workspace,
  dayId: Id,
  dayOrder: DayAxis,
): DayGap[] {
  const rows = windowedDayEntries(workspace, dayId, dayOrder);
  const offsets = new Map<Id, number>(
    rows.map((row) => [row.entry.id, row.placement.rawOffsetMin]),
  );
  return gapsOf(
    dayRouteWindowed(workspace, dayId, dayOrder),
    rows.map((row) => row.entry),
    (entry) => offsets.get(entry.id) ?? entry.startMin,
  );
}

/**
 * Turns a route plus the ordered entry list that produced it into gap rows.
 *
 * `positionOf` is what makes the two flavours differ: clock minutes for the
 * calendar day, window offsets for the 05시 window. Everything else — the stop
 * → entry mapping and the 이동수단 skip — is identical, and stays written once.
 */
function gapsOf(
  route: DayRoute,
  entries: readonly TimelineEntry[],
  positionOf: (entry: TimelineEntry) => number,
): DayGap[] {
  if (route.legs.length === 0) return [];

  /**
   * The route built its stops by walking this exact list in this exact order
   * and keeping the located ones, so walking it again with a cursor maps every
   * stop back onto the entry that produced it — including the case where one
   * card is placed on the day twice.
   */
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
    /**
     * Same card, twice in a row → no hop at all.
     *
     * The distance is 0km and the minute count is whatever the two placements
     * happen to leave between them, so the chip would read 「직선 0m」 — or, for
     * the 심야편 split into a tail and a head, 「직선 0m · 시간이 부족해요」 about
     * standing still in an airport. There is no journey here to state.
     */
    if (from.cardId === to.cardId) continue;

    const distanceKm = haversineKm(leg.from, leg.to);
    const gapMin = positionOf(to) - (positionOf(from) + from.durationMin);
    gaps.push({
      afterEntryId: from.id,
      distanceKm,
      gapMin,
      impossible: gapMin <= IMPOSSIBLE_GAP_MIN && distanceKm > IMPOSSIBLE_KM,
    });
  }
  return gaps;
}
