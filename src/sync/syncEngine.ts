/**
 * The sync engine (M4).
 *
 * A plain module, not a hook: it owns timers and listeners that must survive
 * React re-renders, and it is driven by store subscriptions rather than by the
 * component tree. {@link initSyncEngine} is called once from `App` after the
 * workspace has hydrated.
 *
 * The loop is deliberately dumb, because the merge underneath it is smart:
 *
 * - **Pull** on init, on `visibilitychange → visible` and on `online`:
 *   `fetchAll` → {@link merge} → `replaceWorkspace` → push back if the merge
 *   produced anything the server does not already have.
 * - **Push** 4s after the workspace goes dirty. On a 409 the server's copy is
 *   merged in and the push is retried, up to {@link MAX_CONFLICT_RETRIES}.
 * - **Offline** is not an error: the status flips to `offline` and the next
 *   `online` event re-runs the whole thing.
 *
 * Everything funnels through {@link enqueue}, so there is only ever one sync
 * operation in flight — overlapping pulls and pushes were the one thing
 * guaranteed to produce a version-counter mess.
 */

import { useSyncStore } from '../stores/syncStore';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { SyncError, fetchAll, push } from './api';
import { merge, workspaceEquals } from './merge';
import { isConfigured, loadSettings, type SyncSettings } from './settings';

/** How long the workspace has to stay quiet before we push it. */
export const PUSH_DEBOUNCE_MS = 4_000;

/** How many times a push may lose a 409 race before we give up on this run. */
export const MAX_CONFLICT_RETRIES = 3;

/* ------------------------------------------------------------------ *
 * Module state
 * ------------------------------------------------------------------ */

/** Tail of the operation queue — `null` when nothing is running. */
let inFlight: Promise<void> | null = null;
/** Pending debounced push. */
let pushTimer: ReturnType<typeof setTimeout> | null = null;
/** Teardown for the listeners + store subscription, or `null` when stopped. */
let teardown: (() => void) | null = null;

const sync = () => useSyncStore.getState();
const workspace = () => useWorkspaceStore.getState();

/**
 * Serializes sync work. A job arriving while another runs is *chained*, not
 * dropped — a push queued behind a pull still has to happen, it just has to
 * wait for a fresh `serverVersion` first.
 */
function enqueue(job: () => Promise<void>): Promise<void> {
  const run = (inFlight ?? Promise.resolve()).then(job, job);
  inFlight = run.finally(() => {
    if (inFlight === run) inFlight = null;
  });
  return inFlight;
}

/** Maps a thrown error onto a status. Transport trouble is `offline`, not `error`. */
function reportFailure(err: unknown): void {
  const isNetwork =
    (err instanceof SyncError && err.kind === 'network') ||
    (typeof navigator !== 'undefined' && navigator.onLine === false);
  const message = err instanceof Error ? err.message : '동기화에 실패했어요';
  sync().setStatus(isNetwork ? 'offline' : 'error', message);
}

/* ------------------------------------------------------------------ *
 * Push
 * ------------------------------------------------------------------ */

/**
 * Writes the current workspace, resolving conflicts by merging the server's
 * copy in and trying again.
 *
 * Re-reads the workspace on every attempt on purpose: the user may well have
 * typed something while the request was in the air, and that edit should ride
 * along rather than be clobbered by the retry.
 */
async function pushLoop(settings: SyncSettings, baseVersion: number): Promise<void> {
  let version = baseVersion;

  for (let attempt = 0; attempt <= MAX_CONFLICT_RETRIES; attempt += 1) {
    const local = workspace().workspace;
    const result = await push(version, local, settings);

    if (result.ok) {
      // Only clear `dirty` if nothing changed underneath us mid-request.
      if (workspace().workspace === local) workspace().setDirty(false);
      sync().markSynced(result.version, result.updatedAt || Date.now());
      return;
    }

    // 409: someone else got there first. Fold their copy in and retry.
    version = result.conflict.version;
    const merged = merge(workspace().workspace, result.conflict.data);
    workspace().replaceWorkspace(merged);

    if (workspaceEquals(merged, result.conflict.data)) {
      // Their copy already contains everything of ours — nothing left to send.
      workspace().setDirty(false);
      sync().markSynced(result.conflict.version, result.conflict.updatedAt || Date.now());
      return;
    }
  }

  throw new SyncError('server', '동기화 충돌이 반복돼요. 잠시 후 다시 시도해요');
}

/* ------------------------------------------------------------------ *
 * Pull
 * ------------------------------------------------------------------ */

/** `fetchAll` → merge → adopt → push back anything the server is missing. */
async function pullMerge(settings: SyncSettings): Promise<void> {
  const remote = await fetchAll(settings);

  // A server with no workspace yet (404): ours becomes version 1.
  if (!remote) {
    sync().setServerVersion(0);
    await pushLoop(settings, 0);
    return;
  }

  const local = workspace().workspace;
  const merged = merge(local, remote.data);
  const changedLocally = !workspaceEquals(merged, local);

  // `replaceWorkspace` always marks dirty, so only call it when it earns its
  // keep — otherwise every pull would schedule a pointless push.
  if (changedLocally) workspace().replaceWorkspace(merged);
  sync().setServerVersion(remote.version);

  if (!workspaceEquals(merged, remote.data)) {
    await pushLoop(settings, remote.version);
    return;
  }

  workspace().setDirty(false);
  sync().markSynced(remote.version, remote.updatedAt || Date.now());
}

/* ------------------------------------------------------------------ *
 * Public operations
 * ------------------------------------------------------------------ */

/**
 * Full pull-merge-push round trip. Safe to call at any time; a no-op when sync
 * is not configured. Never rejects — failures land on the status chip.
 */
export function syncNow(): Promise<void> {
  const settings = loadSettings();
  if (!isConfigured(settings)) {
    sync().setStatus('off');
    return Promise.resolve();
  }

  return enqueue(async () => {
    sync().setStatus('syncing');
    try {
      await pullMerge(settings);
    } catch (err) {
      reportFailure(err);
    }
  });
}

/**
 * Push-only path used by the debounce timer: no pull first, so it writes
 * against whatever `serverVersion` we last saw. A stale one simply loses the
 * 409 race and `pushLoop` merges its way out.
 */
function pushNow(): Promise<void> {
  const settings = loadSettings();
  if (!isConfigured(settings)) return Promise.resolve();

  return enqueue(async () => {
    if (!workspace().dirty) return;
    sync().setStatus('syncing');
    try {
      await pushLoop(settings, sync().serverVersion);
    } catch (err) {
      reportFailure(err);
    }
  });
}

/** Cancels any pending debounced push. */
function cancelPush(): void {
  if (pushTimer === null) return;
  clearTimeout(pushTimer);
  pushTimer = null;
}

/**
 * Arms the debounce. Called on every dirty→true transition, so a burst of
 * edits collapses into a single write {@link PUSH_DEBOUNCE_MS} after the user
 * stops typing.
 */
export function schedulePush(): void {
  if (!isConfigured()) return;
  cancelPush();
  pushTimer = setTimeout(() => {
    pushTimer = null;
    void pushNow();
  }, PUSH_DEBOUNCE_MS);
}

/**
 * Adopts new settings: persists nothing itself (the settings sheet does that),
 * resets the version counter so the next run re-reads the server from scratch,
 * and kicks off a sync.
 */
export function restartSync(): Promise<void> {
  cancelPush();
  if (!isConfigured()) {
    sync().reset();
    return Promise.resolve();
  }
  sync().setServerVersion(0);
  sync().setStatus('syncing');
  return syncNow();
}

/**
 * Starts the engine: subscribes to the workspace's dirty flag and listens for
 * `online` / `visibilitychange`. Idempotent — calling it twice keeps the first
 * set of listeners. Returns a teardown function (used by tests; `App` mounts
 * the engine for the lifetime of the page).
 */
export function initSyncEngine(): () => void {
  if (teardown) return teardown;

  if (!isConfigured()) sync().setStatus('off');

  // Any dirty→true transition arms the debounce. `replaceWorkspace` also sets
  // dirty, so a pull that changed something re-arms it too — harmless, since
  // `pushNow` bails out when the flag has already been cleared.
  const unsubscribe = useWorkspaceStore.subscribe((state, previous) => {
    if (state.dirty && !previous.dirty) schedulePush();
  });

  const onOnline = (): void => {
    void syncNow();
  };
  const onVisible = (): void => {
    if (document.visibilityState === 'visible') void syncNow();
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);
  }

  teardown = () => {
    cancelPush();
    unsubscribe();
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
    }
    teardown = null;
  };

  if (isConfigured()) {
    void syncNow();
    // A workspace that was already dirty from a previous session still needs a
    // push even if the pull decides the server is up to date.
    if (workspace().dirty) schedulePush();
  }

  return teardown;
}
