/**
 * 「우리 맛집」의 여덟 갈래 — **데이터와 순수 함수뿐** (M49).
 *
 * M43의 다섯 갈래(`gourmet/filter.ts`)는 조사·검색이 쓰는 갈래다: 구글 Places가
 * 이름을 가진 타입이거나 현지어 키워드로 물을 수 있는 것들이라, 「카페」나
 * 「술집」처럼 검색으로 걸러 봐야 의미가 없는 갈래가 빠져 있다.
 *
 * 여기는 사람이 자기 카드에 붙이는 이름표다. 그래서 그 다섯에 셋을 더한다 —
 * 카페·식사·술집. 여행에서 「어디서 밥을 먹지」와 「커피 한 잔 어디서 하지」는
 * 다른 질문이고, 지도에서 그 둘을 나눠 보는 것이 이 기능의 쓸모다.
 *
 * 다섯은 M43의 상수를 **그대로 펴서** 쓴다(`...GENRE_EMOJI`). 같은 초밥이 두
 * 화면에서 다른 이모지를 달면 그건 두 개의 장르 체계다 — 그럴 바에는 한쪽이
 * 다른 쪽을 읽게 두는 편이 낫고, 그러면 어긋날 수가 없다.
 *
 * React도, 스토어도, 지도도 모른다.
 */

import type { GourmetGenre } from '../data/gourmet';
import { GENRE_EMOJI, GENRE_LABEL } from './filter';

/** 여덟 갈래 — M43의 다섯 + 카페·식사·술집. */
export type UserGourmetGenre = GourmetGenre | 'cafe' | 'meal' | 'bar';

/**
 * 칩이 서는 순서.
 *
 * 앞의 다섯은 M43의 순서 그대로고, 뒤의 셋이 붙는다. 새 갈래를 앞에 끼워 넣지
 * 않는 이유는 이 순서가 곧 사람이 외우는 자리이기 때문이다 — 라멘 칩이 어제는
 * 두 번째, 오늘은 네 번째면 그건 다른 화면이다.
 */
export const USER_GOURMET_GENRES: readonly UserGourmetGenre[] = [
  'sushi',
  'ramen',
  'katsu',
  'okonomiyaki',
  'dessert',
  'cafe',
  'meal',
  'bar',
];

/** 갈래의 이모지 — 핀 위에 서는 글자이자 칩의 얼굴이자 카드 제목 앞의 표식. */
export const USER_GENRE_EMOJI: Record<UserGourmetGenre, string> = {
  ...GENRE_EMOJI,
  cafe: '☕',
  meal: '🍚',
  bar: '🍶',
};

/** 갈래의 한국어 이름. */
export const USER_GENRE_LABEL: Record<UserGourmetGenre, string> = {
  ...GENRE_LABEL,
  cafe: '카페',
  meal: '식사',
  bar: '술집',
};

/**
 * 장르를 안 고른 곳이 쓰는 글자.
 *
 * M43의 `GENRE_EMOJI_FALLBACK`과 같은 🍽️이다. 「갈래를 모른다」는 사정이 두
 * 레이어에서 같은 얼굴을 하는 편이 낫다.
 */
export const NO_GENRE_EMOJI = '🍽️';

/** 「장르 없음」을 부르는 말 — 칩에도, 팝업에도 같은 말이 선다. */
export const NO_GENRE_LABEL = '장르 없음';

/** 저장된 문자열이 우리가 아는 갈래인가. 모르는 값은 「없음」으로 읽힌다. */
export function isUserGourmetGenre(value: unknown): value is UserGourmetGenre {
  return (
    typeof value === 'string' &&
    (USER_GOURMET_GENRES as readonly string[]).includes(value)
  );
}

/**
 * 카드가 든 갈래, 또는 `null`.
 *
 * 모르는 값을 `null`로 접는 것이 {@link Card.gourmetGenre}가 유니온이 아니라
 * `string`인 이유를 감당하는 자리다 — 옛 기기가 적어 둔 갈래도, 다음 판이 뺀
 * 갈래도 여기서 조용히 「없음」이 된다.
 */
export function userGenreOf(value: string | undefined | null): UserGourmetGenre | null {
  return isUserGourmetGenre(value) ? value : null;
}

/** 이 갈래(또는 없음)의 이모지. */
export function userGenreEmoji(value: string | undefined | null): string {
  const genre = userGenreOf(value);
  return genre ? USER_GENRE_EMOJI[genre] : NO_GENRE_EMOJI;
}

/** 이 갈래(또는 없음)의 이름. */
export function userGenreLabel(value: string | undefined | null): string {
  const genre = userGenreOf(value);
  return genre ? USER_GENRE_LABEL[genre] : NO_GENRE_LABEL;
}

/**
 * 칩 하나를 켜고 끈다 (순수) — M43의 `toggleGenre`와 같은 계약.
 *
 * 결과는 언제나 {@link USER_GOURMET_GENRES}의 순서를 따른다. 고른 순서를
 * 기억하면 같은 선택이 기기마다 다른 배열로 저장되고, 그러면 저장값을 눈으로
 * 비교할 수 없다.
 */
export function toggleUserGenre(
  genres: readonly UserGourmetGenre[],
  genre: UserGourmetGenre,
): UserGourmetGenre[] {
  const next = genres.includes(genre)
    ? genres.filter((current) => current !== genre)
    : [...genres, genre];
  return USER_GOURMET_GENRES.filter((current) => next.includes(current));
}
