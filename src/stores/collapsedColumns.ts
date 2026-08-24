/**
 * 접어둔 카테고리 — 기기별로 기억한다 (M15 §2).
 *
 * 일정표의 카테고리(=보드 컬럼)는 다섯 개를 넘어가면 화면을 다 먹는다. 그래서
 * 헤더를 눌러 접을 수 있게 하고, **어떤 카테고리를 접어 두었는지**만 이 기기에
 * 남긴다. 워크스페이스에는 절대 넣지 않는다: 접힘은 데이터가 아니라 이 화면을
 * 보는 사람의 시야 설정이고, 폰에서 접은 것이 노트북에서까지 접혀 있으면
 * 그것은 동기화가 아니라 참견이다 (`sync/settings`·`uiPersist`와 같은 결).
 *
 * 저장 형식은 columnId 배열 하나. 삭제된 컬럼의 id가 남아도 아무 일도 하지
 * 않으므로 청소는 굳이 하지 않는다.
 *
 * `localStorage`가 없는 곳(Node·vitest·프라이빗 모드)에서는 조용히 "아무것도
 * 접지 않음"으로 동작한다 — 순수 함수 부분만 떼어 테스트할 수 있다.
 */

import { create } from 'zustand';

const COLLAPSED_KEY = 'trip-board/collapsed';

/** `localStorage`, 없거나 막혀 있으면 `null`. */
function storage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

/** 중복과 빈 문자열을 걷어낸 id 목록. 입력이 배열이 아니면 빈 배열. */
export function normalizeCollapsed(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string' || item.length === 0) continue;
    seen.add(item);
  }
  return [...seen];
}

/** 이 기기가 접어 둔 컬럼 id들. 읽을 수 없으면 빈 배열. */
export function loadCollapsedColumns(): string[] {
  const store = storage();
  if (!store) return [];
  try {
    const raw = store.getItem(COLLAPSED_KEY);
    if (!raw) return [];
    return normalizeCollapsed(JSON.parse(raw));
  } catch {
    return [];
  }
}

/** 접힘 목록을 저장한다. 못 써도 치명적이지 않다 — 편의 설정이다. */
export function saveCollapsedColumns(ids: readonly string[]): string[] {
  const next = normalizeCollapsed(ids);
  const store = storage();
  if (!store) return next;
  try {
    if (next.length === 0) store.removeItem(COLLAPSED_KEY);
    else store.setItem(COLLAPSED_KEY, JSON.stringify(next));
  } catch {
    /* quota / private mode */
  }
  return next;
}

/** 한 id를 넣거나 뺀 새 목록 — 순수 함수라 저장 없이도 검증할 수 있다. */
export function toggledCollapsed(ids: readonly string[], columnId: string): string[] {
  const current = normalizeCollapsed(ids);
  return current.includes(columnId)
    ? current.filter((id) => id !== columnId)
    : [...current, columnId];
}

interface CollapsedState {
  /** 접혀 있는 컬럼 id들. */
  collapsed: readonly string[];
  toggle: (columnId: string) => void;
}

/**
 * 스토어인 이유: 같은 컬럼이 두 곳(보드 탭, 일정 탭의 보드 레일)에서 그려지고,
 * 한쪽에서 접으면 다른 쪽도 같은 상태로 열려야 한다.
 */
export const useCollapsedStore = create<CollapsedState>()((set) => ({
  collapsed: loadCollapsedColumns(),
  toggle: (columnId) =>
    set((state) => ({ collapsed: saveCollapsedColumns(toggledCollapsed(state.collapsed, columnId)) })),
}));

/** 이 컬럼이 접혀 있는가. */
export function useColumnCollapsed(columnId: string): boolean {
  return useCollapsedStore((state) => state.collapsed.includes(columnId));
}
