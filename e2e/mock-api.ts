import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * In-memory stand-in for `server/data.php`, used by the sync e2e spec.
 *
 * It implements the *same* contract, byte for byte, so the browser code under
 * test cannot tell the difference:
 *
 *   GET  ?meta=1  → 200 {version, updatedAt}
 *   GET           → 200 {version, updatedAt, data} | 404 {error}
 *   PUT           → 200 {version, updatedAt} | 409 {version, updatedAt, data}
 *   any           → 401 without a matching `X-Sync-Token`
 *
 * It is started per-spec from `test.beforeAll` rather than being wired into
 * Playwright's `webServer`, because only one spec needs it and a global server
 * would leak state between the other 25 specs.
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
  /** Wipes the stored workspace and counters. */
  reset: () => void;
  stop: () => Promise<void>;
}

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

  const send = (res: ServerResponse, status: number, payload: unknown): void => {
    const body = JSON.stringify(payload);
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'X-Sync-Token, Content-Type',
      'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
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
    if (!url.pathname.endsWith('/data.php')) {
      send(res, 404, { error: 'not_found' });
      return;
    }
    if (req.headers['x-sync-token'] !== token) {
      send(res, 401, { error: 'unauthorized' });
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
    reset: () => {
      stored = null;
      conflicts = 0;
    },
    stop: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
