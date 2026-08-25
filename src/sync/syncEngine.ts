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
 * - **Poll** while the page is visible (M22): the cheap `?meta=1` probe on a
 *   timer, and the pull above runs only when the version it reports has moved.
 *   The cadence and its backoff live in `sync/poll`; see {@link armPoll}.
 * - **Flush** (M22): {@link flushPush} sends the pending edit immediately
 *   instead of at the end of the debounce — what a 메모 send needs.
 * - **Offline** is not an error: the status flips to `offline` and the next
 *   `online` event re-runs the whole thing.
 *
 * Everything funnels through {@link enqueue}, so there is only ever one sync
 * operation in flight — overlapping pulls and pushes were the one thing
 * guaranteed to produce a version-counter mess.
 */

import { useSyncStore } from '../stores/syncStore';
import { useUiStore } from '../stores/uiStore';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { SyncError, fetchAll, fetchMeta, push } from './api';
import { merge, workspaceEquals } from './merge';
import { uploadPendingPhotos } from './photoSync';
import { nextPollDelay } from './poll';
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
/** Booked version probe (M22) — `null` while the poll is stopped. */
let pollTimer: ReturnType<typeof setTimeout> | null = null;
/** Probes that failed in a row. Drives the backoff; reset by any good news. */
let pollFailures = 0;
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
  // The tail is what gets stored, so the "am I still the last one?" check has
  // to compare against *it* and not against `run` — `finally` hands back a new
  // promise, and comparing with `run` never matched, which quietly left
  // `inFlight` non-null forever. Nothing minded while it was only a chaining
  // point, but M22's poll skips a tick when the queue is busy, and a queue that
  // is permanently "busy" is a poll that never runs.
  const tail: Promise<void> = run.finally(() => {
    if (inFlight === tail) inFlight = null;
  });
  inFlight = tail;
  return tail;
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
 * Photos ride along
 * ------------------------------------------------------------------ */

/**
 * Hands the photo uploader its cue (M20).
 *
 * Only after a round trip *succeeded*: the workspace on the server is what
 * gives those ids meaning, and uploading bytes for cards the NAS has not heard
 * of yet would be work done in the wrong order. And only fire-and-forget —
 * photos are large and slow, the sync queue is not the place to wait for them,
 * and a photo that does not make it this time is retried on the next cycle
 * (which is at most a tab focus away).
 *
 * Deliberately *not* awaited inside `enqueue`: holding the queue open for a
 * 400KB upload would delay the next edit's push behind it.
 */
function uploadPhotosAfterSync(): void {
  if (sync().status !== 'idle') return;
  void uploadPendingPhotos();
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
    uploadPhotosAfterSync();
    // A completed round trip *is* an answer to the question the probe asks, so
    // the next one is due a full interval from here rather than from some fixed
    // grid — a busy device polls the NAS less, not more.
    armPoll();
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
    uploadPhotosAfterSync();
    armPoll();
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
 * Sends what is pending **now** instead of at the end of the debounce (M22).
 *
 * The 4초 debounce exists so that typing a card title is one write instead of
 * twenty, and it is still the right default for everything the user edits in
 * place. A 메모 message is the exception: it is *finished* the moment 보내기 is
 * pressed, and the other person is waiting for it. So the composer calls this
 * instead of leaving the timer to it.
 *
 * Nothing here needs its own guards — it hands the work to the same
 * {@link enqueue}d push the timer would have run:
 *
 * - not configured → `pushNow` returns without touching the network;
 * - nothing dirty → the queued job bails on the flag, so a stray call is free;
 * - already syncing → the queue chains it behind, which is what keeps two
 *   pushes from racing the version counter;
 * - offline → it fails the same quiet way the debounced push does, status chip
 *   and all, and the message still goes up on the next cycle.
 */
export function flushPush(): Promise<void> {
  cancelPush();
  return pushNow();
}

/* ------------------------------------------------------------------ *
 * Poll (M22)
 * ------------------------------------------------------------------ */

/** Stops the booked probe, if there is one. */
function cancelPoll(): void {
  if (pollTimer === null) return;
  clearTimeout(pollTimer);
  pollTimer = null;
}

/**
 * One probe: ask the server for its version counter, and run the *ordinary*
 * cycle when it has moved.
 *
 * Deliberately not a second pull path — `syncNow` already knows how to merge,
 * how to push back what the merge produced and how to report what went wrong.
 * All this adds is the decision to call it, made from one number instead of
 * from a whole workspace.
 *
 * The two skip conditions are borrowed rather than invented: `inFlight` is the
 * queue's own "somebody is already talking to the server", and an armed
 * `pushTimer` means an edit is about to go up and come back with a fresh
 * version anyway. Neither would be *unsafe* to run through — everything
 * funnels through the queue — they are simply requests nobody needed.
 */
export async function pollOnce(): Promise<void> {
  const settings = loadSettings();
  if (!isConfigured(settings)) return;
  if (inFlight !== null || pushTimer !== null) return;

  let version: number;
  try {
    version = (await fetchMeta(settings)).version;
  } catch {
    // Silent on purpose. A probe that could not reach the NAS is not a failed
    // sync: crying 오프라인 at a phone walking between wifi APs would make the
    // chip flicker at something the user cannot act on, and the last *real*
    // round trip is still the honest thing for it to be showing. The failure is
    // paid for in the interval instead — see `nextPollDelay`.
    pollFailures += 1;
    return;
  }

  pollFailures = 0;
  // The engine's own bookkeeping is the only copy of "what we last saw" — a
  // second one here would drift out of step with the 409 handling that uses it.
  if (version === sync().serverVersion) return;
  await syncNow();
}

/**
 * Books the next probe, replacing any already booked.
 *
 * Called from every direction that can change the answer: the engine starting,
 * a cycle finishing, the 메모 탭 being opened or left, the page coming back
 * into view, settings being saved or 해제'd. Because it always cancels first,
 * "re-evaluate" and "start" are the same call and none of those paths can leave
 * two timers running.
 *
 * Three reasons not to book anything: no engine installed (the poll's lifetime
 * is the engine's — see {@link initSyncEngine}), nothing configured, or a page
 * nobody is looking at. That last one is the battery rule: a hidden tab has
 * nobody to show a new message to, and `visibilitychange` brings it back with a
 * full sync anyway.
 */
function armPoll(): void {
  cancelPoll();
  if (teardown === null || !isConfigured()) return;
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;

  const delay = nextPollDelay({
    memoActive: useUiStore.getState().activeTab === 'memo',
    failures: pollFailures,
  });
  pollTimer = setTimeout(() => {
    pollTimer = null;
    void pollOnce().finally(armPoll);
  }, delay);
}

/**
 * Adopts new settings: persists nothing itself (the settings sheet does that),
 * resets the version counter so the next run re-reads the server from scratch,
 * and kicks off a sync.
 */
export function restartSync(): Promise<void> {
  cancelPush();
  // New settings are new circumstances: whatever the old server did to the
  // backoff says nothing about this one (M22).
  pollFailures = 0;
  if (!isConfigured()) {
    sync().reset();
    // 해제 means 해제 — no probes at an address the user just took away.
    cancelPoll();
    return Promise.resolve();
  }
  armPoll();
  sync().setServerVersion(0);
  sync().setStatus('syncing');
  return syncNow();
}

/**
 * Starts the engine: subscribes to the workspace's dirty flag and to the active
 * tab, listens for `online` / `visibilitychange`, and books the first version
 * probe. Idempotent — calling it twice keeps the first set of listeners, which
 * is what makes it safe under StrictMode's double mount. Returns a teardown
 * function (used by tests; `App` mounts the engine for the lifetime of the
 * page).
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

  // The 메모 탭 is polled six times as often as the rest of the app, so the
  // only piece of view state the engine cares about is whether it is the tab on
  // screen — hence the narrow condition rather than a re-arm on every UI change
  // (which a 여행 선택 or a 카드 포커스 would also trip).
  const unsubscribeUi = useUiStore.subscribe((state, previous) => {
    if ((state.activeTab === 'memo') !== (previous.activeTab === 'memo')) armPoll();
  });

  const onOnline = (): void => {
    void syncNow();
  };
  const onVisible = (): void => {
    if (document.visibilityState !== 'visible') {
      // Nobody is looking; stop probing until they are (M22).
      cancelPoll();
      return;
    }
    // Coming back is the clearest "the situation may have changed" there is —
    // a new network, a NAS that finished rebooting — so the backoff starts over.
    pollFailures = 0;
    armPoll();
    void syncNow();
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);
  }

  teardown = () => {
    cancelPush();
    cancelPoll();
    unsubscribe();
    unsubscribeUi();
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
    }
    teardown = null;
  };

  // After `teardown` is set, never before: `armPoll` refuses to book anything
  // for an engine that is not installed, so nothing can outlive one.
  armPoll();

  if (isConfigured()) {
    void syncNow();
    // A workspace that was already dirty from a previous session still needs a
    // push even if the pull decides the server is up to date.
    if (workspace().dirty) schedulePush();
  }

  return teardown;
}

/* ------------------------------------------------------------------ *
 * Browser test seam
 * ------------------------------------------------------------------ */

/**
 * `window.__tripBoardPollNow()` — run one version probe *now* (M22).
 *
 * Same seam, same reasoning as `__tripBoardSweepPhotos` in `stores/photoGc`:
 * the honest e2e proof that B sees A's message without touching anything is a
 * 5초 nap per assertion, times however many the spec needs. This bypasses the
 * booked interval and nothing else — the probe it runs is the real
 * {@link pollOnce}, guards included, so what the test exercises is the code
 * that ships rather than a fixture of it.
 *
 * Attached unconditionally rather than behind a dev flag: it is three lines
 * calling an already-exported function, it reaches nothing a page's own scripts
 * cannot reach anyway, and a seam that only exists in dev builds is a seam the
 * production bundle is never tested with.
 */
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__tripBoardPollNow = (): Promise<void> =>
    pollOnce();
}
