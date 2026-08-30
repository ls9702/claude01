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
 *   /admin.php GET           → 200 {ok, active, sessions, archive, notice, …}
 *              POST {action} → 200 the same body       | 401 without X-Admin-Token
 *   /archive.php GET ?check=1 → 200 {ok, writable, folder}
 *              POST ?name=   → 200 {ok, path, bytes}   | 400 {error}
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
  /**
   * Answers the 주소 되묻기 call for one place (M37).
   *
   * That call is the grounded second stage of the refine pipeline: it fires
   * only when the name snap missed, and it asks for a street address rather
   * than for coordinates. `needle` is matched against the prompt, whose first
   * line is always `주소 확인 장소: <local name>`. Anything not registered here
   * gets "I am not sure" — which the client's parser reads as no address, so
   * the AI coordinates survive untouched. `'error'` answers a 502.
   */
  setAiAddressFor: (needle: string, answer: string | 'error') => void;
  /** The admin token the mock's `/admin.php` expects (M46). */
  adminToken: string;
  /** Which session `/data.php` is serving right now. */
  session: () => string;
  /**
   * Switches the active session **server-side**, the way the admin screen does.
   *
   * A spec that wants to prove a client notices the switch must be able to make
   * one happen without going through the sheet — that is a different assertion.
   */
  setSession: (id: string) => void;
  /** 보관 (M47): the active session refuses PUTs with 423. */
  setLocked: (locked: boolean) => void;
  /** 공지 (M47): what `?meta=1` carries, or `null` to take it down. */
  setNotice: (text: string | null) => void;
  /** How many PUTs have been refused with 409 `session_changed` (M46). */
  sessionRejects: () => number;
  /** Every photo filed through `/archive.php`, newest last (M46). */
  archived: () => { name: string; bytes: number }[];
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

/** The same, for `buildAddressPrompt`'s grounded 주소 되묻기 call (M37). */
const ADDRESS_PROMPT_MARKER = '주소 확인 장소:';

/** What the model says when it has no address to give — no 번지, so no address. */
const NO_ADDRESS_ANSWER = '확실하지 않아서 정확한 주소를 알려 드리기 어려워요.';

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
/** One session's worth of storage inside the mock (M46). */
interface MockSession {
  id: string;
  label: string;
  archived: boolean;
  stored: MockEnvelope | null;
  photos: Map<string, Buffer>;
  /** `YYYYMMDD` → the envelope that day's first save preserved (M30/M47). */
  daily: Map<string, MockEnvelope>;
  profiles: Record<string, { label?: string; avatar?: string }>;
  /** When the administrator last restored this session (M47). `0` = never. */
  restoredAt: number;
}

const newSession = (id: string, label = ''): MockSession => ({
  id,
  label,
  archived: false,
  stored: null,
  photos: new Map(),
  daily: new Map(),
  profiles: {},
  restoredAt: 0,
});

export async function startMockApi(
  token = 'e2e-token',
  adminToken = 'e2e-admin',
): Promise<MockApi> {
  /**
   * 세션 (M46). `default` exists from the start and is active, which is exactly
   * what a pre-M46 NAS looks like after `data.php` has migrated it — so every
   * spec written before this milestone sees no difference at all.
   */
  const sessions = new Map<string, MockSession>([['default', newSession('default')]]);
  let active = 'default';
  let sessionRejects = 0;
  let notice: { text: string; at: number } | null = null;
  let archiveFolder = '';
  const archivedPhotos: { name: string; bytes: number }[] = [];

  /** The active session — always present; `active` is only ever set to a real id. */
  const current = (): MockSession => sessions.get(active) ?? newSession(active);

  let conflicts = 0;
  let metaReads = 0;
  let puts = 0;
  let aiAvailable = true;
  let aiPlaceMode: MockPlaceMode = 'ok';
  /** 검색어(프롬프트 조각) → 그 검색어에만 주는 답 (M36). */
  const placeOverrides = new Map<string, MockPlaceMode | MockPlaceAnswer>();
  /** 장소(프롬프트 조각) → 주소 되묻기에 주는 답 (M37). */
  const addressOverrides = new Map<string, string | 'error'>();
  let aiCalls: MockAiCall[] = [];

  const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'X-Sync-Token, X-Session, X-Admin-Token, Content-Type',
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

  /** `archive.php`'s filename rule, in miniature — see `archive/archiveFiles`. */
  const safeArchiveName = (raw: string): string | null => {
    const base = (raw.split(/[\\/]/).pop() ?? '').trim();
    const dot = base.lastIndexOf('.');
    if (dot <= 0) return null;
    const ext = base.slice(dot + 1).toLowerCase();
    if (!['jpg', 'jpeg', 'png', 'heic', 'heif', 'webp'].includes(ext)) return null;
    const stem = base.slice(0, dot).replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[._-]+|[._-]+$/g, '');
    return `${stem === '' ? 'photo' : stem}.${ext}`;
  };

  /** One session, as `admin.php` lists it. */
  const sessionRow = (item: MockSession): unknown => ({
    id: item.id,
    label: item.label,
    active: item.id === active,
    archived: item.archived,
    updatedAt: item.stored?.updatedAt ?? 0,
    dataBytes: item.stored ? JSON.stringify(item.stored).length : 0,
    photoBytes: [...item.photos.values()].reduce((sum, buf) => sum + buf.length, 0),
    photoCount: item.photos.size,
  });

  /** Every admin response is the whole state — same rule as the PHP. */
  const adminState = (): unknown => ({
    ok: true,
    active,
    sessions: [...sessions.values()].map(sessionRow),
    archive: {
      folder: archiveFolder,
      base: '/volume1/photo/trip-board',
      ready: archiveFolder !== '',
      baseExists: true,
      bytes: archivedPhotos.reduce((sum, item) => sum + item.bytes, 0),
      count: archivedPhotos.length,
    },
    usage: { diskFree: 512 * 1024 * 1024 * 1024, diskTotal: 2 * 1024 * 1024 * 1024 * 1024, at: Date.now() },
    notice,
    profiles: Object.keys(current().profiles).length > 0 ? current().profiles : null,
  });

  const SESSION_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;

  function handleAdmin(req: IncomingMessage, res: ServerResponse, url: URL): void {
    if (req.method === 'GET' || req.method === 'HEAD') {
      if (url.searchParams.get('action') === 'export') {
        const item = sessions.get(url.searchParams.get('id') ?? '');
        if (!item?.stored) {
          send(res, 404, { error: 'not_found', detail: '그 세션에는 아직 저장된 데이터가 없어요.' });
          return;
        }
        // The server's own envelope, which is what `deserializeBackup` reads —
        // so an export restores through 설정 → 가져오기 unchanged.
        send(res, 200, item.stored);
        return;
      }
      send(res, 200, adminState());
      return;
    }
    if (req.method !== 'POST') {
      send(res, 405, { error: 'method_not_allowed' });
      return;
    }

    void readBody(req).then((raw) => {
      let body: Record<string, unknown>;
      try {
        body = JSON.parse(raw ?? '') as Record<string, unknown>;
      } catch {
        send(res, 400, { error: 'bad_request' });
        return;
      }

      const action = typeof body.action === 'string' ? body.action : '';
      const id = typeof body.id === 'string' ? body.id.trim() : '';
      const label = typeof body.label === 'string' ? body.label.trim() : '';
      const needsId = ['create', 'rename', 'activate', 'lock', 'unlock', 'profiles', 'backups', 'restore'];
      if (needsId.includes(action) && !SESSION_ID.test(id)) {
        send(res, 400, { error: 'bad_id', detail: '세션 id는 영문 소문자·숫자·하이픈만 쓸 수 있어요.' });
        return;
      }

      if (action === 'create') {
        if (sessions.has(id)) {
          send(res, 409, { error: 'already_exists', detail: '같은 id의 세션이 이미 있어요.' });
          return;
        }
        sessions.set(id, newSession(id, label));
        send(res, 200, adminState());
        return;
      }

      if (action === 'rename') {
        const item = sessions.get(id) ?? newSession(id);
        item.label = label;
        sessions.set(id, item);
        send(res, 200, adminState());
        return;
      }

      if (action === 'activate') {
        if (!sessions.has(id)) {
          send(res, 404, { error: 'not_found', detail: '그런 세션이 없어요.' });
          return;
        }
        active = id;
        send(res, 200, adminState());
        return;
      }

      if (action === 'lock' || action === 'unlock') {
        const item = sessions.get(id) ?? newSession(id);
        item.archived = action === 'lock';
        sessions.set(id, item);
        send(res, 200, adminState());
        return;
      }

      if (action === 'archive-settings') {
        archiveFolder = typeof body.folder === 'string' ? body.folder.trim() : '';
        send(res, 200, adminState());
        return;
      }

      if (action === 'notice') {
        const text = typeof body.text === 'string' ? body.text.trim() : '';
        notice = text === '' ? null : { text, at: Date.now() };
        send(res, 200, adminState());
        return;
      }

      if (action === 'profiles') {
        const item = sessions.get(id) ?? newSession(id);
        const incoming = (body.profiles ?? {}) as Record<string, { label?: string; avatar?: string }>;
        const out: Record<string, { label?: string; avatar?: string }> = {};
        for (const profileId of ['song', 'hoyabom']) {
          const value = incoming[profileId];
          const nextLabel = value?.label?.trim() ?? '';
          const avatar = value?.avatar?.trim() ?? '';
          if (nextLabel || avatar) {
            out[profileId] = { ...(nextLabel ? { label: nextLabel } : {}), ...(avatar ? { avatar } : {}) };
          }
        }
        item.profiles = out;
        sessions.set(id, item);
        send(res, 200, adminState());
        return;
      }

      if (action === 'backups') {
        const item = sessions.get(id);
        send(res, 200, {
          ok: true,
          backups: [...(item?.daily.keys() ?? [])]
            .sort()
            .reverse()
            .map((date) => ({ date, bytes: JSON.stringify(item?.daily.get(date)).length })),
        });
        return;
      }

      if (action === 'restore') {
        const item = sessions.get(id);
        const date = typeof body.date === 'string' ? body.date : '';
        const snapshot = item?.daily.get(date);
        if (!item || !snapshot) {
          send(res, 404, { error: 'not_found', detail: '그 날짜의 백업이 없어요.' });
          return;
        }
        // **Forward, never back.** Clients decide whether to pull by comparing
        // version numbers; a restore that lowered the counter would be
        // invisible to every device that is already up to date.
        item.stored = {
          version: (item.stored?.version ?? 0) + 1,
          updatedAt: Date.now(),
          data: snapshot.data,
        };
        // The stamp is what makes a restore *win*: clients merge by default, so
        // without it the first device to sync would fold the removed entities
        // straight back in.
        item.restoredAt = Date.now();
        send(res, 200, adminState());
        return;
      }

      send(res, 400, { error: 'bad_request', detail: '알 수 없는 action이에요.' });
    });
  }

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');

    if (req.method === 'OPTIONS') {
      send(res, 204, {});
      return;
    }
    const isAi = url.pathname.endsWith('/ai.php');
    const isImage = url.pathname.endsWith('/image.php');
    const isAdmin = url.pathname.endsWith('/admin.php');
    const isArchive = url.pathname.endsWith('/archive.php');
    if (!isAi && !isImage && !isAdmin && !isArchive && !url.pathname.endsWith('/data.php')) {
      send(res, 404, { error: 'not_found' });
      return;
    }

    /* --- admin.php (M46/M47) ------------------------------------------ *
     * Its own secret, checked before the sync token gate below: holding the
     * sync token lets you use the app, which is deliberately not the same as
     * being allowed to move everybody to a different workspace. */
    if (isAdmin) {
      if (req.headers['x-admin-token'] !== adminToken) {
        send(res, 401, { error: 'unauthorized' });
        return;
      }
      handleAdmin(req, res, url);
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

      // 세션 오염 방지 (M46) / 보관 (M47) — writes only, exactly as in the PHP.
      const claimed = req.headers['x-session'];
      if (
        (req.method === 'PUT' || req.method === 'DELETE') &&
        typeof claimed === 'string' &&
        claimed !== '' &&
        claimed !== active
      ) {
        sessionRejects += 1;
        send(res, 409, { error: 'session_changed', session: active });
        return;
      }
      if ((req.method === 'PUT' || req.method === 'DELETE') && current().archived) {
        send(res, 423, { error: 'locked', detail: '보관된 세션이에요.' });
        return;
      }

      if (req.method === 'GET' || req.method === 'HEAD') {
        const bytes = current().photos.get(id);
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
          current().photos.set(id, body);
          send(res, 200, { ok: true });
        });
        return;
      }

      if (req.method === 'DELETE') {
        // 200 whether or not it was there — two devices sweeping the same
        // tombstone must not turn the loser into an error.
        current().photos.delete(id);
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

        // 주소 되묻기 (M37) — 이름 스냅이 빗나간 뒤에만 오는, 검색을 붙인 호출.
        // 장소 검색보다 **먼저** 가려낸다: 둘 다 `ask`를 타고 오므로 표시로만
        // 구분되고, 여기서 순서를 잘못 두면 주소 질문이 장소 답을 받는다.
        if (typeof parsed.prompt === 'string' && parsed.prompt.includes(ADDRESS_PROMPT_MARKER)) {
          const answer = [...addressOverrides].find(([needle]) =>
            (parsed.prompt as string).includes(needle),
          )?.[1];

          if (answer === 'error') {
            send(res, 502, { error: 'upstream_error', detail: 'HTTP 500 — mock' });
            return;
          }
          // grounding이 켜진 호출이라 서버가 스키마를 떨군다 — 답은 산문 속 JSON이다.
          send(
            res,
            200,
            geminiText([
              answer === undefined
                ? NO_ADDRESS_ANSWER
                : `\`\`\`json\n${JSON.stringify({ address: answer })}\n\`\`\``,
            ]),
          );
          return;
        }

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

    /* --- archive.php (M46) -------------------------------------------- */
    if (isArchive) {
      if (req.method === 'GET' && url.searchParams.has('check')) {
        send(res, 200, {
          ok: true,
          writable: archiveFolder !== '',
          folder: archiveFolder,
          detail: archiveFolder === '' ? '보관 폴더가 정해지지 않았어요.' : '',
        });
        return;
      }
      if (req.method !== 'POST') {
        send(res, 405, { error: 'method_not_allowed' });
        return;
      }
      if (archiveFolder === '') {
        send(res, 409, {
          error: 'no_folder',
          detail: '보관할 폴더가 아직 정해지지 않았어요. 관리자에게 문의해 주세요.',
        });
        return;
      }

      const raw = url.searchParams.get('name') ?? '';
      const name = safeArchiveName(raw);
      if (name === null) {
        send(res, 400, { error: 'bad_type', detail: '사진 파일만 보관할 수 있어요.' });
        return;
      }

      void readRaw(req, MAX_BODY_BYTES).then((body) => {
        if (body === null) {
          send(res, 413, { error: 'payload_too_large' });
          return;
        }
        if (body.length === 0) {
          send(res, 400, { error: 'empty', detail: '보낼 사진이 없어요.' });
          return;
        }
        // Bytes in = bytes out. The whole feature is that nothing between the
        // camera and the disk touches the file, so the mock stores the length
        // it actually received rather than the one the header claimed.
        archivedPhotos.push({ name, bytes: body.length });
        send(res, 200, {
          ok: true,
          folder: archiveFolder,
          name,
          path: `${archiveFolder}/${name}`,
          bytes: body.length,
        });
      });
      return;
    }

    /* --- data.php ------------------------------------------------------ */
    const session = current();

    if (req.method === 'GET') {
      if (url.searchParams.has('meta')) {
        metaReads += 1;
        send(res, 200, {
          version: session.stored?.version ?? 0,
          updatedAt: session.stored?.updatedAt ?? 0,
          // Additive (M46/M47), byte for byte what `data.php` answers.
          session: active,
          locked: session.archived,
          notice,
          profiles: Object.keys(session.profiles).length > 0 ? session.profiles : null,
          restoredAt: session.restoredAt,
        });
        return;
      }
      if (!session.stored) {
        // The 404 names the session too — a client must be able to tell an
        // empty session B from an empty session A before it pushes anything.
        send(res, 404, { error: 'not_found', session: active });
        return;
      }
      send(res, 200, {
        ...session.stored,
        session: active,
        locked: session.archived,
        notice,
        profiles: Object.keys(session.profiles).length > 0 ? session.profiles : null,
        restoredAt: session.restoredAt,
      });
      return;
    }

    if (req.method !== 'PUT') {
      send(res, 405, { error: 'method_not_allowed' });
      return;
    }

    // 세션 오염 방지 (M46), before the body is read and before `puts` is
    // counted: a refused write is not an attempted write.
    const claimedSession = req.headers['x-session'];
    if (
      typeof claimedSession === 'string' &&
      claimedSession !== '' &&
      claimedSession !== active
    ) {
      sessionRejects += 1;
      send(res, 409, { error: 'session_changed', session: active });
      return;
    }
    if (session.archived) {
      send(res, 423, { error: 'locked', detail: '보관된 세션이에요.' });
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

      const currentVersion = session.stored?.version ?? 0;
      if (baseVersion !== currentVersion) {
        conflicts += 1;
        send(res, 409, {
          version: currentVersion,
          updatedAt: session.stored?.updatedAt ?? 0,
          session: active,
          restoredAt: session.restoredAt,
          data: session.stored?.data ?? {
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

      // 일 단위 스냅샷 (M30) — the day's *first* save keeps what was there
      // before it, which is what 관리자 → 백업 → 복원 later walks (M47).
      const today = new Date();
      const stampKey = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(
        today.getDate(),
      ).padStart(2, '0')}`;
      if (session.stored && !session.daily.has(stampKey)) {
        session.daily.set(stampKey, session.stored);
      }

      session.stored = { version: currentVersion + 1, updatedAt: Date.now(), data };
      send(res, 200, {
        version: session.stored.version,
        updatedAt: session.stored.updatedAt,
        session: active,
        locked: false,
        notice,
        restoredAt: session.restoredAt,
      });
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    token,
    adminToken,
    version: () => current().stored?.version ?? 0,
    data: () => current().stored?.data ?? null,
    session: () => active,
    setSession: (id: string) => {
      if (!sessions.has(id)) sessions.set(id, newSession(id));
      active = id;
    },
    setLocked: (locked: boolean) => {
      current().archived = locked;
    },
    setNotice: (text: string | null) => {
      notice = text === null || text.trim() === '' ? null : { text: text.trim(), at: Date.now() };
    },
    sessionRejects: () => sessionRejects,
    archived: () => [...archivedPhotos],
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
    setAiAddressFor: (needle: string, answer: string | 'error') => {
      addressOverrides.set(needle, answer);
    },
    photoCount: () => current().photos.size,
    hasPhoto: (id: string) => current().photos.has(id),
    reset: () => {
      sessions.clear();
      sessions.set('default', newSession('default'));
      active = 'default';
      sessionRejects = 0;
      notice = null;
      archiveFolder = '';
      archivedPhotos.length = 0;
      conflicts = 0;
      metaReads = 0;
      puts = 0;
      aiCalls = [];
      aiAvailable = true;
      aiPlaceMode = 'ok';
      placeOverrides.clear();
      addressOverrides.clear();
    },
    stop: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
