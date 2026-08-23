/**
 * Per-sheet rollup of a trip's timeline entries (M2b).
 *
 * The 🗓 badge on a board card used to be a single number; with several sheets
 * per trip it also has to answer *which* 일정표 those placements are on. Pure
 * and store-free so both the 보드 tab and the 일정 rail can share it — and so
 * the counting is unit-testable without React.
 */

import type { Id, Workspace } from '../types/models';

/** How often one card appears on one sheet. */
export interface SheetScheduleCount {
  sheetId: Id;
  /** The sheet's name at the time of the rollup, for the popover row. */
  sheetName: string;
  count: number;
}

/** What the badge and its popover need, keyed by card id. */
export interface ScheduleSummary {
  /** cardId → total entries across every sheet. Drives `data-count`. */
  counts: Record<Id, number>;
  /** cardId → per-sheet rows in the trip's `sheetOrder`. */
  bySheet: Record<Id, SheetScheduleCount[]>;
}

/**
 * Counts `workspace.entries` per card, and per sheet inside each card.
 *
 * `tripId` narrows the rollup to one trip; pass `undefined` to count the whole
 * workspace. An entry whose day has gone missing still counts towards the
 * total — it just cannot be attributed to a sheet.
 */
export function summarizeSchedule(
  workspace: Workspace,
  tripId: Id | undefined,
): ScheduleSummary {
  const counts: Record<Id, number> = {};
  /** cardId → sheetId → count. */
  const perCard = new Map<Id, Map<Id, number>>();

  for (const entry of Object.values(workspace.entries)) {
    if (tripId && entry.tripId !== tripId) continue;
    counts[entry.cardId] = (counts[entry.cardId] ?? 0) + 1;

    const sheetId = workspace.days[entry.dayId]?.sheetId;
    if (!sheetId) continue;
    let bucket = perCard.get(entry.cardId);
    if (!bucket) {
      bucket = new Map<Id, number>();
      perCard.set(entry.cardId, bucket);
    }
    bucket.set(sheetId, (bucket.get(sheetId) ?? 0) + 1);
  }

  const order = tripId
    ? (workspace.trips[tripId]?.sheetOrder ?? [])
    : Object.keys(workspace.sheets);

  const bySheet: Record<Id, SheetScheduleCount[]> = {};
  for (const [cardId, bucket] of perCard) {
    const rows = order
      .filter((sheetId) => bucket.has(sheetId))
      .map((sheetId) => ({
        sheetId,
        sheetName: workspace.sheets[sheetId]?.name ?? '일정',
        count: bucket.get(sheetId) ?? 0,
      }));
    if (rows.length > 0) bySheet[cardId] = rows;
  }

  return { counts, bySheet };
}
