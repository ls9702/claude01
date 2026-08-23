import { create } from 'zustand';

/**
 * Single-slot undo used by the timeline's toast.
 *
 * Deliberately tiny: only the most recent undoable action is remembered, and
 * pushing a new one replaces it. Nothing here is persisted — an undo is only
 * offered for as long as the toast is on screen.
 */

/** How long an ordinary undo (a placement, an entry delete) stays offered. */
export const UNDO_DEFAULT_MS = 4_000;

/**
 * How long a *destructive* undo (여행/카테고리/카드/일정표/일자 삭제) stays
 * offered. Longer than the default on purpose — losing a whole trip is worth a
 * second read of the toast, and 4초 is not enough time to notice the mistake.
 */
export const UNDO_DESTRUCTIVE_MS = 10_000;

export interface UndoAction {
  /** Monotonic token; the toast restarts its timer whenever it changes. */
  token: number;
  /** Korean sentence shown in the toast, e.g. `'일정에 배치됨'`. */
  message: string;
  /** Reverses the action. Runs at most once. */
  undo: () => void;
  /** How long the toast keeps this offer alive. */
  durationMs: number;
}

export interface UndoState {
  current: UndoAction | null;
  /**
   * Offers `message` with an 실행 취소 button backed by `undo`.
   * `durationMs` defaults to {@link UNDO_DEFAULT_MS}.
   */
  offer: (message: string, undo: () => void, durationMs?: number) => void;
  /** Runs the pending undo and clears the slot. */
  runUndo: () => void;
  /** Drops the pending undo without running it (timeout / dismiss). */
  clear: () => void;
}

let nextToken = 1;

export const useUndoStore = create<UndoState>()((set, get) => ({
  current: null,

  offer: (message, undo, durationMs = UNDO_DEFAULT_MS) =>
    set({ current: { token: nextToken++, message, undo, durationMs } }),

  runUndo: () => {
    const pending = get().current;
    set({ current: null });
    pending?.undo();
  },

  clear: () => set({ current: null }),
}));
