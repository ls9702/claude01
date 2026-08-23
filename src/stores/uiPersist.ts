/**
 * 활성 여행 / 시트만 기기에 남긴다 (M8-2, B15).
 *
 * `uiStore` is ephemeral on purpose — a tab, a focused card, a scroll position
 * are not data. But two of its fields are not view state at all: **which trip
 * you are in** is where you were when the phone locked, and losing it on every
 * reload sent both QA runs back to the trip picker mid-task.
 *
 * So exactly two ids are persisted, and nowhere near the workspace: this is
 * per-device `localStorage`, like `sync/settings.ts` and `sync/backup.ts`, and
 * it never rides along to another phone. The active tab still comes from the
 * URL hash, which is the right home for it.
 *
 * Everything is defensive so Node (vitest) and a private window with storage
 * blocked behave like "nothing remembered" rather than throwing, and
 * {@link validActiveIds} is pure so the "does this still exist?" rule can be
 * tested without a browser.
 */

import type { Workspace } from '../types/models';

const UI_KEY = 'trip-board/ui';

/** The only two fields worth remembering between reloads. */
export interface ActiveIds {
  activeTripId?: string;
  activeSheetId?: string;
}

/**
 * Both keys are always present — `zustand`'s `setState` merges shallowly, so a
 * missing key means "keep it" while an explicit `undefined` means "clear it".
 */
const EMPTY: Required<Record<keyof ActiveIds, undefined>> = {
  activeTripId: undefined,
  activeSheetId: undefined,
};

/** `localStorage`, or `null` where it is missing or blocked. */
function storage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

/** Reads a non-empty string, or `undefined` for anything else. */
const id = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

/** What this device was looking at last. `{}` when there is nothing to say. */
export function loadActiveIds(): ActiveIds {
  const store = storage();
  if (!store) return { ...EMPTY };
  try {
    const raw = store.getItem(UI_KEY);
    if (!raw) return { ...EMPTY };
    const parsed = JSON.parse(raw) as Partial<ActiveIds>;
    return { activeTripId: id(parsed.activeTripId), activeSheetId: id(parsed.activeSheetId) };
  } catch {
    return { ...EMPTY };
  }
}

/** Persists both ids. Silently does nothing where storage is unavailable. */
export function saveActiveIds(ids: ActiveIds): void {
  const store = storage();
  if (!store) return;
  try {
    if (!ids.activeTripId && !ids.activeSheetId) store.removeItem(UI_KEY);
    else store.setItem(UI_KEY, JSON.stringify(ids));
  } catch {
    /* quota / private mode — remembering where you were is a convenience */
  }
}

/**
 * Drops ids the workspace no longer backs.
 *
 * A trip deleted on another device (or on this one, before a restore) must not
 * leave the app pointing at a ghost. Losing the trip takes its sheet with it,
 * and a sheet that belongs to some *other* trip is dropped on its own.
 */
export function validActiveIds(ids: ActiveIds, workspace: Workspace): ActiveIds {
  const trip = ids.activeTripId ? workspace.trips[ids.activeTripId] : undefined;
  if (!trip) return { ...EMPTY };

  const sheet = ids.activeSheetId ? workspace.sheets[ids.activeSheetId] : undefined;
  return {
    activeTripId: trip.id,
    activeSheetId: sheet && sheet.tripId === trip.id ? sheet.id : undefined,
  };
}
