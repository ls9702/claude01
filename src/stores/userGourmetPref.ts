/**
 * 「우리 맛집」 레이어의 장르 선택을 기기에 기억한다 (M49).
 *
 * `gourmetPref`(M43)·`mapFilterPref`(M27)와 같은 결이다: 지금 카페만 보고 있다는
 * 것은 **데이터가 아니라 이 기기의 시야 설정**이고, 폰에서 고른 것이 상대의
 * 노트북까지 흔들면 그건 동기화가 아니라 참견이다. 그래서 `localStorage` 한 줄.
 *
 * 여행마다 나누지 않는다 — 「나는 카페부터 본다」는 여행이 바뀌어도 그대로다.
 *
 * ## M43과 다른 한 가지: 레이어를 켠 상태도 기억하지 않는다
 *
 * 이유는 다르다. M43은 **켜는 순간 구글에 돈이 나가서**였고, 이쪽은 한 푼도
 * 나가지 않는다(위치 있는 카드를 그리는 것뿐이다). 그래도 기억하지 않는 것은
 * 지도 탭의 기본 화면이 「이 여행의 일정」이어야 하기 때문이다 — 어제 켜 둔 참고
 * 층이 오늘 지도를 덮은 채로 열리면, 사용자는 자기가 켠 적 없는 핀을 본다.
 */

import {
  DEFAULT_USER_GOURMET_FILTER,
  type UserGourmetFilter,
} from '../gourmet/userSpots';
import { USER_GOURMET_GENRES, type UserGourmetGenre } from '../gourmet/userGenres';

const FILTER_KEY = 'trip-board/usergourmet-filter';

/**
 * 패널을 접어 두었는가 — 필터 **선택**과는 다른 값이라 키도 다르다 (M45의 그
 * 결정 그대로).
 */
const PANEL_KEY = 'trip-board/usergourmet-panel';

/** `localStorage`, 없거나 막혀 있으면 `null`. */
function storage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

/** 기본값 한 벌 — 배열을 공유하지 않도록 매번 새로 짓는다. */
const fresh = (): UserGourmetFilter => ({ ...DEFAULT_USER_GOURMET_FILTER, genres: [] });

/** 무엇이 들어와도 {@link UserGourmetFilter} 하나로 만든다. */
export function normalizeUserGourmetFilter(value: unknown): UserGourmetFilter {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return fresh();
  const raw = value as Record<string, unknown>;

  // 저장된 순서가 아니라 **정해진 순서**로 접는다 — 같은 선택은 어느 기기에서도
  // 같은 배열이어야 눈으로 비교할 수 있다 (`toggleUserGenre`와 같은 규칙).
  const genres: UserGourmetGenre[] = Array.isArray(raw.genres)
    ? USER_GOURMET_GENRES.filter((genre) => (raw.genres as unknown[]).includes(genre))
    : [];

  return {
    genres,
    // 옛 기기가 적어 둔 줄에는 이 키가 없을 수 있다 — 없으면 「보여 준다」다.
    includeNone: raw.includeNone === undefined ? true : raw.includeNone === true,
  };
}

/** 이 기기가 마지막으로 고른 필터. 고른 적이 없으면 기본값. */
export function loadUserGourmetFilter(): UserGourmetFilter {
  const store = storage();
  if (!store) return fresh();
  try {
    const raw = store.getItem(FILTER_KEY);
    if (!raw) return fresh();
    return normalizeUserGourmetFilter(JSON.parse(raw) as unknown);
  } catch {
    return fresh();
  }
}

/**
 * 선택을 저장한다. 못 써도 치명적이지 않다 — 편의 설정이다.
 *
 * 정규화한 값을 돌려주므로 호출부가 그대로 상태로 삼아도 된다.
 */
export function saveUserGourmetFilter(filter: UserGourmetFilter): UserGourmetFilter {
  const next = normalizeUserGourmetFilter(filter);
  const store = storage();
  if (!store) return next;
  try {
    store.setItem(FILTER_KEY, JSON.stringify(next));
  } catch {
    /* quota / private mode */
  }
  return next;
}

/** 패널이 접혀 있는가. 고른 적이 없으면 **펼침** (M45와 같은 이유). */
export function loadUserGourmetPanelCollapsed(): boolean {
  const store = storage();
  if (!store) return false;
  try {
    return store.getItem(PANEL_KEY) === 'collapsed';
  } catch {
    return false;
  }
}

/** 접힘을 저장하고 그 값을 돌려준다. 펼침은 키를 지운다 (M45와 같은 이유). */
export function saveUserGourmetPanelCollapsed(collapsed: boolean): boolean {
  const store = storage();
  if (!store) return collapsed;
  try {
    if (collapsed) store.setItem(PANEL_KEY, 'collapsed');
    else store.removeItem(PANEL_KEY);
  } catch {
    /* quota / private mode */
  }
  return collapsed;
}
