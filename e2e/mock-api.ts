import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * In-memory stand-in for `server/data.php`, `server/ai.php` **and**
 * `server/image.php`, used by the sync, AI and photo-sync e2e specs.
 *
 * It implements the *same* contracts, byte for byte, so the browser code under
 * test cannot tell the difference:
 *
 *   /data.php  GET  ?meta=1  → 200 {version, updatedAt}
 *              GET           → 200 {version, updatedAt, data} | 404 {error}
 *              PUT           → 200 {version, updatedAt} | 409 {version, …, data}
 *   /ai.php    GET  ?ping=1  → 200 {ok:true, ai:true|false}
 *              POST          → 200 <a canned Gemini generateContent body>
 *   /image.php GET  ?id=     → 200 image/jpeg <bytes> | 404 {error}
 *              PUT  ?id=     → 200 {ok:true}          | 413 {error}
 *              DELETE ?id=   → 200 {ok:true}   (idempotent, as in the original)
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

/** How the mock answers a 장소 검색 call (M28). */
export type MockPlaceMode = 'ok' | 'empty' | 'error';

/** One candidate the mock can hand back, shaped like `PLACES_SCHEMA` (M36). */
export interface MockPlace {
  name: string;
  localName?: string;
  locality?: string;
  lat: number;
  lng: number;
}

/** A hand-written 장소 검색 answer for one query (M36). */
export interface MockPlaceAnswer {
  places: MockPlace[];
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
  /**
   * How many `GET ?meta=1` probes have been answered (M22).
   *
   * The version poll's whole promise is that it costs one number, so the specs
   * need to see both halves of that: the probes really happen, and a probe
   * that finds nothing new really does not turn into a write.
   */
  metaReads: () => number;
  /** How many PUTs have been attempted at all — 200s and 409s alike. */
  puts: () => number;
  /** Every `POST /ai.php` body the mock has seen, oldest first. */
  aiCalls: () => MockAiCall[];
  /** What `GET /ai.php?ping=1` reports. Flip it to test the no-key path. */
  setAiAvailable: (available: boolean) => void;
  /**
   * How the AI half answers a 장소 검색 call (M28).
   *
   * `'ok'` hands back {@link CANNED_PLACES}; `'empty'` an empty list (which is
   * what makes the client try once more with grounding, and then fall back to
   * Nominatim); `'error'` a 502, the shape `ai.php` uses for a failed upstream.
   */
  setAiPlaceMode: (mode: MockPlaceMode) => void;
  /**
   * Answers 장소 검색 differently for one query (M36).
   *
   * `needle` is matched against the prompt, whose first line is always
   * `찾는 장소: <query>` — so the card title is enough to pick a card out. A
   * registered query beats {@link MockApi.setAiPlaceMode}; everything else
   * still gets the global answer. `reset()` clears the lot.
   */
  setAiPlacesFor: (needle: string, answer: MockPlaceMode | MockPlaceAnswer) => void;
  /** How many photos `image.php` is currently holding. */
  photoCount: () => number;
  /** Is this photo id stored? */
  hasPhoto: (id: string) => boolean;
  /** Wipes the stored workspace, the photos and the counters. */
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

/**
 * Two 장소 검색 candidates matching `PLACES_SCHEMA` (M28).
 *
 * 「츠텐카쿠」 is exactly the case the feature exists for: Nominatim has no such
 * string, and the row only becomes checkable because 通天閣 is on it. The second
 * row deliberately has no `localName`, so the "그 줄만 없다" rendering path is
 * exercised too.
 */
const CANNED_PLACES = {
  places: [
    {
      name: '통천각',
      localName: '通天閣',
      locality: '오사카',
      lat: 34.6525,
      lng: 135.5063,
    },
    { name: '신세카이 상점가', locality: '오사카', lat: 34.6519, lng: 135.5057 },
  ],
};

/** The marker `buildPlacesPrompt` always leads with — how the mock spots one. */
const PLACE_PROMPT_MARKER = '찾는 장소:';

const CANNED_REVIEW = [
  '- 첫날 오전에 일정이 세 개 겹쳐 있어요. 하나를 오후로 옮기면 숨통이 트여요.',
  '- 난바에서 우메다로 갔다가 다시 난바로 돌아와요. 순서를 묶으면 이동이 한 번 줄어요.',
  '- 14:00~17:00이 비어 있어요. 근처 카페나 상점가를 넣어 두면 좋아요.',
].join('\n');

const CANNED_ANSWER =
  '비 오는 날에는 우메다 스카이빌딩 실내 전망대와 가이유칸 수족관을 추천해요. 둘 다 지하철역에서 바로 이어져요.';

const MAX_BODY_BYTES = 10 * 1024 * 1024;

/** `image.php`'s own, much smaller ceiling. */
const MAX_PHOTO_BYTES = 600 * 1024;

/** Ids `image.php` will accept. Same pattern, so a bad id fails the same way. */
const ID_PATTERN = /^[A-Za-z0-9_-]{6,64}$/;

/** Reads a raw request body up to `limit`, or `null` when it overflows. */
function readRaw(req: IncomingMessage, limit: number): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let aborted = false;

    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        aborted = true;
        resolve(null);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!aborted) resolve(Buffer.concat(chunks));
    });
    req.on('error', () => resolve(null));
  });
}

/** Reads a request body with the same 10 MB ceiling `data.php` enforces. */
async function readBody(req: IncomingMessage): Promise<string | null> {
  const raw = await readRaw(req, MAX_BODY_BYTES);
  return raw === null ? null : raw.toString('utf8');
}

/** Starts the mock on an ephemeral port. */
export async function startMockApi(token = 'e2e-token'): Promise<MockApi> {
  let stored: MockEnvelope | null = null;
  let conflicts = 0;
  let metaReads = 0;
  let puts = 0;
  let aiAvailable = true;
  let aiPlaceMode: MockPlaceMode = 'ok';
  /** 검색어(프롬프트 조각) → 그 검색어에만 주는 답 (M36). */
  const placeOverrides = new Map<string, MockPlaceMode | MockPlaceAnswer>();
  let aiCalls: MockAiCall[] = [];
  /** `image.php`'s disk: photo id → the JPEG bytes. */
  const photos = new Map<string, Buffer>();

  const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'X-Sync-Token, Content-Type',
    'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS',
  } as const;

  const send = (res: ServerResponse, status: number, payload: unknown): void => {
    const body = JSON.stringify(payload);
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...CORS,
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
    const isImage = url.pathname.endsWith('/image.php');
    if (!isAi && !isImage && !url.pathname.endsWith('/data.php')) {
      send(res, 404, { error: 'not_found' });
      return;
    }
    // Auth first, for every endpoint — `ai.php` guards its ping too, so an
    // unauthenticated scan cannot learn whether a key is configured, and
    // `image.php` guards everything so nobody browses the trip's photos.
    if (req.headers['x-sync-token'] !== token) {
      send(res, 401, { error: 'unauthorized' });
      return;
    }

    /* --- image.php ---------------------------------------------------- */
    if (isImage) {
      const id = url.searchParams.get('id') ?? '';
      if (!ID_PATTERN.test(id)) {
        send(res, 400, { error: 'bad_request' });
        return;
      }

      if (req.method === 'GET' || req.method === 'HEAD') {
        const bytes = photos.get(id);
        if (!bytes) {
          send(res, 404, { error: 'not_found' });
          return;
        }
        res.writeHead(200, {
          'Content-Type': 'image/jpeg',
          // The header that matters: the PHP original marks a photo immutable
          // for a year, and the browser under test caches it accordingly.
          'Cache-Control': 'private, max-age=31536000, immutable',
          ...CORS,
          'Content-Length': bytes.length,
        });
        res.end(req.method === 'HEAD' ? undefined : bytes);
        return;
      }

      if (req.method === 'PUT') {
        void readRaw(req, MAX_PHOTO_BYTES).then((body) => {
          if (body === null) {
            send(res, 413, { error: 'payload_too_large' });
            return;
          }
          if (body.length === 0) {
            send(res, 400, { error: 'bad_request' });
            return;
          }
          // Idempotent overwrite, exactly like the atomic rename in the
          // original: an id's bytes never change, so a retry is a no-op.
          photos.set(id, body);
          send(res, 200, { ok: true });
        });
        return;
      }

      if (req.method === 'DELETE') {
        // 200 whether or not it was there — two devices sweeping the same
        // tombstone must not turn the loser into an error.
        photos.delete(id);
        send(res, 200, { ok: true });
        return;
      }

      send(res, 405, { error: 'method_not_allowed' });
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

        // 장소 검색 (M28) rides on `ask`, so the prompt is what identifies it —
        // and it stays identifiable on the grounded retry, where `ai.php` has
        // dropped the schema.
        if (typeof parsed.prompt === 'string' && parsed.prompt.includes(PLACE_PROMPT_MARKER)) {
          // 검색어별 답이 등록돼 있으면 그것이 이긴다 (M36) — 여러 카드를 한 번에
          // 훑는 스펙은 카드마다 다른 답을 받아야 한다.
          const override = [...placeOverrides].find(([needle]) =>
            (parsed.prompt as string).includes(needle),
          )?.[1];
          const answer = override ?? aiPlaceMode;

          if (answer === 'error') {
            send(res, 502, { error: 'upstream_error', detail: 'HTTP 500 — mock' });
            return;
          }
          const body =
            answer === 'empty' ? { places: [] } : answer === 'ok' ? CANNED_PLACES : answer;
          send(res, 200, geminiText([JSON.stringify(body)]));
          return;
        }

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
        metaReads += 1;
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
    // Counted before the body is even read: what the poll specs assert is that
    // no write was *attempted*, not that one was attempted and rejected.
    puts += 1;

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
    metaReads: () => metaReads,
    puts: () => puts,
    aiCalls: () => aiCalls,
    setAiAvailable: (available: boolean) => {
      aiAvailable = available;
    },
    setAiPlaceMode: (mode: MockPlaceMode) => {
      aiPlaceMode = mode;
    },
    setAiPlacesFor: (needle: string, answer: MockPlaceMode | MockPlaceAnswer) => {
      placeOverrides.set(needle, answer);
    },
    photoCount: () => photos.size,
    hasPhoto: (id: string) => photos.has(id),
    reset: () => {
      stored = null;
      conflicts = 0;
      metaReads = 0;
      puts = 0;
      aiCalls = [];
      aiAvailable = true;
      aiPlaceMode = 'ok';
      placeOverrides.clear();
      photos.clear();
    },
    stop: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
