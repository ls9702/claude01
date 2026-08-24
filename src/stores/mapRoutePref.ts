/**
 * 지도 경로 선택을 기기에 기억한다 (M15 §3).
 *
 * M6은 경로를 **꺼진 상태**로 두고, 사용자가 경로 칩 줄을 발견해 일자를 고르기를
 * 기다렸다. 실사용 피드백은 간단했다: 아무도 그 줄을 찾지 못했고, 그래서 화살표를
 * 본 적이 없다. 이제 기본값은 「전체」이며, 그 선택은 이 기기에 남는다 — 여행마다
 * 따로. 한 여행에서 3일차만 보다가 다른 여행으로 넘어갔을 때 3일차가 따라오면
 * 그건 기억이 아니라 오작동이다.
 *
 * 저장 값은 `'off' | 'all' | 'day:<dayId>'` 한 줄짜리 문자열이고, 워크스페이스가
 * 아니라 `localStorage`에 산다(`uiPersist`·`aiSettings`와 같은 결). 사라진 일자를
 * 가리키는 값은 MapView가 그릴 때 걸러낸다.
 */

const ROUTE_KEY = 'trip-board/map-route';

/** 저장 문자열 — `off` · `all` · `day:<dayId>`. */
export type StoredRouteChoice = string;

/** `localStorage`, 없거나 막혀 있으면 `null`. */
function storage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

/** `{tripId: choice}` 전체. 읽을 수 없으면 빈 객체. */
function loadAll(): Record<string, string> {
  const store = storage();
  if (!store) return {};
  try {
    const raw = store.getItem(ROUTE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [tripId, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string' && value.length > 0) out[tripId] = value;
    }
    return out;
  } catch {
    return {};
  }
}

/** 이 여행에서 마지막으로 고른 값. 고른 적이 없으면 `undefined`. */
export function loadRouteChoice(tripId: string | undefined): StoredRouteChoice | undefined {
  if (!tripId) return undefined;
  return loadAll()[tripId];
}

/** 선택을 저장한다. 못 써도 치명적이지 않다 — 편의 설정이다. */
export function saveRouteChoice(tripId: string | undefined, choice: StoredRouteChoice): void {
  if (!tripId) return;
  const store = storage();
  if (!store) return;
  try {
    store.setItem(ROUTE_KEY, JSON.stringify({ ...loadAll(), [tripId]: choice }));
  } catch {
    /* quota / private mode */
  }
}

/** 저장 문자열이 가리키는 일자 id — 일자 선택이 아니면 `undefined`. */
export function storedDayId(choice: StoredRouteChoice | undefined): string | undefined {
  if (!choice || !choice.startsWith('day:')) return undefined;
  const dayId = choice.slice(4);
  return dayId.length > 0 ? dayId : undefined;
}
