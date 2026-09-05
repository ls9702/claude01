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
 * Where to look when a photo's bytes are not on this device (M20).
 *
 * `null` until `sync/photoSync` installs itself, and `null` forever on a
 * local-only install. This module deliberately does not import the sync side:
 * it knows IndexedDB and object URLs, and teaching it about server addresses,
 * tokens and HTTP would both muddy that and close a module cycle (the uploader
 * reads and writes blobs through here).
 */
let remoteSource: ((id: Id) => Promise<ArrayBuffer | null>) | null = null;

/** Installs the "not on this device — can you fetch it?" fallback. */
export function setRemotePhotoSource(
  source: ((id: Id) => Promise<ArrayBuffer | null>) | null,
): void {
  remoteSource = source;
}

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
 *
 * A local miss is not the end of the search when sync is on (M20): the other
 * phone took this photo, so the bytes may well be on the NAS. They are fetched
 * once and **written into the local store on the way past**, which is what
 * turns "the other phone's photo" into one of ours — the next reload renders
 * it with no network at all. `fetchPhotoBlob` remembers a definitive 404 for
 * the session, so a photo that is genuinely gone costs one request, not one
 * per render.
 */
export function loadPhotoUrl(id: Id): Promise<string | null> {
  const cached = urlCache.get(id);
  if (cached) return Promise.resolve(cached);

  const inFlight = pending.get(id);
  if (inFlight) return inFlight;

  const promise = (async (): Promise<string | null> => {
    let buf = await getPhotoBlob(id);

    if (!buf && remoteSource) {
      const downloaded = await remoteSource(id);
      if (downloaded) {
        buf = downloaded;
        // Failing to keep it is survivable — the render below still works, and
        // `putPhotoBlob` has already raised the 저장 실패 banner if that is
        // what happened.
        try {
          await putPhotoBlob(id, downloaded);
        } catch {
          /* already reported */
        }
      }
    }

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
/**
 * 여러 사진의 URL을 한 번에 — `photoId → url` 맵 (M53-2).
 *
 * 드로우 캔버스가 이것을 부르는 이유는 렌더러의 규칙 때문이다: `DrawElementView`는
 * 훅이 없는 순수 프레젠테이션이라(그래야 draft 미리보기와 PNG가 같은 함수를 쓴다)
 * 자기 사진을 스스로 못 읽는다. 그래서 **부모가 한 번 읽어 맵으로 내려 준다** —
 * 요소마다 훅을 하나씩 두면 획 300개짜리 페이지가 리렌더마다 구독 300개를 만든다.
 *
 * 캐시에 이미 있는 것은 **첫 렌더에 동기로** 들어간다(`usePhotoUrl`과 같은 배려):
 * 탭을 다녀올 때마다 사진이 한 프레임 깜빡이면 그건 그림이 아니라 고장으로 보인다.
 * 목록은 **정렬한 문자열**로 비교한다 — 배열의 정체성으로 비교하면 부모의 매
 * 렌더가 곧 새 효과다.
 */
export function usePhotoUrls(ids: readonly Id[]): Record<Id, string> {
  const key = [...new Set(ids)].sort().join(',');
  const fromCache = (): Record<Id, string> => {
    const map: Record<Id, string> = {};
    for (const id of key === '' ? [] : key.split(',')) {
      const cached = cachedPhotoUrl(id);
      if (cached) map[id] = cached;
    }
    return map;
  };
  const [urls, setUrls] = useState<Record<Id, string>>(fromCache);

  useEffect(() => {
    const list = key === '' ? [] : key.split(',');
    let live = true;
    // 캐시에 있는 것으로 먼저 갈아 끼운다 — 사라진 id는 여기서 함께 빠진다.
    const seeded = fromCache();
    setUrls(seeded);
    for (const id of list) {
      if (seeded[id]) continue;
      void loadPhotoUrl(id).then((url) => {
        if (!live || !url) return;
        setUrls((current) => (current[id] === url ? current : { ...current, [id]: url }));
      });
    }
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return urls;
}

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
