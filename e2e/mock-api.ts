import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * In-memory stand-in for `server/data.php` **and** `server/ai.php`, used by the
 * sync and AI e2e specs.
 *
 * It implements the *same* contracts, byte for byte, so the browser code under
 * test cannot tell the difference:
 *
 *   /data.php  GET  ?meta=1  → 200 {version, updatedAt}
 *              GET           → 200 {version, updatedAt, data} | 404 {error}
 *              PUT           → 200 {version, updatedAt} | 409 {version, …, data}
 *   /ai.php    GET  ?ping=1  → 200 {ok:true, ai:true|false}
 *              POST          → 200 <a canned Gemini generateContent body>
 *   any        → 401 without a matching `X-Sync-Token`
 *
 * The AI half answers with **canned Gemini-shaped bodies**, not with Gemini:
 * an e2e run must not depend on a network, a key or a model's mood. What is
 * exercised is everything between the button and the proxy — the capability
 * ping, the request shape, the `candidates[0].content.parts[].text` unwrapping,
 * the JSON-schema parse, and the grounding citations.
 *
 * It is started per-spec from `test.beforeAll` rather than being wired into
 * Playwright's `webServer`, because only two specs need it and a global server
 * would leak state between the others.
 *
 * CORS *is* enabled here (unlike the PHP original, which is same-origin only):
 * the page under test is served from the preview server on another port, so
 * without it every request would fail preflight.
 */

/** Same envelope shape the PHP endpoint stores. */
export interface MockEnvelope {
  version: number;
  updatedAt: number;
  data: unknown;
}

/** One request the AI half of the mock answered. */
export interface MockAiCall {
  kind: string;
  prompt: string;
  system?: string;
  schema?: unknown;
  grounding?: boolean;
}

/** Handle returned by {@link startMockApi}. */
export interface MockApi {
  /** Base URL to paste into the app's 서버 주소 field, e.g. `http://127.0.0.1:53210`. */
  baseUrl: string;
  /** Token the server expects in `X-Sync-Token`. */
  token: string;
  /** Current version counter — `0` until the first successful push. */
  version: () => number;
  /** The stored workspace, or `null` before the first push. */
  data: () => unknown;
  /** How many PUTs have been answered with 409. */
  conflicts: () => number;
  /** Every `POST /ai.php` body the mock has seen, oldest first. */
  aiCalls: () => MockAiCall[];
  /** What `GET /ai.php?ping=1` reports. Flip it to test the no-key path. */
  setAiAvailable: (available: boolean) => void;
  /** Wipes the stored workspace and counters. */
  reset: () => void;
  stop: () => Promise<void>;
}

/** Wraps text the way `generateContent` does, so the client unwraps it for real. */
function geminiText(parts: string[], groundingChunks?: { title: string; uri: string }[]): unknown {
  const candidate: Record<string, unknown> = {
    content: { role: 'model', parts: parts.map((text) => ({ text })) },
    finishReason: 'STOP',
  };
  if (groundingChunks) {
    candidate.groundingMetadata = {
      webSearchQueries: ['오사카 비 오는 날'],
      groundingChunks: groundingChunks.map((web) => ({ web })),
    };
  }
  return { candidates: [candidate], modelVersion: 'gemini-2.0-flash' };
}

/**
 * Three suggestions matching `SUGGEST_SCHEMA`.
 *
 * `식사` is one of the five seeded column names, so it exercises the "matched
 * an existing column" path; `야시장` matches nothing and must fall back to the
 * first column rather than being dropped.
 */
const CANNED_SUGGESTIONS = {
  suggestions: [
    {
      title: '이치란 라멘 도톤보리',
      columnName: '식사',
      memo: '혼자서도 편한 칸막이 자리',
      durationMin: 45,
      budget: 12000,
    },
    {
      title: '건담 베이스 오사카',
      columnName: '볼거리',
      memo: '실물 크기 프라모델 전시',
      durationMin: 90,
      budget: 0,
    },
    { title: '야시장 구경', columnName: '없는칸', memo: '저녁에 걷기 좋아요' },
  ],
};

const CANNED_REVIEW = [
  '- 첫날 오전에 일정이 세 개 겹쳐 있어요. 하나를 오후로 옮기면 숨통이 트여요.',
  '- 난바에서 우메다로 갔다가 다시 난바로 돌아와요. 순서를 묶으면 이동이 한 번 줄어요.',
  '- 14:00~17:00이 비어 있어요. 근처 카페나 상점가를 넣어 두면 좋아요.',
].join('\n');

const CANNED_ANSWER =
  '비 오는 날에는 우메다 스카이빌딩 실내 전망대와 가이유칸 수족관을 추천해요. 둘 다 지하철역에서 바로 이어져요.';

const MAX_BODY_BYTES = 10 * 1024 * 1024;

/** Reads a request body with the same 10 MB ceiling `data.php` enforces. */
function readBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let aborted = false;

    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        aborted = true;
        resolve(null);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!aborted) resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', () => resolve(null));
  });
}

/** Starts the mock on an ephemeral port. */
export async function startMockApi(token = 'e2e-token'): Promise<MockApi> {
  let stored: MockEnvelope | null = null;
  let conflicts = 0;
  let aiAvailable = true;
  let aiCalls: MockAiCall[] = [];

  const send = (res: ServerResponse, status: number, payload: unknown): void => {
    const body = JSON.stringify(payload);
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'X-Sync-Token, Content-Type',
      'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS',
      'Content-Length': Buffer.byteLength(body),
    });
    res.end(body);
  };

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');

    if (req.method === 'OPTIONS') {
      send(res, 204, {});
      return;
    }
    const isAi = url.pathname.endsWith('/ai.php');
    if (!isAi && !url.pathname.endsWith('/data.php')) {
      send(res, 404, { error: 'not_found' });
      return;
    }
    // Auth first, for both endpoints — `ai.php` guards its ping too, so an
    // unauthenticated scan cannot learn whether a key is configured.
    if (req.headers['x-sync-token'] !== token) {
      send(res, 401, { error: 'unauthorized' });
      return;
    }

    if (isAi) {
      if (req.method === 'GET') {
        if (!url.searchParams.has('ping')) {
          send(res, 400, { error: 'bad_request' });
          return;
        }
        // 200 either way: "no key here" is an answer, not a failure.
        send(res, 200, { ok: true, ai: aiAvailable });
        return;
      }
      if (req.method !== 'POST') {
        send(res, 405, { error: 'method_not_allowed' });
        return;
      }

      void readBody(req).then((body) => {
        let parsed: MockAiCall;
        try {
          parsed = JSON.parse(body ?? '') as MockAiCall;
        } catch {
          send(res, 400, { error: 'bad_request' });
          return;
        }
        aiCalls = [...aiCalls, parsed];

        if (parsed.kind === 'suggest') {
          // The real proxy sets `responseMimeType: application/json`, so what
          // comes back is JSON *inside* a text part — exactly as here.
          send(res, 200, geminiText([JSON.stringify(CANNED_SUGGESTIONS)]));
          return;
        }
        if (parsed.kind === 'review') {
          send(res, 200, geminiText([CANNED_REVIEW]));
          return;
        }
        // 질문. Grounding is what produces citations, and only then — two
        // parts, so the client's "join every text part" is exercised too.
        send(
          res,
          200,
          parsed.grounding
            ? geminiText([CANNED_ANSWER, ' 우산은 편의점에서 살 수 있어요.'], [
                { title: '오사카 관광 공식 사이트', uri: 'https://osaka-info.jp/' },
                { title: '가이유칸', uri: 'https://www.kaiyukan.com/' },
              ])
            : geminiText([CANNED_ANSWER]),
        );
      });
      return;
    }

    if (req.method === 'GET') {
      if (url.searchParams.has('meta')) {
        send(res, 200, { version: stored?.version ?? 0, updatedAt: stored?.updatedAt ?? 0 });
        return;
      }
      if (!stored) {
        send(res, 404, { error: 'not_found' });
        return;
      }
      send(res, 200, stored);
      return;
    }

    if (req.method !== 'PUT') {
      send(res, 405, { error: 'method_not_allowed' });
      return;
    }

    void readBody(req).then((body) => {
      if (body === null) {
        send(res, 413, { error: 'payload_too_large' });
        return;
      }

      let parsed: { baseVersion?: unknown; data?: unknown };
      try {
        parsed = JSON.parse(body) as typeof parsed;
      } catch {
        send(res, 400, { error: 'bad_request' });
        return;
      }

      const baseVersion = parsed.baseVersion;
      const data = parsed.data as Record<string, unknown> | undefined;
      if (typeof baseVersion !== 'number' || !data || data.schemaVersion !== 1) {
        send(res, 400, { error: 'bad_request' });
        return;
      }

      const currentVersion = stored?.version ?? 0;
      if (baseVersion !== currentVersion) {
        conflicts += 1;
        send(res, 409, {
          version: currentVersion,
          updatedAt: stored?.updatedAt ?? 0,
          data: stored?.data ?? {
            schemaVersion: 1,
            trips: {},
            sheets: {},
            columns: {},
            cards: {},
            days: {},
            entries: {},
            tombstones: [],
          },
        });
        return;
      }

      stored = { version: currentVersion + 1, updatedAt: Date.now(), data };
      send(res, 200, { version: stored.version, updatedAt: stored.updatedAt });
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    token,
    version: () => stored?.version ?? 0,
    data: () => stored?.data ?? null,
    conflicts: () => conflicts,
    aiCalls: () => aiCalls,
    setAiAvailable: (available: boolean) => {
      aiAvailable = available;
    },
    reset: () => {
      stored = null;
      conflicts = 0;
      aiCalls = [];
      aiAvailable = true;
    },
    stop: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
