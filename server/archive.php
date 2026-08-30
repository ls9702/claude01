<?php
/**
 * Trip Board — 여행 사진 NAS 보관함 (M46).
 *
 * The opposite of `image.php` in the one way that matters. A card photo is
 * *content*: the client shrinks it to 500KB because it will be rendered in a
 * 96px tile on a phone and synced to two devices forever. A photo filed here is
 * an **original**, on its way to the NAS to be kept — so nothing is resized,
 * nothing is recompressed, and the bytes that leave the camera are the bytes
 * that land on the disk. That is the whole feature.
 *
 * It is also not part of the plan: nothing in the workspace points at these
 * files, no sync ever reads them back, and deleting one changes nothing in the
 * app. This is an upload button that happens to be in a trip planner.
 *
 * ## Contract
 *
 *   GET  ?check=1            → 200 {"ok":true,"writable":bool,"folder":"…"}  (M47)
 *   POST ?name=<원본 파일명>  → 200 {"ok":true,"path":"<folder>/<file>","bytes":N}
 *                              400 {"error":"bad_name"|"bad_type"|"empty"}
 *                              409 {"error":"no_folder"}   보관 폴더 미설정
 *                              413 {"error":"payload_too_large"}
 *                              500 {"error":"not_configured"|"storage_error"}
 *   other                    → 405
 *
 * Auth is `X-Sync-Token`, **not** the admin token: filing a photo is something
 * both travellers do all week, while choosing *where* the photos go is a
 * one-time decision that belongs to the administrator (`admin.php`).
 *
 * ## Where the bytes land
 *
 *   ARCHIVE_DIR (config.php) / <folder> / <safe original name>
 *
 * `ARCHIVE_DIR` is the base and comes from a file only the owner can edit. The
 * only thing the admin screen can choose is `<folder>`, a single subfolder name
 * matched against a whitelist regex — lowercase letters, digits, hyphens. There
 * is no `.` in that set, so there is no `..`, so a photo can never be written
 * outside the base no matter what arrives over the wire.
 *
 * The filename is rebuilt rather than trusted: directory parts are dropped, the
 * extension must be one of {@link ALLOWED_EXTENSIONS}, and everything outside
 * `[A-Za-z0-9._-]` becomes `_`. A name that is already taken gets a timestamp
 * suffix instead of overwriting — the whole point of an archive is that nothing
 * in it disappears.
 *
 * ## Videos
 *
 * Deliberately not accepted. A phone's 4K clip is hundreds of megabytes, PHP
 * would have to be reconfigured to take one, and a browser upload with no
 * resume is the wrong tool for it — File Station is right there. Photos only.
 */

declare(strict_types=1);

/**
 * Largest single photo accepted, 64MB.
 *
 * Comfortably above a 48-megapixel HEIC or a RAW-ish JPEG, and well under what
 * `upload_max_filesize` / `post_max_size` are usually set to. PHP's own limits
 * still win; when they bite, the body arrives empty and we say so in Korean.
 */
const MAX_BODY_BYTES = 64 * 1024 * 1024;

/** Photo extensions we will file. Videos are deliberately absent — see above. */
const ALLOWED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'heic', 'heif', 'webp'];

/** Archive subfolder names — same whitelist shape as a session id. */
const FOLDER_PATTERN = '/^[a-z0-9][a-z0-9-]{0,63}$/';

/** Longest stored filename, extension included. */
const MAX_NAME_LEN = 120;

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

/**
 * Rebuilds a filename out of what arrived, or `null` when there is no usable
 * photo name in it.
 *
 * Never trusts, always reconstructs: `basename` first (so `../../etc/passwd`
 * becomes `passwd`), then the extension is checked against the whitelist, then
 * the stem is scrubbed down to `[A-Za-z0-9._-]`. A stem that scrubs away to
 * nothing — a Korean filename, which is the common case here — becomes `photo`,
 * because a name of `.jpg` is not a name.
 */
function safe_archive_name(string $raw): ?string
{
    $name = basename(str_replace('\\', '/', trim($raw)));
    if ($name === '' || $name === '.' || $name === '..') {
        return null;
    }

    $dot = strrpos($name, '.');
    if ($dot === false || $dot === 0) {
        return null;
    }
    $ext = strtolower(substr($name, $dot + 1));
    if (!in_array($ext, ALLOWED_EXTENSIONS, true)) {
        return null;
    }

    $stem = substr($name, 0, $dot);
    $stem = preg_replace('/[^A-Za-z0-9._-]+/', '_', $stem) ?? '';
    $stem = trim($stem, '._-');
    if ($stem === '') {
        $stem = 'photo';
    }
    $stem = substr($stem, 0, MAX_NAME_LEN - strlen($ext) - 1);

    return $stem . '.' . $ext;
}

/**
 * A path in `$dir` that is not taken yet.
 *
 * First the name as given; then `<stem>-YYYYMMDD-HHMMSS.<ext>`, which is what
 * two phones filing `IMG_0001.jpg` from the same trip actually need; then a
 * counter, for the pathological case of two uploads in the same second.
 */
function unique_target(string $dir, string $name): ?string
{
    if (!file_exists($dir . '/' . $name)) {
        return $dir . '/' . $name;
    }

    $dot  = strrpos($name, '.');
    $stem = substr($name, 0, (int) $dot);
    $ext  = substr($name, (int) $dot + 1);

    $stamped = sprintf('%s-%s.%s', $stem, date('Ymd-His'), $ext);
    if (!file_exists($dir . '/' . $stamped)) {
        return $dir . '/' . $stamped;
    }

    for ($i = 2; $i < 100; $i += 1) {
        $candidate = sprintf('%s-%s-%d.%s', $stem, date('Ymd-His'), $i, $ext);
        if (!file_exists($dir . '/' . $candidate)) {
            return $dir . '/' . $candidate;
        }
    }
    return null;
}

/** Writes bytes atomically: temp file in the same directory, then `rename()`. */
function write_atomic(string $target, string $contents): bool
{
    $tmp = tempnam(dirname($target), '.archive-');
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
 * Configuration
 * ------------------------------------------------------------------ */

$configPath = __DIR__ . '/config.php';
if (!is_file($configPath)) {
    fail(500, 'not_configured', 'config.php가 없어요. config.sample.php를 복사하세요.');
}

$config = require $configPath;
if (!is_array($config) || !isset($config['SYNC_TOKEN'], $config['DATA_DIR'])) {
    fail(500, 'not_configured', 'config.php에 SYNC_TOKEN과 DATA_DIR이 필요해요.');
}

$syncToken  = (string) $config['SYNC_TOKEN'];
$dataDir    = rtrim((string) $config['DATA_DIR'], '/');
$archiveDir = isset($config['ARCHIVE_DIR']) ? rtrim((string) $config['ARCHIVE_DIR'], '/') : '';

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

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

/* ------------------------------------------------------------------ *
 * ?check=1 — 키 점검 (M47)
 *
 * "Can a photo be filed right now?", answered without filing one. Three things
 * have to line up — a base path in config.php, a folder the administrator
 * chose, and a web user who can write to it — and each fails differently and
 * silently. This says which.
 * ------------------------------------------------------------------ */

if (($method === 'GET' || $method === 'HEAD') && isset($_GET['check'])) {
    $folder = '';
    $settingsRaw = @file_get_contents($dataDir . '/archive-settings.json');
    if (is_string($settingsRaw) && $settingsRaw !== '') {
        $settings = json_decode($settingsRaw, true);
        if (is_array($settings) && isset($settings['folder']) && is_string($settings['folder'])) {
            $folder = $settings['folder'];
        }
    }

    if ($archiveDir === '') {
        respond(200, ['ok' => true, 'writable' => false, 'folder' => '', 'detail' => 'config.php에 ARCHIVE_DIR이 없어요.']);
    }
    if ($folder === '' || preg_match(FOLDER_PATTERN, $folder) !== 1) {
        respond(200, ['ok' => true, 'writable' => false, 'folder' => $folder, 'detail' => '보관 폴더가 정해지지 않았어요.']);
    }

    $dir = $archiveDir . '/' . $folder;
    // Created here on purpose: "the folder does not exist yet" is not a failure
    // the owner should have to go and fix by hand — the first upload would have
    // made it anyway, and doing it now is what makes the ✓ honest.
    if (!is_dir($dir)) {
        @mkdir($dir, 0770, true);
    }
    $writable = is_dir($dir) && is_writable($dir);

    respond(200, [
        'ok'       => true,
        'writable' => $writable,
        'folder'   => $folder,
        'detail'   => $writable ? '' : '보관 폴더에 쓸 수 없어요. ARCHIVE_DIR 권한을 확인해 주세요.',
    ]);
}

if ($method !== 'POST') {
    header('Allow: GET, POST');
    fail(405, 'method_not_allowed');
}

if ($archiveDir === '') {
    fail(500, 'not_configured', 'config.php에 ARCHIVE_DIR을 설정해 주세요.');
}

/* ------------------------------------------------------------------ *
 * Where to (the admin's folder) and what to call it
 * ------------------------------------------------------------------ */

$folder = '';
$settingsRaw = @file_get_contents($dataDir . '/archive-settings.json');
if (is_string($settingsRaw) && $settingsRaw !== '') {
    $settings = json_decode($settingsRaw, true);
    if (is_array($settings) && isset($settings['folder']) && is_string($settings['folder'])) {
        $folder = $settings['folder'];
    }
}
// Revalidated here even though `admin.php` validated it on the way in: this is
// the side that turns the string into a path, and the file it came from is one
// a hand edit can reach.
if ($folder === '' || preg_match(FOLDER_PATTERN, $folder) !== 1) {
    fail(409, 'no_folder', '보관할 폴더가 아직 정해지지 않았어요. 관리자에게 문의해 주세요.');
}

$name = safe_archive_name((string) ($_GET['name'] ?? ''));
if ($name === null) {
    fail(400, 'bad_type', '사진 파일만 보관할 수 있어요 (jpg·png·heic·webp).');
}

/* ------------------------------------------------------------------ *
 * The bytes
 * ------------------------------------------------------------------ */

$declared = isset($_SERVER['CONTENT_LENGTH']) ? (int) $_SERVER['CONTENT_LENGTH'] : 0;
if ($declared > MAX_BODY_BYTES) {
    fail(413, 'payload_too_large', '사진 한 장이 너무 커요 (최대 64MB).');
}

$body = file_get_contents('php://input', false, null, 0, MAX_BODY_BYTES + 1);

// PHP's own ceilings (`post_max_size`, `upload_max_filesize`) cut the body off
// before this file ever runs, and what that looks like from here is a declared
// length with nothing behind it. Saying "본문이 비어 있어요" for that would send
// the owner looking for a bug in the app instead of at php.ini.
if (($body === false || $body === '') && $declared > 0) {
    fail(
        413,
        'php_limit',
        '서버가 받을 수 있는 크기를 넘었어요. NAS의 PHP 설정(post_max_size·upload_max_filesize)을 올려 주세요.',
    );
}
if ($body === false || $body === '') {
    fail(400, 'empty', '보낼 사진이 없어요.');
}
if (strlen($body) > MAX_BODY_BYTES) {
    fail(413, 'payload_too_large', '사진 한 장이 너무 커요 (최대 64MB).');
}

$dir = $archiveDir . '/' . $folder;
if (!is_dir($dir) && !@mkdir($dir, 0770, true) && !is_dir($dir)) {
    fail(500, 'storage_error', '보관 폴더를 만들 수 없어요. ARCHIVE_DIR 권한을 확인해 주세요.');
}
if (!is_writable($dir)) {
    fail(500, 'storage_error', '보관 폴더에 쓸 수 없어요. ARCHIVE_DIR 권한을 확인해 주세요.');
}

$target = unique_target($dir, $name);
if ($target === null || !write_atomic($target, $body)) {
    fail(500, 'storage_error', '저장에 실패했어요.');
}

// The response names the *relative* place — `2026-11-osaka/IMG_0001.jpg`. The
// absolute base is the owner's business and is already on the admin screen;
// echoing it to every phone would put a NAS volume path in a chat screenshot.
respond(200, [
    'ok'     => true,
    'folder' => $folder,
    'name'   => basename($target),
    'path'   => $folder . '/' . basename($target),
    'bytes'  => strlen($body),
]);
