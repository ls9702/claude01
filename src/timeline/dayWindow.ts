/**
 * 하루 시작 05시 — the visual/semantic day window (M16-B).
 *
 * ## The rule, once
 *
 * `1일차 = 1일차 05:00 → 2일차 05:00`. A timeline column no longer draws its own
 * calendar midnight-to-midnight; it draws the 1440 minutes that begin at
 * {@link DAY_START_MIN} of its date. Everything below is that one sentence,
 * spelled out.
 *
 * ## What did *not* change
 *
 * The stored model. `TimelineEntry.startMin` is still `0 … 1440` counted from
 * the **entry's own `dayId`'s midnight**, `durationMin` still never runs past
 * that midnight (`clampEntry`), and `schemaVersion` stays `1`. Nothing here is
 * persisted, nothing here is a migration. A workspace written by M15 and read
 * by M16 shows the same entries in different places — which is the whole
 * feature.
 *
 * So there are two coordinate systems, and every function in this file is a
 * translation between them:
 *
 * - **clock space** — `(dayId, startMin)`, what the store holds and what every
 *   label prints. `04:30` is `04:30` forever; M16 never renames a time.
 * - **window space** — `(renderDayId, offsetMin)`, where a block is drawn and
 *   which column's totals it feeds. `offsetMin` is minutes from the top of the
 *   drawn column, `0 … 1440`, and `offset 0` *is* `05:00`.
 *
 * ## Why the previous day, and not the next
 *
 * An entry at `02:00` of 5월 4일 belongs to the night of 5월 3일. The user typed
 * it while thinking "그날 밤"; the map's 3일차 동선 should end at it; the 3일차
 * money should count it. Pushing it *forward* into 4일차 would be the one
 * reading nobody meant. Hence: `startMin < 300` → the **previous** day's window.
 *
 * ## The three edges
 *
 * 1. **First day's 새벽** (`startMin < 300`, no previous day in `dayOrder`).
 *    There is no window to fall back into — 여행 시작 전날은 이 시트에 없다. The
 *    entry stays on its own day, pinned to the top in a thin 새벽 zone
 *    ({@link VisualPlacement.dawn}), because the alternative is an entry that
 *    exists in the store and nowhere on screen. It keeps its real clock label
 *    and stays tappable/draggable.
 * 2. **Crossing 05:00** (`startMin < 300` and `startMin + durationMin > 300`).
 *    `04:00 + 120분` starts in the previous window and ends after that window
 *    has closed. The block is drawn to the window's bottom edge and stopped
 *    there ({@link VisualPlacement.clipped}) — the same contract the old grid
 *    had at 24:00, one boundary further along. The stored duration is untouched;
 *    the detail sheet still reads `04:00–06:00`.
 * 3. **Last day's 새벽 zone** (a drop below the 24:00 line on the final day).
 *    That minute belongs to a day the sheet does not have, so
 *    {@link dropTarget} refuses rather than inventing one — see there.
 */

import type { Id, TimelineEntry, Workspace } from '../types/models';
import { DAY_MIN, DAY_START_MIN } from '../utils/time';

export { DAY_START_MIN };

/** Height of one drawn column, in minutes. Unchanged: a day is still a day. */
export const WINDOW_MIN = DAY_MIN;

/**
 * How tall a first-day 새벽 entry is drawn when none of it reaches 05:00.
 *
 * Its honest height would be zero — the window it belongs to is not on screen.
 * 30분 (27px at `PX_PER_MIN`) is the smallest strip that is still a tap target,
 * and the `새벽` badge on the block says the height is a pin, not a duration.
 */
export const DAWN_PIN_MIN = 30;

/** Where one entry is drawn, and which column's totals it belongs to. */
export interface VisualPlacement {
  /** The day column that draws it — its own, or the previous one. */
  renderDayId: Id;
  /**
   * Minutes from the top of that column, clamped to `0 … 1440`. This is the
   * number that becomes a `top:` pixel.
   */
  offsetMin: number;
  /**
   * The same offset **unclamped** — negative for a first-day 새벽 entry.
   *
   * Ordering, 지금/다음, gap arithmetic and route order all use this one: a
   * 02:00 entry pinned to `offsetMin: 0` must still sort before an 06:00 one,
   * and must still count as already over at 05:30.
   */
  rawOffsetMin: number;
  /** Minutes actually drawn — clipped at the window's bottom edge. */
  drawMin: number;
  /** True when {@link drawMin} is shorter than the entry really is. */
  clipped: boolean;
  /** True for a first-day pre-dawn entry pinned into the 새벽 zone. */
  dawn: boolean;
}

const finite = (value: number, fallback = 0): number =>
  Number.isFinite(value) ? value : fallback;

/** The minimum an entry needs from a caller to be placed. */
export interface PlaceableEntry {
  dayId: Id;
  startMin: number;
  durationMin?: number;
}

/**
 * `(dayId, startMin)` → `(renderDayId, offsetMin)`.
 *
 * - `startMin >= 300` → own day, `offset = startMin - 300`;
 * - `startMin < 300` with a previous day → that day, `offset = startMin + 1140`;
 * - `startMin < 300` with no previous day → own day, pinned (`dawn`).
 *
 * A `dayId` that is not in `dayOrder` at all (another sheet, a deleted row)
 * has no previous day by definition and takes the third branch, so the caller
 * never gets a `renderDayId` it did not ask about.
 */
export function visualPlacement(
  entry: PlaceableEntry,
  dayOrder: readonly Id[],
): VisualPlacement {
  const startMin = finite(entry.startMin);
  const durationMin = Math.max(finite(entry.durationMin ?? 0), 0);

  if (startMin >= DAY_START_MIN) {
    const offsetMin = startMin - DAY_START_MIN;
    const room = WINDOW_MIN - offsetMin;
    const drawMin = Math.min(durationMin, room);
    return {
      renderDayId: entry.dayId,
      offsetMin,
      rawOffsetMin: offsetMin,
      drawMin,
      clipped: drawMin < durationMin,
      dawn: false,
    };
  }

  // Pre-dawn. `+ WINDOW_MIN` is the "yesterday, late" shift: 01:00 of day N is
  // minute 1500 of day N-1's window, i.e. offset 1200.
  const rawOffsetMin = startMin + WINDOW_MIN - DAY_START_MIN;
  const index = dayOrder.indexOf(entry.dayId);
  const previous = index > 0 ? dayOrder[index - 1] : undefined;

  if (previous) {
    const room = WINDOW_MIN - rawOffsetMin;
    const drawMin = Math.min(durationMin, room);
    return {
      renderDayId: previous,
      offsetMin: rawOffsetMin,
      rawOffsetMin,
      // Edge 2: an entry that runs through 05:00 stops at the window's edge.
      drawMin,
      clipped: drawMin < durationMin,
      dawn: false,
    };
  }

  // Edge 1: nowhere to fall back to — pin it to the top of its own day.
  const reachesDawn = startMin + durationMin - DAY_START_MIN;
  const drawMin = Math.max(DAWN_PIN_MIN, Math.min(reachesDawn, WINDOW_MIN));
  return {
    renderDayId: entry.dayId,
    offsetMin: 0,
    // Negative on purpose: this entry really is before the window opens.
    rawOffsetMin: startMin - DAY_START_MIN,
    drawMin,
    clipped: drawMin < durationMin,
    dawn: true,
  };
}

/** Which column an entry's money / route / gap belongs to. Shorthand. */
export const effectiveDayId = (entry: PlaceableEntry, dayOrder: readonly Id[]): Id =>
  visualPlacement(entry, dayOrder).renderDayId;

/** What a drop resolved to, in the coordinates the store speaks. */
export interface DropTarget {
  dayId: Id;
  /** `0 … 1440`, minutes from that day's own midnight. */
  startMin: number;
}

/**
 * The inverse: a Y inside a drawn column → `(dayId, startMin)`.
 *
 * `yMin` is minutes from the top of `visualDayId`'s column, so the clock under
 * the pointer is `yMin + 300`. Past `24:00` (`clock >= 1440`) the pointer is
 * over the **next** day's small hours and the entry has to be created there,
 * one calendar day along, at `clock - 1440`.
 *
 * Returns `null` — edge 3 — when there is no next day: the last column's 새벽
 * zone shows minutes of a date the sheet does not contain, and quietly parking
 * the entry at 23:59 of the last day would be a different plan than the one the
 * user pointed at. The caller says '다음 일자가 없어요' instead.
 */
export function dropTarget(
  visualDayId: Id,
  yMin: number,
  dayOrder: readonly Id[],
): DropTarget | null {
  const y = Math.min(Math.max(finite(yMin), 0), WINDOW_MIN);
  const clock = y + DAY_START_MIN;

  if (clock < DAY_MIN) return { dayId: visualDayId, startMin: clock };

  const index = dayOrder.indexOf(visualDayId);
  const next = index >= 0 ? dayOrder[index + 1] : undefined;
  if (!next) return null;
  return { dayId: next, startMin: clock - DAY_MIN };
}

/** Sort key for a windowed column: visual order, then creation, then id. */
const byOffset = (
  a: { placement: VisualPlacement; entry: TimelineEntry },
  b: { placement: VisualPlacement; entry: TimelineEntry },
): number =>
  a.placement.rawOffsetMin - b.placement.rawOffsetMin ||
  a.entry.createdAt - b.entry.createdAt ||
  (a.entry.id < b.entry.id ? -1 : 1);

/** An entry together with where it lands. */
export interface WindowedEntry {
  entry: TimelineEntry;
  placement: VisualPlacement;
}

/**
 * Every entry of the workspace whose **effective** day is `dayId`, in the order
 * the column draws them.
 *
 * This is the one membership test the whole app shares: the day chip, the
 * summary bar, the gap chips, the map's 일차 route and 지금/다음 all call it (or
 * something built on it), so 지도 1일차 and 일정표 1일차 can never disagree.
 */
export function windowedDayEntries(
  workspace: Workspace,
  dayId: Id,
  dayOrder: readonly Id[],
): WindowedEntry[] {
  const rows: WindowedEntry[] = [];
  for (const entry of Object.values(workspace.entries)) {
    const placement = visualPlacement(entry, dayOrder);
    if (placement.renderDayId === dayId) rows.push({ entry, placement });
  }
  return rows.sort(byOffset);
}

/**
 * The same grouping done once for a whole sheet — `renderDayId → entries`.
 *
 * `windowedDayEntries` walks every entry in the workspace; a five-day sheet
 * calling it per day walks them five times. The grid needs all the days at
 * once, so it uses this.
 */
export function windowedEntriesByDay(
  entries: Iterable<TimelineEntry>,
  dayOrder: readonly Id[],
): Record<Id, WindowedEntry[]> {
  const byDay: Record<Id, WindowedEntry[]> = {};
  for (const entry of entries) {
    const placement = visualPlacement(entry, dayOrder);
    (byDay[placement.renderDayId] ??= []).push({ entry, placement });
  }
  for (const rows of Object.values(byDay)) rows.sort(byOffset);
  return byDay;
}

/**
 * Minutes from the top of the window for a wall-clock minute — the now line.
 *
 * `02:00` is minute 1140 of the window that opened at 05:00 *yesterday*, which
 * is exactly where the red line has to be drawn: near the bottom of 어제's
 * column, not at the top of 오늘's.
 */
export const clockToOffset = (clockMin: number): number => {
  const clock = ((finite(clockMin) % DAY_MIN) + DAY_MIN) % DAY_MIN;
  return clock >= DAY_START_MIN ? clock - DAY_START_MIN : clock + WINDOW_MIN - DAY_START_MIN;
};

/** The inverse of {@link clockToOffset}: `0 … 1440` offset → wall clock. */
export const offsetToClock = (offsetMin: number): number =>
  (finite(offsetMin) + DAY_START_MIN) % DAY_MIN;

/** One label per hour line of the axis: offsets `0, 60, … 1380`. */
export const WINDOW_HOUR_OFFSETS: readonly number[] = Array.from(
  { length: 24 },
  (_, index) => index * 60,
);

/**
 * `0 → '05:00'`, `1140 → '24:00'`, `1200 → '01:00'`.
 *
 * Labels are **clock** times and always were (M16 §4): the window moved, the
 * day did not get renumbered. Midnight reads `24:00` rather than `00:00`
 * because at that point in the column it is the *end* of the evening, the same
 * reason {@link import('../utils/time').formatTimeRange} already prints it.
 */
export function windowHourLabel(offsetMin: number): string {
  const clock = finite(offsetMin) + DAY_START_MIN;
  if (clock === DAY_MIN) return '24:00';
  const wrapped = ((clock % DAY_MIN) + DAY_MIN) % DAY_MIN;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
