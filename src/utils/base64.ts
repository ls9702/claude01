/**
 * ArrayBuffer ↔ base64, in chunks (M10).
 *
 * `btoa(String.fromCharCode(...bytes))` is the one-liner everyone writes and it
 * blows the call stack somewhere around a hundred thousand arguments — which a
 * 500KB photo passes comfortably. So the string is built a chunk at a time.
 *
 * Pure and DOM-free apart from `btoa`/`atob`, which node has had since 16, so
 * the round trip is unit-testable without a browser.
 */

/**
 * How many bytes go into one `fromCharCode` call. Small enough to be safe on
 * every engine, large enough that a 500KB photo is ~62 calls.
 */
const CHUNK = 0x2000;

/** Binary → base64. */
export function bufToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    // `subarray` is a view, not a copy — the slicing here is free.
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
  }
  return btoa(binary);
}

/**
 * base64 → binary. Tolerates the data-URL prefix (`data:image/jpeg;base64,…`)
 * and whitespace, since both turn up in hand-edited backup files.
 *
 * Throws the same way `atob` does when the text is not base64 at all.
 */
export function base64ToBuf(text: string): ArrayBuffer {
  const comma = text.indexOf(',');
  const payload = (text.startsWith('data:') && comma >= 0 ? text.slice(comma + 1) : text).replace(
    /\s+/g,
    '',
  );
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}
