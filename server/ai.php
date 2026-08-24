<?php
/**
 * Trip Board — the Gemini proxy (M11).
 *
 * The browser never sees the API key. It talks to *this* file with the same
 * `X-Sync-Token` it already uses for `data.php`, and this file talks to Google
 * with `GEMINI_API_KEY` out of `config.php`. That is the whole reason the proxy
 * exists: a key shipped to the client is a key on a pastebin, and the app is
 * also published to GitHub Pages where there is no server at all.
 *
 * Same house style as `data.php`: one file, PHP 7.4+, no Composer, no
 * framework, JSON in and JSON out, and every error is a JSON body rather than
 * an HTML stack trace.
 *
 * ## Contract
 *
 *   GET  ?ping=1  → 200 {"ok":true,"ai":true}   a key is configured
 *                   200 {"ok":true,"ai":false}  no key — still 200, because
 *                                               "AI is off here" is an answer,
 *                                               not a failure
 *   POST {"kind":"suggest"|"review"|"ask",
 *         "prompt":"…",
 *         "system":"…",        optional systemInstruction
 *         "schema":{…},        optional responseSchema (forces JSON output)
 *         "grounding":true}    optional google_search tool
 *                 → 200 <Gemini's own generateContent body, passed through>
 *                   429 {"error":"rate_limited"}
 *                   502 {"error":"upstream_error","detail":"…"}
 *
 * Every request needs `X-Sync-Token`; anything else is 401 — including the
 * ping, so an unauthenticated scan cannot even learn whether a key is present.
 *
 * ## Why `schema` and `grounding` are mutually exclusive
 *
 * The API rejects `responseSchema` together with a `google_search` tool. The
 * client is told as much, but a client cannot be trusted to remember, so the
 * rule is enforced here: **grounding wins and the schema is dropped**. A
 * grounded answer is prose either way; a schema'd answer that 400s is nothing.
 *
 * ## Rate limiting
 *
 * A counter file per wall-clock minute in `DATA_DIR`. Not a quota system — a
 * fuse, so a stuck retry loop on one phone cannot spend the month's tokens in
 * an afternoon. If the counter cannot be written it fails *open*: refusing
 * every request because a directory turned read-only would be worse.
 */

declare(strict_types=1);

/** Largest POST body we will even look at — prompts are text, not uploads. */
const MAX_BODY_BYTES = 64 * 1024;

/** Requests allowed per wall-clock minute, across all devices. */
const RATE_LIMIT_PER_MIN = 20;

/** How long Gemini gets to answer. Grounded calls are genuinely slow. */
const UPSTREAM_TIMEOUT_S = 30;

/** The model every kind of request goes to. */
const GEMINI_MODEL = 'gemini-2.0-flash';

/** How much of an upstream error body is worth repeating to the client. */
const DETAIL_CHARS = 400;

/** The three things the client is allowed to ask for. */
const KINDS = ['suggest', 'review', 'ask'];

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

/* ------------------------------------------------------------------ *
 * Helpers — deliberately the same three `data.php` uses
 * ------------------------------------------------------------------ */

function encode($value): string
{
    return json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
}

function respond(int $status, $payload)
{
    http_response_code($status);
    echo encode($payload);
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

$syncToken = (string) $config['SYNC_TOKEN'];
$dataDir   = rtrim((string) $config['DATA_DIR'], '/');
// Optional on purpose: a NAS that syncs but has no Gemini key is a supported
// setup, and it answers the ping with `ai:false` rather than an error.
$apiKey    = isset($config['GEMINI_API_KEY']) ? trim((string) $config['GEMINI_API_KEY']) : '';

if ($syncToken === '' || $syncToken === 'change-me-to-a-long-random-string') {
    fail(500, 'not_configured', 'SYNC_TOKEN을 바꿔주세요.');
}

/* ------------------------------------------------------------------ *
 * Auth — before anything touches the disk or the network
 * ------------------------------------------------------------------ */

$presented = $_SERVER['HTTP_X_SYNC_TOKEN'] ?? '';
if (!is_string($presented) || !hash_equals($syncToken, $presented)) {
    fail(401, 'unauthorized');
}

/* ------------------------------------------------------------------ *
 * Routing
 * ------------------------------------------------------------------ */

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'GET' || $method === 'HEAD') {
    if (!isset($_GET['ping'])) {
        fail(400, 'bad_request', 'GET은 ?ping=1만 받아요.');
    }
    // 200 either way: this is a capability probe, and "no key here" is a
    // perfectly good answer that the client turns into a grey status line.
    respond(200, ['ok' => true, 'ai' => $apiKey !== '']);
}

if ($method !== 'POST') {
    header('Allow: GET, POST');
    fail(405, 'method_not_allowed');
}

if ($apiKey === '') {
    fail(503, 'ai_disabled', 'GEMINI_API_KEY가 설정되지 않았어요.');
}

/* --- the request ---------------------------------------------------- */

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

// Objects, not associative arrays — `schema` is passed straight back out to
// Google, and an associative decode would turn its empty objects into `[]`.
$request = json_decode($body);
if (!is_object($request)) {
    fail(400, 'bad_request', 'JSON 본문이 필요해요.');
}

$kind = isset($request->kind) && is_string($request->kind) ? $request->kind : '';
if (!in_array($kind, KINDS, true)) {
    fail(400, 'bad_request', 'kind는 suggest/review/ask 중 하나예요.');
}

$prompt = isset($request->prompt) && is_string($request->prompt) ? trim($request->prompt) : '';
if ($prompt === '') {
    fail(400, 'bad_request', 'prompt가 비어 있어요.');
}

$system    = isset($request->system) && is_string($request->system) ? trim($request->system) : '';
$grounding = isset($request->grounding) && $request->grounding === true;
$schema    = isset($request->schema) && is_object($request->schema) ? $request->schema : null;

/* --- the fuse ------------------------------------------------------- */

/**
 * Counts this request against the current minute. `false` means "over the
 * limit"; an unwritable data dir counts as under it (fail open).
 */
function within_rate_limit(string $dataDir): bool
{
    if (!is_dir($dataDir) && !@mkdir($dataDir, 0770, true) && !is_dir($dataDir)) {
        return true;
    }

    $path   = sprintf('%s/ai-rate-%s.cnt', $dataDir, gmdate('Ymd-Hi'));
    $handle = @fopen($path, 'c+');
    if ($handle === false) {
        return true;
    }
    if (!flock($handle, LOCK_EX)) {
        fclose($handle);
        return true;
    }

    $count = (int) stream_get_contents($handle) + 1;
    rewind($handle);
    ftruncate($handle, 0);
    fwrite($handle, (string) $count);
    fflush($handle);
    flock($handle, LOCK_UN);
    fclose($handle);

    // Two minutes back, so the directory does not slowly fill with dead
    // counters. Cheap, and the file being gone already is fine.
    @unlink(sprintf('%s/ai-rate-%s.cnt', $dataDir, gmdate('Ymd-Hi', time() - 120)));

    return $count <= RATE_LIMIT_PER_MIN;
}

if (!within_rate_limit($dataDir)) {
    fail(429, 'rate_limited');
}

/* --- the upstream call ---------------------------------------------- */

$payload = [
    'contents' => [
        ['role' => 'user', 'parts' => [['text' => $prompt]]],
    ],
];

if ($system !== '') {
    $payload['systemInstruction'] = ['parts' => [['text' => $system]]];
}

if ($grounding) {
    // Grounding wins; see the header comment. `new stdClass()` and not `[]`,
    // or json_encode writes `"google_search":[]` and the API rejects it.
    $payload['tools'] = [['google_search' => new stdClass()]];
} elseif ($schema !== null) {
    $payload['generationConfig'] = [
        'responseMimeType' => 'application/json',
        'responseSchema'   => $schema,
    ];
}

$encoded = encode($payload);
if ($encoded === false) {
    fail(400, 'bad_request', '요청을 JSON으로 만들 수 없어요.');
}

$url = sprintf(
    'https://generativelanguage.googleapis.com/v1beta/models/%s:generateContent?key=%s',
    GEMINI_MODEL,
    rawurlencode($apiKey)
);

/**
 * One POST to Google. Returns `[status, body]`; status `0` means the request
 * never got an answer at all (DNS, TLS, timeout).
 *
 * curl when it exists — a NAS PHP build without it is unusual but not unheard
 * of, so the stream wrapper is there as a fallback rather than an assumption.
 */
function upstream(string $url, string $json): array
{
    $headers = ['Content-Type: application/json', 'Accept: application/json'];

    if (function_exists('curl_init')) {
        $curl = curl_init($url);
        curl_setopt_array($curl, [
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => $json,
            CURLOPT_HTTPHEADER     => $headers,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => UPSTREAM_TIMEOUT_S,
            CURLOPT_CONNECTTIMEOUT => 10,
        ]);
        $raw    = curl_exec($curl);
        $status = (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
        $error  = curl_error($curl);
        curl_close($curl);

        if ($raw === false || $status === 0) {
            return [0, $error !== '' ? $error : '연결 실패'];
        }
        return [$status, (string) $raw];
    }

    $context = stream_context_create([
        'http' => [
            'method'        => 'POST',
            'header'        => implode("\r\n", $headers),
            'content'       => $json,
            'timeout'       => UPSTREAM_TIMEOUT_S,
            'ignore_errors' => true,
        ],
    ]);
    $raw = @file_get_contents($url, false, $context);
    if ($raw === false) {
        return [0, '연결 실패'];
    }

    $status = 0;
    foreach ($http_response_header ?? [] as $line) {
        if (preg_match('#^HTTP/\S+\s+(\d{3})#', $line, $match)) {
            $status = (int) $match[1];
        }
    }
    return [$status ?: 200, (string) $raw];
}

list($status, $raw) = upstream($url, $encoded);

if ($status === 200) {
    // Straight through. Every field the client needs — candidates, parts,
    // groundingMetadata — is Gemini's own, and re-wrapping it here would mean
    // chasing the API's shape in two places instead of one.
    echo $raw;
    exit;
}

// Never repeat the whole upstream body: it can be long, and the key is in the
// URL rather than the body but there is no reason to gamble on that staying
// true. A trimmed first paragraph is enough to tell a 400 from a 429.
// `mb_substr` where mbstring exists (it cannot split a multi-byte character in
// half); plain `substr` otherwise, since a NAS build without mbstring should
// still get a readable error rather than a fatal one.
$head   = function_exists('mb_substr')
    ? mb_substr($raw, 0, DETAIL_CHARS)
    : substr($raw, 0, DETAIL_CHARS);
$detail = trim(preg_replace('/\s+/u', ' ', $head) ?? '');
fail(502, 'upstream_error', $detail === '' ? "HTTP $status" : "HTTP $status — $detail");
