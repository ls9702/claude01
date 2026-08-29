/**
 * 일정 탭의 「수정」 모드 — 지속시간 조정을 잠그는 스위치 (M45).
 *
 * 실사용 신고: 「살짝 클릭 했는데 시간 조절이 됨」. 원인은 `EntryBlock`의 리사이즈
 * 손잡이다 — 그것은 dnd-kit의 센서를 쓰지 않고 **날 포인터 이벤트**로 돌기 때문에
 * 활성화 거리가 0이다(그게 리사이즈에 필요한 성질이다). 그래서 블록 아래 12px
 * 띠에 손가락이 스치기만 해도 길이가 바뀌고, 사용자는 자기가 무엇을 눌렀는지
 * 모른 채 계획이 달라진 화면을 본다.
 *
 * 고치는 방법은 「거리 문턱을 둔다」가 아니다. 문턱은 사고를 줄일 뿐 없애지
 * 못하고, 문턱을 넘긴 진짜 리사이즈까지 둔하게 만든다. 대신 **모드**를 둔다:
 * 기본은 꺼짐이고, 꺼져 있으면 손잡이는 아예 **그려지지 않는다** — 리스너가
 * 붙지 않으므로 스칠 것 자체가 없다.
 *
 * 잠그는 것은 **길이 하나**다. 드래그 이동도, 탭으로 상세 열기도, 휴지통 드래그
 * (M34)도 그대로다: 그 셋은 전부 활성화 문턱(8px / 250ms)을 가진 제스처라 실수로
 * 벌어지지 않고, 무엇보다 사용자가 불평한 것은 그 셋이 아니다.
 *
 * 저장은 `timelineChrome`(M18)·`mapFilterPref`(M27)와 같은 결이다: 「지금 고치는
 * 중인가」는 데이터가 아니라 **이 기기의 손잡이 설정**이다. 폰에서 켠 것이
 * 노트북까지 켜져 있으면 그건 동기화가 아니라 참견이고, 무엇보다 이 값은
 * 워크스페이스에 들어갈 이유가 없다 — 여행이 바뀌어도 같은 값이다.
 */

import { create } from 'zustand';

const EDIT_KEY = 'trip-board/timeline-edit';

/** `localStorage`, 없거나 막혀 있으면 `null`. */
function storage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

/** 저장 형식. 지금은 한 칸이지만 늘어날 자리를 열어 둔 객체다. */
export interface TimelineEdit {
  /** 길이 조절 손잡이를 그리는가. */
  on: boolean;
}

/** 기본값 — **꺼짐**. 처음 여는 사람에게 사고가 나서는 안 된다. */
export const DEFAULT_TIMELINE_EDIT: TimelineEdit = { on: false };

/**
 * 무엇이 들어와도 {@link TimelineEdit} 하나로 만든다.
 *
 * `true`만 켜짐으로 본다: 옛 형식이든 손으로 고친 값이든, 애매하면 꺼짐이 안전한
 * 쪽이다 — 꺼진 화면은 아무것도 망가뜨리지 않는다.
 */
export function normalizeTimelineEdit(value: unknown): TimelineEdit {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ...DEFAULT_TIMELINE_EDIT };
  }
  return { on: (value as Partial<TimelineEdit>).on === true };
}

/** 이 기기가 기억하는 수정 모드. 읽을 수 없으면 꺼짐. */
export function loadTimelineEdit(): TimelineEdit {
  const store = storage();
  if (!store) return { ...DEFAULT_TIMELINE_EDIT };
  try {
    const raw = store.getItem(EDIT_KEY);
    if (!raw) return { ...DEFAULT_TIMELINE_EDIT };
    return normalizeTimelineEdit(JSON.parse(raw) as unknown);
  } catch {
    return { ...DEFAULT_TIMELINE_EDIT };
  }
}

/**
 * 상태를 저장한다. 못 써도 치명적이지 않다 — 편의 설정이다.
 *
 * 꺼짐은 키를 **지운다**({@link import('./timelineChrome')}의 그 규칙): 기본값을
 * 굳이 적어 두면 「한 번도 안 건드림」과 「켰다가 다시 끔」이 구별되지 않는다.
 */
export function saveTimelineEdit(edit: TimelineEdit): TimelineEdit {
  const next = normalizeTimelineEdit(edit);
  const store = storage();
  if (!store) return next;
  try {
    if (!next.on) store.removeItem(EDIT_KEY);
    else store.setItem(EDIT_KEY, JSON.stringify(next));
  } catch {
    /* quota / private mode */
  }
  return next;
}

interface TimelineEditState {
  /** 길이 조절 손잡이가 서 있는가. */
  on: boolean;
  toggle: () => void;
  set: (on: boolean) => void;
}

export const useTimelineEditStore = create<TimelineEditState>()((set) => ({
  on: loadTimelineEdit().on,
  toggle: () => set((state) => saveTimelineEdit({ on: !state.on })),
  set: (on) => set(() => saveTimelineEdit({ on })),
}));
