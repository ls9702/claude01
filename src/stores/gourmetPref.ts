/**
 * 「주변 맛집」 필터 선택을 기기에 기억한다 (M43).
 *
 * `mapFilterPref`(M27)와 같은 결이다: 지금 초밥만 보고 있다는 것은 **데이터가
 * 아니라 이 기기의 시야 설정**이고, 폰에서 고른 것이 상대의 노트북까지 흔들면
 * 그건 동기화가 아니라 참견이다. 그래서 `localStorage` 한 줄.
 *
 * 여행마다 나누지 않는다 — 「나는 라멘파다」는 여행이 바뀌어도 그대로다.
 *
 * 레이어를 **켠 상태**는 기억하지 않는다. 켜는 순간 구글에 돈이 나가는 일이
 * 시작되므로, 지도 탭을 열었을 뿐인 사람에게 그 일이 자동으로 벌어져서는 안 된다.
 */

import type { GourmetGenre } from '../data/gourmet';
import {
  DEFAULT_GOURMET_FILTER,
  GOURMET_GENRES,
  type GourmetFilter,
  type GourmetReservableFilter,
  type GourmetSourceFilter,
} from '../gourmet/filter';

const GOURMET_FILTER_KEY = 'trip-board/gourmet-filter';

const RESERVABLE: readonly GourmetReservableFilter[] = ['all', 'yes', 'no'];
const SOURCES: readonly GourmetSourceFilter[] = ['all', 'curated', 'google'];

/** `localStorage`, 없거나 막혀 있으면 `null`. */
function storage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

/** 무엇이 들어와도 {@link GourmetFilter} 하나로 만든다. */
export function normalizeGourmetFilter(value: unknown): GourmetFilter {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ...DEFAULT_GOURMET_FILTER, genres: [] };
  }
  const raw = value as Record<string, unknown>;

  const genres = Array.isArray(raw.genres)
    ? GOURMET_GENRES.filter((genre) => (raw.genres as unknown[]).includes(genre))
    : [];
  const reservable = RESERVABLE.find((kind) => kind === raw.reservable) ?? 'all';
  const source = SOURCES.find((kind) => kind === raw.source) ?? 'all';

  return { genres: genres as GourmetGenre[], reservable, source };
}

/** 이 기기가 마지막으로 고른 필터. 고른 적이 없으면 기본값. */
export function loadGourmetFilter(): GourmetFilter {
  const store = storage();
  if (!store) return { ...DEFAULT_GOURMET_FILTER, genres: [] };
  try {
    const raw = store.getItem(GOURMET_FILTER_KEY);
    if (!raw) return { ...DEFAULT_GOURMET_FILTER, genres: [] };
    return normalizeGourmetFilter(JSON.parse(raw) as unknown);
  } catch {
    return { ...DEFAULT_GOURMET_FILTER, genres: [] };
  }
}

/**
 * 선택을 저장한다. 못 써도 치명적이지 않다 — 편의 설정이다.
 *
 * 정규화한 값을 돌려주므로 호출부가 그대로 상태로 삼아도 된다.
 */
export function saveGourmetFilter(filter: GourmetFilter): GourmetFilter {
  const next = normalizeGourmetFilter(filter);
  const store = storage();
  if (!store) return next;
  try {
    store.setItem(GOURMET_FILTER_KEY, JSON.stringify(next));
  } catch {
    /* quota / private mode */
  }
  return next;
}
