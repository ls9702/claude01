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

/**
 * 이 앱 안의 자리를 가리키는 주소인가 (M52b) — `#/draw/<id>`, `#/board` 등.
 *
 * 카드의 링크 칸에 페이지 주소를 넣는 사람이 있고(칩이 생기기 전부터 있던
 * 길이다), 그것이 새 탭에서 앱을 처음부터 다시 여는 것은 답이 아니다. 통째
 * URL(`https://trip.863ad.co.kr/#/draw/…`)은 여기서 다루지 않는다 — 그건 주소가
 * 정말 바깥을 가리키는 경우와 구분할 방법이 배포 주소를 아는 것뿐이고, 이
 * 계층은 그것을 몰라야 한다.
 */
export const isInAppHash = (url: string | undefined): boolean =>
  (url ?? '').startsWith('#/');

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
  // 앱 자신의 주소 (M52b). `#/draw/<id>`는 스킴이 없는 상대 주소라 그냥 두면
  // `https://#/draw/…`가 됐다 — 열 수 없는 주소이고, 정작 사람이 넣은 것은
  // **이 앱 안의 자리**다. 해시는 해시로 남겨 두면 브라우저가 같은 문서 안에서
  // 옮겨 주고 `HashSync`가 그 뒤를 잇는다.
  if (isInAppHash(value)) return value;
  if (SCHEME_RE.test(value)) return value;
  // `//example.com` is protocol-relative; the rest is a bare host or path.
  return `https://${value.replace(/^\/\//, '')}`;
}
