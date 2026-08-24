/**
 * 사진 블롭 청소 (M10) — mark and sweep, with a grace period.
 *
 * Photo metadata lives in the workspace and photo bytes live in their own
 * store, which means the two can drift apart in exactly two ways:
 *
 *  - a blob whose card was deleted, or whose photo row was removed;
 *  - a blob written just before the tab was closed, whose metadata never got
 *    committed (the write-bytes-first ordering makes this the *safe* failure).
 *
 * Both are the same shape — bytes nothing refers to — so both are swept the
 * same way: list the store, subtract everything the workspace still mentions,
 * and delete what is left. What makes that safe is the **grace period**: an
 * unreferenced blob is not deleted on sight, it is written down as a candidate
 * and only removed if it is *still* unreferenced {@link PHOTO_GC_GRACE_MS}
 * later. That covers the 10초 실행 취소 window on a card delete — undo hands
 * the ids straight back, and a re-referenced candidate is dropped from the
 * list rather than deleted.
 *
 * The decision half ({@link planGc}) is pure, so the grace arithmetic is
 * testable without a browser or a clock.
 */

import { deleteServerPhotos } from '../sync/photoSync';
import type { Id, Millis } from '../types/models';
import { referencedPhotoIds } from '../utils/photos';
import { deletePhotoBlobs, listPhotoBlobIds } from './photoBlobs';
import { useWorkspaceStore } from './workspaceStore';

/**
 * Re-exported so the GC's own callers keep a single import. The definition
 * lives in `utils/photos` because the uploader needs it too — see there.
 */
export { referencedPhotoIds };

/**
 * How long a blob must sit unreferenced before it is deleted.
 *
 * Comfortably longer than `UNDO_DESTRUCTIVE_MS` (10초): the undo offer is the
 * one thing that can put a reference back, and a sweep that beat it would take
 * the photos off a restored card.
 */
export const PHOTO_GC_GRACE_MS = 30_000;

/** What a sweep decided: what to delete now, and what to keep watching. */
export interface GcPlan {
  toDelete: Id[];
  /** The next candidate list — `id → when it was first seen unreferenced`. */
  nextCandidates: Map<Id, Millis>;
}

/**
 * Pure sweep decision.
 *
 * @param allIds     every blob id currently in the store.
 * @param referenced ids the workspace still mentions.
 * @param candidates ids seen unreferenced before, and when they were first seen.
 * @param now        current time.
 * @param grace      how long an id must stay unreferenced to be deleted.
 */
export function planGc(
  allIds: readonly Id[],
  referenced: ReadonlySet<Id>,
  candidates: ReadonlyMap<Id, Millis>,
  now: Millis,
  grace: Millis = PHOTO_GC_GRACE_MS,
): GcPlan {
  const toDelete: Id[] = [];
  const nextCandidates = new Map<Id, Millis>();

  for (const id of allIds) {
    // A referenced blob is never a candidate — and a candidate that got
    // referenced again (undo, sync, import) is forgiven, not deleted.
    if (referenced.has(id)) continue;

    const since = candidates.get(id);
    if (since === undefined) {
      nextCandidates.set(id, now);
      continue;
    }
    // `>=` so an injected clock in a test can land exactly on the deadline.
    if (now - since >= grace) toDelete.push(id);
    else nextCandidates.set(id, since);
  }

  return { toDelete, nextCandidates };
}

/* ------------------------------------------------------------------ *
 * The impure half: one debounced timer for the whole app
 * ------------------------------------------------------------------ */

/**
 * Module-level, deliberately. StrictMode mounts `App` twice in development and
 * every call site here is a "something might have gone stale" hint rather than
 * a lifecycle — a single shared timer means N hints still cost one sweep.
 */
let timer: ReturnType<typeof setTimeout> | null = null;

/** Candidates carried between sweeps. Session-only; a reload starts over. */
let candidates = new Map<Id, Millis>();

/** True while a sweep is in flight, so a second one cannot overlap it. */
let sweeping = false;

/**
 * One sweep: list the store, subtract the *current* references, apply the
 * grace, delete what is left.
 *
 * The references are read at delete time rather than when the sweep was
 * scheduled, which is the second half of the undo safety story: even a blob
 * that has been a candidate for a minute is spared if the workspace has picked
 * it up again in the meantime.
 */
export async function sweepPhotoBlobs(now: Millis = Date.now()): Promise<Id[]> {
  if (sweeping) return [];
  sweeping = true;
  try {
    const allIds = await listPhotoBlobIds();
    if (allIds.length === 0) {
      candidates = new Map();
      return [];
    }

    const referenced = referencedPhotoIds(useWorkspaceStore.getState().workspace);
    const plan = planGc(allIds, referenced, candidates, now);
    candidates = plan.nextCandidates;
    if (plan.toDelete.length > 0) {
      await deletePhotoBlobs(plan.toDelete);
      // The workspace is the *shared* truth (M20). An id it no longer mentions
      // is unreferenced on every device, not just this one, so the copy on the
      // NAS goes with the local bytes — otherwise deleted photos would pile up
      // on the server forever, invisible and unreachable. Best-effort and
      // never awaited into the caller's path: a failed DELETE leaves one
      // orphan file, which is the cheap side of this trade.
      void deleteServerPhotos(plan.toDelete);
    }

    // A blob seen unreferenced for the first time is only *written down* by
    // this sweep — someone has to come back after the grace to delete it. That
    // second visit is booked here rather than at the call site, so a delete
    // (or a crash-leftover found at startup) converges on its own.
    //
    // It cannot loop forever: a candidate either gets deleted — and vanishes
    // from the store's key list — or gets re-referenced, and either way it
    // leaves the list. An empty list books nothing.
    if (plan.nextCandidates.size > 0) schedulePhotoGc();

    return plan.toDelete;
  } catch (err) {
    console.warn('[photoGc] sweep failed', err);
    return [];
  } finally {
    sweeping = false;
  }
}

/**
 * Asks for a sweep in `delayMs`. Calling it again before then just moves the
 * appointment — a burst of deletes costs one sweep, not one each.
 */
export function schedulePhotoGc(delayMs: number = PHOTO_GC_GRACE_MS): void {
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void sweepPhotoBlobs();
  }, delayMs);
}

/** Cancels a pending sweep and forgets the candidates (tests). */
export function resetPhotoGc(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  candidates = new Map();
  sweeping = false;
}

/* ------------------------------------------------------------------ *
 * Browser test seam
 * ------------------------------------------------------------------ */

/**
 * `window.__tripBoardSweepPhotos()` — run a sweep *now*, with the grace period
 * fast-forwarded (M20).
 *
 * The e2e suite has to prove that deleting a photo takes it off the NAS too,
 * and the honest path to that assertion is a 30초 wait per run. The seam gives
 * the sweep an injected clock instead: every call jumps two grace periods
 * further into the future, so **two** calls are what a deletion costs — the
 * first writes the id down as a candidate, the second finds it still
 * unreferenced and past the deadline. That is the real two-visit protocol, not
 * a shortcut around it.
 *
 * Attached unconditionally rather than behind a dev flag: it is three lines
 * that call an already-exported function with a different number, it reaches
 * nothing a page's own scripts cannot reach anyway, and a seam that only
 * exists in dev builds is a seam the production bundle is never tested with.
 */
let sweepEpoch = 0;

if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__tripBoardSweepPhotos = (): Promise<Id[]> => {
    sweepEpoch += PHOTO_GC_GRACE_MS * 2;
    return sweepPhotoBlobs(Date.now() + sweepEpoch);
  };
}
