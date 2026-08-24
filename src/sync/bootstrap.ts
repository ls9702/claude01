/**
 * Zero-config bootstrap (M14).
 *
 * The NAS deployment drops a `bootstrap-config.json` next to `index.html`:
 *
 *     { "sync": { "baseUrl": "https://…/api", "token": "…" }, "aiEnabled": true }
 *
 * On startup the app fetches it and, when this device has never been set up,
 * applies it — so the second (non-technical) user opens the URL, picks a
 * profile, and everything already works. GitHub Pages has no such file, so
 * the fetch 404s and nothing changes there.
 *
 * The user's own choices always win over the file:
 *  - sync already configured on this device        → file's sync ignored
 *  - user pressed 해제 (opt-out marker)             → file's sync never reapplies
 *  - AI toggle ever touched on this device         → file's aiEnabled ignored
 *
 * Deliberate trade-off, decided by the owner: the token in this file is
 * readable by anyone who can load the NAS page. Personal two-person
 * deployment behind HTTPS — convenience won.
 */

import { useAiStore, hasStoredAiSettings } from '../ai/aiSettings';
import { isConfigured, normalizeBaseUrl, saveSettings } from './settings';
import { restartSync } from './syncEngine';

const APPLIED_KEY = 'trip-board/bootstrap';
const OPTOUT_KEY = 'trip-board/bootstrap-optout';

/** What a valid bootstrap file may carry. */
export interface BootstrapConfig {
  sync?: { baseUrl: string; token: string };
  aiEnabled?: boolean;
}

function storage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

/**
 * Validates a parsed JSON body. Returns `null` when there is nothing usable —
 * a junk file must behave exactly like a missing one.
 */
export function parseBootstrapConfig(raw: unknown): BootstrapConfig | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const out: BootstrapConfig = {};

  const sync = record.sync;
  if (typeof sync === 'object' && sync !== null && !Array.isArray(sync)) {
    const { baseUrl, token } = sync as Record<string, unknown>;
    if (
      typeof baseUrl === 'string' &&
      normalizeBaseUrl(baseUrl).length > 0 &&
      typeof token === 'string' &&
      token.trim().length > 0
    ) {
      out.sync = { baseUrl, token };
    }
  }

  if (record.aiEnabled === true) out.aiEnabled = true;

  return out.sync || out.aiEnabled ? out : null;
}

/** True when this device's sync settings came from the bootstrap file. */
export function isBootstrapApplied(): boolean {
  try {
    return storage()?.getItem(APPLIED_KEY) != null;
  } catch {
    return false;
  }
}

/** Manual 저장 replaces the auto config — the note should disappear. */
export function clearBootstrapApplied(): void {
  try {
    storage()?.removeItem(APPLIED_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * 해제 means "this device does not want the server config" — remember that,
 * or the next reload would silently re-connect what the user just turned off.
 */
export function markBootstrapOptOut(): void {
  try {
    const store = storage();
    store?.setItem(OPTOUT_KEY, String(Date.now()));
    store?.removeItem(APPLIED_KEY);
  } catch {
    /* ignore */
  }
}

export function hasBootstrapOptOut(): boolean {
  try {
    return storage()?.getItem(OPTOUT_KEY) != null;
  } catch {
    return false;
  }
}

/**
 * Fetches and applies the bootstrap file. Never throws; resolves `true` when
 * anything was actually applied. Relative to the app base so it works under a
 * `/claude01/`-style subpath too.
 */
export async function applyBootstrapConfig(): Promise<boolean> {
  let config: BootstrapConfig | null = null;
  try {
    const base = import.meta.env.BASE_URL ?? '/';
    const response = await fetch(`${base}bootstrap-config.json`, { cache: 'no-store' });
    if (!response.ok) return false;
    config = parseBootstrapConfig(await response.json());
  } catch {
    return false;
  }
  if (!config) return false;

  let applied = false;

  if (config.sync && !isConfigured() && !hasBootstrapOptOut()) {
    saveSettings(config.sync);
    try {
      storage()?.setItem(APPLIED_KEY, String(Date.now()));
    } catch {
      /* ignore */
    }
    await restartSync();
    applied = true;
  }

  // Only when the toggle has never been touched on this device — an explicit
  // OFF must survive every reload.
  if (config.aiEnabled && !hasStoredAiSettings()) {
    useAiStore.getState().setEnabled(true);
    applied = true;
  }

  return applied;
}
