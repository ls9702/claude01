import { create } from 'zustand';
import type { Millis } from '../types/models';
import { loadBookkeeping, saveBookkeeping } from '../sync/settings';

/**
 * What the status chip shows.
 *
 * - `off`     — nothing configured. The app is local-only and perfectly happy.
 * - `idle`    — configured and up to date.
 * - `syncing` — a pull or push is in flight.
 * - `offline` — the transport failed; we retry on the next `online` event.
 * - `error`   — the server answered, but badly (bad token, 500, garbage body).
 */
export type SyncStatus = 'off' | 'idle' | 'syncing' | 'offline' | 'error';

/** Korean labels for the chip. */
export const SYNC_STATUS_LABELS: Record<SyncStatus, string> = {
  off: '끔',
  idle: '동기화됨',
  syncing: '동기화 중',
  offline: '오프라인',
  error: '오류',
};

export interface SyncState {
  status: SyncStatus;
  /** When the last successful push/pull landed. */
  lastSyncedAt?: Millis;
  /** User-facing message for the most recent failure. */
  lastError?: string;
  /** Version counter of the server copy we last saw. `0` = never synced. */
  serverVersion: number;

  /** Sets the status; clears `lastError` unless one is supplied. */
  setStatus: (status: SyncStatus, error?: string) => void;
  /** Records a successful round trip and persists the bookkeeping. */
  markSynced: (serverVersion: number, at?: Millis) => void;
  /** Updates the known server version without claiming success. */
  setServerVersion: (serverVersion: number) => void;
  /** Back to a never-configured state (used by 해제). */
  reset: () => void;
}

const initial = loadBookkeeping();

export const useSyncStore = create<SyncState>()((set, get) => ({
  status: 'off',
  lastSyncedAt: initial.lastSyncedAt,
  lastError: undefined,
  serverVersion: initial.serverVersion,

  setStatus: (status, error) => set({ status, lastError: error }),

  markSynced: (serverVersion, at = Date.now()) => {
    set({ status: 'idle', serverVersion, lastSyncedAt: at, lastError: undefined });
    saveBookkeeping({ serverVersion, lastSyncedAt: at });
  },

  setServerVersion: (serverVersion) => {
    set({ serverVersion });
    saveBookkeeping({ serverVersion, lastSyncedAt: get().lastSyncedAt });
  },

  reset: () => {
    set({ status: 'off', serverVersion: 0, lastSyncedAt: undefined, lastError: undefined });
    saveBookkeeping({ serverVersion: 0 });
  },
}));
