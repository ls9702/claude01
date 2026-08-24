/**
 * 일정 탭 상단 크롬을 접어 둔 상태 — 기기별로 기억한다 (M18).
 *
 * 폰에서 일정 탭을 열면 그리드에 닿기까지 다섯 줄을 지나야 했다: 제목+버튼,
 * 시트 탭, 지출 요약 바, 일자 페이저, 그리고 지금/다음 바. 390×844에서 그리드는
 * 화면의 절반도 못 가졌다. 그래서 **접기 토글** 하나를 둔다 — 접으면 시트 탭과
 * 지출 요약 바가 사라지고 제목 줄은 시트명 하나만 든 슬림 줄로 줄어든다.
 *
 * 페이저는 접어도 남는다. 그건 장식이 아니라 **네비게이션**이고, 1일차에서
 * 2일차로 가는 유일한 길을 접어 버리면 공간을 아낀 게 아니라 앱을 망가뜨린 것이다.
 *
 * 저장 위치가 `localStorage`인 이유는 `collapsedColumns`와 똑같다: 접힘은
 * 데이터가 아니라 **이 화면을 보는 이 기기의 시야 설정**이다. 폰에서 접은 것이
 * 노트북에서까지 접혀 있으면 그것은 동기화가 아니라 참견이다. 데스크톱은 애초에
 * 이 토글을 그리지도 않는다(≥lg는 M18 이전과 픽셀 단위로 같다).
 *
 * 기본값은 **펼침**이다. 처음 열었을 때 시트 탭이 없으면 시트를 여러 개 만들 수
 * 있다는 사실 자체를 발견할 수 없다.
 */

import { create } from 'zustand';

const CHROME_KEY = 'trip-board/timeline-chrome';

/** `localStorage`, 없거나 막혀 있으면 `null`. */
function storage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

/** 저장 형식. 지금은 한 칸이지만, 나중에 늘어날 자리를 열어 둔 객체다. */
export interface TimelineChrome {
  /** 시트 탭 + 지출 요약 바를 접어 두었는가. */
  collapsed: boolean;
}

/** 아무것도 접지 않은 상태 — 읽을 수 없을 때의 답이기도 하다. */
export const DEFAULT_TIMELINE_CHROME: TimelineChrome = { collapsed: false };

/**
 * 무엇이 들어와도 `TimelineChrome` 하나로 만든다.
 *
 * `true`만 접힘으로 본다: 예전 형식이든 손으로 고친 값이든, 애매하면 펼침이
 * 안전한 쪽이다 — 펼쳐진 화면은 못생겼을 수는 있어도 아무것도 숨기지 않는다.
 */
export function normalizeChrome(value: unknown): TimelineChrome {
  if (typeof value !== 'object' || value === null) return { ...DEFAULT_TIMELINE_CHROME };
  return { collapsed: (value as Partial<TimelineChrome>).collapsed === true };
}

/** 이 기기가 기억하는 접힘 상태. 읽을 수 없으면 펼침. */
export function loadTimelineChrome(): TimelineChrome {
  const store = storage();
  if (!store) return { ...DEFAULT_TIMELINE_CHROME };
  try {
    const raw = store.getItem(CHROME_KEY);
    if (!raw) return { ...DEFAULT_TIMELINE_CHROME };
    return normalizeChrome(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_TIMELINE_CHROME };
  }
}

/**
 * 접힘 상태를 저장한다. 못 써도 치명적이지 않다 — 편의 설정이다.
 *
 * 펼침은 키를 **지운다**: 기본값을 굳이 적어 두면 「한 번도 안 건드림」과
 * 「접었다가 다시 폄」이 구별되지 않고, 그 구별이 필요해지는 날 이미 늦다.
 */
export function saveTimelineChrome(chrome: TimelineChrome): TimelineChrome {
  const next = normalizeChrome(chrome);
  const store = storage();
  if (!store) return next;
  try {
    if (!next.collapsed) store.removeItem(CHROME_KEY);
    else store.setItem(CHROME_KEY, JSON.stringify(next));
  } catch {
    /* quota / private mode */
  }
  return next;
}

interface TimelineChromeState {
  /** 시트 탭 + 지출 요약 바가 접혀 있는가. */
  collapsed: boolean;
  toggle: () => void;
  /** 접힌 줄의 시트명을 눌렀을 때 — 시트 전환은 언제나 두 탭 안이어야 한다. */
  expand: () => void;
}

export const useTimelineChromeStore = create<TimelineChromeState>()((set) => ({
  collapsed: loadTimelineChrome().collapsed,
  toggle: () =>
    set((state) => saveTimelineChrome({ collapsed: !state.collapsed })),
  expand: () => set(() => saveTimelineChrome({ collapsed: false })),
}));
