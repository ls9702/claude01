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

/**
 * 필터 패널을 접어 두었는가 (M45) — 필터 **선택**과는 다른 값이라 키도 다르다.
 *
 * 신고: 폰에서 패널(`inset-x-2 top-[9.5rem] max-h-[55%]`)이 지도의 절반을 덮는다.
 * 칩 열한 개는 한 번 고르고 나면 다시 볼 일이 드문 물건인데, 그것이 지도를
 * 가리고 서 있다.
 *
 * 접힘을 필터 객체 안에 넣지 않은 이유: `GourmetFilter`는 **무엇을 보여 줄지**를
 * 정하는 순수 값이고 `gourmet/filter.ts`의 함수들이 그것만 읽는다. 「패널이
 * 접혀 있다」는 화면의 사정이지 필터의 사정이 아니다 — 섞으면 필터를 검사하는
 * 단위 테스트가 화면 상태를 알게 된다.
 */
const GOURMET_PANEL_KEY = 'trip-board/gourmet-panel';

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

/* ------------------------------------------------------------------ *
 * 패널 접기 (M45)
 * ------------------------------------------------------------------ */

/**
 * 패널이 접혀 있는가. 고른 적이 없으면 **펼침**.
 *
 * 기본이 펼침인 이유는 `timelineChrome`(M18)과 같다: 처음 켠 사람이 칩이 있다는
 * 사실 자체를 발견할 수 없으면, 아낀 것은 공간이 아니라 기능이다. 한 번 접으면
 * 그때부터 기억한다.
 */
export function loadGourmetPanelCollapsed(): boolean {
  const store = storage();
  if (!store) return false;
  try {
    return store.getItem(GOURMET_PANEL_KEY) === 'collapsed';
  } catch {
    return false;
  }
}

/**
 * 접힘을 저장하고 그 값을 돌려준다 — 호출부가 그대로 상태로 삼아도 된다.
 *
 * 펼침은 키를 지운다: 기본값을 적어 두면 「한 번도 안 건드림」과 「접었다 폄」이
 * 구별되지 않는다.
 */
export function saveGourmetPanelCollapsed(collapsed: boolean): boolean {
  const store = storage();
  if (!store) return collapsed;
  try {
    if (collapsed) store.setItem(GOURMET_PANEL_KEY, 'collapsed');
    else store.removeItem(GOURMET_PANEL_KEY);
  } catch {
    /* quota / private mode */
  }
  return collapsed;
}
