/**
 * 사진 압축 (M10) — a phone photo is 4MB; a card wants a 200KB one.
 *
 * Everything a card photo goes through happens **once, on the way in**: decode,
 * downscale to {@link MAX_EDGE_PX} on the long edge, and re-encode as JPEG
 * until it fits {@link MAX_PHOTO_BYTES}. What lands in IndexedDB is the final
 * article — nothing is ever recompressed at render time, and the original file
 * is never kept (this is a planner, not a photo library).
 *
 * The DOM half (canvas, `createImageBitmap`) cannot run under vitest's node
 * environment, so every *decision* it makes is factored out into pure helpers —
 * {@link fitWithin} and {@link nextAttempt} — which are the parts that can be
 * wrong in an interesting way.
 */

/** Longest edge kept, in px. A 1600px photo still fills a retina lightbox. */
export const MAX_EDGE_PX = 1600;

/** JPEG quality the first attempt encodes at. */
export const JPEG_QUALITY = 0.8;

/** Byte ceiling one stored photo aims for (500KB). */
export const MAX_PHOTO_BYTES = 500 * 1024;

/** Qualities the ladder walks down before it gives up on quality alone. */
const QUALITY_LADDER = [0.8, 0.7, 0.6, 0.5] as const;

/** Quality used for the one retry at half the edge cap. */
const HALVED_QUALITY = 0.7;

/** A photo ready to be stored: the encoded bytes plus what they turned out as. */
export interface PreparedPhoto {
  buf: ArrayBuffer;
  w: number;
  h: number;
  bytes: number;
}

/** Width/height after fitting inside a square of `maxEdge`. Never upscales. */
export function fitWithin(
  w: number,
  h: number,
  maxEdge: number = MAX_EDGE_PX,
): { w: number; h: number } {
  const safe = (value: number): number =>
    Number.isFinite(value) && value > 0 ? value : 1;
  const width = safe(w);
  const height = safe(h);
  const cap = Number.isFinite(maxEdge) && maxEdge > 0 ? maxEdge : MAX_EDGE_PX;

  const longest = Math.max(width, height);
  if (longest <= cap) return { w: Math.round(width), h: Math.round(height) };

  const scale = cap / longest;
  // `max(1, …)` so a 4000×3 panorama keeps a drawable height.
  return {
    w: Math.max(1, Math.round(width * scale)),
    h: Math.max(1, Math.round(height * scale)),
  };
}

/** One rung of the compression ladder. */
export interface Attempt {
  quality: number;
  /** Long-edge cap for this attempt, in px. */
  maxEdge: number;
}

/** The first rung: full edge cap at the nominal quality. */
export const firstAttempt = (maxEdge: number = MAX_EDGE_PX): Attempt => ({
  quality: QUALITY_LADDER[0],
  maxEdge,
});

/**
 * What to try after `attempt` produced `bytes` — or `null` for "stop, this is
 * as good as it gets".
 *
 * The ladder walks the quality down first (0.8 → 0.5), because dropping pixels
 * is the more visible loss. Only when the smallest quality is still over
 * budget does the edge cap halve, once, at a middling quality. After that the
 * result is **accepted** whatever its size: a photo the user picked must end up
 * on the card, and refusing a stubborn 700KB panorama would be a worse answer
 * than storing it.
 */
export function nextAttempt(
  attempt: Attempt,
  bytes: number,
  limit: number = MAX_PHOTO_BYTES,
  baseEdge: number = MAX_EDGE_PX,
): Attempt | null {
  if (bytes <= limit) return null;

  // Already at half the edge cap — that was the last rung.
  if (attempt.maxEdge < baseEdge) return null;

  const rung = QUALITY_LADDER.indexOf(attempt.quality as (typeof QUALITY_LADDER)[number]);
  const nextQuality = rung >= 0 ? QUALITY_LADDER[rung + 1] : undefined;
  if (nextQuality !== undefined) return { quality: nextQuality, maxEdge: attempt.maxEdge };

  // Quality is spent: halve the picture once and try a middling quality again.
  return { quality: HALVED_QUALITY, maxEdge: Math.max(1, Math.round(baseEdge / 2)) };
}

/* ------------------------------------------------------------------ *
 * DOM half — not reachable from vitest's node environment
 * ------------------------------------------------------------------ */

/** What a decoded source looks like to the scaler; both branches satisfy it. */
type Decoded = { width: number; height: number; source: CanvasImageSource; close: () => void };

/**
 * Decodes a picked file, honouring its EXIF orientation.
 *
 * Three attempts, in order of how much we trust them:
 *  1. `createImageBitmap(file, {imageOrientation:'from-image'})` — the only one
 *     that rotates an iPhone portrait shot for us.
 *  2. the same call **without** the options bag: older Safari throws outright
 *     on an unknown option rather than ignoring it.
 *  3. an `<img>` on an object URL — always available, and the browser applies
 *     EXIF orientation to `<img>` rendering by itself.
 */
async function decode(file: Blob): Promise<Decoded> {
  if (typeof createImageBitmap === 'function') {
    for (const options of [{ imageOrientation: 'from-image' as const }, undefined]) {
      try {
        const bitmap = options
          ? await createImageBitmap(file, options)
          : await createImageBitmap(file);
        return {
          width: bitmap.width,
          height: bitmap.height,
          source: bitmap,
          close: () => bitmap.close(),
        };
      } catch {
        /* fall through to the next strategy */
      }
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    if (typeof image.decode === 'function') {
      await image.decode();
    } else {
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error('사진을 읽지 못했어요'));
      });
    }
    return {
      width: image.naturalWidth || image.width,
      height: image.naturalHeight || image.height,
      source: image,
      // The URL is what has to be released here; the element is garbage.
      close: () => URL.revokeObjectURL(url),
    };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

/** Canvas → JPEG blob. `toBlob` is callback-shaped and can hand back `null`. */
function encode(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('사진을 변환하지 못했어요'))),
      'image/jpeg',
      quality,
    );
  });
}

/** Draws `decoded` into a fresh canvas at `size`. */
function draw(decoded: Decoded, size: { w: number; h: number }): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size.w;
  canvas.height = size.h;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('사진을 변환하지 못했어요');
  // Slightly better downscaling than the default on every engine that has it.
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(decoded.source, 0, 0, size.w, size.h);
  return canvas;
}

/**
 * Decodes, downscales and JPEG-encodes one picked file.
 *
 * Callers process files **one at a time**: a decoded 12MP bitmap is ~50MB of
 * memory, and five of them at once is how a mobile tab gets killed. The bitmap
 * is closed as soon as the pixels are on the canvas, for the same reason.
 *
 * Throws a Korean `Error` when the file cannot be decoded at all.
 */
export async function preparePhoto(file: Blob): Promise<PreparedPhoto> {
  const decoded = await decode(file);
  let attempt = firstAttempt();
  let best: { blob: Blob; size: { w: number; h: number } } | null = null;

  try {
    // Bounded by construction: `nextAttempt` walks a 4-rung ladder and then one
    // halving, so this cannot loop more than five times.
    for (;;) {
      const size = fitWithin(decoded.width, decoded.height, attempt.maxEdge);
      const blob = await encode(draw(decoded, size), attempt.quality);
      best = { blob, size };

      const next = nextAttempt(attempt, blob.size);
      if (!next) break;
      attempt = next;
    }
  } finally {
    decoded.close();
  }

  const result = best as { blob: Blob; size: { w: number; h: number } };
  return {
    buf: await result.blob.arrayBuffer(),
    w: result.size.w,
    h: result.size.h,
    bytes: result.blob.size,
  };
}

/* ------------------------------------------------------------------ *
 * Rollup + formatting (pure)
 * ------------------------------------------------------------------ */

/**
 * Every photo id the workspace still refers to.
 *
 * Lives here, in a module that imports nothing, because three very different
 * things need the same answer: the GC (delete blobs nobody mentions), the
 * uploader (upload blobs somebody does), and the backup writer. Two of those
 * are in `stores/`, one in `sync/`, and hanging it off either would put a
 * needless edge — in one case a cycle — between them.
 *
 * 메모 photos (M21) count exactly like card photos, and walking them here is
 * the *only* wiring that milestone needed on the photo side: retention, the
 * `image.php` upload, the lazy download and 사진 포함 내보내기 all ask this one
 * question. A workspace with no `memos` field answers it as before.
 */
export function referencedPhotoIds(workspace: {
  cards: Record<string, { photos?: { id: string }[] }>;
  memos?: Record<string, { photos?: { id: string }[] }>;
  drawPages?: Record<string, { background?: { photoId: string } }>;
}): Set<string> {
  const ids = new Set<string>();
  for (const card of Object.values(workspace.cards)) {
    for (const photo of card.photos ?? []) ids.add(photo.id);
  }
  for (const memo of Object.values(workspace.memos ?? {})) {
    for (const photo of memo.photos ?? []) ids.add(photo.id);
  }
  // 드로우 페이지의 배경 (M52b) — **이 세 줄이 없으면 배경은 30초 뒤에
  // 사라진다**. GC는 「워크스페이스가 말하지 않는 블롭」을 지우는 물건이고,
  // 배경은 카드 사진과 똑같이 워크스페이스가 id로만 들고 있는 바이트다.
  // 업로드(`sync/photoSync`)와 사진 포함 백업도 같은 답을 여기서 받는다.
  for (const page of Object.values(workspace.drawPages ?? {})) {
    if (page.background?.photoId) ids.add(page.background.photoId);
  }
  return ids;
}

/** How much of the device's storage the workspace's photos claim. */
export interface PhotoUsage {
  /** Number of photos referenced by a surviving card. */
  count: number;
  /** Sum of their `bytes`. */
  bytes: number;
}

/**
 * Totals every photo the workspace still refers to (M10, + 메모 in M21).
 *
 * Counts *references*, not blobs: an id that appears on two cards — which only
 * a hand-edited backup can produce — is one photo of storage, and a blob no
 * card mentions any more is the GC's business, not the user's.
 */
export function photoUsage(workspace: {
  cards: Record<string, { photos?: { id: string; bytes: number }[] }>;
  memos?: Record<string, { photos?: { id: string; bytes: number }[] }>;
}): PhotoUsage {
  const seen = new Map<string, number>();
  const count = (photos?: { id: string; bytes: number }[]): void => {
    for (const photo of photos ?? []) {
      if (!seen.has(photo.id)) {
        seen.set(photo.id, Number.isFinite(photo.bytes) ? Math.max(0, photo.bytes) : 0);
      }
    }
  };
  for (const card of Object.values(workspace.cards)) count(card.photos);
  for (const memo of Object.values(workspace.memos ?? {})) count(memo.photos);

  let bytes = 0;
  for (const size of seen.values()) bytes += size;
  return { count: seen.size, bytes };
}

/** `1.2MB` / `340KB` / `0KB` — one decimal only where it earns its place. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0KB';
  if (bytes < 1024) return '1KB';
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)}KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)}MB`;
}
