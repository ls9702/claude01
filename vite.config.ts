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
        // The sync endpoint is an API, not a route: never hand it the shell.
        navigateFallbackDenylist: [/\/api\//, /data\.php/],
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // Map tiles are immutable and expensive; everything else the app
            // talks to (data.php, nominatim) is deliberately left uncached so
            // it can never serve stale trip data or stale search results.
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
