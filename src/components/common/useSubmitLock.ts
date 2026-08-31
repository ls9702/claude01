import { useCallback, useRef } from 'react';

/**
 * 제출 버튼은 한 번만 듣는다 (M50, 헌터D2 #2·#3).
 *
 * 시트의 「추가」는 눌리면 스토어에 쓰고 부모에게 닫으라고 말한다. 그런데 닫는
 * 일은 리액트의 다음 렌더에서 일어나고, 시트에는 닫힘 애니메이션까지 있다 —
 * 그 사이의 100~200ms 동안 버튼은 화면에 그대로 있고, 여전히 눌린다. 손가락이
 * 두 번 튀거나 마우스를 더블클릭하면 카드가 두 장 생기고 배치가 둘로 늘었다.
 *
 * 잠금은 **ref**여야 한다: 상태로 두면 두 번째 클릭이 리렌더 전에 도착해
 * 옛 값을 읽는다. 한 번 잠기면 풀리지 않는데, 이 훅을 쓰는 자리들은 전부
 * 제출과 동시에 언마운트되기 때문이다 — 다시 열린 시트는 새 잠금을 받는다.
 *
 * ```ts
 * const once = useSubmitLock();
 * const submit = () => once(() => { save(); onClose(); });
 * ```
 */
export function useSubmitLock(): (run: () => void) => void {
  const busy = useRef(false);
  return useCallback((run: () => void) => {
    if (busy.current) return;
    busy.current = true;
    run();
  }, []);
}

export default useSubmitLock;
