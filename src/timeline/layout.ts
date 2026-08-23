import type { Id } from '../types/models';

/**
 * Side-by-side layout for overlapping timeline entries.
 *
 * Pure and React-free (mirrors `src/dnd/boardDnd.ts`) so the geometry can be
 * unit-tested without a DOM: the day column only turns the returned
 * `lane`/`lanes` pair into a percentage width.
 */

/** The minimum an entry needs from a caller to be laid out. */
export interface LaneItem {
  id: Id;
  startMin: number;
  durationMin: number;
}

/** Where one entry sits inside its overlap cluster. */
export interface LaneBox {
  id: Id;
  /** 0-based column inside the cluster. */
  lane: number;
  /** How many columns the cluster was split into (≥ 1). */
  lanes: number;
}

/** Grid constants shared by the axis, the day columns and the drop math. */
export const PX_PER_MIN = 0.9;

/** Height of a full day column in CSS pixels (`1440 × PX_PER_MIN`). */
export const DAY_HEIGHT_PX = 1440 * PX_PER_MIN;

/** Where the grid is scrolled on first paint — 06:00, not midnight. */
export const INITIAL_SCROLL_MIN = 360;

/** Width of one day column on desktop, in CSS pixels. */
export const DAY_COLUMN_PX = 224;

/** Width of the hour-label gutter, in CSS pixels. */
export const AXIS_PX = 52;

/** Height of the sticky day-header row, in CSS pixels. */
export const HEADER_PX = 44;

/** Sort key: earlier first, then longer first, then id — always deterministic. */
const byStart = (a: LaneItem, b: LaneItem): number =>
  a.startMin - b.startMin || b.durationMin - a.durationMin || (a.id < b.id ? -1 : 1);

const endOf = (item: LaneItem): number => item.startMin + Math.max(item.durationMin, 1);

/**
 * Splits `items` into clusters of transitively overlapping entries and packs
 * each cluster into as few lanes as possible (greedy, left-to-right).
 *
 * Entries that merely touch (`10:00–11:00` and `11:00–12:00`) do **not**
 * overlap and each get the full column width.
 *
 * The result is keyed by entry id and is stable for a given input set.
 */
export function layoutLanes(items: readonly LaneItem[]): LaneBox[] {
  const sorted = [...items].sort(byStart);
  const boxes = new Map<Id, LaneBox>();

  /** Entries of the cluster being packed, plus the end time of each lane. */
  let cluster: { id: Id; lane: number }[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    for (const member of cluster) {
      boxes.set(member.id, { id: member.id, lane: member.lane, lanes: laneEnds.length });
    }
    cluster = [];
    laneEnds = [];
    clusterEnd = -Infinity;
  };

  for (const item of sorted) {
    // A gap wider than zero closes the cluster: nothing after it can overlap
    // anything inside it, because the list is sorted by start time.
    if (item.startMin >= clusterEnd) flush();

    let lane = laneEnds.findIndex((end) => end <= item.startMin);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(0);
    }
    laneEnds[lane] = endOf(item);
    clusterEnd = Math.max(clusterEnd, endOf(item));
    cluster.push({ id: item.id, lane });
  }
  flush();

  // Return in input order so React keys stay put.
  return items.map(
    (item) => boxes.get(item.id) ?? { id: item.id, lane: 0, lanes: 1 },
  );
}

/** `layoutLanes` result as a lookup, for components that render one entry. */
export function laneMap(items: readonly LaneItem[]): Record<Id, LaneBox> {
  const map: Record<Id, LaneBox> = {};
  for (const box of layoutLanes(items)) map[box.id] = box;
  return map;
}
