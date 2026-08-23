import { create } from 'zustand';

/**
 * Single-slot undo used by the timeline's toast.
 *
 * Deliberately tiny: only the most recent undoable action is remembered, and
 * pushing a new one replaces it. Nothing here is persisted — an undo is only
 * offered for as long as the toast is on screen.
 */
export interface UndoAction {
  /** Monotonic token; the toast restarts its timer whenever it changes. */
  token: number;
  /** Korean sentence shown in the toast, e.g. `'일정에 배치됨'`. */
  message: string;
  /** Reverses the action. Runs at most once. */
  undo: () => void;
}

export interface UndoState {
  current: UndoAction | null;
  /** Offers `message` with an 실행 취소 button backed by `undo`. */
  offer: (message: string, undo: () => void) => void;
  /** Runs the pending undo and clears the slot. */
  runUndo: () => void;
  /** Drops the pending undo without running it (timeout / dismiss). */
  clear: () => void;
}

let nextToken = 1;

export const useUndoStore = create<UndoState>()((set, get) => ({
  current: null,

  offer: (message, undo) => set({ current: { token: nextToken++, message, undo } }),

  runUndo: () => {
    const pending = get().current;
    set({ current: null });
    pending?.undo();
  },

  clear: () => set({ current: null }),
}));
