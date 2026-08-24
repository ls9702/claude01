<?php
/**
 * Trip Board — sync configuration.
 *
 * Copy this file to `config.php` next to `data.php` and edit it. `config.php`
 * is gitignored: the token is the only thing standing between the open
 * internet and your trips, so it must never be committed.
 *
 *     cp config.sample.php config.php
 *     php -r 'echo bin2hex(random_bytes(24)), PHP_EOL;'   # a decent token
 *
 * On a Synology NAS, put the whole `server/` folder somewhere Web Station
 * serves (e.g. `/web/travel/api/`) and make sure the web user can write to
 * DATA_DIR. Nothing else needs configuring — no database, no Docker.
 */

return [
    /**
     * Shared secret the app sends in the `X-Sync-Token` header. Any long random
     * string; compared with hash_equals, so length is the only thing that
     * matters. CHANGE THIS.
     */
    'SYNC_TOKEN' => 'change-me-to-a-long-random-string',

    /**
     * Where the workspace and its rotating backups live. Keep it OUTSIDE the
     * web root if you can (e.g. '/volume1/trip-board-data') — then even a
     * misconfigured server cannot hand `data.json` out over plain HTTP.
     */
    'DATA_DIR' => __DIR__ . '/data',

    /**
     * Google AI Studio key for the AI 도우미 (M11), used only by `ai.php`.
     *
     * Leave it empty and everything else keeps working: `ai.php?ping=1` then
     * answers `{"ok":true,"ai":false}` and the app hides its ✨ buttons. The
     * key never reaches the browser — that is the entire point of `ai.php`.
     *
     *     https://aistudio.google.com/apikey
     */
    'GEMINI_API_KEY' => '',
];
