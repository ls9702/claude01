/**
 * 사진 자동 동기화 (M20) — the pixels follow the workspace to the NAS.
 *
 * M10 split a photo in two: the metadata rides the card (and therefore syncs,
 * merges and backs up like everything else) while the bytes sit in their own
 * IndexedDB store. That was the right split for storage and the wrong one for
 * two people: the other phone pulled a card that said "1장" and rendered an
 * empty tile, because the only copy of those bytes was on the phone that took
 * the photo. `server/image.php` closes the gap, and this module is the client
 * half of it.
 *
 * Three jobs, one per direction, and every one of them a **no-op when sync is
 * not configured** — GitHub Pages and a local-only device must not notice this
 * file exists:
 *
 *   {@link uploadPendingPhotos}  local bytes the server has not seen  → PUT
 *   {@link fetchPhotoBlob}       a tile whose bytes are not here yet  ← GET
 *   {@link deleteServerPhotos}   what the GC just swept               → DELETE
 *
 * ## What "the server has not seen" means
 *
 * There is no listing endpoint and deliberately so — asking the NAS "which of
 * these 300 ids do you have?" on every sync is a request nobody needs. Instead
 * each device keeps a set of ids it has successfully uploaded, in
 * `localStorage` under {@link UPLOADED_KEY}, **keyed by server address**. Keyed
 * that way because the set is a claim about one particular NAS: point the app
 * at a different address (or follow a bootstrap file to a new one) and the
 * claim is void, so the new server gets everything again. Re-uploading bytes
 * that are already there is a plain 200 — `image.php` is idempotent precisely
 * so this bookkeeping is allowed to be lossy.
 *
 * The set can also be lost outright (private window, cleared site data). The
 * cost of that is one extra upload per photo, once. That is the whole reason
 * it is allowed to live in `localStorage` rather than being something the
 * workspace has to carry and merge.
 *
 * ## Failure is quiet, on purpose
 *
 * A photo that did not upload is not marked uploaded, so the next sync tries
 * it again — and syncs happen on every push, every pull, every tab focus and
 * every `online` event. A transient NAS hiccup therefore heals itself within
 * seconds, and surfacing it would put a red banner on the screen for a problem
 * that has already fixed itself by the time it is read. What *does* surface is
 * the thing the user can act on: the sync status chip, which is about the
 * workspace and is driven by `syncEngine`. Photo trouble stays in the console.
 */

import { getPhotoBlob, setRemotePhotoSource } from '../stores/photoBlobs';
import { useWorkspaceStore } from '../stores/workspaceStore';
import type { Id } from '../types/models';
import { referencedPhotoIds } from '../utils/photos';
import { isConfigured, loadSettings, normalizeBaseUrl, type SyncSettings } from './settings';

/** Per-server record of what has been uploaded: `{ [baseUrl]: id[] }`. */
export const UPLOADED_KEY = 'trip-board/photo-uploaded';

/** How long a single photo request may take before we give up on it. */
export const PHOTO_REQUEST_TIMEOUT_MS = 30_000;

/* ------------------------------------------------------------------ *
 * The uploaded-set (pure-ish: localStorage in, localStorage out)
 * ------------------------------------------------------------------ */

function storage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

/**
 * Narrows whatever is under {@link UPLOADED_KEY} to the shape we expect.
 *
 * Defensive to the point of paranoia because this key is written by an older
 * version of this file as easily as by this one, and a device that cannot
 * parse it must degrade to "nothing uploaded yet" — one wasted upload round —
 * rather than throwing on the sync path.
 */
export function parseUploadedMap(raw: string | null): Record<string, string[]> {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};

  const out: Record<string, string[]> = {};
  for (const [server, ids] of Object.entries(parsed as Record<string, unknown>)) {
    if (!Array.isArray(ids)) continue;
    const clean = ids.filter((id): id is string => typeof id === 'string' && id.length > 0);
    if (clean.length > 0) out[server] = [...new Set(clean)];
  }
  return out;
}

function readMap(): Record<string, string[]> {
  try {
    return parseUploadedMap(storage()?.getItem(UPLOADED_KEY) ?? null);
  } catch {
    return {};
  }
}

function writeMap(map: Record<string, string[]>): void {
  try {
    storage()?.setItem(UPLOADED_KEY, JSON.stringify(map));
  } catch {
    /* quota / private mode — the set is an optimization, never a requirement */
  }
}

/**
 * Ids already uploaded to `baseUrl`.
 *
 * The list is never trimmed: one id is ~10 bytes and a trip that reached the
 * per-card cap on a hundred cards would still be under 15KB. Capping it would
 * mean re-uploading the oldest photos forever, which is exactly the cost the
 * set exists to avoid.
 */
export function loadUploadedIds(baseUrl: string): Set<Id> {
  return new Set(readMap()[normalizeBaseUrl(baseUrl)] ?? []);
}

/** Replaces the set for one server, dropping the entry when it empties. */
export function saveUploadedIds(baseUrl: string, ids: Iterable<Id>): void {
  const server = normalizeBaseUrl(baseUrl);
  const list = [...new Set(ids)];
  const map = readMap();
  if (list.length === 0) delete map[server];
  else map[server] = list;
  writeMap(map);
}

/** Adds one id to a server's set. */
export function markUploaded(baseUrl: string, id: Id): void {
  const ids = loadUploadedIds(baseUrl);
  if (ids.has(id)) return;
  ids.add(id);
  saveUploadedIds(baseUrl, ids);
}

/** Forgets ids for one server — what a delete leaves behind. */
export function pruneUploadedIds(baseUrl: string, ids: readonly Id[]): void {
  if (ids.length === 0) return;
  const server = normalizeBaseUrl(baseUrl);
  const map = readMap();
  const current = map[server];
  if (!current) return;
  const gone = new Set(ids);
  const kept = current.filter((id) => !gone.has(id));
  if (kept.length === current.length) return;
  saveUploadedIds(server, kept);
}

/* ------------------------------------------------------------------ *
 * The miss memo
 * ------------------------------------------------------------------ */

/**
 * Ids the server answered 404 for this session.
 *
 * A photo taken on a device that has since been wiped — or restored from a
 * backup written before `image.php` existed — is gone for good, and its card
 * still points at it. Without this, every render of that thumbnail would fire
 * another GET, and a strip of them would do it on every scroll. Session-only:
 * a reload is the natural moment to ask once more, in case the other phone has
 * come online and pushed the bytes since.
 *
 * Only a *definitive* 404 lands here. A network failure does not — the answer
 * to "the NAS is unreachable" is to ask again later, not to give up until the
 * page reloads.
 */
const missed = new Set<Id>();

/** True when `id` has already been proven absent from the server this session. */
export const hasMissedPhoto = (id: Id): boolean => missed.has(id);

/** Records a definitive 404. */
export function rememberPhotoMiss(id: Id): void {
  missed.add(id);
}

/** Clears the memo (tests, and 해제 → 재설정 pointing at another server). */
export function resetPhotoMisses(): void {
  missed.clear();
}

/* ------------------------------------------------------------------ *
 * Transport
 * ------------------------------------------------------------------ */

const endpoint = (settings: SyncSettings, id: Id): string =>
  `${normalizeBaseUrl(settings.baseUrl)}/image.php?id=${encodeURIComponent(id)}`;

/** `AbortSignal.timeout` where available; otherwise no timeout at all. */
function timeoutSignal(): AbortSignal | undefined {
  try {
    return AbortSignal.timeout?.(PHOTO_REQUEST_TIMEOUT_MS);
  } catch {
    return undefined;
  }
}

/**
 * One photo request. Returns `null` instead of throwing when the transport
 * fails: every caller here treats "could not reach the NAS" and "the NAS said
 * no" the same way — leave the bookkeeping alone and try again next cycle.
 */
async function photoRequest(
  settings: SyncSettings,
  id: Id,
  init: RequestInit,
): Promise<Response | null> {
  try {
    return await fetch(endpoint(settings, id), {
      ...init,
      headers: { 'X-Sync-Token': settings.token, ...((init.headers as Record<string, string>) ?? {}) },
      signal: timeoutSignal(),
      cache: 'no-store',
      credentials: 'omit',
    });
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * Upload
 * ------------------------------------------------------------------ */

/**
 * Uploads every referenced photo whose bytes this device holds and this server
 * has not been told about.
 *
 * Sequential, not `Promise.all`: these are ~400KB bodies going to a NAS over a
 * home upload link, and a dozen in parallel is how a first sync after a day of
 * photographing stalls every other request the app wants to make — including
 * the workspace push that gives those photos their meaning.
 *
 * Only *referenced* ids are considered. An unreferenced local blob is either a
 * crash leftover or something the GC is already counting down on; uploading it
 * would mean uploading a photo in order to delete it 30 seconds later.
 */
export async function uploadPendingPhotos(): Promise<void> {
  const settings = loadSettings();
  if (!isConfigured(settings)) return;

  const referenced = referencedPhotoIds(useWorkspaceStore.getState().workspace);
  if (referenced.size === 0) return;

  const uploaded = loadUploadedIds(settings.baseUrl);
  const pending = [...referenced].filter((id) => !uploaded.has(id));
  if (pending.length === 0) return;

  for (const id of pending) {
    const buf = await getPhotoBlob(id);
    // No local bytes: this card came from the other device and its photo has
    // not been downloaded here. Nothing to send — and nothing to remember,
    // since this device makes no claim about it either way.
    if (!buf) continue;

    const response = await photoRequest(settings, id, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/jpeg' },
      body: buf,
    });

    if (response?.ok) {
      markUploaded(settings.baseUrl, id);
      // It is on the server now, so a tile that gave up on it earlier in this
      // session deserves another look.
      missed.delete(id);
    } else {
      // Deliberately not marked. See the module doc: the next sync retries,
      // and there is no user-facing state for "one photo is a few seconds
      // behind" that would be worth the anxiety it causes.
      console.warn('[photoSync] upload failed', id, response?.status ?? 'network');
    }
  }
}

/* ------------------------------------------------------------------ *
 * Download
 * ------------------------------------------------------------------ */

/**
 * Fetches one photo's bytes from the server, or `null` when there are none to
 * be had — not configured, already known missing, 404, or offline.
 *
 * A success is also recorded as "uploaded": these exact bytes demonstrably sit
 * on that exact server under that exact id, which is the only thing the set
 * ever claims. Without it the receiving device would dutifully upload back
 * every photo it just downloaded.
 */
export async function fetchPhotoBlob(id: Id): Promise<ArrayBuffer | null> {
  const settings = loadSettings();
  if (!isConfigured(settings)) return null;
  if (missed.has(id)) return null;

  const response = await photoRequest(settings, id, { method: 'GET' });
  if (!response) return null;

  if (response.status === 404) {
    rememberPhotoMiss(id);
    return null;
  }
  if (!response.ok) return null;

  try {
    const buf = await response.arrayBuffer();
    if (buf.byteLength === 0) return null;
    markUploaded(settings.baseUrl, id);
    return buf;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * Delete
 * ------------------------------------------------------------------ */

/**
 * Removes photos from the server, best effort, and forgets them locally.
 *
 * Called by the GC after it has deleted the local bytes. The uploaded-set is
 * pruned **first and unconditionally**: whether or not the DELETE lands, this
 * device is no longer entitled to claim the server has those ids, and leaving
 * a stale claim behind is how a re-imported backup would fail to re-upload.
 */
export async function deleteServerPhotos(ids: readonly Id[]): Promise<void> {
  if (ids.length === 0) return;
  const settings = loadSettings();
  if (!isConfigured(settings)) return;

  pruneUploadedIds(settings.baseUrl, ids);

  for (const id of ids) {
    const response = await photoRequest(settings, id, { method: 'DELETE' });
    if (!response?.ok) {
      console.warn('[photoSync] delete failed', id, response?.status ?? 'network');
    }
  }
}

/* ------------------------------------------------------------------ *
 * Installation
 * ------------------------------------------------------------------ */

/**
 * Teaches the blob store how to reach the server (M20).
 *
 * `photoBlobs` is a storage module and stays one: it knows IndexedDB and
 * object URLs and nothing about sync settings or HTTP. The one thing it needs
 * from this side — "the bytes are not here, can you get them?" — arrives as an
 * injected function rather than an import, which is also what keeps the two
 * modules out of a cycle (`photoSync` reads and writes blobs; `photoBlobs`
 * must not import `photoSync` back).
 *
 * Installed at module scope so that merely importing this file is enough:
 * `syncEngine` does, `App` mounts `syncEngine`, and a thumbnail that renders
 * before any of that has finished simply falls back to the placeholder for one
 * paint. There is no ordering to get wrong.
 */
setRemotePhotoSource(fetchPhotoBlob);
