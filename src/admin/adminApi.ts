/**
 * Client for `server/admin.php` (M46/M47).
 *
 * The administrator's half of the app: which workspace everybody sees, what the
 * two people are called, where photos are filed, what the 공지 says, and how to
 * put a finished trip back the way it was yesterday.
 *
 * Three rules shape this file:
 *
 * - **The token never touches `localStorage`.** It is held in a module variable
 *   for the life of the tab and mirrored into `sessionStorage`, so reopening the
 *   sheet during one sitting does not ask again and closing the tab forgets it.
 *   It is a password that moves everyone's data; it does not get to persist.
 * - **Every action answers with the whole state.** `create`, `activate`,
 *   `rename`, `공지`… all return the same `{active, sessions, archive, …}` body
 *   the plain GET does, so the sheet never has to guess what changed or fire a
 *   second request to find out.
 * - **Errors are Korean sentences.** This screen is used by one person, rarely,
 *   usually on a phone. `HTTP 409` is not an answer.
 */

import type { ProfileOverrides, ServerNotice } from '../sync/api';
import { isConfigured, loadSettings, normalizeBaseUrl, type SyncSettings } from '../sync/settings';

/** How long an admin request may take before we call it offline. */
export const ADMIN_TIMEOUT_MS = 20_000;

/** Where the token is mirrored for the life of the tab. */
export const ADMIN_TOKEN_KEY = 'trip-board/admin-token';

/** One session, as the admin screen lists it. */
export interface AdminSession {
  id: string;
  /** The display name the administrator typed. Empty means "just the id". */
  label: string;
  active: boolean;
  /** 보관 — read-only, `data.php` refuses pushes with 423 (M47). */
  archived: boolean;
  /** When its workspace file was last written, ms. `0` = never. */
  updatedAt: number;
  dataBytes: number;
  photoBytes: number;
  photoCount: number;
}

/** Where 사진 보관 files things, and whether it can. */
export interface AdminArchiveSettings {
  folder: string;
  /** `ARCHIVE_DIR` from config.php — shown so the owner can see it is right. */
  base: string;
  ready: boolean;
  baseExists: boolean;
  bytes: number;
  count: number;
}

/** The NAS's own numbers (M47 용량 대시보드). */
export interface AdminUsage {
  diskFree: number;
  diskTotal: number;
  /** When this was measured — the server caches it for a minute. */
  at: number;
}

/** Everything the admin sheet draws, in one response. */
export interface AdminState {
  active: string;
  sessions: AdminSession[];
  archive: AdminArchiveSettings;
  usage: AdminUsage | null;
  notice: ServerNotice | null;
  profiles: ProfileOverrides | null;
}

/** One daily snapshot available to restore (M47). */
export interface AdminBackup {
  /** `YYYYMMDD`, straight off the filename — the name *is* the order. */
  date: string;
  bytes: number;
}

/** A failure with something worth showing the person who pressed the button. */
export class AdminError extends Error {
  status: number;

  constructor(message: string, status = 0) {
    super(message);
    this.name = 'AdminError';
    this.status = status;
  }
}

/* ------------------------------------------------------------------ *
 * The token
 * ------------------------------------------------------------------ */

let memoryToken: string | null = null;

function sessionStore(): Storage | null {
  try {
    if (typeof sessionStorage === 'undefined') return null;
    return sessionStorage;
  } catch {
    return null;
  }
}

/** The admin token for this tab, or `null` when nobody has typed it. */
export function loadAdminToken(): string | null {
  if (memoryToken) return memoryToken;
  try {
    const stored = sessionStore()?.getItem(ADMIN_TOKEN_KEY);
    memoryToken = stored && stored.length > 0 ? stored : null;
  } catch {
    memoryToken = null;
  }
  return memoryToken;
}

/** Holds the token for this tab. Never `localStorage` — see the module doc. */
export function saveAdminToken(token: string): void {
  memoryToken = token;
  try {
    sessionStore()?.setItem(ADMIN_TOKEN_KEY, token);
  } catch {
    /* private mode — the sheet simply asks again next time it is opened */
  }
}

/** Forgets the token (잠금 해제 버튼, and a 401). */
export function clearAdminToken(): void {
  memoryToken = null;
  try {
    sessionStore()?.removeItem(ADMIN_TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------------ *
 * Transport
 * ------------------------------------------------------------------ */

const endpoint = (settings: SyncSettings, query = ''): string =>
  `${normalizeBaseUrl(settings.baseUrl)}/admin.php${query}`;

function timeoutSignal(): AbortSignal | undefined {
  try {
    return AbortSignal.timeout?.(ADMIN_TIMEOUT_MS);
  } catch {
    return undefined;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** The server's own Korean sentence when it sent one, a fallback when it did not. */
function messageFor(status: number, body: unknown): string {
  const detail = isRecord(body) && typeof body.detail === 'string' ? body.detail : '';
  if (detail) return detail;
  if (status === 401) return '비밀번호가 올바르지 않아요';
  if (status === 404) return '서버에 관리자 기능이 없어요 (admin.php를 올려 주세요)';
  return `서버가 오류를 돌려줬어요 (HTTP ${status})`;
}

/**
 * One admin request.
 *
 * `token` is passed rather than read so the 비밀번호 prompt can *test* a token
 * before it is stored — otherwise a wrong password would have to be saved in
 * order to find out it was wrong.
 */
async function adminRequest(
  init: RequestInit,
  query = '',
  token: string = loadAdminToken() ?? '',
  settings: SyncSettings = loadSettings(),
): Promise<Response> {
  if (!isConfigured(settings)) {
    throw new AdminError('동기화 주소가 설정되지 않았어요');
  }
  if (token === '') {
    throw new AdminError('비밀번호가 필요해요', 401);
  }

  try {
    return await fetch(endpoint(settings, query), {
      ...init,
      headers: {
        'X-Admin-Token': token,
        Accept: 'application/json',
        ...((init.headers as Record<string, string> | undefined) ?? {}),
      },
      signal: timeoutSignal(),
      cache: 'no-store',
      credentials: 'omit',
    });
  } catch {
    throw new AdminError('서버에 연결할 수 없어요');
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new AdminError('서버 응답을 이해할 수 없어요', response.status);
  }
}

/* ------------------------------------------------------------------ *
 * Parsing — every field defended, because this screen moves everyone's data
 * ------------------------------------------------------------------ */

const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
const str = (value: unknown): string => (typeof value === 'string' ? value : '');

function parseSession(raw: unknown): AdminSession | null {
  if (!isRecord(raw) || typeof raw.id !== 'string' || raw.id === '') return null;
  return {
    id: raw.id,
    label: str(raw.label),
    active: raw.active === true,
    archived: raw.archived === true,
    updatedAt: num(raw.updatedAt),
    dataBytes: num(raw.dataBytes),
    photoBytes: num(raw.photoBytes),
    photoCount: num(raw.photoCount),
  };
}

/** Narrows any admin response body to {@link AdminState}. */
export function parseAdminState(body: unknown): AdminState {
  if (!isRecord(body)) throw new AdminError('서버 응답을 이해할 수 없어요');

  const sessions = Array.isArray(body.sessions)
    ? body.sessions.map(parseSession).filter((s): s is AdminSession => s !== null)
    : [];

  const archiveRaw = isRecord(body.archive) ? body.archive : {};
  const usageRaw = isRecord(body.usage) ? body.usage : null;
  const noticeRaw = isRecord(body.notice) ? body.notice : null;
  const noticeText = str(noticeRaw?.text).trim();

  return {
    active: str(body.active) || 'default',
    sessions,
    archive: {
      folder: str(archiveRaw.folder),
      base: str(archiveRaw.base),
      ready: archiveRaw.ready === true,
      baseExists: archiveRaw.baseExists === true,
      bytes: num(archiveRaw.bytes),
      count: num(archiveRaw.count),
    },
    usage: usageRaw
      ? { diskFree: num(usageRaw.diskFree), diskTotal: num(usageRaw.diskTotal), at: num(usageRaw.at) }
      : null,
    notice: noticeText ? { text: noticeText, at: num(noticeRaw?.at) } : null,
    profiles: isRecord(body.profiles) ? (body.profiles as ProfileOverrides) : null,
  };
}

/** Narrows a `backups` response to the list the 복원 UI walks. */
export function parseAdminBackups(body: unknown): AdminBackup[] {
  const raw = isRecord(body) && Array.isArray(body.backups) ? body.backups : [];
  return raw
    .map((item): AdminBackup | null => {
      if (!isRecord(item) || typeof item.date !== 'string') return null;
      return { date: item.date, bytes: num(item.bytes) };
    })
    .filter((item): item is AdminBackup => item !== null);
}

/* ------------------------------------------------------------------ *
 * Calls
 * ------------------------------------------------------------------ */

/** The whole admin screen, and the call that proves a password (`GET`). */
export async function adminList(token?: string): Promise<AdminState> {
  const response = await adminRequest({ method: 'GET' }, '', token);
  const body = await readJson(response);
  if (!response.ok) throw new AdminError(messageFor(response.status, body), response.status);
  return parseAdminState(body);
}

/** Posts one action and adopts the state it answers with. */
async function adminPost(payload: Record<string, unknown>): Promise<AdminState> {
  const response = await adminRequest({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await readJson(response);
  if (!response.ok) throw new AdminError(messageFor(response.status, body), response.status);
  return parseAdminState(body);
}

export const adminCreate = (id: string, label: string): Promise<AdminState> =>
  adminPost({ action: 'create', id, label });

export const adminRename = (id: string, label: string): Promise<AdminState> =>
  adminPost({ action: 'rename', id, label });

export const adminActivate = (id: string): Promise<AdminState> =>
  adminPost({ action: 'activate', id });

export const adminSetArchiveFolder = (folder: string): Promise<AdminState> =>
  adminPost({ action: 'archive-settings', folder });

/** 공지 게시 / 내리기 (M47) — an empty string takes it down. */
export const adminSetNotice = (text: string): Promise<AdminState> =>
  adminPost({ action: 'notice', text });

/** 세션 보관 / 해제 (M47) — read-only, not deletion. */
export const adminSetArchived = (id: string, archived: boolean): Promise<AdminState> =>
  adminPost({ action: archived ? 'lock' : 'unlock', id });

/** Per-session display names and emoji avatars (M47). */
export const adminSetProfiles = (
  id: string,
  profiles: ProfileOverrides,
): Promise<AdminState> => adminPost({ action: 'profiles', id, profiles });

/** The daily snapshots one session has (M47). */
export async function adminBackups(id: string): Promise<AdminBackup[]> {
  const response = await adminRequest(
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'backups', id }) },
  );
  const body = await readJson(response);
  if (!response.ok) throw new AdminError(messageFor(response.status, body), response.status);
  return parseAdminBackups(body);
}

/** Puts one session's workspace back to a dated snapshot (M47). */
export const adminRestore = (id: string, date: string): Promise<AdminState> =>
  adminPost({ action: 'restore', id, date });

/**
 * Downloads one session's workspace as a file (M47).
 *
 * The bytes are the server's own envelope — `{version, updatedAt, data}` — which
 * is exactly what `sync/exportImport.deserializeBackup` already knows how to
 * read, so an exported session restores through 설정 → 가져오기 with no
 * conversion step and no second format to keep alive.
 */
export async function adminExport(id: string): Promise<string> {
  const response = await adminRequest(
    { method: 'GET' },
    `?action=export&id=${encodeURIComponent(id)}`,
  );
  if (!response.ok) {
    throw new AdminError(messageFor(response.status, await readJson(response)), response.status);
  }

  const text = await response.text();
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `trip-board-${id}-${stamp}.json`;

  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);

  return filename;
}
