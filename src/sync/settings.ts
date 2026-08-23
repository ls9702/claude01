/**
 * Sync configuration + the little bit of sync bookkeeping that has to outlive
 * a reload (M4).
 *
 * This lives in `localStorage`, not in the IndexedDB workspace blob, on
 * purpose: it is **per-device**, and it must never travel to the server and
 * back. Two phones pointed at the same NAS have their own token, their own
 * `serverVersion` and their own "last synced" clock.
 *
 * Everything here is defensive — the app has to keep working on GitHub Pages
 * with nothing configured, in a private window with storage disabled, and in
 * Node (vitest) where `localStorage` does not exist at all.
 */

import type { Millis } from '../types/models';

const SETTINGS_KEY = 'trip-board/sync-settings';
const STATE_KEY = 'trip-board/sync-state';

/** Where to sync, and the shared secret that gets us in. */
export interface SyncSettings {
  /**
   * Base URL that `data.php` sits under — `/api` when the app is served from
   * the same Synology Web Station host, or a full
   * `https://xxx.synology.me/travel/api` from anywhere else. No trailing slash
   * required; {@link normalizeBaseUrl} trims one.
   */
  baseUrl: string;
  /** Shared secret sent as `X-Sync-Token`. */
  token: string;
}

/** What the engine remembers between reloads. */
export interface SyncBookkeeping {
  /** Version counter of the server copy we last saw. `0` = never synced. */
  serverVersion: number;
  /** When the last successful push/pull finished. */
  lastSyncedAt?: Millis;
}

export const EMPTY_SETTINGS: SyncSettings = { baseUrl: '', token: '' };

/** `localStorage`, or `null` where it is missing or blocked (Node, private mode). */
function storage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

function readJson<T>(key: string): T | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(key, JSON.stringify(value));
  } catch {
    /* quota / private mode — sync config is a convenience, never fatal */
  }
}

/** Drops trailing slashes so `${base}/data.php` is always well-formed. */
export const normalizeBaseUrl = (baseUrl: string): string => baseUrl.trim().replace(/\/+$/, '');

/** Reads the stored settings, falling back to "not configured". */
export function loadSettings(): SyncSettings {
  const stored = readJson<Partial<SyncSettings>>(SETTINGS_KEY);
  if (!stored) return EMPTY_SETTINGS;
  return {
    baseUrl: typeof stored.baseUrl === 'string' ? stored.baseUrl : '',
    token: typeof stored.token === 'string' ? stored.token : '',
  };
}

/** Persists settings with the base URL normalized. */
export function saveSettings(settings: SyncSettings): SyncSettings {
  const normalized: SyncSettings = {
    baseUrl: normalizeBaseUrl(settings.baseUrl),
    token: settings.token.trim(),
  };
  writeJson(SETTINGS_KEY, normalized);
  return normalized;
}

/** Forgets the server entirely — settings *and* bookkeeping. */
export function clearSettings(): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(SETTINGS_KEY);
    store.removeItem(STATE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * True when there is somewhere to sync to. The token is not checked here — an
 * empty one simply fails the first request with 401, which is a much clearer
 * signal to the user than a silently disabled chip.
 */
export const isConfigured = (settings: SyncSettings = loadSettings()): boolean =>
  normalizeBaseUrl(settings.baseUrl).length > 0;

/** Reads the persisted `serverVersion` / `lastSyncedAt`. */
export function loadBookkeeping(): SyncBookkeeping {
  const stored = readJson<Partial<SyncBookkeeping>>(STATE_KEY);
  const serverVersion =
    typeof stored?.serverVersion === 'number' && Number.isFinite(stored.serverVersion)
      ? stored.serverVersion
      : 0;
  const lastSyncedAt =
    typeof stored?.lastSyncedAt === 'number' && Number.isFinite(stored.lastSyncedAt)
      ? stored.lastSyncedAt
      : undefined;
  return { serverVersion, lastSyncedAt };
}

/** Persists the `serverVersion` / `lastSyncedAt` pair. */
export function saveBookkeeping(state: SyncBookkeeping): void {
  writeJson(STATE_KEY, state);
}
