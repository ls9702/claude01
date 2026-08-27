/**
 * 붙여넣은 좌표·구글 지도 링크 읽기 (M37) — 검색을 건너뛰는 유일한 길.
 *
 * 검색 엔진은 두 개(AI·Nominatim)이고 둘 다 **이름을 자리로 바꾸는** 기계다.
 * 그런데 사용자가 이미 자리를 알고 있는 경우가 있다: 구글 지도에서 그 가게를
 * 찾아 놓고, 주소창을 복사해 오거나 좌표를 그대로 적어 오는 경우다. 그럴 때
 * 이름으로 다시 찾는 것은 **틀릴 기회를 한 번 더 주는 것**이다 — 이번 마일스톤의
 * 신고(「잇푸도 난바점이 구글 지도와 다르다」)가 정확히 그 상황이었다.
 *
 * 그래서 입력이 좌표로 읽히면 아무에게도 묻지 않는다. 이 파일은 그 판정 하나만
 * 하는 순수 함수다 — 네트워크도, React도, 상태도 없다.
 *
 * ## 받아들이는 모양
 *
 * | 입력 | 결과 |
 * | ---- | ---- |
 * | `34.6659, 135.5013` · `34.6659 135.5013` | 그 좌표 |
 * | `…/maps/place/…/@34.6659,135.5013,17z/…` | 그 좌표 |
 * | `…!8m2!3d34.6659!4d135.5013` (장소 자체의 점) | 그 좌표 |
 * | `…/maps?q=34.6659,135.5013` · `?query=…` · `?ll=…` | 그 좌표 |
 * | `https://maps.app.goo.gl/xxxx` | 단축 링크 — 안내 한 줄 |
 * | 그 밖의 모든 것 | `null` (평소대로 검색) |
 *
 * 단축 링크를 **따로 알아보는** 이유는 실패의 모양 때문이다. 브라우저에서
 * `maps.app.goo.gl`을 펼치려면 리다이렉트를 따라가야 하는데 CORS가 막는다. 그걸
 * 조용히 「못 찾음」으로 처리하면 사용자는 자기가 뭘 잘못했는지 영원히 모른다 —
 * 그래서 못 한다고 말하고, 대신 무엇을 하면 되는지 한 줄로 알려 준다.
 */

/** 입력을 읽어낸 결과. 읽어낼 것이 없으면 {@link parseCoordInput}이 `null`을 준다. */
export type CoordInput =
  /** 정확한 좌표 한 쌍 — 검색 없이 그대로 핀이 된다. */
  | { kind: 'coords'; lat: number; lng: number }
  /** 구글 지도 단축 링크 — 여기서는 펼칠 수 없다(리다이렉트+CORS). */
  | { kind: 'short-link' };

/** 단축 링크는 브라우저에서 펼칠 수 없다 — 대신 이 한 줄을 보여 준다. */
export const SHORT_LINK_HINT = '단축 링크는 열어서 주소창의 전체 주소를 복사해 주세요';

/** 십진수 한 칸. 정수부는 세 자리까지 — 경도의 `180`이 가장 긴 모양이다. */
const DECIMAL = String.raw`[-+]?\d{1,3}(?:\.\d+)?`;

/** 「34.6659, 135.5013」 · 「34.6659 135.5013」 — 사람이 손으로 적는 모양. */
const BARE_PAIR = new RegExp(`^(${DECIMAL})\\s*[,\\s]\\s*(${DECIMAL})$`);

/** `maps.app.goo.gl/xxxx` · `goo.gl/maps/xxxx` — 펼치지 못하는 링크. */
const SHORT_LINK = /(?:maps\.app\.goo\.gl|goo\.gl\/maps)/i;

/** 링크로 볼 만한 글자인가 — 이름 안의 숫자를 좌표로 오해하지 않기 위한 문지기. */
const LINK_LIKE = /^https?:\/\/|google\.[a-z.]+\/|goo\.gl/i;

/**
 * 링크에서 좌표를 꺼내는 자리들 — **앞의 것이 더 정확하다.**
 *
 *  1. `!3d…!4d…`는 그 **장소 자체의 점**이다. 구글에서 가게를 눌러 얻은 주소에
 *     들어 있고, 화면을 어디로 끌어 놨든 바뀌지 않는다.
 *  2. `q=`·`query=`는 사람이 **좌표를 대놓고 적어 넣은** 자리다.
 *  3. `ll=`·`center=`·`@…`는 **화면 중심**이다. 보통 장소와 겹치지만, 손으로 지도를
 *     끌었다면 조금 밀려 있다 — 그래서 마지막이다.
 */
const URL_PATTERNS: readonly RegExp[] = [
  new RegExp(`!3d(${DECIMAL})!4d(${DECIMAL})`, 'g'),
  new RegExp(`[?&](?:q|query)=([^&#]+)`, 'gi'),
  new RegExp(`[?&](?:ll|center|sll)=([^&#]+)`, 'gi'),
  new RegExp(`@(${DECIMAL}),(${DECIMAL})`, 'g'),
];

/** 위경도 범위 안의 진짜 좌표인가. `0,0`은 대서양 한가운데 — 빈 값의 전형이다. */
function toCoords(latRaw: string, lngRaw: string): CoordInput | null {
  const lat = Number(latRaw);
  const lng = Number(lngRaw);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  if (lat === 0 && lng === 0) return null;
  return { kind: 'coords', lat, lng };
}

/** 쿼리 문자열 한 칸을 사람이 적은 모양으로 되돌린다(`%2C`, `+`). */
function decodeParam(value: string): string {
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    /* 반쯤 깨진 %인코딩 — 원문 그대로 읽어 본다 */
  }
  return decoded.replace(/\+/g, ' ').trim();
}

/** 「34.6659, 135.5013」 한 덩어리를 좌표로. 이름이 섞여 있으면 `null`. */
function parsePair(value: string): CoordInput | null {
  const match = BARE_PAIR.exec(value.trim());
  return match ? toCoords(match[1], match[2]) : null;
}

/**
 * 입력 한 줄을 좌표(또는 단축 링크)로 읽는다. 읽히지 않으면 `null`.
 *
 * `null`은 실패가 아니라 **평소**다: 「츠텐카쿠」도, 「오사카성」도 여기서는 `null`이고
 * 그래서 검색 엔진에게 간다. 이 함수가 답을 내는 것은 사용자가 이미 자리를 알고
 * 있을 때뿐이다.
 */
export function parseCoordInput(text: string): CoordInput | null {
  const value = text.trim();
  if (value === '') return null;

  const bare = parsePair(value);
  if (bare) return bare;

  if (!LINK_LIKE.test(value)) return null;
  if (SHORT_LINK.test(value)) return { kind: 'short-link' };

  for (const pattern of URL_PATTERNS) {
    // `g` 플래그를 단 정규식은 상태를 갖는다 — 매번 처음부터 읽게 되돌려 놓는다.
    pattern.lastIndex = 0;
    for (let match = pattern.exec(value); match; match = pattern.exec(value)) {
      const found =
        match[2] === undefined ? parsePair(decodeParam(match[1])) : toCoords(match[1], match[2]);
      if (found) return found;
    }
  }
  return null;
}
