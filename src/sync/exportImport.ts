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

import { useWorkspaceStore } from '../stores/workspaceStore';
import type { Millis, Workspace } from '../types/models';
import { markBackedUp } from './backup';
import { merge } from './merge';

/** Shape of the `.json` file written by {@link exportJson}. */
export interface BackupFile {
  /** When the export ran. Informational — merge uses the entity stamps. */
  exportedAt: Millis;
  workspace: Workspace;
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

/** Pure half of the export: workspace → file contents. */
export function serializeBackup(workspace: Workspace, now: Millis = Date.now()): string {
  const payload: BackupFile = { exportedAt: now, workspace };
  return JSON.stringify(payload, null, 2);
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
export function exportJson(now: Millis = Date.now()): void {
  const text = serializeBackup(useWorkspaceStore.getState().workspace, now);
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = backupFileName(now);
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

/**
 * Reads a picked file and folds it into the current workspace.
 *
 * Leaves the store dirty (via `replaceWorkspace`), so the sync engine's
 * debounce picks the result up and pushes it — importing on one device
 * propagates to the others by itself.
 */
export async function importJson(file: File): Promise<ImportSummary> {
  const imported = deserializeBackup(await file.text());
  const store = useWorkspaceStore.getState();
  const merged = merge(store.workspace, imported);
  store.replaceWorkspace(merged);

  return {
    trips: Object.keys(merged.trips).length,
    cards: Object.keys(merged.cards).length,
    entries: Object.keys(merged.entries).length,
  };
}
