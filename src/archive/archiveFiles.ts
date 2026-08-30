/**
 * 여행 사진 보관함 — 파일 이름과 갈래 (M46).
 *
 * The pure half of 📤 「사진 보관」: which files this button will accept, what
 * they will be called on the NAS, and how the result reads afterwards.
 *
 * Nothing here compresses, resizes or re-encodes anything, and that is the
 * whole difference between this feature and card photos. A card photo is
 * *content* — it is rendered in a 96px tile, synced to two devices and merged
 * forever, so `utils/photos` grinds it down to 500KB. A photo filed here is an
 * **original** on its way to a NAS folder to be kept. The bytes that left the
 * camera are the bytes that land on the disk.
 *
 * The server does its own validation of everything below and is the authority
 * (`server/archive.php`); this exists so the phone can say "그건 사진이 아니에요"
 * without spending a 40MB upload to find out.
 */

/** Extensions the archive accepts. Videos are deliberately absent. */
export const ARCHIVE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'heic', 'heif', 'webp'] as const;

/** Longest stored filename, extension included — mirrors `archive.php`. */
export const MAX_ARCHIVE_NAME_LEN = 120;

/** The lowercase extension of a filename, or `''` when it has none. */
export function extensionOf(name: string): string {
  const base = name.trim().split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return '';
  return base.slice(dot + 1).toLowerCase();
}

/** True for a name this archive will take. */
export const isArchivableName = (name: string): boolean =>
  (ARCHIVE_EXTENSIONS as readonly string[]).includes(extensionOf(name));

/**
 * The name a file will be filed under, or `null` when it is not a photo.
 *
 * Mirrors `safe_archive_name()` in `archive.php` rule for rule — directory
 * parts dropped, extension whitelisted, stem scrubbed to `[A-Za-z0-9._-]`, a
 * stem that scrubs away to nothing becomes `photo`. Two implementations of one
 * rule is a real cost, and it is paid for by being able to *show* the person
 * what their 사진.jpg is about to be called before anything is uploaded.
 */
export function safeArchiveName(raw: string): string | null {
  const base = (raw.trim().split(/[\\/]/).pop() ?? '').trim();
  if (base === '' || base === '.' || base === '..') return null;

  const ext = extensionOf(base);
  if (!(ARCHIVE_EXTENSIONS as readonly string[]).includes(ext)) return null;

  const stem = base
    .slice(0, base.lastIndexOf('.'))
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^[._-]+|[._-]+$/g, '');

  const safeStem = (stem === '' ? 'photo' : stem).slice(0, MAX_ARCHIVE_NAME_LEN - ext.length - 1);
  return `${safeStem}.${ext}`;
}

/** How one file's upload ended. */
export type ArchiveOutcome = 'ok' | 'skipped' | 'failed';

/** One row of the result list the sheet shows when it is done. */
export interface ArchiveResult {
  name: string;
  outcome: ArchiveOutcome;
  /** Where it landed (`folder/file.jpg`) or why it did not. */
  detail: string;
}

/**
 * The one-line summary under the progress bar.
 *
 * Says the good news first and only mentions the other two when there is
 * something to mention — "12장 보관했어요" is the sentence this feature exists
 * to produce, and appending "· 실패 0장" to it every time would bury it.
 */
export function summarizeArchive(results: readonly ArchiveResult[]): string {
  const ok = results.filter((r) => r.outcome === 'ok').length;
  const skipped = results.filter((r) => r.outcome === 'skipped').length;
  const failed = results.filter((r) => r.outcome === 'failed').length;

  if (results.length === 0) return '보관할 사진을 골라 주세요';

  const parts: string[] = [];
  if (ok > 0) parts.push(`${ok}장 보관했어요`);
  if (failed > 0) parts.push(`${failed}장 실패`);
  if (skipped > 0) parts.push(`${skipped}장은 사진이 아니라 건너뛰었어요`);
  return parts.length > 0 ? parts.join(' · ') : '보관한 사진이 없어요';
}
