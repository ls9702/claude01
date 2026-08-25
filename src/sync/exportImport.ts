/**
 * 내보내기 / 가져오기 — the escape hatch that works with no server at all (M4).
 *
 * On GitHub Pages (or any install where the NAS is not reachable) this is the
 * only way to move a workspace between devices, so it has to be boring and
 * total: one JSON file, no compression, no incremental format.
 *
 * Import is **not** a replace — it runs the same {@link merge} the sync engine
 * uses. Loading a backup on a device that has since moved on therefore adds
 * what is missing instead of throwing away newer work, and re-importing the
 * same file twice is a no-op.
 *
 * The pure `serialize`/`deserialize` pair is split out from the two DOM
 * functions so the round trip can be unit-tested without a browser.
 */

import { getPhotoBlob, putPhotoBlob } from '../stores/photoBlobs';
import { schedulePhotoGc } from '../stores/photoGc';
import { useWorkspaceStore } from '../stores/workspaceStore';
import type { Id, Millis, Tombstone, Workspace } from '../types/models';
import { base64ToBuf, bufToBase64 } from '../utils/base64';
import { markBackedUp } from './backup';
import { merge } from './merge';

/** `photoId → base64 JPEG`, the optional second half of a backup file (M10). */
export type BackupPhotos = Record<Id, string>;

/** Shape of the `.json` file written by {@link exportJson}. */
export interface BackupFile {
  /** When the export ran. Informational — merge uses the entity stamps. */
  exportedAt: Millis;
  workspace: Workspace;
  /**
   * Photo bytes, base64 in the same JSON (M10). Absent from an ordinary
   * 내보내기 — a workspace is tens of kilobytes and a photo album is tens of
   * megabytes, and one of those is a file you can email yourself.
   *
   * Old readers ignore the key (`deserializeBackup` only ever looks at
   * `workspace`), so a 사진 포함 file still restores everywhere.
   */
  photos?: BackupPhotos;
}

/** What an import actually brought in, for the confirmation message. */
export interface ImportSummary {
  trips: number;
  cards: number;
  entries: number;
}

/** `YYYYMMDD` in local time — the file is for a human, not for a parser. */
export function backupDateStamp(now: Millis = Date.now()): string {
  const date = new Date(now);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}

/** `trip-board-backup-YYYYMMDD.json`. */
export const backupFileName = (now: Millis = Date.now()): string =>
  `trip-board-backup-${backupDateStamp(now)}.json`;

/** `trip-board-backup-YYYYMMDD-photos.json` — the 사진 포함 variant (M10). */
export const backupPhotoFileName = (now: Millis = Date.now()): string =>
  `trip-board-backup-${backupDateStamp(now)}-photos.json`;

/** Pure half of the export: workspace → file contents. */
export function serializeBackup(workspace: Workspace, now: Millis = Date.now()): string {
  const payload: BackupFile = { exportedAt: now, workspace };
  return JSON.stringify(payload, null, 2);
}

/**
 * Pure half of the 사진 포함 export.
 *
 * Not pretty-printed like {@link serializeBackup}: two extra spaces per line of
 * base64 is real weight once photos are in, and nobody reads this half by hand.
 */
export function serializeBackupWithPhotos(
  workspace: Workspace,
  photos: BackupPhotos,
  now: Millis = Date.now(),
): string {
  const payload: BackupFile = { exportedAt: now, workspace, photos };
  return JSON.stringify(payload);
}

/**
 * Pure half of the import's photo half: the `photos` map of a parsed file, or
 * `undefined` for an ordinary backup (and for anything that is not a map of
 * strings — a hand-edited file must not be able to smuggle objects in here).
 */
export function readBackupPhotos(parsed: unknown): BackupPhotos | undefined {
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const raw = (parsed as { photos?: unknown }).photos;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;

  const photos: BackupPhotos = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'string' && value.length > 0) photos[id] = value;
  }
  return Object.keys(photos).length > 0 ? photos : undefined;
}

/**
 * Pure half of the import: file contents → workspace.
 *
 * Throws an `Error` with a Korean message the settings sheet can show as-is.
 * Also accepts a bare workspace (no `{exportedAt, workspace}` wrapper), since
 * that is what someone poking at IndexedDB by hand will most likely paste in.
 */
export function deserializeBackup(text: string): Workspace {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('JSON 파일이 아니에요');
  }

  if (typeof parsed !== 'object' || parsed === null) throw new Error('백업 파일 형식이 아니에요');

  const record = parsed as Record<string, unknown>;
  const candidate = (
    'workspace' in record && typeof record.workspace === 'object' && record.workspace !== null
      ? record.workspace
      : record
  ) as Record<string, unknown>;

  if (candidate.schemaVersion !== 1) {
    throw new Error('지원하지 않는 백업 버전이에요');
  }
  for (const key of ['trips', 'sheets', 'columns', 'cards', 'days', 'entries'] as const) {
    if (typeof candidate[key] !== 'object' || candidate[key] === null) {
      throw new Error('백업 파일이 손상됐어요');
    }
  }
  if (!Array.isArray(candidate.tombstones)) throw new Error('백업 파일이 손상됐어요');

  return candidate as unknown as Workspace;
}

/**
 * Downloads the current workspace as a JSON file.
 *
 * Uses an object URL + a synthetic `<a download>` click, which is the only
 * approach that works in a WKWebView-backed iOS PWA as well as on desktop.
 */
function download(text: string, filename: string, now: Millis): void {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();

  // Safari needs the URL to outlive the click by a tick.
  setTimeout(() => URL.revokeObjectURL(url), 1_000);

  // The click is as close to "a file exists now" as the browser will let us
  // get — there is no completion event for a download — so stamp it here and
  // let the 백업 넛지 stand down.
  markBackedUp(now);
}

export function exportJson(now: Millis = Date.now()): void {
  const workspace = useWorkspaceStore.getState().workspace;
  download(serializeBackup(workspace, now), backupFileName(now), now);
}

/**
 * Downloads the workspace **with its photos** base64'd into the same file
 * (M10).
 *
 * One file rather than a zip on purpose: the app has no zip library, the
 * import path is already "pick a .json", and a single file is the thing people
 * actually manage to move between a phone and a laptop. The cost is base64's
 * 33% — a 12-photo trip is ~8MB — which is why this is a *separate button* and
 * not what 내보내기 does.
 *
 * Only photos the workspace still refers to are written; an orphan blob the GC
 * has not swept yet is not something to carry to another device.
 */
export async function exportJsonWithPhotos(now: Millis = Date.now()): Promise<number> {
  const workspace = useWorkspaceStore.getState().workspace;
  const photos: BackupPhotos = {};

  for (const id of referencedIds(workspace)) {
    const buf = await getPhotoBlob(id);
    // A missing blob is skipped rather than fatal: the file is still a valid
    // backup of everything else, and one lost photo must not cost the trip.
    if (buf) photos[id] = bufToBase64(buf);
  }

  download(serializeBackupWithPhotos(workspace, photos, now), backupPhotoFileName(now), now);
  return Object.keys(photos).length;
}

/**
 * Every photo id the workspace mentions, oldest card first — then the 메모
 * thread's own photos (M21), which a 사진 포함 backup must carry too.
 */
function referencedIds(workspace: Workspace): Id[] {
  const ids = new Set<Id>();
  for (const card of Object.values(workspace.cards)) {
    for (const photo of card.photos ?? []) ids.add(photo.id);
  }
  for (const memo of Object.values(workspace.memos ?? {})) {
    for (const photo of memo.photos ?? []) ids.add(photo.id);
  }
  return [...ids];
}

/** Reads a picked file into a workspace, so the UI can look before it merges. */
export const readBackupFile = async (file: File): Promise<Workspace> =>
  deserializeBackup(await file.text());

/** Which entity map a tombstone's `entity` names. */
const MAP_OF = {
  trip: 'trips',
  sheet: 'sheets',
  column: 'columns',
  card: 'cards',
  day: 'days',
  entry: 'entries',
} as const satisfies Record<Tombstone['entity'], keyof Workspace>;

const tombKey = (tomb: Tombstone): string => `${tomb.entity}:${tomb.id}`;

/**
 * The local deletions that would swallow something the backup still has (B11).
 *
 * Import is a {@link merge}, and merge is right to let a tombstone win over an
 * older entity — that is what stops a stale device from resurrecting a row.
 * But it makes 백업 가져오기 useless for the one job people expect of it:
 * "I deleted my trip, give it back". The file has the trip; the local tombstone
 * kills it on the way in; the user sees 여행 0개 and no explanation.
 *
 * So the decision is handed to them instead. This is the *question* half —
 * pure, and reproducing merge's own kill rule exactly (`deletedAt >
 * entity.updatedAt`) so the answer is never off by one entity.
 */
export function findTombstoneConflicts(local: Workspace, imported: Workspace): Tombstone[] {
  const conflicts: Tombstone[] = [];
  for (const tomb of local.tombstones) {
    const map = imported[MAP_OF[tomb.entity]] as Record<Id, { updatedAt: Millis }> | undefined;
    const entity = map?.[tomb.id];
    if (entity && tomb.deletedAt > entity.updatedAt) conflicts.push(tomb);
  }
  return conflicts;
}

/** A copy of `workspace` with exactly `drop`'s tombstones taken out. */
export function withoutTombstones(workspace: Workspace, drop: readonly Tombstone[]): Workspace {
  if (drop.length === 0) return workspace;
  const dropped = new Set(drop.map(tombKey));
  return {
    ...workspace,
    tombstones: workspace.tombstones.filter((tomb) => !dropped.has(tombKey(tomb))),
  };
}

/** How an import should treat {@link findTombstoneConflicts}. */
export interface ImportOptions {
  /**
   * `true` drops exactly the conflicting local tombstones before merging, so
   * the backup's copies come back. Everything else — including tombstones the
   * backup knows nothing about — is left alone, so sync semantics are untouched
   * for every other row.
   */
  restore?: boolean;
}

/**
 * Reads a picked file and folds it into the current workspace.
 *
 * Leaves the store dirty (via `replaceWorkspace`), so the sync engine's
 * debounce picks the result up and pushes it — importing on one device
 * propagates to the others by itself.
 */
export async function importJson(
  file: File,
  opts: ImportOptions = {},
): Promise<ImportSummary> {
  const text = await file.text();
  const imported = deserializeBackup(text);
  // Parsed a second time only to reach the optional `photos` half, and only
  // because `deserializeBackup` is the frozen, well-tested door for the rest.
  const photos = readBackupPhotos(JSON.parse(text) as unknown);

  const store = useWorkspaceStore.getState();
  const local = opts.restore
    ? withoutTombstones(store.workspace, findTombstoneConflicts(store.workspace, imported))
    : store.workspace;
  const merged = merge(local, imported);
  store.replaceWorkspace(merged);

  if (photos) await restorePhotos(photos, merged);
  // A merge can also *drop* cards (a tombstone outliving them), so every import
  // is a moment when blobs may have become unreachable — let the sweeper look
  // once the grace period has passed.
  schedulePhotoGc();

  return {
    trips: Object.keys(merged.trips).length,
    cards: Object.keys(merged.cards).length,
    entries: Object.keys(merged.entries).length,
  };
}

/**
 * Writes the file's photo bytes back into the blob store (M10).
 *
 * Filtered by the **merged** workspace, not by the file: a card the merge threw
 * away (a tombstone outlived it) must not leave its photos behind as garbage,
 * and a photo whose id is already here is simply re-written — same id, same
 * bytes, so an import run twice is still a no-op.
 *
 * A failed write is swallowed on purpose. The workspace has already been
 * replaced by then; turning "one photo would not fit" into a thrown import
 * would tell the user their trip did not come back, which is false.
 */
async function restorePhotos(photos: BackupPhotos, merged: Workspace): Promise<void> {
  const wanted = new Set(referencedIds(merged));
  for (const [id, base64] of Object.entries(photos)) {
    if (!wanted.has(id)) continue;
    try {
      await putPhotoBlob(id, base64ToBuf(base64));
    } catch (err) {
      console.warn('[importJson] photo restore failed', id, err);
    }
  }
}
