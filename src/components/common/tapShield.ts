/**
 * 시트가 닫힌 직후 잠깐 화면을 덮는 투명 방패.
 *
 * 시트의 푸터 버튼은 하필 탭바 바로 위(모바일에서 y≈787)에 앉는다. 그래서
 * 「저장」을 두 번 연타하면 첫 탭이 시트를 닫고, 시트가 사라진 자리에 있던
 * **탭바가** 두 번째 탭을 받아 엉뚱한 탭으로 넘어간다. 사람에게는 한 동작인
 * 두 번의 탭이 서로 다른 화면에 떨어지는 셈이다.
 *
 * 350ms 동안 아무것도 통과시키지 않는 레이어를 깔아 그 창을 막는다. 리액트
 * 트리 밖(=`document.body`에 붙는 DOM 노드)에 사는 이유는 하나다: 방패가
 * 필요한 순간이 바로 시트가 언마운트되는 순간이라, 시트가 렌더링하는 것으로는
 * 이미 늦다.
 *
 * **손가락일 때만** 올린다. 새어 나갈 두 번째 탭이 존재하는 입력은 터치뿐이고,
 * 마우스 앞에 보이지 않는 벽을 세우는 건(클릭이 조용히 사라지는 것은 물론
 * 드래그가 시작조차 못 하는 것도) 고치려던 것보다 나쁜 버그다.
 */

/** 두 번째 탭이 「같은 동작의 일부」로 읽히는 한계. */
const SHIELD_MS = 350;

let node: HTMLDivElement | null = null;
let timer = 0;
let watching = false;
let lastPointerWasTouch = false;

const rememberPointerType = (event: PointerEvent) => {
  lastPointerWasTouch = event.pointerType === 'touch' || event.pointerType === 'pen';
};

/**
 * 마지막 입력이 손가락이었는지 지켜본다. 시트가 마운트될 때 한 번 부르면 되고,
 * 여러 번 불러도 리스너는 하나다.
 */
export function watchPointerType(): void {
  if (watching || typeof window === 'undefined') return;
  watching = true;
  window.addEventListener('pointerdown', rememberPointerType, { capture: true, passive: true });
}

/** 방패를 걷는다. 시간이 다 되면 저절로 불린다. */
export function dropTapShield(): void {
  window.clearTimeout(timer);
  timer = 0;
  node?.remove();
}

/**
 * `durationMs` 동안 화면 전체를 덮는다. 이미 떠 있으면 시간만 연장한다.
 * 마지막 입력이 터치가 아니었으면 아무 일도 하지 않는다.
 */
export function raiseTapShield(durationMs: number = SHIELD_MS): void {
  if (typeof document === 'undefined' || !lastPointerWasTouch) return;

  if (!node) {
    node = document.createElement('div');
    node.setAttribute('aria-hidden', 'true');
    node.dataset.testid = 'tap-shield';
    // 탭바(z-40)와 시트(z-50) 위, 지도 모달(z-60)과 같은 층.
    node.style.cssText =
      'position:fixed;inset:0;z-index:60;background:transparent;touch-action:none';
  }

  if (!node.isConnected) document.body.appendChild(node);
  window.clearTimeout(timer);
  timer = window.setTimeout(dropTapShield, durationMs);
}
