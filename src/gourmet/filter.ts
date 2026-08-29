/**
 * 「주변 맛집」 레이어가 무엇을 보여 줄지 정하는 **순수 규칙** (M43).
 *
 * 이 레이어에는 출처가 둘이다:
 *
 * | 출처 | 어디서 오나 | 무엇을 아나 |
 * |---|---|---|
 * | `curated` | `data/gourmet.ts` + 구글 Places 1회 조회(캐시) | 타베로그·예약·한 줄 메모까지 |
 * | `google` | 지금 화면 한가운데의 `searchNearby`/텍스트 검색 | 구글 평점뿐 |
 *
 * 둘은 화면에서 **같은 모양의 한 줄**({@link GourmetSpot})이 된다. 그래야 칩
 * 하나로 둘을 같이 거를 수 있고, 팝업도 한 벌이면 된다.
 *
 * ## 이중 필터
 *
 * 큐레이션 목록은 사람이 골랐다. 그런데 사람이 고른 시점과 우리가 가는 날 사이에
 * 가게는 늙는다 — 그래서 **지금의 구글 평점이 4.3 미만이면 감춘다**. 구글 쪽
 * 결과도 같은 문턱을 넘긴 것만 올라온다. 목록에 있다는 것과 지금 갈 만하다는
 * 것은 다른 이야기이고, 이 파일이 그 둘을 한 줄로 잇는다.
 *
 * 평점을 **모르는** 곳은 감춘다. 「모른다」를 「괜찮다」로 읽으면 이중 필터가
 * 아니라 그냥 목록이 된다.
 *
 * 전부 순수 함수다 — React도, 구글도, `localStorage`도 모른다.
 */

import type { GourmetCity, GourmetGenre } from '../data/gourmet';

/** 한 줄이 어디서 왔는가. */
export type GourmetSource = 'curated' | 'google';

/**
 * 지금 갈 만한가의 문턱 — 구글 평점 기준.
 *
 * 4.3은 「좋다」와 「나쁘지 않다」가 갈리는 자리다. 4.5로 올리면 오사카의 오래된
 * 노포가 통째로 사라지고(현지 평점은 관대하지 않다), 4.0으로 내리면 관광지
 * 한복판의 아무 집이나 남는다.
 */
export const GOURMET_MIN_RATING = 4.3;

/** 지도에 설 수 있는 한 곳 — 두 출처가 같은 모양으로 접힌다. */
export interface GourmetSpot {
  /** 화면에서 이 한 곳을 가리키는 유일한 이름 (`curated:<id>` / `google:<placeId>`). */
  key: string;
  source: GourmetSource;
  /** 큐레이션이면 엔트리 id, 구글이면 place id. */
  id: string;
  /** 화면에 뜨는 이름 — 큐레이션은 한국어, 구글은 구글이 준 이름. */
  name: string;
  /** 일본어 상호. 구글 지도 링크의 검색어이기도 하다. */
  localName?: string;
  /**
   * 갈래. 구글 결과 중 어느 갈래인지 못 읽은 것은 `null`이고, 그런 한 줄은
   * 장르 칩을 **통과한다** — 지금 켜 둔 장르로 검색해서 받아 온 결과이므로,
   * 갈래를 못 읽었다는 이유로 감추면 사용자는 이유를 알 길이 없다.
   */
  genre: GourmetGenre | null;
  city?: GourmetCity;
  area?: string;
  lat: number;
  lng: number;
  address?: string;
  /** 지금의 구글 평점. 이 값이 문턱을 넘어야 화면에 선다. */
  googleRating?: number;
  /** 구글 평점을 매긴 사람 수 — 4.9(3명)와 4.4(2천명)를 가르는 값. */
  googleRatingCount?: number;
  /** 조사 시점의 타베로그 점수 (큐레이션만). */
  tabelog?: number;
  /** 예약 가능 여부. 구글 결과는 대개 모른다(`undefined`). */
  reservable?: boolean;
  note?: string;
  /** 구글의 장소 id — 「구글 지도에서 보기」가 그 가게의 페이지를 바로 연다. */
  placeId?: string;
}

/** 예약 칩 세 갈래. */
export type GourmetReservableFilter = 'all' | 'yes' | 'no';

/** 출처 칩 세 갈래. */
export type GourmetSourceFilter = 'all' | 'curated' | 'google';

/** 필터 패널의 선택 전부. */
export interface GourmetFilter {
  /** 켜 둔 장르. **빈 배열이 곧 「전체」**다 — 아무것도 안 고른 사람이 아무것도 못 보면 안 된다. */
  genres: readonly GourmetGenre[];
  reservable: GourmetReservableFilter;
  source: GourmetSourceFilter;
}

/** 아무것도 고르지 않은 상태. 읽을 수 없을 때의 답이기도 하다. */
export const DEFAULT_GOURMET_FILTER: GourmetFilter = {
  genres: [],
  reservable: 'all',
  source: 'all',
};

/** 다섯 갈래의 표시 순서 — 칩 줄도, 범례도 이 순서다. */
export const GOURMET_GENRES: readonly GourmetGenre[] = [
  'sushi',
  'ramen',
  'katsu',
  'okonomiyaki',
  'dessert',
];

/** 갈래의 한국어 이름. */
export const GENRE_LABEL: Record<GourmetGenre, string> = {
  sushi: '초밥',
  ramen: '라멘',
  katsu: '카츠',
  okonomiyaki: '오코노미야키',
  dessert: '디저트',
};

/** 갈래의 이모지 — 핀 위에 서는 글자이자 칩의 얼굴. */
export const GENRE_EMOJI: Record<GourmetGenre, string> = {
  sushi: '🍣',
  ramen: '🍜',
  katsu: '🍖',
  okonomiyaki: '🥞',
  dessert: '🍰',
};

/** 갈래를 못 읽은 구글 결과가 쓰는 글자. */
export const GENRE_EMOJI_FALLBACK = '🍽️';

/** 이 한 곳의 핀에 설 글자. */
export const spotEmoji = (spot: Pick<GourmetSpot, 'genre'>): string =>
  spot.genre ? GENRE_EMOJI[spot.genre] : GENRE_EMOJI_FALLBACK;

/** 지금 갈 만한 평점인가. 모르면 아니다. */
export function passesRatingGate(rating: number | undefined | null): boolean {
  return typeof rating === 'number' && Number.isFinite(rating) && rating >= GOURMET_MIN_RATING;
}

/** 장르 칩 하나를 켜고 끈다 (순수). */
export function toggleGenre(
  genres: readonly GourmetGenre[],
  genre: GourmetGenre,
): GourmetGenre[] {
  return genres.includes(genre)
    ? genres.filter((item) => item !== genre)
    : [...genres, genre];
}

/** 지금 검색해야 하는 갈래들 — 아무것도 안 골랐으면 다섯 전부. */
export function activeGenres(filter: GourmetFilter): GourmetGenre[] {
  return filter.genres.length === 0 ? [...GOURMET_GENRES] : GOURMET_GENRES.filter((genre) => filter.genres.includes(genre));
}

/**
 * 한 곳이 지금의 필터를 통과하는가.
 *
 * 예약 칩이 「전체」가 아닐 때 **모르는 곳은 빠진다**: 구글 결과는 예약 여부를
 * 대개 모르고, 모르는 것을 「가능」이나 「불가」 어느 쪽에 넣어도 그건 거짓말이다.
 */
export function matchesGourmetFilter(spot: GourmetSpot, filter: GourmetFilter): boolean {
  if (filter.source !== 'all' && spot.source !== filter.source) return false;

  if (filter.genres.length > 0 && spot.genre !== null && !filter.genres.includes(spot.genre)) {
    return false;
  }

  if (filter.reservable === 'yes' && spot.reservable !== true) return false;
  if (filter.reservable === 'no' && spot.reservable !== false) return false;

  return true;
}

/**
 * 화면에 세울 목록 하나 — 문턱 · 중복 · 필터를 한 번에.
 *
 * 순서: **큐레이션이 먼저**, 그 안에서는 구글 평점이 높은 순. 같은 가게가 두
 * 출처에서 오면(구글 검색이 우리가 고른 그 집을 찾아냈다) 큐레이션 쪽을 남긴다 —
 * 타베로그와 한 줄 메모를 아는 쪽이 더 많이 아는 쪽이다.
 */
export function visibleGourmetSpots(
  spots: readonly GourmetSpot[],
  filter: GourmetFilter,
): GourmetSpot[] {
  const curatedPlaceIds = new Set(
    spots.filter((spot) => spot.source === 'curated' && spot.placeId).map((spot) => spot.placeId),
  );

  const kept = spots.filter((spot) => {
    if (!passesRatingGate(spot.googleRating)) return false;
    if (spot.source === 'google' && spot.placeId && curatedPlaceIds.has(spot.placeId)) return false;
    return matchesGourmetFilter(spot, filter);
  });

  const seen = new Set<string>();
  const unique = kept.filter((spot) => {
    if (seen.has(spot.key)) return false;
    seen.add(spot.key);
    return true;
  });

  return unique.sort((a, b) => {
    if (a.source !== b.source) return a.source === 'curated' ? -1 : 1;
    return (b.googleRating ?? 0) - (a.googleRating ?? 0);
  });
}

/** 필터가 다 걸러 냈을 때 화면이 할 말. */
export function emptyGourmetHint(total: number): string {
  return total === 0
    ? '이 근처에서 조건에 맞는 맛집을 찾지 못했어요'
    : '고른 조건에 맞는 맛집이 없어요';
}
