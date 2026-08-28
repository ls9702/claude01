import { useEffect, useRef, useState } from 'react';
import { useGoogleMapsKey } from '../../map/gmapsKey';
import { loadGoogleMaps } from '../../map/googleLoader';
import { searchPlaceByText } from '../../map/googlePlaces';
import {
  decidePlaceFix,
  placeFixBias,
  type PlaceFixDecision,
  type PlaceSuggestion,
} from '../../map/placeFix';
import { usePlaceFixQueue } from '../../stores/placeFixQueue';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import type { Card } from '../../types/models';
import PlaceFixDialog from './PlaceFixDialog';

/** 화면에 떠 있는 질문 하나. */
interface ActiveFix {
  card: Card;
  suggestion: PlaceSuggestion;
  decision: PlaceFixDecision;
}

/**
 * 배치 보정 팝업의 **유일한** 주인 (M41).
 *
 * 앱 껍데기에 하나만 상주한다. 배치하는 자리는 셋(일정 탭의 드래그, 일정 탭의
 * 탭 배치, 보드 탭의 「시간표에 추가」)이지만 팝업은 하나여야 하고, 무엇보다
 * 그중 하나(보드의 배치 시트)는 일정 탭이 화면에 없을 때도 열린다.
 *
 * 하는 일은 짧다: 대기열에서 부탁 하나를 집어 → 구글에 카드 제목으로 한 번
 * 물어보고 → {@link decidePlaceFix}가 「보여 줄 만하다」고 하면 팝업을 띄운다.
 * 그 셋 중 어디서 실패해도(키 없음·못 찾음·네트워크) 조용히 아무 일도 없었던
 * 것이 된다 — 사용자가 부탁한 적 없는 일이라, 실패까지 알릴 이유가 없다.
 *
 * 한 번에 하나만 처리한다. 처리 중에 새 부탁이 들어오면 대기열이 그것을 들고
 * 있다가(길이 1, 최신이 이긴다) 이 팝업이 닫힌 다음에 이어서 처리된다.
 */
export default function PlaceFixHost() {
  const apiKey = useGoogleMapsKey();
  const pending = usePlaceFixQueue((s) => s.pending);
  const take = usePlaceFixQueue((s) => s.take);
  const updateCard = useWorkspaceStore((s) => s.updateCard);

  const [active, setActive] = useState<ActiveFix | null>(null);
  /** 지금 구글에 묻고 있는 중인가 — 두 부탁이 동시에 날아가지 않게. */
  const busyRef = useRef(false);
  /**
   * 살아 있는가 — **효과 단위가 아니라 컴포넌트 단위**의 취소 깃발이다.
   *
   * 효과 안에 `let cancelled`를 두면 안 된다: 부탁을 집어 드는 순간 대기열이
   * 비고, 그 상태 변화가 곧바로 이 효과를 정리시킨다. 그러면 아직 날아가고 있는
   * 검색이 「취소됨」으로 표시되어 팝업이 영영 뜨지 않는다. 취소해야 하는 진짜
   * 경우는 하나뿐이다 — 이 컴포넌트가 화면에서 사라졌을 때.
   */
  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  useEffect(() => {
    if (!pending || active || busyRef.current || !apiKey) return;

    const request = take();
    if (!request) return;
    busyRef.current = true;

    void (async () => {
      try {
        const workspace = useWorkspaceStore.getState().workspace;
        const card = workspace.cards[request.cardId];
        if (!card?.title.trim()) return;

        const maps = await loadGoogleMaps(apiKey);
        const suggestion = await searchPlaceByText(
          maps,
          card.title,
          placeFixBias(workspace, card.id),
        );
        if (!mountedRef.current) return;

        // 카드가 그새 바뀌었을 수 있다 — 판단은 **지금**의 카드로 한다.
        const current = useWorkspaceStore.getState().workspace.cards[card.id];
        if (!current) return;

        const decision = decidePlaceFix(current.location, suggestion);
        if (!decision.offer || !suggestion) return;
        setActive({ card: current, suggestion, decision });
      } catch {
        /* 조용히 지나간다 */
      } finally {
        busyRef.current = false;
      }
    })();
  }, [pending, active, apiKey, take]);

  if (!active || !apiKey) return null;

  return (
    <PlaceFixDialog
      apiKey={apiKey}
      card={active.card}
      suggestion={active.suggestion}
      decision={active.decision}
      onConfirm={() => {
        // 주소도 함께 간다: 좌표만 바꾸고 옛 주소를 남기면 카드가 스스로를
        // 부정하는 상태가 된다(칩에는 옛 가게 이름, 지도에는 새 자리).
        updateCard(active.card.id, {
          location: {
            lat: active.suggestion.lat,
            lng: active.suggestion.lng,
            ...(active.suggestion.address ? { address: active.suggestion.address } : {}),
          },
        });
        setActive(null);
      }}
      onCancel={() => setActive(null)}
    />
  );
}
