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
 *   GET  ?meta=1   → 200 {"version":N,"updatedAt":ms,
 *                          "session":id,"locked":bool,"notice":…,"profiles":…,
 *                          "restoredAt":ms}   ← everything after updatedAt is
 *                    additive (M46/M47); a pre-M46 client ignores it all
 *                    (N = 0 when nothing has ever been pushed)
 *   GET            → 200 {…the same, plus "data":{…workspace}}
 *                    404 {"error":"not_found","session":id} nothing pushed yet
 *   PUT  {"baseVersion":N,"data":{…}}  (+ optional `X-Session` header)
 *                  → 200 {"version":N+1,"updatedAt":ms,…}     accepted
 *                    409 {"version":M,"updatedAt":ms,"data":…} someone else won
 *                    409 {"error":"session_changed","session":id}  M46, below
 *                    423 {"error":"locked"}   the session is 보관 (read-only)
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
 *
 * ## 세션 (M46)
 *
 * One address, several independent workspaces, and an administrator who picks
 * which one everybody sees. The disk grew one level:
 *
 *     DATA_DIR/active.json                     {"active":"<id>"}
 *     DATA_DIR/sessions/<id>/data.json         the workspace (+ backups, daily/)
 *     DATA_DIR/sessions/<id>/photos/           image.php's blobs
 *     DATA_DIR/sessions/<id>/session.json      {"label":"오사카 2026"}
 *
 * Every read and write above goes to the **active** session, so nothing in the
 * contract above changed shape — `?meta=1` and the workspace GET simply carry
 * one more field, `"session":"<id>"`, which is additive by design.
 *
 * The one new refusal is the important one. A tab that was looking at session A
 * when the administrator switched to B would, on its next push, overwrite B's
 * workspace with A's. So a client tells us which session it thinks it is in
 * (`X-Session`) and a mismatch is **409 `session_changed`** — the server, not
 * the client, is what makes that accident impossible. A request without the
 * header is an older client and is served the active session, exactly as before.
 */

declare(strict_types=1);

/** Largest PUT body we will even look at. */
const MAX_BODY_BYTES = 10 * 1024 * 1024;

/** How many rotating copies of past versions to keep. */
const BACKUP_SLOTS = 5;

/** How many daily snapshots to keep under daily/ (M30). */
const DAILY_KEEP = 30;

/**
 * Session ids that may become a path segment (M46).
 *
 * Lowercase letters, digits and hyphens only, first character alphanumeric.
 * No dots, so `..` cannot exist; no slashes, so there is nothing to traverse.
 * The admin endpoint validates with the same expression before it creates a
 * directory, and every reader validates again before it trusts what is on disk.
 */
const SESSION_ID_PATTERN = '/^[a-z0-9][a-z0-9-]{0,31}$/';

/** The session a pre-M46 install becomes, and the fallback whenever none is set. */
const DEFAULT_SESSION = 'default';

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
 * 세션 (M46) — duplicated verbatim in image.php and admin.php
 *
 * Three tiny functions, copied rather than shared, because this backend is
 * "PHP files you can drop into Web Station" and an include is one more file
 * that can go missing at deploy time. `write_atomic` already lives in two
 * places for the same reason.
 * ------------------------------------------------------------------ */

/** Which session everybody is looking at right now. Falls back to `default`. */
function active_session(string $dataDir): string
{
    $file = $dataDir . '/active.json';
    if (!is_file($file)) {
        return DEFAULT_SESSION;
    }
    $raw = @file_get_contents($file);
    if ($raw === false || $raw === '') {
        return DEFAULT_SESSION;
    }
    $parsed = json_decode($raw, true);
    $id = is_array($parsed) && isset($parsed['active']) ? $parsed['active'] : '';
    // A hand-edited or corrupt pointer must not be able to name a path. An
    // unusable value means "default" — the app keeps working, on the session
    // a pre-M46 install already had.
    if (!is_string($id) || preg_match(SESSION_ID_PATTERN, $id) !== 1) {
        return DEFAULT_SESSION;
    }
    return $id;
}

/** Absolute path of one session's folder. The id must already be validated. */
function session_dir(string $dataDir, string $id): string
{
    return $dataDir . '/sessions/' . $id;
}

/** Reads a small JSON file as an array, or `[]` when it is missing or junk. */
function read_json_array(string $path): array
{
    if (!is_file($path)) {
        return [];
    }
    $raw = @file_get_contents($path);
    if ($raw === false || $raw === '') {
        return [];
    }
    $parsed = json_decode($raw, true);
    return is_array($parsed) ? $parsed : [];
}

/**
 * The administrator's 공지 (M47), or `null`.
 *
 * Rides on `?meta=1` — the request the app already makes every few seconds —
 * rather than getting an endpoint of its own. A notice nobody polls for is a
 * notice nobody reads.
 */
function read_notice(string $dataDir)
{
    $notice = read_json_array($dataDir . '/notice.json');
    $text = isset($notice['text']) && is_string($notice['text']) ? trim($notice['text']) : '';
    if ($text === '') {
        return null;
    }
    return ['text' => $text, 'at' => isset($notice['at']) ? (int) $notice['at'] : 0];
}

/**
 * Per-session display names and emoji avatars (M47), or `null`.
 *
 * Presentation only, and outside the workspace on purpose: the **ids** stay
 * `song`/`hoyabom` because they are written into every card, comment and
 * receipt, so this needs no schema change and no migration. An empty file — the
 * state of every session that has never been edited — answers `null`, and the
 * client draws exactly what it has always drawn.
 */
function read_profiles(string $sessionDir)
{
    $profiles = read_json_array($sessionDir . '/profiles.json');
    $out = [];
    foreach ($profiles as $id => $value) {
        if (!is_string($id) || !is_array($value)) {
            continue;
        }
        $row = [];
        if (isset($value['label']) && is_string($value['label']) && trim($value['label']) !== '') {
            $row['label'] = trim($value['label']);
        }
        if (isset($value['avatar']) && is_string($value['avatar']) && trim($value['avatar']) !== '') {
            $row['avatar'] = trim($value['avatar']);
        }
        if ($row !== []) {
            $out[$id] = $row;
        }
    }
    return $out === [] ? null : $out;
}

/**
 * Moves a pre-M46 layout under `sessions/default/`, once (M46).
 *
 * Idempotent and cheap: the fast path is a single `is_dir`, which is what every
 * request after the first one pays. The move itself happens under its own lock
 * so two simultaneous first-requests cannot both do it, and it is a `rename()`
 * within one directory — same volume, so it is atomic and instant even for a
 * photos folder with hundreds of files in it.
 *
 * Best effort throughout. If anything cannot be moved the install simply keeps
 * running on whatever did move; nothing is deleted, so the worst case is a
 * leftover file next to `sessions/`, not a lost workspace.
 */
function migrate_legacy_sessions(string $dataDir): void
{
    $sessions = $dataDir . '/sessions';
    if (is_dir($sessions) || !is_dir($dataDir)) {
        return;
    }

    $lock = @fopen($dataDir . '/.migrate.lock', 'c');
    if ($lock === false) {
        return;
    }
    if (!flock($lock, LOCK_EX)) {
        fclose($lock);
        return;
    }

    // Re-checked with the lock held: the loser of the race finds the work done.
    if (!is_dir($sessions)) {
        $target = $sessions . '/' . DEFAULT_SESSION;
        if (@mkdir($target, 0770, true) || is_dir($target)) {
            $names = ['data.json', '.lock', 'daily', 'photos'];
            foreach (glob($dataDir . '/data.backup.*.json') ?: [] as $backup) {
                $names[] = basename($backup);
            }
            foreach ($names as $name) {
                $from = $dataDir . '/' . $name;
                if (file_exists($from) && !file_exists($target . '/' . $name)) {
                    @rename($from, $target . '/' . $name);
                }
            }
        }
    }

    flock($lock, LOCK_UN);
    fclose($lock);
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

/* ------------------------------------------------------------------ *
 * Auth — before anything touches the disk
 * ------------------------------------------------------------------ */

$presented = $_SERVER['HTTP_X_SYNC_TOKEN'] ?? '';
if (!is_string($presented) || !hash_equals($syncToken, $presented)) {
    fail(401, 'unauthorized');
}

/* ------------------------------------------------------------------ *
 * Which session (M46) — after auth, because it touches the disk
 * ------------------------------------------------------------------ */

migrate_legacy_sessions($dataDir);

$sessionId  = active_session($dataDir);
$sessionDir = session_dir($dataDir, $sessionId);
$dataFile   = $sessionDir . '/data.json';
$lockFile   = $sessionDir . '/.lock';

// 보관 (M47): a session the administrator marked read-only. Reads are normal;
// writes are refused with 423 and a sentence saying why.
$sessionMeta = read_json_array($sessionDir . '/session.json');
$archived    = ($sessionMeta['archived'] ?? false) === true;

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
            // Additive (M46/M47). The poll is the cheapest place the client can
            // learn that the administrator moved everyone somewhere else, put a
            // notice up, or locked the session — and it already runs every few
            // seconds, so none of these needs an endpoint of its own.
            'session'   => $sessionId,
            'locked'    => $archived,
            'notice'    => read_notice($dataDir),
            'profiles'  => read_profiles($sessionDir),
            // 복원 도장 (M47) — see admin.php's `restore`. Clients that have
            // not acted on this stamp adopt the server copy wholesale instead
            // of merging their own entities back over it.
            'restoredAt' => (int) ($envelope->restoredAt ?? 0),
        ]);
    }

    if ($envelope === null) {
        // Carries the session even though there is nothing to hand over: a
        // client that pushed its old workspace into a brand-new empty session
        // would be the exact accident `X-Session` exists to prevent, so it has
        // to be able to tell "empty session B" from "empty session A".
        respond(404, ['error' => 'not_found', 'session' => $sessionId]);
    }

    respond(200, [
        'version'   => $envelope->version,
        'updatedAt' => $envelope->updatedAt ?? 0,
        'session'    => $sessionId,
        'locked'     => $archived,
        'notice'     => read_notice($dataDir),
        'profiles'   => read_profiles($sessionDir),
        'restoredAt' => (int) ($envelope->restoredAt ?? 0),
        'data'       => $envelope->data,
    ]);
}

if ($method !== 'PUT') {
    header('Allow: GET, PUT');
    fail(405, 'method_not_allowed');
}

/* --- PUT ----------------------------------------------------------- */

// 세션 오염 방지 (M46), before the body is even read. A client that names a
// session tells us which workspace it built its edit on; if that is no longer
// the active one, the edit belongs to a workspace nobody is looking at and
// writing it here would overwrite a different group's trip. No header means an
// older client, which is served the active session exactly as it always was.
$claimedSession = $_SERVER['HTTP_X_SESSION'] ?? '';
if (is_string($claimedSession) && $claimedSession !== '' && $claimedSession !== $sessionId) {
    respond(409, ['error' => 'session_changed', 'session' => $sessionId]);
}

// 보관 (M47): read-only means read-only. The client keeps the edit locally and
// says so in a quiet banner — nothing is lost, it just does not travel.
if ($archived) {
    fail(423, 'locked', '보관된 세션이에요. 관리자가 보관을 해제해야 저장할 수 있어요.');
}

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

// The session folder is created on the first push into it — an activated but
// never-written session has nothing on disk, and that is a perfectly good
// state for it to be in.
if (!is_dir($sessionDir) && !@mkdir($sessionDir, 0770, true) && !is_dir($sessionDir)) {
    fail(500, 'storage_error', 'DATA_DIR을 만들 수 없어요.');
}
if (!is_writable($sessionDir)) {
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
        'version'    => $currentVersion,
        'updatedAt'  => $current->updatedAt ?? 0,
        'session'    => $sessionId,
        'restoredAt' => (int) ($current->restoredAt ?? 0),
        'data'       => $current->data ?? empty_workspace(),
    ];
    $unlock();
    respond(409, $conflict);
}

$version   = $currentVersion + 1;
$updatedAt = now_ms();
// Carried forward, not re-stamped: the restore happened once, and a device
// that has been offline since must still be told about it on its next pull.
$restoredAt = (int) ($current->restoredAt ?? 0);
$encoded   = encode([
    'version'    => $version,
    'updatedAt'  => $updatedAt,
    'restoredAt' => $restoredAt,
    'data'       => $request->data,
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
daily_snapshot($sessionDir, $dataFile);

if (!write_atomic($dataFile, $encoded)) {
    $unlock();
    fail(500, 'storage_error', '저장에 실패했어요.');
}

// Rotating history: the last BACKUP_SLOTS versions stay on disk under
// predictable names, so a bad merge can be undone by hand with `cp`.
$backup = sprintf('%s/data.backup.%d.json', $sessionDir, $version % BACKUP_SLOTS);
write_atomic($backup, $encoded);

$unlock();
respond(200, [
    'version'    => $version,
    'updatedAt'  => $updatedAt,
    'session'    => $sessionId,
    'locked'     => false,
    'notice'     => read_notice($dataDir),
    'restoredAt' => $restoredAt,
]);

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
 *
 * `$sessionDir` since M46: every session keeps its own 30 days of history, so
 * switching groups never puts one trip's snapshots in another's folder.
 */
function daily_snapshot(string $sessionDir, string $dataFile): void
{
    if (!is_file($dataFile)) {
        return;
    }
    $dir = $sessionDir . '/daily';
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
