/**
 * 「지금 이 화면 근처」를 구글에 묻는 계획 — 순수 규칙 (M43).
 *
 * 두 번째 출처는 실시간이다: 지도를 옮겨 놓고 「이 지역에서 다시 검색」을 누르면
 * 그 한가운데를 중심으로 구글에 묻는다. 큐레이션 목록이 못 담는 것 — 우리가
 * 조사하지 않은 동네, 오늘 새로 생긴 집 — 이 그렇게 들어온다.
 *
 * ## Places (New)의 갈래 이름
 *
 * `searchNearby`는 `includedTypes`로 거른다. 우리 다섯 갈래 중 구글이 이름을
 * 가진 것은 셋뿐이다:
 *
 * | 갈래 | Places (New) 타입 | 비고 |
 * |---|---|---|
 * | 초밥 | `sushi_restaurant` | 있다 |
 * | 라멘 | `ramen_restaurant` | 있다 |
 * | 디저트 | `dessert_shop` | 있다 (Table A) |
 * | 카츠 | **없다** | `tonkatsu_restaurant`은 존재하지 않는다 → 키워드 검색 |
 * | 오코노미야키 | **없다** | `okonomiyaki_restaurant`도 없다 → 키워드 검색 |
 *
 * 구글의 Table A에는 일식 하위 갈래가 `japanese_restaurant`·`ramen_restaurant`·
 * `sushi_restaurant` 셋뿐이라, 돈카츠·오코노미야키는 타입으로 물을 방법이 없다.
 * 그 둘은 **현지어 키워드**로 Text Search를 부르고 `minRating`을 함께 실어
 * 문턱을 서버 쪽에서 넘긴다.
 *
 * 그리고 방어가 하나 더 있다: `includedTypes`에 구글이 모르는 이름이 하나라도
 * 있으면 요청 **전체**가 400으로 떨어진다. 그래서 호출부는 nearby가 실패하면
 * 그 갈래들을 키워드 검색으로 한 번 더 시도한다({@link nearbyFallbackQueries}) —
 * 구글이 언젠가 타입 이름을 바꿔도 화면은 조용히 계속 동작한다.
 *
 * ## 값을 아끼는 방법
 *
 * - 타입이 있는 갈래는 **한 번에 묶어서** 한 번만 부른다(3갈래 → 1콜).
 * - 타입이 없는 갈래만 갈래당 한 번.
 * - 그래서 다섯 갈래를 다 켜도 화면 한 번에 나가는 호출은 **최대 3개**다.
 * - 자동으로는 절대 다시 묻지 않는다. 켤 때 한 번, 「이 지역에서 다시 검색」에
 *   한 번. 지도를 미는 동안 호출이 따라 나가는 설계는 청구서로 돌아온다.
 * - (중심좌표, 갈래들)마다 이 세션 동안 기억한다({@link nearbyCacheKey}).
 */

import type { GourmetCity, GourmetGenre } from '../data/gourmet';
import { GOURMET_MIN_RATING } from './filter';

/** 이 여행이 도는 도시의 한가운데 — 큐레이션 조회를 기울이는 자리. */
export const CITY_CENTER: Record<GourmetCity, { lat: number; lng: number }> = {
  // 오사카역/우메다 일대
  osaka: { lat: 34.7025, lng: 135.4959 },
  // 교토역 일대
  kyoto: { lat: 34.9858, lng: 135.7588 },
};

/**
 * 갈래 → Places (New) 타입. 이름이 없는 갈래는 `null`.
 *
 * 이 표가 이 기능에서 유일하게 「구글의 어휘」를 아는 자리다.
 */
export const GENRE_PLACE_TYPE: Record<GourmetGenre, string | null> = {
  sushi: 'sushi_restaurant',
  ramen: 'ramen_restaurant',
  katsu: null,
  okonomiyaki: null,
  dessert: 'dessert_shop',
};

/** 타입이 없는 갈래를 부르는 현지어 — 검색어는 일본어여야 일본에서 맞는다. */
export const GENRE_KEYWORD: Record<GourmetGenre, string> = {
  sushi: '寿司',
  ramen: 'ラーメン',
  katsu: 'とんかつ',
  okonomiyaki: 'お好み焼き',
  dessert: 'スイーツ',
};

/** 반경 — 걸어서 갈 만한 동네 하나. */
export const NEARBY_RADIUS_M = 1_500;

/** 한 번에 받아 오는 최대 줄 수 (Places의 상한이기도 하다). */
export const NEARBY_MAX_RESULTS = 20;

/** 키워드 한 갈래를 어떻게 물을 것인가. */
export interface GourmetTextQuery {
  genre: GourmetGenre;
  textQuery: string;
  minRating: number;
}

/** 이번 검색의 계획 하나. */
export interface GourmetNearbyPlan {
  /** 한 번의 `searchNearby`에 실을 타입들. 비어 있으면 그 호출은 없다. */
  includedTypes: string[];
  /** 그 호출이 대신 물어 주는 갈래들 — 결과의 갈래를 되읽는 데 쓴다. */
  typedGenres: GourmetGenre[];
  /** 타입이 없어 따로 물어야 하는 갈래들. */
  textQueries: GourmetTextQuery[];
}

/** 갈래 목록 → 계획 하나 (순수). */
export function nearbyPlan(genres: readonly GourmetGenre[]): GourmetNearbyPlan {
  const includedTypes: string[] = [];
  const typedGenres: GourmetGenre[] = [];
  const textQueries: GourmetTextQuery[] = [];

  for (const genre of genres) {
    const type = GENRE_PLACE_TYPE[genre];
    if (type) {
      includedTypes.push(type);
      typedGenres.push(genre);
    } else {
      textQueries.push({
        genre,
        textQuery: GENRE_KEYWORD[genre],
        minRating: GOURMET_MIN_RATING,
      });
    }
  }

  return { includedTypes, typedGenres, textQueries };
}

/**
 * nearby가 통째로 실패했을 때의 두 번째 계단.
 *
 * 타입으로 물으려던 갈래들을 키워드로 다시 묻는다. 구글이 타입 이름을 바꾸거나
 * 우리가 잘못 적었을 때, 사용자가 보는 것은 빈 지도가 아니라 조금 덜 정확한
 * 결과여야 한다.
 */
export function nearbyFallbackQueries(plan: GourmetNearbyPlan): GourmetTextQuery[] {
  return plan.typedGenres.map((genre) => ({
    genre,
    textQuery: GENRE_KEYWORD[genre],
    minRating: GOURMET_MIN_RATING,
  }));
}

/**
 * 구글이 준 타입 목록에서 우리 갈래를 되읽는다 (순수).
 *
 * 한 곳은 타입을 여럿 든다(`sushi_restaurant`, `restaurant`, `food`…). 우리가
 * 물어본 갈래 중 **처음 맞는 것**을 답으로 삼고, 하나도 없으면 `null` —
 * 그런 줄도 화면에는 선다({@link GourmetSpot.genre}의 주석).
 */
export function genreFromTypes(
  types: readonly string[] | undefined,
  candidates: readonly GourmetGenre[],
): GourmetGenre | null {
  if (!types || types.length === 0) return null;
  const set = new Set(types);
  for (const genre of candidates) {
    const type = GENRE_PLACE_TYPE[genre];
    if (type && set.has(type)) return genre;
  }
  return null;
}

/**
 * 좌표를 소수점 셋(≈110m)으로 접은 이 검색의 이름.
 *
 * 지도를 손톱만큼 밀고 다시 누르는 것을 새 검색으로 치지 않기 위한 반올림이다.
 * 갈래는 정렬해서 붙인다 — 고른 순서는 질문을 바꾸지 않는다.
 */
export function nearbyCacheKey(
  center: { lat: number; lng: number },
  genres: readonly GourmetGenre[],
): string {
  return `${center.lat.toFixed(3)},${center.lng.toFixed(3)}|${[...genres].sort().join(',')}`;
}
