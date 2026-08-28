/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

/** 30 days, the OSM tile cache's ceiling. */
const THIRTY_DAYS = 30 * 24 * 60 * 60;

// https://vite.dev/config/
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // Never reload out from under someone mid-trip: a waiting worker raises
      // `onNeedRefresh` and UpdateToast asks first.
      registerType: 'prompt',
      // The dev server must stay a plain dev server — a service worker there
      // would sit in front of every e2e run and every HMR update.
      devOptions: { enabled: false },
      includeAssets: ['icons/icon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'Trip Board',
        short_name: 'TripBoard',
        description: '여행 아이디어를 모으고 일정으로 만드는 보드',
        lang: 'ko',
        theme_color: '#f5f4f1',
        background_color: '#f5f4f1',
        display: 'standalone',
        orientation: 'portrait',
        // Relative so a VITE_BASE subpath install (GitHub Pages, a NAS folder)
        // scopes itself correctly without rebuilding the manifest.
        start_url: './',
        scope: './',
        icons: [
          { src: 'icons/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        navigateFallback: 'index.html',
        // The sync, AI and photo endpoints are APIs, not routes: never hand
        // them the shell. `ai.php` is also never runtime-cached — an AI answer
        // is a one-off, and a cached one would be a lie with a timestamp.
        //
        // `image.php` is not runtime-cached either, and that is not an
        // oversight: its responses already carry `immutable, max-age=1y`, so
        // the browser's own HTTP cache holds them for free. A workbox entry on
        // top would be a second copy of every photo inside the service
        // worker's storage — the one budget a phone actually runs out of.
        //
        // `bootstrap-config.json` (M41): 서버가 실제로 주는 파일인데도 SPA
        // 폴백에 걸려 `index.html`이 돌아오던 자리다 — 사용자가 주소창에 직접
        // 열어 보고 HTML을 받았다. 앱의 `fetch`는 그 HTML을 JSON으로 읽으려다
        // 실패하고 「파일 없음」과 구분되지 않는 조용한 실패가 된다.
        navigateFallbackDenylist: [
          /\/api\//,
          /data\.php/,
          /ai\.php/,
          /image\.php/,
          /bootstrap-config\.json/,
        ],
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // Map tiles are immutable and expensive; everything else the app
            // talks to (data.php, nominatim) is deliberately left uncached so
            // it can never serve stale trip data or stale search results.
            //
            // 구글 지도(M41)도 그 「everything else」다: `maps.googleapis.com`·
            // `maps.gstatic.com`은 여기 없으므로 서비스워커가 가로채지 않고
            // 네트워크로 곧장 간다. 일부러 그렇게 둔다 — 구글 스크립트는 자기
            // 캐시 정책과 버전 채널(`v=weekly`)을 들고 다니고, 그 위에 우리
            // 캐시를 한 겹 얹으면 어느 날 낡은 API가 새 키로 뜬다.
            urlPattern: /^https:\/\/[a-c]\.tile\.openstreetmap\.org\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'osm-tiles',
              expiration: { maxEntries: 400, maxAgeSeconds: THIRTY_DAYS },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
  },
});
