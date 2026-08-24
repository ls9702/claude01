/**
 * 사진 원본 저장소 (M10) — the pixels, kept well away from the workspace.
 *
 * `persistMiddleware` re-serializes the **whole** workspace on every mutation,
 * so anything living inside it is re-written each time a title is typed, ridden
 * along by every sync push and copied into every backup file. A few megabytes
 * of JPEG cannot be in there. So photos are split in two: the metadata rides
 * the card (`Card.photos`, tiny, syncs and merges like everything else) and the
 * bytes go here, in their own IndexedDB store keyed by the photo id.
 *
 * Stored as **`ArrayBuffer`, never `Blob`**: iOS WebKit has a long-standing bug
 * where a `Blob` written to IndexedDB comes back detached after the page is
 * reloaded — the record is there and reading it fails. An ArrayBuffer is plain
 * bytes and survives. The `Blob` is reconstructed on the way out, for the one
 * thing it is needed for: an object URL an `<img>` can point at.
 */

import { useEffect, useState } from 'react';
import { createStore, del, delMany, get, keys, set } from 'idb-keyval';
import type { Id } from '../types/models';
import { usePersistHealthStore } from './persistHealth';

/**
 * A second database, not a second store inside `trip-board`: idb-keyval opens a
 * database per `createStore` call, and adding an object store to an existing
 * database means a version bump every device would have to run through.
 */
const photoStore = createStore('trip-board-photos', 'blobs');

/**
 * Object URLs handed out this session, keyed by photo id.
 *
 * Module-level on purpose. A URL is revoked only when the photo is actually
 * gone (delete / GC), never on unmount: React 19's StrictMode mounts every
 * component twice in development, and revoking in a cleanup would leave the
 * second mount pointing at a dead URL — the classic "photo shows up, then
 * turns into a broken image" bug. A handful of URLs for a session is a cheap
 * price for that not happening.
 */
const urlCache = new Map<Id, string>();

/** In-flight loads, so two thumbnails of one photo do not read IDB twice. */
const pending = new Map<Id, Promise<string | null>>();

/**
 * Writes one photo's bytes.
 *
 * Reports the outcome to `persistHealth` — the 저장 실패 banner is about
 * "your data is not being kept", and a photo write is exactly that — and
 * **re-throws** on failure so the caller aborts before committing metadata.
 * Metadata pointing at bytes that were never written is the one state this
 * design must not reach.
 */
export async function putPhotoBlob(id: Id, buf: ArrayBuffer): Promise<void> {
  try {
    await set(id, buf, photoStore);
    usePersistHealthStore.getState().ok();
  } catch (err) {
    console.warn('[photoBlobs] put failed', err);
    usePersistHealthStore.getState().fail();
    throw err;
  }
}

/** Reads one photo's bytes, or `undefined` when the id is unknown. */
export async function getPhotoBlob(id: Id): Promise<ArrayBuffer | undefined> {
  try {
    return await get<ArrayBuffer>(id, photoStore);
  } catch (err) {
    console.warn('[photoBlobs] get failed', err);
    return undefined;
  }
}

/** Every blob id currently held, referenced or not. The GC's left-hand side. */
export async function listPhotoBlobIds(): Promise<Id[]> {
  try {
    return (await keys<Id>(photoStore)).map((key) => String(key));
  } catch (err) {
    console.warn('[photoBlobs] keys failed', err);
    return [];
  }
}

/** Deletes blobs and releases the object URLs that were pointing at them. */
export async function deletePhotoBlobs(ids: readonly Id[]): Promise<void> {
  if (ids.length === 0) return;
  for (const id of ids) {
    const url = urlCache.get(id);
    if (url) {
      URL.revokeObjectURL(url);
      urlCache.delete(id);
    }
    pending.delete(id);
  }
  try {
    if (ids.length === 1) await del(ids[0], photoStore);
    else await delMany([...ids], photoStore);
  } catch (err) {
    console.warn('[photoBlobs] delete failed', err);
  }
}

/** The object URL for `id` if it has already been loaded this session. */
export const cachedPhotoUrl = (id: Id): string | null => urlCache.get(id) ?? null;

/**
 * Loads `id` and returns a session-cached object URL, or `null` when the blob
 * is missing — a backup restored long after its photos were swept, say. The
 * caller renders a placeholder tile for `null`; it is not an error state.
 */
export function loadPhotoUrl(id: Id): Promise<string | null> {
  const cached = urlCache.get(id);
  if (cached) return Promise.resolve(cached);

  const inFlight = pending.get(id);
  if (inFlight) return inFlight;

  const promise = (async (): Promise<string | null> => {
    const buf = await getPhotoBlob(id);
    if (!buf) return null;
    // Reconstructed here rather than stored — see the module doc.
    const url = URL.createObjectURL(new Blob([buf], { type: 'image/jpeg' }));
    urlCache.set(id, url);
    return url;
  })().finally(() => {
    pending.delete(id);
  });

  pending.set(id, promise);
  return promise;
}

/**
 * The object URL for one photo, or `null` while it loads / when it is missing.
 *
 * A cache hit resolves **synchronously in the initial state**, so scrolling a
 * strip back and forth never flashes a placeholder. A miss sets state when the
 * read lands, guarded by a `live` flag so a fast unmount cannot warn.
 */
export function usePhotoUrl(id: Id | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(() => (id ? cachedPhotoUrl(id) : null));

  useEffect(() => {
    if (!id) {
      setUrl(null);
      return;
    }
    const cached = cachedPhotoUrl(id);
    if (cached) {
      setUrl(cached);
      return;
    }

    let live = true;
    setUrl(null);
    void loadPhotoUrl(id).then((loaded) => {
      if (live) setUrl(loaded);
    });
    return () => {
      live = false;
    };
  }, [id]);

  return url;
}
