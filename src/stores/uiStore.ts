import { create } from 'zustand';
import type { Workspace } from '../types/models';
import { loadActiveIds, saveActiveIds, validActiveIds } from './uiPersist';

/** The five top-level tabs: 여행 / 보드 / 일정 / 지도 / 메모. */
export type TabId = 'trips' | 'board' | 'timeline' | 'map' | 'memo';

export const TAB_IDS: readonly TabId[] = ['trips', 'board', 'timeline', 'map', 'memo'];

/** Korean labels shown in the tab bar. */
export const TAB_LABELS: Record<TabId, string> = {
  trips: '여행',
  board: '보드',
  timeline: '일정',
  map: '지도',
  memo: '메모',
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
  setTab: (tab: TabId) => void;
  setActiveTrip: (tripId?: string) => void;
  setActiveSheet: (sheetId?: string) => void;
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
    set({ activeTripId: tripId, activeSheetId: undefined, focusCardId: undefined }),
  setActiveSheet: (sheetId) => set({ activeSheetId: sheetId }),
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
