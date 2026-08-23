/**
 * Generates the PWA's PNG icons from `public/icons/icon.svg`.
 *
 * Launchers are still stubbornly PNG-only (Chromium will take an SVG, iOS and
 * most Android launchers will not), so the SVG is the source of truth and the
 * PNGs are build artefacts — *committed* build artefacts, because this runs
 * once by hand rather than on every `npm run build`:
 *
 *     node scripts/gen-icons.mjs
 *
 * The rasterizer is the Chromium that Playwright already installed for the e2e
 * suite. That is deliberate: no `sharp`, no `canvas`, no native toolchain, and
 * nothing new in `package.json` for a script that runs a handful of times in
 * the project's life.
 *
 * `maskable-512x512.png` is a separate drawing rather than a crop: Android
 * masks the icon down to a circle inscribed in the middle 80%, so the plane is
 * shrunk to ~58% and the background bleeds to all four edges.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ICONS_DIR = join(ROOT, 'public', 'icons');
const SOURCE = join(ICONS_DIR, 'icon.svg');

/** `{ file, size, maskable }` — everything the manifest references. */
const TARGETS = [
  { file: 'pwa-192x192.png', size: 192, maskable: false },
  { file: 'pwa-512x512.png', size: 512, maskable: false },
  { file: 'apple-touch-icon.png', size: 180, maskable: false },
  { file: 'maskable-512x512.png', size: 512, maskable: true },
];

/**
 * Rebuilds the source SVG as a full-bleed maskable variant: square background,
 * plane scaled about the centre so it sits inside Android's safe zone.
 */
function toMaskable(svg) {
  const SAFE = 0.58;
  const offset = (512 * (1 - SAFE)) / 2;
  return svg
    .replace(/rx="112" ry="112"/, 'rx="0" ry="0"')
    .replace(/<path/, `<g transform="translate(${offset} ${offset}) scale(${SAFE})"><path`)
    .replace(/<\/svg>/, '</g></svg>');
}

async function main() {
  const svg = await readFile(SOURCE, 'utf8');
  await mkdir(ICONS_DIR, { recursive: true });

  const browser = await chromium.launch();
  try {
    for (const { file, size, maskable } of TARGETS) {
      const markup = maskable ? toMaskable(svg) : svg;
      const page = await browser.newPage({
        viewport: { width: size, height: size },
        deviceScaleFactor: 1,
      });

      // The SVG is inlined rather than loaded as an <img src>: no file:// URL,
      // no cache, and `width/height: 100%` makes it fill the viewport exactly.
      await page.setContent(
        `<!doctype html><meta charset="utf-8">
         <style>
           html,body{margin:0;padding:0;background:transparent}
           svg{display:block;width:${size}px;height:${size}px}
         </style>
         ${markup}`,
        { waitUntil: 'load' },
      );

      const png = await page.screenshot({ omitBackground: true, type: 'png' });
      await writeFile(join(ICONS_DIR, file), png);
      await page.close();
      console.log(`  ✓ ${file} (${size}×${size}${maskable ? ', maskable' : ''}) — ${png.length} B`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
