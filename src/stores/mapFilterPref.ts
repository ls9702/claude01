/**
 * 지도 필터 선택을 기기에 기억한다 (M27).
 *
 * `mapRoutePref`(M15)와 같은 결이다: 지도에서 무엇을 보고 있는지는 **데이터가
 * 아니라 이 기기의 시야 설정**이다. 폰에서 「1일차 · 맛집만」을 보고 있다고 해서
 * 노트북까지 그렇게 열리면 그건 동기화가 아니라 참견이고, 워크스페이스에 들어간
 * 순간 두 사람이 서로의 지도를 흔들게 된다. 그래서 `localStorage`, 여행마다 따로.
 *
 * 저장 값은 여행 id → `{ scope, dayId?, muted }` 하나이고, 읽을 때 무엇이
 * 들어와도 {@link DEFAULT_MAP_FILTER_PREF}로 정규화한다 — 손으로 고친 값이나 옛
 * 형식이 지도를 비워 놓는 일은 없어야 한다. 사라진 일자·사라진 카테고리를
 * 가리키는 값은 `MapView`가 그릴 때 걸러 낸다(경로 선택이 이미 그렇게 한다).
 */

import type { MapScopeKind } from '../map/filter';

const FILTER_KEY = 'trip-board/map-filter';

/** 이 기기가 한 여행에 대해 기억하는 지도 필터. */
export interface MapFilterPref {
  /** 범위 — 기본은 M3부터의 동작인 「전체 아이템」. */
  scope: MapScopeKind;
  /** 「일자별」이 마지막으로 보던 일자. */
  dayId?: string;
  /** 꺼 둔 카테고리(칼럼 id) — 나머지는 전부 켜져 있다. */
  muted: string[];
}

/** 아무것도 고르지 않은 상태. 읽을 수 없을 때의 답이기도 하다. */
export const DEFAULT_MAP_FILTER_PREF: MapFilterPref = { scope: 'all', muted: [] };

const SCOPES: readonly MapScopeKind[] = ['all', 'sheet', 'day', 'unscheduled'];

/** `localStorage`, 없거나 막혀 있으면 `null`. */
function storage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

/** 무엇이 들어와도 {@link MapFilterPref} 하나로 만든다. */
export function normalizeFilterPref(value: unknown): MapFilterPref {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ...DEFAULT_MAP_FILTER_PREF, muted: [] };
  }
  const raw = value as Partial<Record<keyof MapFilterPref, unknown>>;
  const scope = SCOPES.find((kind) => kind === raw.scope) ?? 'all';
  const dayId = typeof raw.dayId === 'string' && raw.dayId.length > 0 ? raw.dayId : undefined;
  const muted = Array.isArray(raw.muted)
    ? raw.muted.filter((id): id is string => typeof id === 'string' && id.length > 0)
    : [];
  return dayId ? { scope, dayId, muted } : { scope, muted };
}

/** `{tripId: pref}` 전체. 읽을 수 없으면 빈 객체. */
function loadAll(): Record<string, MapFilterPref> {
  const store = storage();
  if (!store) return {};
  try {
    const raw = store.getItem(FILTER_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, MapFilterPref> = {};
    for (const [tripId, value] of Object.entries(parsed as Record<string, unknown>)) {
      out[tripId] = normalizeFilterPref(value);
    }
    return out;
  } catch {
    return {};
  }
}

/** 이 여행에서 마지막으로 고른 필터. 고른 적이 없으면 기본값. */
export function loadMapFilter(tripId: string | undefined): MapFilterPref {
  if (!tripId) return { ...DEFAULT_MAP_FILTER_PREF, muted: [] };
  return loadAll()[tripId] ?? { ...DEFAULT_MAP_FILTER_PREF, muted: [] };
}

/**
 * 선택을 저장한다. 못 써도 치명적이지 않다 — 편의 설정이다.
 *
 * 정규화한 값을 돌려주므로 호출부가 그대로 상태로 삼아도 된다.
 */
export function saveMapFilter(
  tripId: string | undefined,
  pref: MapFilterPref,
): MapFilterPref {
  const next = normalizeFilterPref(pref);
  if (!tripId) return next;
  const store = storage();
  if (!store) return next;
  try {
    store.setItem(FILTER_KEY, JSON.stringify({ ...loadAll(), [tripId]: next }));
  } catch {
    /* quota / private mode */
  }
  return next;
}
