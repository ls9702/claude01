import { create } from 'zustand';
import type { Millis } from '../types/models';

/**
 * 저장 실패 감지 (M7a).
 *
 * IndexedDB writes fail quietly on the platforms that matter most to this app:
 * Safari private browsing, an over-quota origin, iOS evicting the database
 * under storage pressure. `idbStorage.setItem` swallows those errors so the UI
 * never breaks — which is right, but it also means a user can keep planning a
 * trip for an hour with nothing actually being kept.
 *
 * This store is the missing feedback loop: the storage adapter reports every
 * write outcome here, and the app can put a banner up once the failures stop
 * looking like a fluke.
 *
 * Deliberately *not* persisted — it describes the health of persistence
 * itself, and a store that cannot write cannot record that it cannot write.
 */

/**
 * How many writes in a row must fail before we say anything.
 *
 * One failure is not a story: a transaction can lose a race with a tab being
 * closed, or with the browser reclaiming an idle connection, and the very next
 * write goes through. Two consecutive failures is a pattern.
 */
export const PERSIST_FAIL_THRESHOLD = 2;

export interface PersistHealthState {
  /** Consecutive failed writes. Reset to `0` by any success. */
  failCount: number;
  /** When the most recent failure happened. Kept after a recovery. */
  lastFailAt?: Millis;

  /** Records a successful write — clears the streak. */
  ok: () => void;
  /** Records a failed write — extends the streak. */
  fail: (at?: Millis) => void;
  /** Back to a clean slate (tests). */
  reset: () => void;
}

export const usePersistHealthStore = create<PersistHealthState>()((set) => ({
  failCount: 0,
  lastFailAt: undefined,

  ok: () => set((state) => (state.failCount === 0 ? state : { ...state, failCount: 0 })),

  fail: (at = Date.now()) =>
    set((state) => ({ ...state, failCount: state.failCount + 1, lastFailAt: at })),

  reset: () => set({ failCount: 0, lastFailAt: undefined }),
}));

/** True once the failures are worth warning about. */
export const isPersistFailing = (failCount: number): boolean =>
  failCount >= PERSIST_FAIL_THRESHOLD;

/** Selector form of {@link isPersistFailing}, for `useStore(...)`. */
export const selectPersistFailing = (state: PersistHealthState): boolean =>
  isPersistFailing(state.failCount);
