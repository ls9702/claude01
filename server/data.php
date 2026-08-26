<?php
/**
 * Trip Board — the entire sync backend.
 *
 * One file, one JSON blob on disk, one shared token. It is meant for a
 * low-spec Synology NAS running Web Station's plain PHP handler: no database,
 * no Composer, no Docker, no framework. If this file and `config.php` are
 * readable by the web server, sync works.
 *
 * ## Contract
 *
 *   GET  ?meta=1   → 200 {"version":N,"updatedAt":ms}
 *                    (N = 0 when nothing has ever been pushed)
 *   GET            → 200 {"version":N,"updatedAt":ms,"data":{…workspace}}
 *                    404 {"error":"not_found"} when nothing has been pushed
 *   PUT  {"baseVersion":N,"data":{…}}
 *                  → 200 {"version":N+1,"updatedAt":ms}       accepted
 *                    409 {"version":M,"updatedAt":ms,"data":…} someone else won
 *
 * Every request needs `X-Sync-Token`; anything else is 401.
 *
 * ## Concurrency
 *
 * Two phones pushing at once is the normal case, not an edge case. A single
 * `flock(LOCK_EX)` on a dedicated lock file covers the whole read-compare-write
 * sequence, and the winner is decided by an optimistic version counter: a push
 * whose `baseVersion` no longer matches gets 409 *plus the current copy*, so
 * the client can merge and retry without a second round trip.
 *
 * Writes go to a temp file and are `rename()`d into place — atomic on the same
 * filesystem — so a reader never sees a half-written workspace, and a crash
 * mid-write leaves the previous version intact.
 *
 * CORS is deliberately absent: the app is served from the same origin as this
 * file. If you ever host them apart, that is the one thing to add.
 */

declare(strict_types=1);

/** Largest PUT body we will even look at. */
const MAX_BODY_BYTES = 10 * 1024 * 1024;

/** How many rotating copies of past versions to keep. */
const BACKUP_SLOTS = 5;

/** How many daily snapshots to keep under data/daily/ (M30). */
const DAILY_KEEP = 30;

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

/** Encodes a value the way every response in this file wants it. */
function encode($value): string
{
    return json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
}

/** Sends a JSON body with a status code and stops. */
function respond(int $status, $payload)
{
    http_response_code($status);
    echo encode($payload);
    exit;
}

/** Sends `{"error": …}` and stops. */
function fail(int $status, string $code, string $detail = '')
{
    $payload = ['error' => $code];
    if ($detail !== '') {
        $payload['detail'] = $detail;
    }
    respond($status, $payload);
}

/** Milliseconds since the epoch — the same clock the client stamps entities with. */
function now_ms(): int
{
    return (int) round(microtime(true) * 1000);
}

/** A valid but empty workspace, used as the "server has nothing yet" payload. */
function empty_workspace(): array
{
    return [
        'schemaVersion' => 1,
        'trips'      => new stdClass(),
        'sheets'     => new stdClass(),
        'columns'    => new stdClass(),
        'cards'      => new stdClass(),
        'days'       => new stdClass(),
        'entries'    => new stdClass(),
        'tombstones' => [],
    ];
}

/* ------------------------------------------------------------------ *
 * Configuration
 * ------------------------------------------------------------------ */

$configPath = __DIR__ . '/config.php';
if (!is_file($configPath)) {
    fail(500, 'not_configured', 'config.php가 없어요. config.sample.php를 복사하세요.');
}

/** @var array{SYNC_TOKEN:string, DATA_DIR:string} $config */
$config = require $configPath;

if (!is_array($config) || !isset($config['SYNC_TOKEN'], $config['DATA_DIR'])) {
    fail(500, 'not_configured', 'config.php에 SYNC_TOKEN과 DATA_DIR이 필요해요.');
}

$syncToken = (string) $config['SYNC_TOKEN'];
$dataDir   = rtrim((string) $config['DATA_DIR'], '/');

if ($syncToken === '' || $syncToken === 'change-me-to-a-long-random-string') {
    fail(500, 'not_configured', 'SYNC_TOKEN을 바꿔주세요.');
}

$dataFile = $dataDir . '/data.json';
$lockFile = $dataDir . '/.lock';

/* ------------------------------------------------------------------ *
 * Auth — before anything touches the disk
 * ------------------------------------------------------------------ */

$presented = $_SERVER['HTTP_X_SYNC_TOKEN'] ?? '';
if (!is_string($presented) || !hash_equals($syncToken, $presented)) {
    fail(401, 'unauthorized');
}

/* ------------------------------------------------------------------ *
 * Storage
 * ------------------------------------------------------------------ */

/**
 * Reads the stored envelope, or null when there is none / it is unreadable.
 * A corrupt file is treated as absent rather than fatal — the next push simply
 * starts a new version chain, and the old bytes stay in the backup slots.
 *
 * Decoded as **objects, not associative arrays**: PHP cannot tell `{}` from
 * `[]` once a JSON object becomes an empty array, and re-encoding would turn
 * every empty workspace map (`"cards": {}`) into `"cards": []`. The client
 * compares its merge result against this payload to decide whether a push is
 * needed, so that one character would put it in an endless push loop.
 */
function read_envelope(string $dataFile): ?object
{
    if (!is_file($dataFile)) {
        return null;
    }
    $raw = file_get_contents($dataFile);
    if ($raw === false || $raw === '') {
        return null;
    }
    $parsed = json_decode($raw);
    if (!is_object($parsed) || !isset($parsed->version, $parsed->data)) {
        return null;
    }
    return $parsed;
}

/**
 * Writes the envelope atomically: a temp file in the same directory, fsync'd,
 * then renamed over the target. The rename is what makes it atomic, so the
 * temp file must live on the same filesystem — hence `$dataDir`, not sys temp.
 */
function write_atomic(string $target, string $contents): bool
{
    $dir = dirname($target);
    $tmp = tempnam($dir, '.data-');
    if ($tmp === false) {
        return false;
    }

    $handle = fopen($tmp, 'wb');
    if ($handle === false) {
        @unlink($tmp);
        return false;
    }

    $ok = fwrite($handle, $contents) === strlen($contents);
    if ($ok) {
        fflush($handle);
    }
    fclose($handle);

    if (!$ok) {
        @unlink($tmp);
        return false;
    }

    @chmod($tmp, 0640);
    if (!rename($tmp, $target)) {
        @unlink($tmp);
        return false;
    }
    return true;
}

/* ------------------------------------------------------------------ *
 * Routing
 * ------------------------------------------------------------------ */

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'GET' || $method === 'HEAD') {
    $envelope = read_envelope($dataFile);

    // `?meta=1` is the cheap poll (and what 연결 테스트 uses): it must succeed
    // on a brand-new server, so "nothing yet" is version 0 rather than a 404.
    if (isset($_GET['meta'])) {
        respond(200, [
            'version'   => $envelope->version ?? 0,
            'updatedAt' => $envelope->updatedAt ?? 0,
        ]);
    }

    if ($envelope === null) {
        fail(404, 'not_found');
    }

    respond(200, [
        'version'   => $envelope->version,
        'updatedAt' => $envelope->updatedAt ?? 0,
        'data'      => $envelope->data,
    ]);
}

if ($method !== 'PUT') {
    header('Allow: GET, PUT');
    fail(405, 'method_not_allowed');
}

/* --- PUT ----------------------------------------------------------- */

// Check the advertised length first so an oversized upload is refused before
// it is read into memory.
$declared = isset($_SERVER['CONTENT_LENGTH']) ? (int) $_SERVER['CONTENT_LENGTH'] : 0;
if ($declared > MAX_BODY_BYTES) {
    fail(413, 'payload_too_large');
}

$body = file_get_contents('php://input', false, null, 0, MAX_BODY_BYTES + 1);
if ($body === false) {
    fail(400, 'bad_request', '본문을 읽을 수 없어요.');
}
if (strlen($body) > MAX_BODY_BYTES) {
    fail(413, 'payload_too_large');
}

// Objects, not associative arrays — see read_envelope() for why `{}` vs `[]`
// matters enough to be worth a comment in two places.
$request = json_decode($body);
if (!is_object($request) || !property_exists($request, 'baseVersion') || !isset($request->data)) {
    fail(400, 'bad_request', 'baseVersion과 data가 필요해요.');
}
if (!is_int($request->baseVersion) || $request->baseVersion < 0) {
    fail(400, 'bad_request', 'baseVersion은 0 이상의 정수여야 해요.');
}
if (!is_object($request->data) || ($request->data->schemaVersion ?? null) !== 1) {
    fail(400, 'bad_request', 'schemaVersion 1인 워크스페이스가 아니에요.');
}

if (!is_dir($dataDir) && !@mkdir($dataDir, 0770, true) && !is_dir($dataDir)) {
    fail(500, 'storage_error', 'DATA_DIR을 만들 수 없어요.');
}
if (!is_writable($dataDir)) {
    fail(500, 'storage_error', 'DATA_DIR에 쓸 수 없어요.');
}

// One exclusive lock spans read → compare → write, so two simultaneous pushes
// are serialized instead of racing on the version counter.
$lock = fopen($lockFile, 'c');
if ($lock === false) {
    fail(500, 'storage_error', '잠금 파일을 열 수 없어요.');
}
if (!flock($lock, LOCK_EX)) {
    fclose($lock);
    fail(503, 'busy');
}

$current        = read_envelope($dataFile);
$currentVersion = $current->version ?? 0;

/** Releases the lock. `respond()`/`fail()` call `exit`, which skips `finally`. */
$unlock = function () use ($lock) {
    flock($lock, LOCK_UN);
    fclose($lock);
};

if ($request->baseVersion !== $currentVersion) {
    // Lost the race. Hand back the whole current copy so the client can merge
    // locally and retry — one extra round trip saved, every time.
    $conflict = [
        'version'   => $currentVersion,
        'updatedAt' => $current->updatedAt ?? 0,
        'data'      => $current->data ?? empty_workspace(),
    ];
    $unlock();
    respond(409, $conflict);
}

$version   = $currentVersion + 1;
$updatedAt = now_ms();
$encoded   = encode([
    'version'   => $version,
    'updatedAt' => $updatedAt,
    'data'      => $request->data,
]);

if ($encoded === false) {
    $unlock();
    fail(400, 'bad_request', 'data를 JSON으로 저장할 수 없어요.');
}

// 일 단위 스냅샷 (M30): 그날의 **첫** 저장이, 덮어쓰기 직전의 파일 — 즉
// 어제까지의 마지막 상태 — 를 data/daily/workspace-YYYYMMDD.json 으로 남긴다.
// 회전 백업(BACKUP_SLOTS)은 편집이 활발한 날 몇 분 만에 다 밀려나지만, 이
// 파일은 하루에 하나씩 DAILY_KEEP일을 산다. 전부 최선노력: 스냅샷이 무슨
// 이유로든 실패해도 본 저장은 계속된다 — 백업이 저장을 막으면 본말전도다.
daily_snapshot($dataDir, $dataFile);

if (!write_atomic($dataFile, $encoded)) {
    $unlock();
    fail(500, 'storage_error', '저장에 실패했어요.');
}

// Rotating history: the last BACKUP_SLOTS versions stay on disk under
// predictable names, so a bad merge can be undone by hand with `cp`.
$backup = sprintf('%s/data.backup.%d.json', $dataDir, $version % BACKUP_SLOTS);
write_atomic($backup, $encoded);

$unlock();
respond(200, ['version' => $version, 'updatedAt' => $updatedAt]);

/* ------------------------------------------------------------------ *
 * 일 단위 스냅샷 (M30)
 * ------------------------------------------------------------------ */

/**
 * Keeps one dated copy of the workspace per day, best effort.
 *
 * Called with the lock held, immediately before the day's first overwrite, so
 * what it copies is yesterday's final state. A brand-new install has no file
 * yet and nothing worth keeping; a day whose snapshot already exists is done.
 * Pruning trusts the filename (`workspace-YYYYMMDD.json`) — the name *is* the
 * order, so a restored file's mtime can't confuse it.
 */
function daily_snapshot(string $dataDir, string $dataFile): void
{
    if (!is_file($dataFile)) {
        return;
    }
    $dir = $dataDir . '/daily';
    if (!is_dir($dir) && !@mkdir($dir, 0770, true)) {
        return;
    }
    $snapshot = sprintf('%s/workspace-%s.json', $dir, date('Ymd'));
    if (is_file($snapshot) || !@copy($dataFile, $snapshot)) {
        return;
    }

    $files = glob($dir . '/workspace-*.json') ?: [];
    sort($files);
    foreach (array_slice($files, 0, max(0, count($files) - DAILY_KEEP)) as $old) {
        @unlink($old);
    }
}
