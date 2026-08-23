/**
 * Types for the `virtual:pwa-register` module that vite-plugin-pwa injects at
 * build time. Without this reference `tsc --noEmit` cannot resolve the import
 * in `UpdateToast.tsx` — the module only exists inside Vite.
 */
/// <reference types="vite-plugin-pwa/client" />
