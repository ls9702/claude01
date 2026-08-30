/**
 * Client for `server/archive.php` (M46).
 *
 * One call: POST the raw bytes with the original filename in the query string.
 * No multipart, no form, no `FormData` — a `File` is already a `Blob` and
 * `fetch` will stream it as the body, so the wire carries the photo and nothing
 * else. That is also what keeps 원본 그대로 honest: there is no encoding step
 * anywhere between the camera roll and the disk.
 *
 * Auth is the ordinary `X-Sync-Token`: both travellers file photos all week.
 * Choosing *where* they go is the administrator's call and lives in `admin.php`.
 */

import { isConfigured, loadSettings, normalizeBaseUrl, type SyncSettings } from '../sync/settings';

/**
 * How long one photo may take.
 *
 * Generous on purpose: this is a 20MB original going to a home NAS over a phone
 * uplink, which is a different order of magnitude from the 400KB card photo
 * `photoSync` allows 30초 for.
 */
export const ARCHIVE_TIMEOUT_MS = 180_000;

/** Where the bytes landed, as `archive.php` reports it. */
export interface ArchiveUploadResult {
  /** `2026-11-osaka/IMG_0001.jpg` — relative, never the NAS volume path. */
  path: string;
  name: string;
  bytes: number;
}

/** A failure with a Korean sentence the sheet can show as-is. */
export class ArchiveError extends Error {
  status: number;

  constructor(message: string, status = 0) {
    super(message);
    this.name = 'ArchiveError';
    this.status = status;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

function timeoutSignal(): AbortSignal | undefined {
  try {
    return AbortSignal.timeout?.(ARCHIVE_TIMEOUT_MS);
  } catch {
    return undefined;
  }
}

/**
 * Files one photo. Rejects with an {@link ArchiveError} carrying the server's
 * own sentence — `archive.php` writes those in Korean precisely so this layer
 * never has to invent one for a case it cannot see.
 */
export async function uploadArchiveFile(
  file: File,
  settings: SyncSettings = loadSettings(),
): Promise<ArchiveUploadResult> {
  if (!isConfigured(settings)) {
    throw new ArchiveError('동기화 주소가 설정되지 않았어요');
  }

  const url = `${normalizeBaseUrl(settings.baseUrl)}/archive.php?name=${encodeURIComponent(file.name)}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'X-Sync-Token': settings.token,
        // Whatever the picker said it is. The server rebuilds the name from the
        // query string and never trusts this, but a correct type is what makes
        // a proxy in between leave the body alone.
        'Content-Type': file.type || 'application/octet-stream',
        Accept: 'application/json',
      },
      body: file,
      signal: timeoutSignal(),
      cache: 'no-store',
      credentials: 'omit',
    });
  } catch {
    throw new ArchiveError('서버에 연결할 수 없어요');
  }

  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const detail = isRecord(body) && typeof body.detail === 'string' ? body.detail : '';
    throw new ArchiveError(
      detail || `보관에 실패했어요 (HTTP ${response.status})`,
      response.status,
    );
  }

  if (!isRecord(body) || typeof body.path !== 'string') {
    throw new ArchiveError('서버 응답을 이해할 수 없어요', response.status);
  }

  return {
    path: body.path,
    name: typeof body.name === 'string' ? body.name : file.name,
    bytes: typeof body.bytes === 'number' ? body.bytes : file.size,
  };
}
