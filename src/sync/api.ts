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
import { isValidSessionId, loadServerSession } from './session';
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
  | 'parse'
  /**
   * 423 — the administrator put this session in 보관 (read-only, M47). Edits
   * stay on the device and nothing is lost; the server simply will not take
   * them. Retrying does not help until somebody unlocks it, which is why it is
   * its own kind rather than a `server` error with a nicer message.
   */
  | 'locked';

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
  /**
   * Which workspace the server is serving (M46), when it is new enough to say.
   *
   * Additive on both sides: a pre-M46 server simply omits it and every caller
   * here treats that as "the session cannot have changed", which is exactly
   * true for a server that only has one.
   */
  session?: string;
  /** Is the active session read-only right now (M47 보관)? */
  locked?: boolean;
  /** The administrator's 공지, or `null` when there is none (M47). */
  notice?: ServerNotice | null;
  /** Per-session display overrides for the two profiles (M47). */
  profiles?: ProfileOverrides | null;
  /**
   * When the administrator last restored this session from a backup (M47).
   *
   * `0` for a session that has never been restored, and for a pre-M47 server.
   * The engine treats a stamp newer than the one it last acted on as "adopt the
   * server copy whole" — see `syncEngine.pullMerge`.
   */
  restoredAt?: Millis;
}

/** One 공지 line the administrator posted (M47). */
export interface ServerNotice {
  text: string;
  /** When it was posted — what makes a re-posted identical line show again. */
  at: Millis;
}

/**
 * What the administrator may change about how a person is drawn (M47).
 *
 * Presentation only, keyed by the two profile ids the app has always had.
 * The **ids** stay `song` / `hoyabom` because they are written into every card,
 * comment and receipt — renaming those would rewrite history. What is on the
 * screen is a label and an avatar, and those are the two things a different
 * group of two people actually needs to change.
 */
export type ProfileOverrides = Record<string, { label?: string; avatar?: string }>;

/** {@link SyncMeta} with the payload attached. */
export interface SyncEnvelope extends SyncMeta {
  data: Workspace;
}

/**
 * A workspace GET, session and all (M46).
 *
 * The session arrives even when the envelope does not: a 404 means "the active
 * session has nothing yet", and *which* empty session that is decides whether
 * this device may push its copy into it. Pushing session A's trips into a
 * freshly created session B is the exact accident this milestone exists to make
 * impossible, so the 404 has to be able to say the id too.
 */
export interface WorkspaceFetch {
  session: string | null;
  envelope: SyncEnvelope | null;
}

/**
 * Outcome of a {@link push}: accepted, rejected with the server's copy, or
 * refused because the administrator moved everyone somewhere else mid-edit
 * (M46 — `409 session_changed`, which is *not* a version conflict and must not
 * be merged its way out of).
 */
export type PushResult =
  | { ok: true; version: number; updatedAt: Millis }
  | { ok: false; conflict: SyncEnvelope }
  | { ok: false; sessionChanged: true; session: string | null };

/** Korean, user-facing message for a failure kind. */
const MESSAGES: Record<SyncErrorKind, string> = {
  unconfigured: '동기화 주소가 설정되지 않았어요',
  network: '서버에 연결할 수 없어요',
  auth: '토큰이 올바르지 않아요',
  server: '서버가 오류를 돌려줬어요',
  parse: '서버 응답을 이해할 수 없어요',
  locked: '보관된 세션이라 저장되지 않아요 (읽기 전용)',
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
  if (response.status === 423) {
    return new SyncError('locked', MESSAGES.locked, response.status);
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

/** The session id in a body, or `null` — junk and absence are the same thing. */
const readSession = (body: unknown): string | null => {
  const value = isRecord(body) ? body.session : null;
  return isValidSessionId(value) ? value : null;
};

/**
 * The 공지 in a body (M47), or `null`.
 *
 * `null` for a body that has no `notice` key **and** for one whose `notice` is
 * explicitly null — "the administrator took the notice down" and "this server
 * has never heard of notices" reach the banner as the same absence, which is
 * the only reading under which a pre-M47 server behaves like it always did.
 */
export function readNotice(body: unknown): ServerNotice | null {
  const raw = isRecord(body) ? body.notice : null;
  if (!isRecord(raw)) return null;
  const text = typeof raw.text === 'string' ? raw.text.trim() : '';
  if (text === '') return null;
  return { text, at: typeof raw.at === 'number' ? raw.at : 0 };
}

/** The per-session profile overrides in a body (M47), or `null`. */
export function readProfileOverrides(body: unknown): ProfileOverrides | null {
  const raw = isRecord(body) ? body.profiles : null;
  if (!isRecord(raw)) return null;

  const out: ProfileOverrides = {};
  for (const [id, value] of Object.entries(raw)) {
    if (!isRecord(value)) continue;
    const label = typeof value.label === 'string' ? value.label.trim() : '';
    const avatar = typeof value.avatar === 'string' ? value.avatar.trim() : '';
    // An override that overrides nothing is not stored: the defaults must stay
    // the defaults, byte for byte, on a server that has never been edited.
    if (label === '' && avatar === '') continue;
    out[id] = { ...(label ? { label } : {}), ...(avatar ? { avatar } : {}) };
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Narrows a raw body to {@link SyncMeta}, or throws `SyncError('parse')`. */
function asMeta(body: unknown, status: number): SyncMeta {
  if (!isRecord(body) || typeof body.version !== 'number') {
    throw new SyncError('parse', MESSAGES.parse, status);
  }
  const session = readSession(body);
  return {
    version: body.version,
    updatedAt: typeof body.updatedAt === 'number' ? body.updatedAt : 0,
    ...(session ? { session } : {}),
    locked: body.locked === true,
    notice: readNotice(body),
    profiles: readProfileOverrides(body),
    restoredAt: typeof body.restoredAt === 'number' ? body.restoredAt : 0,
  };
}

/**
 * The `Record<Id, …>` maps a workspace carries.
 *
 * `memos` (M21) is optional and simply absent from a pre-M21 payload, which
 * both users of this list already handle: the presence check below only runs
 * on keys that are there, and the `[]`-flattening shim only rewrites a value
 * that actually arrived as an empty array.
 */
const ENTITY_MAPS = ['trips', 'sheets', 'columns', 'cards', 'days', 'entries', 'memos'] as const;

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
 * The full server copy plus the session it belongs to (M46).
 *
 * The session survives a 404 on purpose — see {@link WorkspaceFetch}. A body
 * that cannot be parsed at all on the 404 path is not an error either: an
 * unknown session simply means "this server does not do sessions", which is the
 * pre-M46 behaviour the engine already knows how to handle.
 */
export async function fetchWorkspace(
  settings: SyncSettings = loadSettings(),
): Promise<WorkspaceFetch> {
  requireConfigured(settings);
  const response = await request(endpoint(settings), settings, { method: 'GET' });

  if (response.status === 404) {
    let session: string | null = null;
    try {
      session = readSession(await response.json());
    } catch {
      /* pre-M46 servers answer a bare {"error":"not_found"} */
    }
    return { session, envelope: null };
  }
  if (!response.ok) throw statusError(response);

  const envelope = asEnvelope(await parseJson(response), response.status);
  return { session: envelope.session ?? null, envelope };
}

/**
 * The full server copy, or `null` when the server has no workspace yet — a
 * fresh NAS answers 404, and the engine treats that as "push mine as v1".
 *
 * Kept as the plain shape for callers that have no interest in sessions; the
 * engine uses {@link fetchWorkspace} because it very much does.
 */
export async function fetchAll(settings: SyncSettings = loadSettings()): Promise<SyncEnvelope | null> {
  return (await fetchWorkspace(settings)).envelope;
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
  sessionId: string = loadServerSession(),
): Promise<PushResult> {
  requireConfigured(settings);
  const response = await request(endpoint(settings), settings, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      // 세션 오염 방지 (M46): the server refuses this write outright if the
      // administrator has since moved everyone somewhere else. Saying which
      // workspace an edit was built on is the client's whole share of that
      // guarantee — the enforcement is deliberately on the far side.
      'X-Session': sessionId,
    },
    body: JSON.stringify({ baseVersion, data }),
  });

  if (response.status === 409) {
    const body = await parseJson(response);
    // Two different 409s. A version conflict hands back a workspace to merge;
    // `session_changed` hands back an id, and merging is precisely what must
    // not happen — the local copy belongs to a different trip entirely.
    if (isRecord(body) && body.error === 'session_changed') {
      return { ok: false, sessionChanged: true, session: readSession(body) };
    }
    return { ok: false, conflict: asEnvelope(body, response.status) };
  }
  if (!response.ok) throw statusError(response);

  const meta = asMeta(await parseJson(response), response.status);
  return { ok: true, version: meta.version, updatedAt: meta.updatedAt };
}
