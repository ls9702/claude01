import { create } from 'zustand';
import type { Workspace } from '../types/models';
import { loadActiveIds, saveActiveIds, validActiveIds } from './uiPersist';

/** The six top-level tabs: 여행 / 보드 / 일정 / 지도 / 메모 / 드로우. */
export type TabId = 'trips' | 'board' | 'timeline' | 'map' | 'memo' | 'draw';

export const TAB_IDS: readonly TabId[] = ['trips', 'board', 'timeline', 'map', 'memo', 'draw'];

/** Korean labels shown in the tab bar. */
export const TAB_LABELS: Record<TabId, string> = {
  trips: '여행',
  board: '보드',
  timeline: '일정',
  map: '지도',
  memo: '메모',
  // 드로우 (M52a) — 앞의 다섯이 두 글자라 여기만 세 글자다. 320px에서 여섯 칸이
  // 넘치지 않는 것은 `TabBar`가 이 칸에만 한 단계 작은 활자를 주기 때문이고,
  // 그 사실은 `viewportfit.spec`가 폭 셋에서 지킨다.
  draw: '드로우',
};

export const isTabId = (value: string): value is TabId =>
  (TAB_IDS as readonly string[]).includes(value);

/**
 * View state. Ephemeral except for {@link UiState.activeTripId} and
 * {@link UiState.activeSheetId}, which survive a reload through
 * `uiPersist` — see that module for why those two and nothing else (B15).
 */
export interface UiState {
  activeTab: TabId;
  activeTripId?: string;
  activeSheetId?: string;
  /**
   * A card another view asked the 보드 to open — the map's 「보드에서 편집」.
   * The board opens its edit sheet for it and clears the field immediately, so
   * this is a one-shot handoff rather than a piece of state.
   */
  focusCardId?: string;
  /**
   * Same one-shot handoff pattern for the AI 추천 sheet — the 질문 시트's
   * 「카드로 만들기」 sends the typed text here, the 보드 opens AI 추천 with it
   * prefilled and clears the field (M17).
   */
  aiSuggestPrefill?: string;
  /**
   * 열려 있는 드로우 페이지 (M52a). **URL이 주인**이다 — `HashSync`가
   * `#/draw/<pageId>`와 이 값을 양방향으로 묶으므로, 새로고침해도 보던 페이지가
   * 그대로 열리고 링크를 보내면 그 페이지가 열린다. 그래서 `uiPersist`에는
   * 넣지 않는다(같은 사실을 두 곳에 적으면 언젠가 둘이 다른 말을 한다).
   */
  activeDrawPageId?: string;
  setTab: (tab: TabId) => void;
  setActiveTrip: (tripId?: string) => void;
  setActiveSheet: (sheetId?: string) => void;
  /** 페이지를 열거나(`id`) 목록으로 돌아간다(`undefined`). */
  setActiveDrawPage: (pageId?: string) => void;
  focusCard: (cardId?: string) => void;
  requestAiSuggest: (prefill: string) => void;
  clearAiSuggestPrefill: () => void;
}

const restored = loadActiveIds();

export const useUiStore = create<UiState>()((set) => ({
  // The tab still comes from the URL hash (see `HashSync`); only the two ids
  // below are remembered per device.
  activeTab: 'trips',
  activeTripId: restored.activeTripId,
  activeSheetId: restored.activeSheetId,
  focusCardId: undefined,
  setTab: (tab) => set({ activeTab: tab }),
  setActiveTrip: (tripId) =>
    set({
      activeTripId: tripId,
      activeSheetId: undefined,
      focusCardId: undefined,
      // 다른 여행의 스케치북을 그대로 들고 갈 수는 없다 (M52a).
      activeDrawPageId: undefined,
    }),
  setActiveSheet: (sheetId) => set({ activeSheetId: sheetId }),
  setActiveDrawPage: (pageId) => set({ activeDrawPageId: pageId }),
  focusCard: (cardId) => set({ focusCardId: cardId }),
  requestAiSuggest: (prefill) => set({ aiSuggestPrefill: prefill, activeTab: 'board' }),
  clearAiSuggestPrefill: () => set({ aiSuggestPrefill: undefined }),
}));

useUiStore.subscribe((state) =>
  saveActiveIds({ activeTripId: state.activeTripId, activeSheetId: state.activeSheetId }),
);

/**
 * Drops a remembered trip/sheet the workspace no longer has.
 *
 * Called once IndexedDB rehydration is done — before that the workspace is
 * empty and *every* id would look like a ghost.
 */
export function pruneActiveIds(workspace: Workspace): void {
  const { activeTripId, activeSheetId } = useUiStore.getState();
  if (!activeTripId && !activeSheetId) return;

  const next = validActiveIds({ activeTripId, activeSheetId }, workspace);
  if (next.activeTripId === activeTripId && next.activeSheetId === activeSheetId) return;
  useUiStore.setState(next);
}
