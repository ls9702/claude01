/**
 * Client for `server/ai.php` — the only door between this app and Gemini (M11).
 *
 * Shaped after `sync/api.ts` on purpose: same base URL, same `X-Sync-Token`,
 * same Latin-1 guard, same "every failure is one typed error with a Korean
 * message" rule. What is different is what a failure *means*: sync failing is
 * an emergency, AI failing is a shrug — so nothing here touches global state or
 * schedules a retry. The caller shows a line of text and the user moves on.
 *
 * | call                     | request                        |
 * | ------------------------ | ------------------------------ |
 * | {@link pingAi}           | `GET  <base>/ai.php?ping=1`    |
 * | {@link callAi}           | `POST <base>/ai.php`           |
 *
 * The API key is never in any of this. It is read by `ai.php` from `config.php`
 * and put into the *upstream* URL, server-side.
 */

import { loadSettings, normalizeBaseUrl, isConfigured, type SyncSettings } from '../sync/settings';
import { useAiStore } from './aiSettings';

/** How long one AI request may take. Grounded answers are genuinely slow. */
export const AI_TIMEOUT_MS = 35_000;

/** How long the capability ping may take. It is one tiny GET. */
export const PING_TIMEOUT_MS = 8_000;

/** The three things `ai.php` will answer. */
export type AiKind = 'suggest' | 'review' | 'ask';

/** Why an AI call failed. */
export type AiErrorKind =
  /** The toggle is off, sync is unconfigured, or the server has no key. */
  | 'unavailable'
  /** Transport died: offline, DNS, TLS, timeout. */
  | 'network'
  /** 401 — the sync token is wrong. */
  | 'auth'
  /** 429 — the proxy's per-minute fuse blew. */
  | 'rate'
  /** Any other non-2xx, including 502 from a failed upstream call. */
  | 'server'
  /** 2xx whose body was not something we could read an answer out of. */
  | 'parse';

/** Korean, user-facing message per failure kind. */
export const AI_MESSAGES: Record<AiErrorKind, string> = {
  unavailable: 'AI 기능을 쓸 수 없어요',
  network: 'AI 서버에 연결할 수 없어요',
  auth: '토큰이 올바르지 않아요',
  rate: '요청이 너무 많아요 — 잠시 후 다시',
  server: 'AI 서버가 오류를 돌려줬어요',
  parse: 'AI 응답을 이해하지 못했어요',
};

/** Typed failure from {@link callAi}. */
export class AiError extends Error {
  kind: AiErrorKind;
  /** HTTP status, or `0` when the request never got a response. */
  status: number;

  constructor(kind: AiErrorKind, message: string = AI_MESSAGES[kind], status = 0) {
    super(message);
    this.name = 'AiError';
    this.kind = kind;
    this.status = status;
  }
}

/** One source Gemini says it consulted, when grounding was on. */
export interface AiCitation {
  title: string;
  uri: string;
}

/** What one AI call produced. */
export interface AiResult {
  /** Every text part of the first candidate, joined. */
  text: string;
  /** The parsed object, when a `schema` was sent. */
  json?: unknown;
  /** Grounding sources; `[]` whenever the answer was not grounded. */
  citations: AiCitation[];
}

/** What to ask for. `schema` and `grounding` are mutually exclusive upstream. */
export interface AiRequest {
  prompt: string;
  /** `systemInstruction` — the standing rules for this kind of answer. */
  system?: string;
  /** A Gemini `responseSchema`; forces `application/json` output. */
  schema?: object;
  /** Turn on the `google_search` tool. Beats `schema` if both are given. */
  grounding?: boolean;
}

/** Same guard `sync/api.ts` needs — a header value must be Latin-1. */
const LATIN1_ONLY = /^[\u0020-\u00ff]*$/;

const endpoint = (settings: SyncSettings, query = ''): string =>
  `${normalizeBaseUrl(settings.baseUrl)}/ai.php${query}`;

function timeoutSignal(ms: number): AbortSignal | undefined {
  try {
    return AbortSignal.timeout?.(ms);
  } catch {
    return undefined;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/* ------------------------------------------------------------------ *
 * Capability
 * ------------------------------------------------------------------ */

/**
 * One ping: does the server behind the sync URL have a Gemini key?
 *
 * **Never throws.** Any failure at all — unconfigured, offline, 401, a
 * `data.php`-only server that answers 404 for `ai.php`, an HTML error page —
 * is the same answer: no AI here. That is what makes it safe to call on every
 * app start, including on GitHub Pages where there is no server at all.
 */
export async function pingAi(
  settings: SyncSettings = loadSettings(),
): Promise<{ available: boolean }> {
  if (!isConfigured(settings) || !LATIN1_ONLY.test(settings.token)) {
    return { available: false };
  }

  try {
    const response = await fetch(endpoint(settings, '?ping=1'), {
      method: 'GET',
      headers: { 'X-Sync-Token': settings.token, Accept: 'application/json' },
      signal: timeoutSignal(PING_TIMEOUT_MS),
      cache: 'no-store',
      credentials: 'omit',
    });
    if (!response.ok) return { available: false };
    const body: unknown = await response.json();
    return { available: isRecord(body) && body.ok === true && body.ai === true };
  } catch {
    return { available: false };
  }
}

/**
 * Pings and writes the result into the store — the "one ping" of the design.
 *
 * Called on app start (post-hydration), whenever the sync settings are saved
 * or cleared, and when the toggle is switched on. Nothing else re-checks: a
 * server that gains a key mid-session is not a case worth polling for.
 */
export async function refreshAiCapability(): Promise<boolean> {
  const { available } = await pingAi();
  useAiStore.getState().setAvailable(available);
  return available;
}

/** Toggle **and** sync configured **and** a key on the server. */
export function aiEnabled(): boolean {
  const { enabled, available } = useAiStore.getState();
  return enabled && available && isConfigured();
}

/* ------------------------------------------------------------------ *
 * Reading Gemini's answer
 * ------------------------------------------------------------------ */

/**
 * Every `text` part of the first candidate, joined.
 *
 * A model answer can arrive as several parts (and a grounded one usually
 * does); taking `parts[0]` alone silently truncates it.
 */
function extractText(body: unknown): string {
  if (!isRecord(body)) return '';
  const candidates = body.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return '';
  const content = isRecord(candidates[0]) ? candidates[0].content : null;
  const parts = isRecord(content) ? content.parts : null;
  if (!Array.isArray(parts)) return '';

  return parts
    .map((part) => (isRecord(part) && typeof part.text === 'string' ? part.text : ''))
    .filter((text) => text !== '')
    .join('')
    .trim();
}

/** `groundingMetadata.groundingChunks[].web` → `{title, uri}`, deduped by uri. */
function extractCitations(body: unknown): AiCitation[] {
  if (!isRecord(body)) return [];
  const candidates = body.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return [];
  const meta = isRecord(candidates[0]) ? candidates[0].groundingMetadata : null;
  const chunks = isRecord(meta) ? meta.groundingChunks : null;
  if (!Array.isArray(chunks)) return [];

  const seen = new Set<string>();
  const citations: AiCitation[] = [];
  for (const chunk of chunks) {
    const web = isRecord(chunk) ? chunk.web : null;
    if (!isRecord(web)) continue;
    const uri = typeof web.uri === 'string' ? web.uri : '';
    if (!uri || seen.has(uri)) continue;
    seen.add(uri);
    citations.push({ uri, title: typeof web.title === 'string' && web.title ? web.title : uri });
  }
  return citations;
}

/**
 * Strips a ```json fence if the model wrapped its JSON in one.
 *
 * `responseMimeType: 'application/json'` is supposed to make this impossible.
 * It is one regex against a class of failure that would otherwise read as
 * "AI 응답을 이해하지 못했어요" for an answer that was perfectly fine.
 */
export function stripFences(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i.exec(trimmed);
  return (fenced ? fenced[1] : trimmed).trim();
}

/* ------------------------------------------------------------------ *
 * The call
 * ------------------------------------------------------------------ */

/**
 * One `generateContent` round trip through the proxy.
 *
 * Guarded: it throws `AiError('unavailable')` rather than reaching the network
 * when {@link aiEnabled} is false, so a stray call from a component that
 * forgot to hide itself cannot leak a request off a GitHub Pages build.
 */
export async function callAi(kind: AiKind, request: AiRequest): Promise<AiResult> {
  if (!aiEnabled()) throw new AiError('unavailable');

  const settings = loadSettings();
  if (!LATIN1_ONLY.test(settings.token)) {
    throw new AiError('auth', '토큰에 쓸 수 없는 문자가 있어요 (영문·숫자·기호만)');
  }

  // Grounding and a schema cannot travel together — `ai.php` enforces it too,
  // but sending both would be asking the server to guess what we meant.
  const grounding = request.grounding === true;
  const body = JSON.stringify({
    kind,
    prompt: request.prompt,
    ...(request.system ? { system: request.system } : {}),
    ...(grounding ? { grounding: true } : request.schema ? { schema: request.schema } : {}),
  });

  let response: Response;
  try {
    response = await fetch(endpoint(settings), {
      method: 'POST',
      headers: {
        'X-Sync-Token': settings.token,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body,
      signal: timeoutSignal(AI_TIMEOUT_MS),
      cache: 'no-store',
      credentials: 'omit',
    });
  } catch (err) {
    const error = new AiError('network');
    error.cause = err;
    throw error;
  }

  if (response.status === 429) throw new AiError('rate', AI_MESSAGES.rate, 429);
  if (response.status === 401 || response.status === 403) {
    throw new AiError('auth', AI_MESSAGES.auth, response.status);
  }
  if (!response.ok) {
    // ai.php's 5xx carries a `detail` naming the real upstream cause (e.g. a
    // rejected API key). Surfacing it turns "HTTP 502" from a dead end into a
    // fixable message; swallow any body-read failure and fall back to the code.
    let detail = '';
    try {
      const body = (await response.json()) as { detail?: unknown } | null;
      if (typeof body?.detail === 'string') detail = body.detail.slice(0, 200);
    } catch {
      /* body unreadable — keep the generic message */
    }
    throw new AiError(
      'server',
      `${AI_MESSAGES.server} (HTTP ${response.status}${detail ? ` · ${detail}` : ''})`,
      response.status,
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new AiError('parse', AI_MESSAGES.parse, response.status);
  }

  const text = extractText(payload);
  if (!text) throw new AiError('parse', AI_MESSAGES.parse, response.status);

  const result: AiResult = { text, citations: extractCitations(payload) };

  // Only a schema'd call promised JSON, so only a schema'd call is held to it.
  if (request.schema && !grounding) {
    try {
      result.json = JSON.parse(stripFences(text));
    } catch {
      throw new AiError('parse', AI_MESSAGES.parse, response.status);
    }
  }

  return result;
}
