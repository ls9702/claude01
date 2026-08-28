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
 *  - sync configured **by hand** on this device    → file's sync ignored
 *  - user pressed 해제 (opt-out marker)             → file's sync never reapplies
 *  - AI toggle ever touched on this device         → file's aiEnabled ignored
 *
 * The one thing the file *keeps* control of is the address it handed out in
 * the first place (M20): a device that was configured by the file follows the
 * file when the file moves. See {@link decideBootstrapSync} for why that is
 * worth the extra rule.
 *
 * A follow also re-uploads photos, as a side effect worth knowing about: the
 * uploader's "already sent" set in `sync/photoSync` is keyed by server
 * address, so a new address starts with an empty set and every referenced
 * photo is PUT again. If the move was a rename in front of the same disk the
 * files are already there and each PUT is an idempotent 200 — a few hundred KB
 * of wasted upload, once, in exchange for not needing a way to ask a server
 * what it already has.
 *
 * Deliberate trade-off, decided by the owner: the token in this file is
 * readable by anyone who can load the NAS page. Personal two-person
 * deployment behind HTTPS — convenience won.
 */

import { useAiStore, hasStoredAiSettings } from '../ai/aiSettings';
import { normalizeGoogleMapsKey, useGoogleMapsKeyStore } from '../map/gmapsKey';
import type { Millis } from '../types/models';
import { isConfigured, loadSettings, normalizeBaseUrl, saveSettings } from './settings';
import { restartSync } from './syncEngine';

const APPLIED_KEY = 'trip-board/bootstrap';
const OPTOUT_KEY = 'trip-board/bootstrap-optout';

/** What a valid bootstrap file may carry. */
export interface BootstrapConfig {
  sync?: { baseUrl: string; token: string };
  aiEnabled?: boolean;
  /**
   * 구글 지도 브라우저 키 (M41) — 있으면 이 기기가 구글 지도를 쓸 수 있다.
   *
   * 동기화 토큰과 같은 파일에 사는 같은 종류의 맞바꿈이고(위 문단), 이 키에는
   * 그 위에 HTTP 리퍼러 제한이 걸려 있다. 없으면 아무 일도 일어나지 않는다 —
   * 앱은 M3부터의 OSM 지도 그대로다.
   */
  googleMapsKey?: string;
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

  // 공백만 든 키는 「키 없음」을 잘못 적은 것이다 — 없는 것으로 읽는다 (M41).
  const googleMapsKey = normalizeGoogleMapsKey(record.googleMapsKey);
  if (googleMapsKey) out.googleMapsKey = googleMapsKey;

  return out.sync || out.aiEnabled || out.googleMapsKey ? out : null;
}

/* ------------------------------------------------------------------ *
 * The applied marker
 * ------------------------------------------------------------------ */

/**
 * What the bootstrap file last talked this device into.
 *
 * M14 wrote a bare timestamp here, which was enough to answer "did the file
 * configure this device?" but not "which server did it point at?" — and that
 * second question is the whole of M20's address follow-up. The value is now
 * JSON; a legacy timestamp is still honoured as "applied, address unknown".
 */
export interface BootstrapApplied {
  at: Millis;
  /** The address that was applied, normalized. Absent in legacy markers. */
  baseUrl?: string;
}

/**
 * Reads the marker in either shape. `null` means the file never configured
 * this device — which is also what a manual 저장 leaves behind, and the
 * difference is load-bearing: a device the user set up by hand is never
 * dragged somewhere else by the file.
 */
export function parseAppliedMarker(raw: string | null): BootstrapApplied | null {
  if (raw == null || raw === '') return null;

  // M14's format: `String(Date.now())`. Applied, but we cannot say to where.
  const legacy = Number(raw);
  if (Number.isFinite(legacy) && /^\d+$/.test(raw.trim())) return { at: legacy };

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    const at = typeof record.at === 'number' && Number.isFinite(record.at) ? record.at : 0;
    const baseUrl =
      typeof record.baseUrl === 'string' && normalizeBaseUrl(record.baseUrl).length > 0
        ? normalizeBaseUrl(record.baseUrl)
        : undefined;
    return baseUrl ? { at, baseUrl } : { at };
  } catch {
    // Unparseable but present. Something wrote it, so the device is not
    // "untouched"; treat it as applied-with-unknown-address rather than
    // silently promoting it to a manually-configured device.
    return { at: 0 };
  }
}

/** The marker for this device, or `null`. */
export function readAppliedMarker(): BootstrapApplied | null {
  try {
    return parseAppliedMarker(storage()?.getItem(APPLIED_KEY) ?? null);
  } catch {
    return null;
  }
}

/** Records that the file's `baseUrl` is what this device is now pointed at. */
function writeAppliedMarker(baseUrl: string): void {
  try {
    storage()?.setItem(
      APPLIED_KEY,
      JSON.stringify({ at: Date.now(), baseUrl: normalizeBaseUrl(baseUrl) }),
    );
  } catch {
    /* ignore */
  }
}

/** True when this device's sync settings came from the bootstrap file. */
export function isBootstrapApplied(): boolean {
  return readAppliedMarker() !== null;
}

/* ------------------------------------------------------------------ *
 * The follow rule
 * ------------------------------------------------------------------ */

/** What {@link applyBootstrapConfig} should do about the file's `sync` block. */
export type BootstrapSyncAction =
  /** Nothing configured here yet — take the file's settings. */
  | 'apply'
  /** Already configured *by the file*, and the file has since moved. */
  | 'follow'
  /** Leave this device alone. */
  | 'skip';

/** Everything the decision depends on, so the decision itself can be pure. */
export interface BootstrapSyncInput {
  /** `sync.baseUrl` from the file. */
  fileBaseUrl: string;
  /** Is sync configured on this device at all? */
  configured: boolean;
  /** Has the user pressed 해제? */
  optedOut: boolean;
  /** The applied marker, or `null` for a manually-configured device. */
  applied: BootstrapApplied | null;
  /** The address currently saved on this device. */
  currentBaseUrl: string;
}

/**
 * Should the file's server address win?
 *
 * The NAS address is the one setting that genuinely changes underneath people:
 * a DDNS name is bought, a reverse proxy moves the app to a subpath, the port
 * changes. Before M20 the second (non-technical) user's phone would simply
 * stop syncing, with no way back short of typing a URL into a settings sheet
 * they have never opened. So: **a device the file configured keeps following
 * the file.** Nothing else does.
 *
 *  - no marker → the user typed this address in themselves. Never touched.
 *  - opted out → 해제 means "not this server, not ever". Never touched.
 *  - marker with an address → follow when the file names a different one.
 *  - legacy marker (no address) → the marker cannot say what was applied, so
 *    compare against what is actually saved instead. Same intent, one step
 *    less certain, and it self-corrects: the follow writes a modern marker.
 */
export function decideBootstrapSync(input: BootstrapSyncInput): BootstrapSyncAction {
  const target = normalizeBaseUrl(input.fileBaseUrl);
  if (target.length === 0) return 'skip';
  if (input.optedOut) return 'skip';
  if (!input.configured) return 'apply';
  if (!input.applied) return 'skip';

  const reference = input.applied.baseUrl ?? normalizeBaseUrl(input.currentBaseUrl);
  return target === reference ? 'skip' : 'follow';
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

  if (config.sync) {
    const action = decideBootstrapSync({
      fileBaseUrl: config.sync.baseUrl,
      configured: isConfigured(),
      optedOut: hasBootstrapOptOut(),
      applied: readAppliedMarker(),
      currentBaseUrl: loadSettings().baseUrl,
    });

    if (action !== 'skip') {
      // `follow` and `apply` do exactly the same thing — the difference is
      // only in what made them legal. Taking the whole `sync` block, token
      // included: a moved server usually means a re-issued token too.
      saveSettings(config.sync);
      writeAppliedMarker(config.sync.baseUrl);
      await restartSync();
      applied = true;
    }
  }

  // Only when the toggle has never been touched on this device — an explicit
  // OFF must survive every reload.
  if (config.aiEnabled && !hasStoredAiSettings()) {
    useAiStore.getState().setEnabled(true);
    applied = true;
  }

  // 구글 지도 키 (M41)는 위 두 가지와 달리 **사용자 선택이 아니라 배치 사실**
  // 이다 — 켜고 끄는 토글이 없으므로 존중할 「명시적 OFF」도 없고, 키가 바뀌면
  // (재발급·교체) 그냥 새 키를 쓰는 것이 맞다. 그래서 파일이 말하는 대로 매번
  // 덮어쓴다. 파일에서 키가 사라지면 이 기기의 키도 지운다.
  const storedKey = useGoogleMapsKeyStore.getState().key;
  const fileKey = config.googleMapsKey ?? null;
  if (fileKey !== storedKey) {
    useGoogleMapsKeyStore.getState().setKey(fileKey);
    applied = applied || fileKey !== null;
  }

  return applied;
}
