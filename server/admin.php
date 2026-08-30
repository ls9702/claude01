<?php
/**
 * Trip Board — 관리자 엔드포인트 (M46).
 *
 * One address, several independent workspaces, one person who decides which of
 * them everybody is looking at. `data.php` and `image.php` only read the pointer
 * this file writes; nothing here ever touches a workspace's contents.
 *
 * ## Contract
 *
 *   GET                       → 200 {ok, active, sessions:[…], archive:{…}}
 *   POST {"action":"create",   "id":"…","label":"…"}  → 200 {ok, sessions:[…]}
 *   POST {"action":"rename",   "id":"…","label":"…"}  → 200 {ok, sessions:[…]}
 *   POST {"action":"activate", "id":"…"}              → 200 {ok, active, …}
 *   POST {"action":"archive-settings","folder":"…"}   → 200 {ok, archive:{…}}
 *   POST {"action":"lock"|"unlock", "id":"…"}         → 200 {ok, sessions:[…]}   (M47)
 *   POST {"action":"notice",   "text":"…"}            → 200 {ok, notice:…}       (M47)
 *   POST {"action":"profiles", "id":"…","profiles":…} → 200 {ok, profiles:…}     (M47)
 *   POST {"action":"backups",  "id":"…"}              → 200 {ok, backups:[…]}    (M47)
 *   POST {"action":"restore",  "id":"…","date":"…"}   → 200 {ok, …}              (M47)
 *   GET  ?action=export&id=…                          → 200 the raw envelope     (M47)
 *   anything else                                     → 400 / 405
 *
 * Every request needs `X-Admin-Token` (config.php's `ADMIN_TOKEN`), compared
 * with `hash_equals` exactly the way `data.php` compares `SYNC_TOKEN`. The two
 * secrets are deliberately separate: both users hold the sync token, and being
 * able to *use* the app is not the same as being able to move everyone to a
 * different workspace.
 *
 * ## What is deliberately missing
 *
 * **Delete.** Removing a session means removing a trip, its photos and its 30
 * days of snapshots with one tap on a phone, and there is no undo behind it. A
 * session that is finished simply stops being the active one; the folder costs
 * a few megabytes and can be deleted by hand in File Station by the one person
 * who would ever want to.
 *
 * ## Storage
 *
 *   DATA_DIR/active.json              {"active":"<id>"}
 *   DATA_DIR/sessions/<id>/           the session (see data.php)
 *   DATA_DIR/sessions/<id>/session.json  {"label":"오사카 2026"}
 *   DATA_DIR/archive-settings.json    {"folder":"2026-11-osaka"}  (archive.php)
 *
 * The id is the only user input that becomes a path, and it is validated with
 * the same whitelist expression the readers use — lowercase letters, digits and
 * hyphens, nothing else, so there is no `.` for a `..` to be made of.
 */

declare(strict_types=1);

/** Largest POST body we will look at. Every action here is a few dozen bytes. */
const MAX_BODY_BYTES = 64 * 1024;

/** Session ids that may become a path segment — same rule as data.php. */
const SESSION_ID_PATTERN = '/^[a-z0-9][a-z0-9-]{0,31}$/';

/** Archive subfolder names. Same shape, and for exactly the same reason. */
const FOLDER_PATTERN = '/^[a-z0-9][a-z0-9-]{0,63}$/';

/** The session a pre-M46 install becomes, and the fallback whenever none is set. */
const DEFAULT_SESSION = 'default';

/** Longest display name we store. Long enough for a trip, short enough to show. */
const MAX_LABEL_LEN = 60;

/** Longest 공지. One line on a phone, not a newsletter. */
const MAX_NOTICE_LEN = 300;

/** How long the disk-usage figures are cached, seconds (M47). */
const USAGE_CACHE_SEC = 60;

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function respond(int $status, $payload)
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function fail(int $status, string $code, string $detail = '')
{
    $payload = ['error' => $code];
    if ($detail !== '') {
        $payload['detail'] = $detail;
    }
    respond($status, $payload);
}

/** Encodes a value the way every response in this file wants it. */
function encode($value): string
{
    $json = json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    return $json === false ? '{}' : $json;
}

/** Milliseconds since the epoch — the same clock data.php stamps versions with. */
function now_ms(): int
{
    return (int) round(microtime(true) * 1000);
}

/** Writes bytes atomically: temp file in the same directory, then `rename()`. */
function write_atomic(string $target, string $contents): bool
{
    $tmp = tempnam(dirname($target), '.admin-');
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

/** Reads a small JSON file as an array, or `[]` when it is missing or junk. */
function read_json_file(string $path): array
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

/** Which session everybody is looking at right now — same rule as data.php. */
function active_session(string $dataDir): string
{
    $parsed = read_json_file($dataDir . '/active.json');
    $id = $parsed['active'] ?? '';
    if (!is_string($id) || preg_match(SESSION_ID_PATTERN, $id) !== 1) {
        return DEFAULT_SESSION;
    }
    return $id;
}

/** Total bytes of one directory, one level deep. `photos/` is flat by design. */
function dir_bytes(string $dir): array
{
    if (!is_dir($dir)) {
        return ['bytes' => 0, 'count' => 0];
    }
    $bytes = 0;
    $count = 0;
    foreach (glob($dir . '/*') ?: [] as $path) {
        if (is_file($path)) {
            $bytes += (int) filesize($path);
            $count += 1;
        }
    }
    return ['bytes' => $bytes, 'count' => $count];
}

/**
 * Every session on disk, plus the one the pointer names.
 *
 * The active session is always in the list even when it has no folder yet — it
 * was just created and nobody has pushed into it, which is a perfectly ordinary
 * state and would otherwise make the admin screen show an empty list right
 * after a 만들기.
 */
function list_sessions(string $dataDir, string $active): array
{
    $ids = [];
    foreach (glob($dataDir . '/sessions/*', GLOB_ONLYDIR) ?: [] as $path) {
        $id = basename($path);
        if (preg_match(SESSION_ID_PATTERN, $id) === 1) {
            $ids[$id] = true;
        }
    }
    $ids[$active] = true;
    $ids[DEFAULT_SESSION] = true;
    ksort($ids);

    $out = [];
    foreach (array_keys($ids) as $id) {
        $dir  = $dataDir . '/sessions/' . $id;
        $meta = read_json_file($dir . '/session.json');
        $label = isset($meta['label']) && is_string($meta['label']) ? $meta['label'] : '';
        $dataFile = $dir . '/data.json';
        $photos = dir_bytes($dir . '/photos');

        $out[] = [
            'id'         => $id,
            'label'      => $label,
            'active'     => $id === $active,
            'archived'   => ($meta['archived'] ?? false) === true,
            'updatedAt'  => is_file($dataFile) ? (int) filemtime($dataFile) * 1000 : 0,
            'dataBytes'  => is_file($dataFile) ? (int) filesize($dataFile) : 0,
            'photoBytes' => $photos['bytes'],
            'photoCount' => $photos['count'],
        ];
    }
    return $out;
}

/** The archive destination, as the admin screen needs to show it. */
function archive_state(string $dataDir, string $archiveDir): array
{
    $settings = read_json_file($dataDir . '/archive-settings.json');
    $folder = $settings['folder'] ?? '';
    if (!is_string($folder) || preg_match(FOLDER_PATTERN, $folder) !== 1) {
        $folder = '';
    }
    $size = $folder === '' ? ['bytes' => 0, 'count' => 0] : dir_bytes($archiveDir . '/' . $folder);

    return [
        'folder'     => $folder,
        'base'       => $archiveDir,
        // "Can a photo actually be filed right now?" — one boolean instead of
        // making the client reason about two strings it cannot verify.
        'ready'      => $archiveDir !== '' && $folder !== '' && is_dir($archiveDir),
        'baseExists' => $archiveDir !== '' && is_dir($archiveDir),
        'bytes'      => $size['bytes'],
        'count'      => $size['count'],
    ];
}

/**
 * The NAS's own free space (M47), cached for a minute.
 *
 * `disk_free_space` is cheap, but the walk that produces the per-session sizes
 * above is not once a trip has a thousand photos in it, and this screen is
 * re-rendered after every action. One small cache file covers both: the whole
 * dashboard is recomputed at most once a minute, and the numbers on it are
 * "about a minute old", which is exactly the precision anyone needs from a
 * free-space figure.
 */
function usage_state(string $dataDir): array
{
    $cacheFile = $dataDir . '/.usage-cache.json';
    $cached = read_json_file($cacheFile);
    if (isset($cached['at']) && is_int($cached['at']) && $cached['at'] > (time() - USAGE_CACHE_SEC) * 1000) {
        return $cached;
    }

    $free  = @disk_free_space($dataDir);
    $total = @disk_total_space($dataDir);
    $usage = [
        'diskFree'  => is_float($free) ? (int) $free : 0,
        'diskTotal' => is_float($total) ? (int) $total : 0,
        'at'        => (int) round(microtime(true) * 1000),
    ];
    write_atomic($cacheFile, json_encode($usage, JSON_UNESCAPED_SLASHES) ?: '{}');
    return $usage;
}

/** The 공지 as `data.php` will serve it, or `null`. */
function notice_state(string $dataDir)
{
    $notice = read_json_file($dataDir . '/notice.json');
    $text = isset($notice['text']) && is_string($notice['text']) ? trim($notice['text']) : '';
    if ($text === '') {
        return null;
    }
    return ['text' => $text, 'at' => isset($notice['at']) ? (int) $notice['at'] : 0];
}

/** The display overrides stored for one session (M47), or `null`. */
function profiles_state(string $dataDir, string $id)
{
    $profiles = read_json_file($dataDir . '/sessions/' . $id . '/profiles.json');
    return $profiles === [] ? null : $profiles;
}

/**
 * Everything the admin screen draws, in one shape.
 *
 * Every action answers with this, so the sheet never has to guess what its own
 * write changed or fire a second request to find out.
 */
function admin_state(string $dataDir, string $archiveDir, string $active): array
{
    return [
        'ok'       => true,
        'active'   => $active,
        'sessions' => list_sessions($dataDir, $active),
        'archive'  => archive_state($dataDir, $archiveDir),
        'usage'    => usage_state($dataDir),
        'notice'   => notice_state($dataDir),
        'profiles' => profiles_state($dataDir, $active),
    ];
}

/**
 * The daily snapshots one session has (M47), newest first.
 *
 * Read from `daily/` — the folder M30 has been filling for a year — rather than
 * from a new list this milestone would have to keep in step. The filename *is*
 * the date and therefore the order, so a file restored by hand cannot confuse
 * it by having the wrong mtime.
 */
function list_backups(string $dataDir, string $id): array
{
    $files = glob($dataDir . '/sessions/' . $id . '/daily/workspace-*.json') ?: [];
    rsort($files);

    $out = [];
    foreach ($files as $path) {
        if (preg_match('/workspace-(\d{8})\.json$/', basename($path), $m) === 1) {
            $out[] = ['date' => $m[1], 'bytes' => (int) filesize($path)];
        }
    }
    return $out;
}

/* ------------------------------------------------------------------ *
 * Configuration
 * ------------------------------------------------------------------ */

$configPath = __DIR__ . '/config.php';
if (!is_file($configPath)) {
    fail(500, 'not_configured', 'config.php가 없어요. config.sample.php를 복사하세요.');
}

$config = require $configPath;
if (!is_array($config) || !isset($config['DATA_DIR'])) {
    fail(500, 'not_configured', 'config.php에 DATA_DIR이 필요해요.');
}

$adminToken = isset($config['ADMIN_TOKEN']) ? (string) $config['ADMIN_TOKEN'] : '';
$dataDir    = rtrim((string) $config['DATA_DIR'], '/');
$archiveDir = isset($config['ARCHIVE_DIR']) ? rtrim((string) $config['ARCHIVE_DIR'], '/') : '';

if ($adminToken === '' || $adminToken === 'change-me-to-another-long-random-string') {
    fail(500, 'not_configured', 'config.php에 ADMIN_TOKEN을 설정해 주세요.');
}

/* ------------------------------------------------------------------ *
 * Auth — before anything touches the disk
 * ------------------------------------------------------------------ */

$presented = $_SERVER['HTTP_X_ADMIN_TOKEN'] ?? '';
if (!is_string($presented) || !hash_equals($adminToken, $presented)) {
    fail(401, 'unauthorized');
}

if (!is_dir($dataDir) && !@mkdir($dataDir, 0770, true) && !is_dir($dataDir)) {
    fail(500, 'storage_error', 'DATA_DIR을 만들 수 없어요.');
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

/* ------------------------------------------------------------------ *
 * GET — the whole admin screen in one response
 * ------------------------------------------------------------------ */

if ($method === 'GET' || $method === 'HEAD') {
    $active = active_session($dataDir);

    // ?action=export — one session's workspace, byte for byte (M47).
    //
    // What comes back is the server's own envelope, `{version,updatedAt,data}`,
    // which is exactly what `sync/exportImport.deserializeBackup` already reads.
    // So an exported session restores through 설정 → 가져오기 with no
    // conversion step and no second backup format to keep alive.
    if (isset($_GET['action']) && $_GET['action'] === 'export') {
        $id = isset($_GET['id']) && is_string($_GET['id']) ? trim($_GET['id']) : '';
        if (preg_match(SESSION_ID_PATTERN, $id) !== 1) {
            fail(400, 'bad_id', '세션 id가 올바르지 않아요.');
        }
        $file = $dataDir . '/sessions/' . $id . '/data.json';
        if (!is_file($file)) {
            fail(404, 'not_found', '그 세션에는 아직 저장된 데이터가 없어요.');
        }
        header('Content-Disposition: attachment; filename="trip-board-' . $id . '.json"');
        readfile($file);
        exit;
    }

    respond(200, admin_state($dataDir, $archiveDir, $active));
}

if ($method !== 'POST') {
    header('Allow: GET, POST');
    fail(405, 'method_not_allowed');
}

/* ------------------------------------------------------------------ *
 * POST
 * ------------------------------------------------------------------ */

$body = file_get_contents('php://input', false, null, 0, MAX_BODY_BYTES + 1);
if ($body === false || strlen($body) > MAX_BODY_BYTES) {
    fail(400, 'bad_request', '본문을 읽을 수 없어요.');
}

$request = json_decode($body, true);
if (!is_array($request)) {
    fail(400, 'bad_request', 'JSON 본문이 필요해요.');
}

$action = isset($request['action']) && is_string($request['action']) ? $request['action'] : '';
$active = active_session($dataDir);

/**
 * Trims a piece of user text to `$max` **characters**. `''` stays `''`.
 *
 * `mb_substr` where mbstring is available and a UTF-8-aware regex otherwise —
 * a Web Station PHP profile without mbstring must not turn 「오사카 2026」 into
 * three broken bytes, and this same function is what bounds the 공지 and the
 * emoji avatar.
 */
$cleanText = static function ($raw, int $max): string {
    if (!is_string($raw)) {
        return '';
    }
    $text = trim($raw);
    if (function_exists('mb_substr')) {
        return mb_substr($text, 0, $max, 'UTF-8');
    }
    $chars = preg_split('//u', $text, -1, PREG_SPLIT_NO_EMPTY) ?: [];
    return implode('', array_slice($chars, 0, $max));
};

/** The id an action names, validated. Never reaches the disk unvalidated. */
$requireId = static function (array $request) {
    $id = isset($request['id']) && is_string($request['id']) ? trim($request['id']) : '';
    if (preg_match(SESSION_ID_PATTERN, $id) !== 1) {
        fail(400, 'bad_id', '세션 id는 영문 소문자·숫자·하이픈만 쓸 수 있어요.');
    }
    return $id;
};

if ($action === 'create') {
    $id = $requireId($request);
    $dir = $dataDir . '/sessions/' . $id;
    if (is_dir($dir)) {
        fail(409, 'already_exists', '같은 id의 세션이 이미 있어요.');
    }
    if (!@mkdir($dir, 0770, true) && !is_dir($dir)) {
        fail(500, 'storage_error', '세션 폴더를 만들 수 없어요.');
    }
    write_atomic($dir . '/session.json', encode([
        'label'     => $cleanText($request['label'] ?? '', MAX_LABEL_LEN),
        'createdAt' => (int) round(microtime(true) * 1000),
    ]));
    // Creating is not activating. Making a session and moving everybody into it
    // are two decisions, and the second one gets its own confirmation.
    respond(200, admin_state($dataDir, $archiveDir, $active));
}

if ($action === 'rename') {
    $id = $requireId($request);
    $dir = $dataDir . '/sessions/' . $id;
    if (!is_dir($dir) && !@mkdir($dir, 0770, true) && !is_dir($dir)) {
        fail(500, 'storage_error', '세션 폴더를 만들 수 없어요.');
    }
    // **The id never changes.** It is a path segment and it is what every
    // device has written down as "which workspace am I in"; renaming it would
    // strand every open tab. Only the display name moves.
    $meta = read_json_file($dir . '/session.json');
    $meta['label'] = $cleanText($request['label'] ?? '', MAX_LABEL_LEN);
    if (!write_atomic($dir . '/session.json', encode($meta))) {
        fail(500, 'storage_error', '이름을 저장할 수 없어요.');
    }
    respond(200, admin_state($dataDir, $archiveDir, $active));
}

if ($action === 'activate') {
    $id = $requireId($request);
    $dir = $dataDir . '/sessions/' . $id;
    // Activating a session nobody has pushed into yet is legal — that is what a
    // brand-new group looks like — but it must at least have been created.
    if (!is_dir($dir) && $id !== DEFAULT_SESSION) {
        fail(404, 'not_found', '그런 세션이 없어요.');
    }
    if (!write_atomic($dataDir . '/active.json', encode(['active' => $id]))) {
        fail(500, 'storage_error', '활성 세션을 저장할 수 없어요.');
    }
    respond(200, admin_state($dataDir, $archiveDir, $id));
}

if ($action === 'archive-settings') {
    $folder = isset($request['folder']) && is_string($request['folder']) ? trim($request['folder']) : '';
    // An empty folder is a legal setting: it means "not filing anywhere yet",
    // and `archive.php` refuses uploads with a sentence saying so.
    if ($folder !== '' && preg_match(FOLDER_PATTERN, $folder) !== 1) {
        fail(400, 'bad_folder', '폴더 이름은 영문 소문자·숫자·하이픈만 쓸 수 있어요.');
    }
    if (!write_atomic($dataDir . '/archive-settings.json', encode(['folder' => $folder]))) {
        fail(500, 'storage_error', '보관함 설정을 저장할 수 없어요.');
    }
    respond(200, admin_state($dataDir, $archiveDir, $active));
}

/* --- M47 ----------------------------------------------------------- */

if ($action === 'lock' || $action === 'unlock') {
    // 보관 = read-only, **not** delete. `data.php` and `image.php` refuse
    // writes to a session carrying this flag with 423; everything else about it
    // keeps working, and unlocking is one tap away.
    $id = $requireId($request);
    $dir = $dataDir . '/sessions/' . $id;
    if (!is_dir($dir) && !@mkdir($dir, 0770, true) && !is_dir($dir)) {
        fail(500, 'storage_error', '세션 폴더를 만들 수 없어요.');
    }
    $meta = read_json_file($dir . '/session.json');
    $meta['archived'] = $action === 'lock';
    if (!write_atomic($dir . '/session.json', encode($meta))) {
        fail(500, 'storage_error', '보관 상태를 저장할 수 없어요.');
    }
    respond(200, admin_state($dataDir, $archiveDir, $active));
}

if ($action === 'notice') {
    $text = isset($request['text']) && is_string($request['text']) ? trim($request['text']) : '';
    $text = $cleanText($text, MAX_NOTICE_LEN);
    // An empty text is 내리기, not an error: the same button either way, and
    // `data.php` reads a blank notice as no notice.
    $payload = $text === '' ? ['text' => '', 'at' => 0] : ['text' => $text, 'at' => (int) round(microtime(true) * 1000)];
    if (!write_atomic($dataDir . '/notice.json', encode($payload))) {
        fail(500, 'storage_error', '공지를 저장할 수 없어요.');
    }
    respond(200, admin_state($dataDir, $archiveDir, $active));
}

if ($action === 'profiles') {
    $id = $requireId($request);
    $dir = $dataDir . '/sessions/' . $id;
    if (!is_dir($dir) && !@mkdir($dir, 0770, true) && !is_dir($dir)) {
        fail(500, 'storage_error', '세션 폴더를 만들 수 없어요.');
    }

    // Presentation only, and only for the ids the app actually has. A profile
    // id is written into every card and comment ever created, so this endpoint
    // is deliberately unable to invent one.
    $incoming = isset($request['profiles']) && is_array($request['profiles']) ? $request['profiles'] : [];
    $out = [];
    foreach (['song', 'hoyabom'] as $profileId) {
        $value = $incoming[$profileId] ?? null;
        if (!is_array($value)) {
            continue;
        }
        $row = [];
        $label = $cleanText(is_string($value['label'] ?? null) ? $value['label'] : '', MAX_LABEL_LEN);
        $avatar = $cleanText(is_string($value['avatar'] ?? null) ? $value['avatar'] : '', 8);
        if ($label !== '') {
            $row['label'] = $label;
        }
        if ($avatar !== '') {
            $row['avatar'] = $avatar;
        }
        if ($row !== []) {
            $out[$profileId] = $row;
        }
    }

    if (!write_atomic($dir . '/profiles.json', encode($out === [] ? new stdClass() : $out))) {
        fail(500, 'storage_error', '프로필을 저장할 수 없어요.');
    }
    respond(200, admin_state($dataDir, $archiveDir, $active));
}

if ($action === 'backups') {
    $id = $requireId($request);
    respond(200, ['ok' => true, 'backups' => list_backups($dataDir, $id)]);
}

if ($action === 'restore') {
    $id = $requireId($request);
    $date = isset($request['date']) && is_string($request['date']) ? trim($request['date']) : '';
    if (preg_match('/^\d{8}$/', $date) !== 1) {
        fail(400, 'bad_request', '복원할 날짜가 올바르지 않아요.');
    }

    $dir      = $dataDir . '/sessions/' . $id;
    $snapshot = $dir . '/daily/workspace-' . $date . '.json';
    $dataFile = $dir . '/data.json';
    if (!is_file($snapshot)) {
        fail(404, 'not_found', '그 날짜의 백업이 없어요.');
    }

    // The same lock `data.php` holds for a push, so a restore cannot land in
    // the middle of somebody's save.
    $lock = @fopen($dir . '/.lock', 'c');
    if ($lock === false || !flock($lock, LOCK_EX)) {
        if ($lock !== false) {
            fclose($lock);
        }
        fail(503, 'busy', '지금은 저장 중이에요. 잠시 후 다시 시도해 주세요.');
    }

    $snapRaw = @file_get_contents($snapshot);
    $snapDecoded = $snapRaw === false ? null : json_decode($snapRaw);
    if (!is_object($snapDecoded) || !isset($snapDecoded->data)) {
        flock($lock, LOCK_UN);
        fclose($lock);
        fail(500, 'storage_error', '백업 파일을 읽을 수 없어요.');
    }

    $currentRaw = is_file($dataFile) ? @file_get_contents($dataFile) : false;
    $current = $currentRaw === false ? null : json_decode((string) $currentRaw);
    $currentVersion = is_object($current) && isset($current->version) ? (int) $current->version : 0;

    // A way back, kept **outside** daily/ so the 30-day prune cannot reach it
    // and so it never shows up in the restore list as if it were a snapshot.
    if ($currentRaw !== false) {
        write_atomic(
            sprintf('%s/pre-restore-%d.json', $dir, (int) round(microtime(true) * 1000)),
            (string) $currentRaw,
        );
    }

    // **The version goes forward, never back.** Every client decides whether to
    // pull by comparing this number with the one it last saw; writing the
    // snapshot's old version here would make a restore invisible to every phone
    // that is already up to date — the one failure that would make this feature
    // worse than useless.
    // `restoredAt` (M47) is what makes a restore *win*.
    //
    // The clients merge, they do not replace — that is the whole of M4's LWW
    // contract and it is right for two phones editing one trip. But a restore
    // is the one write where the server's copy must beat everybody's: without
    // this stamp, the first device to sync would helpfully merge the entities
    // the restore just removed straight back in. A client that sees a stamp
    // newer than the last one it acted on adopts the payload wholesale.
    $restored = encode([
        'version'    => $currentVersion + 1,
        'updatedAt'  => now_ms(),
        'restoredAt' => now_ms(),
        'data'       => $snapDecoded->data,
    ]);

    if (!write_atomic($dataFile, $restored)) {
        flock($lock, LOCK_UN);
        fclose($lock);
        fail(500, 'storage_error', '복원에 실패했어요.');
    }

    flock($lock, LOCK_UN);
    fclose($lock);
    respond(200, admin_state($dataDir, $archiveDir, $active));
}

fail(400, 'bad_request', '알 수 없는 action이에요.');
