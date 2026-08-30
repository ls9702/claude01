/**
 * 서버가 말해 준 것들 (M46/M47).
 *
 * Three facts arrive on every `?meta=1` probe — the cheapest request the app
 * makes, already running every few seconds — and none of them belongs in the
 * workspace: they are about the **server**, not about the trip.
 *
 *   session   which workspace everybody is looking at   (M46)
 *   locked    is it read-only right now (보관)           (M47)
 *   notice    the administrator's one-line 공지          (M47)
 *   profiles  per-session display names / avatars        (M47)
 *
 * Deliberately *not* persisted. Every one of these is re-learned within one
 * poll of opening the app, and a stale copy from three days ago showing a 공지
 * that has since been taken down would be worse than showing nothing. The one
 * thing that *is* remembered across reloads is which notice this device has
 * dismissed, and that lives in `sync/notice.ts` where the dismissal is made.
 */

import { create } from 'zustand';
import type { ProfileOverrides, ServerNotice, SyncMeta } from '../sync/api';
import { DEFAULT_SESSION_ID } from '../sync/session';

export interface ServerStateStore {
  /** The session the server last said it was serving. */
  session: string;
  /** True while the active session is 보관 (read-only). */
  locked: boolean;
  /** The current 공지, or `null`. */
  notice: ServerNotice | null;
  /** Display overrides for the two profiles, or `null` for "use the defaults". */
  profiles: ProfileOverrides | null;

  /** Adopts everything a meta/envelope response carried. */
  applyMeta: (meta: SyncMeta) => void;
  /** Back to "we have not heard from a server" (해제, and tests). */
  reset: () => void;
}

const EMPTY = {
  session: DEFAULT_SESSION_ID,
  locked: false,
  notice: null,
  profiles: null,
} as const;

export const useServerStateStore = create<ServerStateStore>()((set) => ({
  ...EMPTY,

  applyMeta: (meta) =>
    set((state) => ({
      session: meta.session ?? state.session,
      locked: meta.locked === true,
      // `undefined` means the field was not in the response at all — a pre-M47
      // server — and must leave what we have alone. `null` is an answer.
      notice: meta.notice === undefined ? state.notice : meta.notice,
      profiles: meta.profiles === undefined ? state.profiles : meta.profiles,
    })),

  reset: () => set({ ...EMPTY }),
}));

/** The store as a plain read, for modules that must not subscribe. */
export const getServerState = (): ServerStateStore => useServerStateStore.getState();
