/**
 * 두 출처를 한 모양으로 접는 자리 — 순수 (M43).
 *
 * 큐레이션 한 줄(`data/gourmet.ts` + 캐시 한 줄)과 구글 한 줄(`GourmetPlace`)이
 * 여기서 같은 {@link GourmetSpot}이 된다. 그 뒤로는 지도도, 필터도, 팝업도
 * 어느 쪽에서 온 줄인지 신경 쓰지 않는다 — `source` 한 글자로만 갈린다.
 *
 * 화면에 쓰는 짧은 문장들도 여기 있다. 「⭐ 구글 4.5 · 타베로그 3.6」 같은 줄은
 * 지도 팝업에도, 보드에 만드는 카드의 메모에도 들어가야 하고, 두 자리에서 다른
 * 문장이 나오면 그건 두 개의 사실이 된다.
 */

import type { GourmetEntry, GourmetGenre } from '../data/gourmet';
import type { GourmetPlace } from '../map/googlePlaces';
import type { GourmetResolved } from './cache';
import { GENRE_LABEL, type GourmetSpot } from './filter';
import { genreFromTypes } from './nearby';

/** 큐레이션 한 집 + 구글이 답해 준 것 → 한 줄. */
export function curatedSpot(entry: GourmetEntry, resolved: GourmetResolved): GourmetSpot {
  return {
    key: `curated:${entry.id}`,
    source: 'curated',
    id: entry.id,
    name: entry.name,
    localName: entry.localName,
    genre: entry.genre,
    city: entry.city,
    area: entry.area,
    lat: resolved.lat,
    lng: resolved.lng,
    ...(resolved.address ? { address: resolved.address } : {}),
    ...(resolved.googleRating !== undefined ? { googleRating: resolved.googleRating } : {}),
    ...(resolved.googleRatingCount !== undefined
      ? { googleRatingCount: resolved.googleRatingCount }
      : {}),
    tabelog: entry.tabelog,
    // 예약 여부는 **조사값이 이긴다**: 구글의 `reservable`은 자주 비어 있고,
    // 사람이 확인한 「예약 됨」을 빈 값이 덮으면 그건 정보의 후퇴다.
    reservable: entry.reservable,
    ...(entry.note ? { note: entry.note } : {}),
    ...(resolved.placeId ? { placeId: resolved.placeId } : {}),
  };
}

/** 구글이 준 한 줄 → 한 줄. place id가 없으면 좌표로 이름을 짓는다. */
export function googleSpot(
  place: GourmetPlace,
  candidates: readonly GourmetGenre[],
  fallbackGenre: GourmetGenre | null = null,
): GourmetSpot {
  const id = place.placeId ?? `${place.lat.toFixed(5)},${place.lng.toFixed(5)}`;
  return {
    key: `google:${id}`,
    source: 'google',
    id,
    name: place.name || '이름 없는 곳',
    genre: genreFromTypes(place.types, candidates) ?? fallbackGenre,
    lat: place.lat,
    lng: place.lng,
    ...(place.address ? { address: place.address } : {}),
    ...(place.rating !== undefined ? { googleRating: place.rating } : {}),
    ...(place.ratingCount !== undefined ? { googleRatingCount: place.ratingCount } : {}),
    ...(place.reservable !== undefined ? { reservable: place.reservable } : {}),
    ...(place.placeId ? { placeId: place.placeId } : {}),
  };
}

/** 구글이 준 한 줄 → 캐시에 적을 답. */
export function resolvedFromPlace(place: GourmetPlace, now: Date = new Date()): GourmetResolved {
  return {
    lat: place.lat,
    lng: place.lng,
    ...(place.address ? { address: place.address } : {}),
    ...(place.rating !== undefined ? { googleRating: place.rating } : {}),
    ...(place.ratingCount !== undefined ? { googleRatingCount: place.ratingCount } : {}),
    ...(place.reservable !== undefined ? { reservable: place.reservable } : {}),
    ...(place.placeId ? { placeId: place.placeId } : {}),
    cachedAt: now.toISOString(),
  };
}

/** 이 집을 구글에 물을 때의 검색어 — 상호 + 동네. */
export const lookupQuery = (entry: GourmetEntry): string =>
  `${entry.localName} ${entry.area}`.trim();

/** 「초밥 · 기온」 — 팝업 둘째 줄. */
export function genreAreaLine(spot: GourmetSpot): string {
  const genre = spot.genre ? GENRE_LABEL[spot.genre] : '맛집';
  return spot.area ? `${genre} · ${spot.area}` : genre;
}

/** 소수 한 자리로 — 4.5, 3.6. */
const score = (value: number): string => value.toFixed(1);

/**
 * 「⭐ 구글 4.5 · 타베로그 3.6」 / 「⭐ 구글 4.4 (구글만)」.
 *
 * 타베로그 점수가 없는 줄은 **왜 없는지**를 말한다: 구글에서 방금 찾은 집이라
 * 우리가 조사한 적이 없다는 뜻이고, 그건 감출 일이 아니라 알릴 일이다.
 */
export function ratingLine(spot: GourmetSpot): string {
  const google =
    spot.googleRating !== undefined ? `⭐ 구글 ${score(spot.googleRating)}` : '⭐ 구글 평점 없음';
  return spot.tabelog !== undefined
    ? `${google} · 타베로그 ${score(spot.tabelog)}`
    : `${google} (구글만)`;
}

/** 「예약 가능」 / 「예약 불가」 / 「예약 정보 없음」. */
export function reservableLine(spot: GourmetSpot): string {
  if (spot.reservable === true) return '예약 가능';
  if (spot.reservable === false) return '예약 불가';
  return '예약 정보 없음';
}

/** 보드에 만드는 카드의 메모 한 줄 — 평점과 예약을 한 문장으로. */
export function cardMemoLine(spot: GourmetSpot): string {
  return `${ratingLine(spot)} · ${reservableLine(spot)}`;
}

/** 진행 표시 한 줄 — 「맛집 정보 불러오는 중 12/48」. */
export const progressLabel = (done: number, total: number): string =>
  `맛집 정보 불러오는 중 ${done}/${total}`;
