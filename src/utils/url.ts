/**
 * 링크 정규화 (M8-2, B13).
 *
 * The 카드 링크 field saves whatever was typed, and `tabelog.com/tokyo` typed
 * without a scheme is a *relative* URL: the anchor resolves it against the app's
 * own origin and the tap lands on a 404 inside Trip Board. Everything that
 * reaches `card.url` goes through {@link normalizeUrl} first.
 *
 * Deliberately not a validator. It answers one question — "can a browser open
 * this?" — and adds the one part people leave out. A string that cannot be a
 * URL at all comes back `undefined`, which is the same shape an empty field
 * already has, so nothing downstream sees a special case.
 */

/** `scheme:` at the head of a string — `https:`, `mailto:`, `tel:`. */
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

/** Schemes an app must never hand to `<a href>`, whoever typed them. */
const BLOCKED_SCHEMES = /^(?:javascript|data|vbscript|file):/i;

/**
 * `'  tabelog.com/tokyo '` → `'https://tabelog.com/tokyo'`;
 * `'https://x.test'` → unchanged; `''` / `'맛집 리스트'` → `undefined`.
 *
 * A scheme that is already there is kept (so `mailto:` and `tel:` survive),
 * except for the handful that would turn a link into code. Whitespace inside
 * the value means it is prose, not an address, and is rejected rather than
 * quietly glued into something unopenable.
 */
export function normalizeUrl(raw: string | undefined): string | undefined {
  const value = (raw ?? '').trim();
  if (value === '') return undefined;
  if (/\s/.test(value)) return undefined;
  if (BLOCKED_SCHEMES.test(value)) return undefined;
  if (SCHEME_RE.test(value)) return value;
  // `//example.com` is protocol-relative; the rest is a bare host or path.
  return `https://${value.replace(/^\/\//, '')}`;
}
