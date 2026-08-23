/**
 * Client for the `data.php` sync endpoint (M4).
 *
 * The whole protocol is three calls against one file, with an optimistic
 * version counter instead of locks:
 *
 * | call            | request                                  | response |
 * | --------------- | ---------------------------------------- | -------- |
 * | {@link fetchMeta}  | `GET  <base>/data.php?meta=1`         | `{version, updatedAt}` |
 * | {@link fetchAll}   | `GET  <base>/data.php`                | `{version, updatedAt, data}`, or `null` when the server has nothing yet |
 * | {@link push}       | `PUT  <base>/data.php` `{baseVersion, data}` | `{ok:true, version, updatedAt}`, or `{ok:false, conflict}` on 409 |
 *
 * Auth is a single shared secret in `X-Sync-Token`. Everything that is not a
 * clean 2xx (or the expected 404/409) becomes a {@link SyncError} so the engine
 * can tell "no network" from "wrong token" from "the NAS is on fire".
 */

import type { Millis, Workspace } from '../types/models';
import { isConfigured, loadSettings, normalizeBaseUrl, type SyncSettings } from './settings';

/** How long a single request may take before we call it offline. */
export const REQUEST_TIMEOUT_MS = 15_000;

/** Why a sync call failed — drives both the status chip and the retry policy. */
export type SyncErrorKind =
  /** Nothing configured; the caller should not have tried. */
  | 'unconfigured'
  /** Transport died: offline, DNS, TLS, timeout. Retry when back online. */
  | 'network'
  /** 401 — bad or missing token. Retrying will not help. */
  | 'auth'
  /** Any other non-2xx from the server. */
  | 'server'
  /** 2xx whose body was not the JSON we expect. */
  | 'parse';

/** Typed failure from any of the three calls. */
export class SyncError extends Error {
  kind: SyncErrorKind;
  /** HTTP status, or `0` when the request never got a response. */
  status: number;

  constructor(kind: SyncErrorKind, message: string, status = 0) {
    super(message);
    this.name = 'SyncError';
    this.kind = kind;
    this.status = status;
  }
}

/** Server-side version counter plus when it was written. */
export interface SyncMeta {
  version: number;
  updatedAt: Millis;
}

/** {@link SyncMeta} with the payload attached. */
export interface SyncEnvelope extends SyncMeta {
  data: Workspace;
}

/** Outcome of a {@link push}: accepted, or rejected with the server's copy. */
export type PushResult =
  | { ok: true; version: number; updatedAt: Millis }
  | { ok: false; conflict: SyncEnvelope };

/** Korean, user-facing message for a failure kind. */
const MESSAGES: Record<SyncErrorKind, string> = {
  unconfigured: '동기화 주소가 설정되지 않았어요',
  network: '서버에 연결할 수 없어요',
  auth: '토큰이 올바르지 않아요',
  server: '서버가 오류를 돌려줬어요',
  parse: '서버 응답을 이해할 수 없어요',
};

/**
 * HTTP header values are Latin-1. A token with a Korean character (or an
 * emoji, or a smart quote pasted from a notes app) makes `fetch` throw before
 * it ever opens a socket, which would otherwise surface as the thoroughly
 * misleading "서버에 연결할 수 없어요".
 */
const LATIN1_ONLY = /^[\u0020-\u00ff]*$/;

const endpoint = (settings: SyncSettings, query = ''): string =>
  `${normalizeBaseUrl(settings.baseUrl)}/data.php${query}`;

/** `AbortSignal.timeout` where available; otherwise no timeout at all. */
function timeoutSignal(): AbortSignal | undefined {
  try {
    return AbortSignal.timeout?.(REQUEST_TIMEOUT_MS);
  } catch {
    return undefined;
  }
}

/**
 * One request, with the token header attached and transport failures mapped
 * onto `SyncError('network')`.
 */
async function request(url: string, settings: SyncSettings, init: RequestInit): Promise<Response> {
  if (!LATIN1_ONLY.test(settings.token)) {
    throw new SyncError('auth', '토큰에 쓸 수 없는 문자가 있어요 (영문·숫자·기호만)');
  }

  const headers: Record<string, string> = {
    'X-Sync-Token': settings.token,
    Accept: 'application/json',
    ...((init.headers as Record<string, string> | undefined) ?? {}),
  };

  try {
    return await fetch(url, {
      ...init,
      headers,
      signal: timeoutSignal(),
      cache: 'no-store',
      credentials: 'omit',
    });
  } catch (err) {
    const error = new SyncError('network', MESSAGES.network);
    error.cause = err;
    throw error;
  }
}

/** Turns a non-2xx status into the right {@link SyncError}. */
function statusError(response: Response): SyncError {
  if (response.status === 401 || response.status === 403) {
    return new SyncError('auth', MESSAGES.auth, response.status);
  }
  return new SyncError('server', `${MESSAGES.server} (HTTP ${response.status})`, response.status);
}

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new SyncError('parse', MESSAGES.parse, response.status);
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** Narrows a raw body to {@link SyncMeta}, or throws `SyncError('parse')`. */
function asMeta(body: unknown, status: number): SyncMeta {
  if (!isRecord(body) || typeof body.version !== 'number') {
    throw new SyncError('parse', MESSAGES.parse, status);
  }
  return {
    version: body.version,
    updatedAt: typeof body.updatedAt === 'number' ? body.updatedAt : 0,
  };
}

/** The six `Record<Id, …>` maps a workspace carries. */
const ENTITY_MAPS = ['trips', 'sheets', 'columns', 'cards', 'days', 'entries'] as const;

/**
 * Repairs empty maps that came back as `[]` instead of `{}`.
 *
 * Some JSON encoders — PHP's `json_encode` on an associative array being the
 * one that matters here — cannot tell an empty object from an empty array. An
 * empty `cards: []` would still *behave* like an empty map in most of the app,
 * but it compares unequal to `{}`, and the engine decides whether to push by
 * comparing its merge result against this payload. Left alone, one stray
 * bracket means every pull schedules a push, forever.
 *
 * `data.php` is careful not to do this; the shim is here so that a
 * differently-built server (or a hand-edited `data.json`) cannot spin the
 * client.
 */
function normalizeWorkspace(data: Record<string, unknown>): Workspace {
  const fixed: Record<string, unknown> = { ...data };
  for (const key of ENTITY_MAPS) {
    const value = fixed[key];
    if (Array.isArray(value) && value.length === 0) fixed[key] = {};
  }
  if (!Array.isArray(fixed.tombstones)) fixed.tombstones = [];
  return fixed as unknown as Workspace;
}

/** Narrows a raw body to {@link SyncEnvelope}, or throws `SyncError('parse')`. */
function asEnvelope(body: unknown, status: number): SyncEnvelope {
  const meta = asMeta(body, status);
  const data = isRecord(body) ? body.data : null;
  if (!isRecord(data) || data.schemaVersion !== 1) {
    throw new SyncError('parse', MESSAGES.parse, status);
  }
  for (const key of ENTITY_MAPS) {
    if (data[key] !== undefined && typeof data[key] !== 'object') {
      throw new SyncError('parse', MESSAGES.parse, status);
    }
  }
  return { ...meta, data: normalizeWorkspace(data) };
}

/** Throws unless the caller actually has somewhere to sync to. */
function requireConfigured(settings: SyncSettings): void {
  if (!isConfigured(settings)) throw new SyncError('unconfigured', MESSAGES.unconfigured);
}

/**
 * Cheap "has anything changed?" probe — also what 연결 테스트 uses, since a
 * clean response proves the URL, the token and CORS all line up.
 */
export async function fetchMeta(settings: SyncSettings = loadSettings()): Promise<SyncMeta> {
  requireConfigured(settings);
  const response = await request(endpoint(settings, '?meta=1'), settings, { method: 'GET' });
  if (!response.ok) throw statusError(response);
  return asMeta(await parseJson(response), response.status);
}

/**
 * The full server copy, or `null` when the server has no workspace yet — a
 * fresh NAS answers 404, and the engine treats that as "push mine as v1".
 */
export async function fetchAll(settings: SyncSettings = loadSettings()): Promise<SyncEnvelope | null> {
  requireConfigured(settings);
  const response = await request(endpoint(settings), settings, { method: 'GET' });
  if (response.status === 404) return null;
  if (!response.ok) throw statusError(response);
  return asEnvelope(await parseJson(response), response.status);
}

/**
 * Optimistic write. `baseVersion` is the version this workspace was built on
 * (`0` for the very first push); the server accepts only if it still matches,
 * otherwise it answers 409 with its own copy for us to merge and retry.
 */
export async function push(
  baseVersion: number,
  data: Workspace,
  settings: SyncSettings = loadSettings(),
): Promise<PushResult> {
  requireConfigured(settings);
  const response = await request(endpoint(settings), settings, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ baseVersion, data }),
  });

  if (response.status === 409) {
    return { ok: false, conflict: asEnvelope(await parseJson(response), response.status) };
  }
  if (!response.ok) throw statusError(response);

  const meta = asMeta(await parseJson(response), response.status);
  return { ok: true, version: meta.version, updatedAt: meta.updatedAt };
}
