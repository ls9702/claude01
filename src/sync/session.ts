/**
 * 세션 이름공간 (M46) — which workspace on the server this device is looking at.
 *
 * One address, several independent workspaces, and an administrator who picks
 * the active one for everybody (`server/admin.php`). The server is the single
 * source of truth: it stamps `"session":"<id>"` on `?meta=1` and on the
 * workspace GET, and this module is the little bit of bookkeeping the client
 * keeps so it can notice when that value moves.
 *
 * Two rules make the whole feature safe, and both live here:
 *
 * 1. **Local state is namespaced by session.** The IndexedDB key a workspace is
 *    persisted under is derived from the session id, so switching away leaves
 *    the old session's data exactly where it was — switching back finds it
 *    again, and nothing is ever lost by a switch.
 * 2. **`default` keeps the original key.** Every device that has ever run this
 *    app has a workspace under `trip-board/workspace`, and a pre-M46 server
 *    becomes session `default` on its first request. Giving `default` the
 *    unsuffixed key makes the migration free: there is nothing to copy, nothing
 *    to run once, and nothing that can half-fail.
 *
 * What must *never* happen is a merge across sessions: two groups' trips folded
 * together by LWW is not a conflict anyone can undo. So there is no code here
 * that combines two namespaces, and the switch in `sessionSwitch.ts` replaces
 * rather than merges.
 *
 * `localStorage` because this is per-device and must never travel to the server
 * and back — the same reasoning, and the same defensiveness, as `settings.ts`.
 */

/** Where this device remembers the server's session id. */
export const SESSION_KEY = 'trip-board/server-session';

/** What a pre-M46 server becomes, and what an unset/unreadable value means. */
export const DEFAULT_SESSION_ID = 'default';

/** The IndexedDB key `default` uses — the one every device already has. */
export const BASE_WORKSPACE_KEY = 'trip-board/workspace';

/**
 * Ids that may become a path segment on the NAS.
 *
 * Lowercase letters, digits and hyphens, first character alphanumeric, 32 max.
 * Byte-for-byte the expression `data.php`, `image.php` and `admin.php` use — a
 * client that offers to create an id the server would refuse is a client that
 * lies to the person typing it.
 */
export const SESSION_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;

/** True for a string the server would accept as a session id. */
export const isValidSessionId = (value: unknown): value is string =>
  typeof value === 'string' && SESSION_ID_PATTERN.test(value);

/**
 * Tidies what someone typed into an id, or `null` when it cannot be one.
 *
 * Trims and lowercases — `Osaka 2026` is obviously meant as an id and obviously
 * cannot be one, and silently fixing the two harmless halves (case, stray
 * spaces) while refusing the space in the middle is more useful than refusing
 * all three the same way.
 */
export function normalizeSessionId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const candidate = raw.trim().toLowerCase();
  return SESSION_ID_PATTERN.test(candidate) ? candidate : null;
}

/**
 * Where a session's workspace is persisted.
 *
 * `default` → `trip-board/workspace` (see the module doc), anything else →
 * `trip-board/workspace:<id>`. An id that is not valid is treated as `default`
 * rather than becoming a key of its own: a junk value must not be able to strand
 * this device's data under a namespace nothing will ever look at again.
 */
export function workspaceStorageKey(sessionId: string): string {
  if (!isValidSessionId(sessionId) || sessionId === DEFAULT_SESSION_ID) {
    return BASE_WORKSPACE_KEY;
  }
  return `${BASE_WORKSPACE_KEY}:${sessionId}`;
}

/** `localStorage`, or `null` where it is missing or blocked (Node, private mode). */
function storage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

/**
 * The session this device believes it is in.
 *
 * `default` for a device that has never been told otherwise — which is every
 * device before this milestone, and every device talking to a server that only
 * ever had one workspace.
 */
export function loadServerSession(): string {
  try {
    const stored = storage()?.getItem(SESSION_KEY);
    return isValidSessionId(stored) ? stored : DEFAULT_SESSION_ID;
  } catch {
    return DEFAULT_SESSION_ID;
  }
}

/** Records the session id. Invalid values are ignored, never written. */
export function saveServerSession(sessionId: string): void {
  if (!isValidSessionId(sessionId)) return;
  try {
    storage()?.setItem(SESSION_KEY, sessionId);
  } catch {
    /* quota / private mode — the app still works, it just re-adopts on reload */
  }
}

/** Forgets the session (해제, and tests). Back to `default`. */
export function clearServerSession(): void {
  try {
    storage()?.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}
