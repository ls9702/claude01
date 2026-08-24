<?php
/**
 * Trip Board — 사진 원본 보관소 (M20).
 *
 * The sibling of `data.php`, and deliberately its opposite in every way that
 * matters. `data.php` holds one small JSON document that every device rewrites
 * constantly; this holds many large opaque blobs that are written **once** and
 * then never change. So there is no version counter here, no lock file, no
 * merge: a photo id is minted client-side from a nanoid and the bytes under it
 * are immutable for the lifetime of that id. Two devices "racing" to upload the
 * same id are uploading the same JPEG, and the last rename wins harmlessly.
 *
 * That immutability is the whole reason this file is worth having: it lets the
 * response carry a one-year `immutable` cache header, so a phone that has
 * scrolled a trip once never asks for those pixels again.
 *
 * ## Contract
 *
 *   GET    ?id=<id>  → 200 image/jpeg + the bytes
 *                      404 {"error":"not_found"}
 *   PUT    ?id=<id>  → 200 {"ok":true}   (raw JPEG body, ≤ MAX_BODY_BYTES)
 *                      413 {"error":"payload_too_large"}
 *   DELETE ?id=<id>  → 200 {"ok":true}   (also when it was already gone)
 *   other            → 405
 *
 * Every request needs `X-Sync-Token`; anything else is 401 — checked before a
 * single byte of disk is touched, exactly as in `data.php`.
 *
 * ## Why PUT and DELETE are both idempotent
 *
 * The client's uploader is a retry loop with a per-server "already uploaded"
 * set in `localStorage`, and that set can be lost (private window, cleared
 * site data) or be keyed under a different server address after a bootstrap
 * migration. Re-uploading bytes that are already there must therefore be a
 * boring 200, not a conflict. The same goes for the GC: it deletes ids it
 * believes are unreferenced, and two devices sweeping the same tombstone must
 * not turn the second one into an error on someone's phone.
 *
 * ## Storage
 *
 * `DATA_DIR/photos/<id>.jpg`, one flat directory. A two-person trip planner
 * produces hundreds of files, not millions, so sharding would be cosplay.
 * Writes go through a temp file + `rename()` — atomic on one filesystem — so a
 * reader never sees a half-uploaded photo.
 *
 * CORS is deliberately absent, same as `data.php`: same-origin deployment.
 */

declare(strict_types=1);

/**
 * Largest photo body accepted, 600KB.
 *
 * The client compresses to `MAX_PHOTO_BYTES` (500KB) before it ever gets here;
 * the extra 100KB is slack for a JPEG that landed just over the ladder's last
 * rung, not an invitation to upload originals.
 */
const MAX_BODY_BYTES = 600 * 1024;

/** Ids are client-minted nanoids. Anything outside this set never sees the disk. */
const ID_PATTERN = '/^[A-Za-z0-9_-]{6,64}$/';

header('X-Content-Type-Options: nosniff');

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

/** Sends a JSON body with a status code and stops. */
function respond(int $status, $payload)
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
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

/**
 * Writes bytes atomically: temp file in the same directory, then `rename()`.
 * The rename is what makes it atomic, so the temp file has to live on the same
 * filesystem — hence the target's own directory rather than sys temp.
 */
function write_atomic(string $target, string $contents): bool
{
    $tmp = tempnam(dirname($target), '.photo-');
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

/** @var array{SYNC_TOKEN:string, DATA_DIR:string} $config */
$config = require $configPath;

if (!is_array($config) || !isset($config['SYNC_TOKEN'], $config['DATA_DIR'])) {
    fail(500, 'not_configured', 'config.php에 SYNC_TOKEN과 DATA_DIR이 필요해요.');
}

$syncToken = (string) $config['SYNC_TOKEN'];
$photoDir  = rtrim((string) $config['DATA_DIR'], '/') . '/photos';

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
 * Id — the only piece of user input that becomes a path
 * ------------------------------------------------------------------ */

$id = $_GET['id'] ?? '';
if (!is_string($id) || preg_match(ID_PATTERN, $id) !== 1) {
    fail(400, 'bad_request', 'id가 올바르지 않아요.');
}

$file   = $photoDir . '/' . $id . '.jpg';
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

/* ------------------------------------------------------------------ *
 * Routing
 * ------------------------------------------------------------------ */

if ($method === 'GET' || $method === 'HEAD') {
    if (!is_file($file)) {
        fail(404, 'not_found');
    }
    header('Content-Type: image/jpeg');
    // Content-addressed by a client-minted id whose bytes never change, so the
    // strongest cache directive there is, is also the correct one. `private`
    // because a shared proxy has no business holding someone's trip photos.
    header('Cache-Control: private, max-age=31536000, immutable');
    header('Content-Length: ' . (string) filesize($file));
    if ($method === 'GET') {
        readfile($file);
    }
    exit;
}

if ($method === 'PUT') {
    // Refuse an oversized upload on the advertised length, before reading it
    // into memory — the same order `data.php` uses.
    $declared = isset($_SERVER['CONTENT_LENGTH']) ? (int) $_SERVER['CONTENT_LENGTH'] : 0;
    if ($declared > MAX_BODY_BYTES) {
        fail(413, 'payload_too_large');
    }

    $body = file_get_contents('php://input', false, null, 0, MAX_BODY_BYTES + 1);
    if ($body === false || $body === '') {
        fail(400, 'bad_request', '본문이 비어 있어요.');
    }
    if (strlen($body) > MAX_BODY_BYTES) {
        fail(413, 'payload_too_large');
    }

    if (!is_dir($photoDir) && !@mkdir($photoDir, 0770, true) && !is_dir($photoDir)) {
        fail(500, 'storage_error', '사진 폴더를 만들 수 없어요.');
    }
    if (!is_writable($photoDir)) {
        fail(500, 'storage_error', '사진 폴더에 쓸 수 없어요.');
    }

    // Overwriting an existing id with identical bytes is the normal retry
    // path, not an error — see the module doc.
    if (!write_atomic($file, $body)) {
        fail(500, 'storage_error', '저장에 실패했어요.');
    }

    respond(200, ['ok' => true]);
}

if ($method === 'DELETE') {
    if (is_file($file)) {
        @unlink($file);
    }
    // Already gone is the outcome the caller wanted. 200 either way.
    respond(200, ['ok' => true]);
}

header('Allow: GET, PUT, DELETE');
fail(405, 'method_not_allowed');
