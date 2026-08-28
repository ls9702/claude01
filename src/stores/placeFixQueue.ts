/**
 * 「방금 배치한 카드의 위치를 구글에 한 번 물어봐 줘」 — 부탁 한 건 (M41).
 *
 * 배치하는 자리는 둘이다: 드래그(`dnd/PlanDndContext`)와 탭(`ScheduleSheet`,
 * 보드에서도 열린다). 팝업을 띄우는 화면은 하나여야 하므로(같은 팝업이 두 벌
 * 있으면 언젠가 서로 다르게 굴기 시작한다), 배치 쪽은 **부탁만 적고** 앱 껍데기에
 * 상주하는 {@link ../components/map/PlaceFixHost}가 그걸 집어 처리한다.
 *
 * ## 한 번에 하나, 그리고 최신이 이긴다
 *
 * 카드를 연달아 세 장 놓으면 팝업이 세 개 쌓여서는 안 된다. 그렇다고 첫 장의
 * 팝업이 뜬 동안 나머지를 버리면 「왜 어떤 건 물어보고 어떤 건 안 물어보지」가
 * 된다. 그래서 대기열은 **길이 1**이다: 새 부탁은 아직 처리 안 된 앞 부탁을
 * 덮어쓰고, 화면이 비는 순간 그 마지막 한 건이 처리된다. 사람이 마지막으로 놓은
 * 카드가 사람이 지금 생각하고 있는 카드다.
 */

import { create } from 'zustand';
import { hasGoogleMapsKey } from '../map/gmapsKey';
import { isGoogleSheetDay } from '../map/placeFix';
import type { Id, Workspace } from '../types/models';

/** 처리해 달라는 카드 하나. */
export interface PlaceFixRequest {
  cardId: Id;
  /** 부탁이 생긴 시각 — 같은 카드를 두 번 놓아도 새 부탁으로 읽히게 한다. */
  at: number;
}

export interface PlaceFixQueueState {
  /** 아직 아무도 집어가지 않은 마지막 부탁. */
  pending: PlaceFixRequest | null;
  /** 부탁을 적는다 — 앞 부탁이 남아 있으면 덮어쓴다. */
  push: (cardId: Id) => void;
  /** 집어 든다. 대기열은 비워진다. */
  take: () => PlaceFixRequest | null;
  /** 부탁을 버린다 — 여행을 옮기거나 화면을 떠날 때. */
  clear: () => void;
}

export const usePlaceFixQueue = create<PlaceFixQueueState>()((set, get) => ({
  pending: null,
  push: (cardId) => set({ pending: { cardId, at: Date.now() } }),
  take: () => {
    const pending = get().pending;
    if (pending) set({ pending: null });
    return pending;
  },
  clear: () => set({ pending: null }),
}));

/**
 * 배치 경로가 부르는 한 줄 — 이 배치가 물어볼 만한 배치인지까지 여기서 정한다.
 *
 * 조건은 둘뿐이다: 이 기기에 구글 키가 있고, 놓인 일자가 **구글 시트**의 일자일
 * 것. 둘 중 하나라도 아니면 아무 일도 일어나지 않는다 — OSM 시트를 쓰는 사람은
 * 이 기능이 있는 줄도 모르는 편이 맞다.
 *
 * 배치 자체는 이 함수보다 **먼저** 끝나 있어야 한다. 이 부탁은 배치의 조건이
 * 아니라 배치의 뒷이야기다.
 */
export function requestPlaceFix(workspace: Workspace, cardId: Id, dayId: Id): void {
  if (!hasGoogleMapsKey()) return;
  if (!isGoogleSheetDay(workspace, dayId)) return;
  usePlaceFixQueue.getState().push(cardId);
}
