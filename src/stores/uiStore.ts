import { create } from 'zustand';

/** The four top-level tabs: 여행 / 보드 / 일정 / 지도. */
export type TabId = 'trips' | 'board' | 'timeline' | 'map';

export const TAB_IDS: readonly TabId[] = ['trips', 'board', 'timeline', 'map'];

/** Korean labels shown in the tab bar. */
export const TAB_LABELS: Record<TabId, string> = {
  trips: '여행',
  board: '보드',
  timeline: '일정',
  map: '지도',
};

export const isTabId = (value: string): value is TabId =>
  (TAB_IDS as readonly string[]).includes(value);

/** Ephemeral view state. Deliberately NOT persisted. */
export interface UiState {
  activeTab: TabId;
  activeTripId?: string;
  activeSheetId?: string;
  setTab: (tab: TabId) => void;
  setActiveTrip: (tripId?: string) => void;
  setActiveSheet: (sheetId?: string) => void;
}

export const useUiStore = create<UiState>()((set) => ({
  activeTab: 'trips',
  activeTripId: undefined,
  activeSheetId: undefined,
  setTab: (tab) => set({ activeTab: tab }),
  setActiveTrip: (tripId) => set({ activeTripId: tripId, activeSheetId: undefined }),
  setActiveSheet: (sheetId) => set({ activeSheetId: sheetId }),
}));
