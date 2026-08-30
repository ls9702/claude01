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
     * Second shared secret, for `admin.php` only (M46).
     *
     * This is the password the 설정 → 관리자 screen asks for. It buys three
     * things the sync token deliberately does not: making a session, renaming
     * one, and **switching which session everybody sees**. Both travellers hold
     * SYNC_TOKEN; only the person who runs the NAS should hold this one, so
     * make it a different string, not the same one.
     *
     *     php -r 'echo bin2hex(random_bytes(24)), PHP_EOL;'
     *
     * Leave it as it is and `admin.php` answers 500 not_configured — the app
     * simply keeps working on the single (default) session, exactly as before.
     */
    'ADMIN_TOKEN' => 'change-me-to-another-long-random-string',

    /**
     * Where the workspace and its rotating backups live. Keep it OUTSIDE the
     * web root if you can (e.g. '/volume1/trip-board-data') — then even a
     * misconfigured server cannot hand `data.json` out over plain HTTP.
     *
     * Since M46 the layout underneath is one level deeper, so that several
     * groups can share one address:
     *
     *     DATA_DIR/active.json                  {"active":"default"}
     *     DATA_DIR/sessions/<id>/data.json      the workspace + backups + daily/
     *     DATA_DIR/sessions/<id>/photos/        card photos, one JPEG per id
     *
     * Nothing to do on an existing install: the first request after the upgrade
     * moves `data.json` and `photos/` into `sessions/default/` by itself, once.
     * Budget the space the same way as before — ~500KB per photo, 12 per card.
     */
    'DATA_DIR' => __DIR__ . '/data',

    /**
     * 여행 사진 보관함 (M46) — where 📤 「사진 보관」 files its originals.
     *
     * A base path, and only a base path. The 관리자 screen chooses the single
     * subfolder under it (`2026-11-osaka` and the like); nothing the browser
     * sends can escape this directory. Point it at a normal Synology shared
     * folder so the photos show up in File Station and Photos as themselves:
     *
     *     '/volume1/photo/trip-board'
     *
     * The web user has to be able to write here. Leave it empty and the
     * 사진 보관 button says the archive is not set up yet; everything else in
     * the app is unaffected.
     */
    'ARCHIVE_DIR' => '',

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

    /**
     * Optional: which Gemini model ai.php calls. Leave it out to use the
     * default (gemini-2.5-flash). Set e.g. 'gemini-2.5-pro' if you prefer.
     */
    // 'GEMINI_MODEL' => 'gemini-2.5-flash',
];
