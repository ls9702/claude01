/**
 * 드래그 중 자동 스크롤의 문 (M50, 헌터M1).
 *
 * dnd-kit의 기본 규칙은 두 가지 이유로 폰에서 무너진다.
 *
 * 1. 문턱이 컨테이너 높이의 **비율**(0.2)이다.
 * 2. 그 문턱 안에 들어왔는지를 손가락이 아니라 **끌고 있는 블록의 사각형**으로
 *    잰다.
 *
 * 데스크톱에서는 둘 다 무해하다 — 700px 그리드의 0.2는 140px이고, 60px짜리
 * 블록이 그 안에 들어가려면 진짜로 가장자리까지 가야 한다. 320×568 폰에서는
 * 보이는 그리드가 170px뿐이고 한 시간짜리 블록이 벌써 54px이라, 블록의 아래
 * 모서리는 **가만히 있어도** 문턱(34px) 안에 있다. 손가락이 5px 움직여 스크롤
 * 의도가 잡히는 순간 최고 속도가 붙었고, 40px 끌었을 뿐인데 그리드가 636px
 * 굴렀다.
 *
 * 그래서 비율 대신 **절대 픽셀**로, 블록 대신 **손가락**으로 판정한다.
 *
 * 컴포넌트에서 떼어 놓은 이유는 검사 가능해야 하기 때문이다: 이 판정이
 * 헐거워지면 폰 드래그가 다시 날뛰고, 너무 조이면 그리드 밖으로 끌고 나갈 수
 * 없게 된다. 두 실패 모두 사람이 눈치채기 전에 회귀로 들어온다.
 */

/**
 * 손가락이 컨테이너 **가장자리에서 이만큼 안쪽**에 들어와야 자동 스크롤이 는다.
 *
 * 24px은 320px 폰에서 한 시간짜리 블록(54px)의 한복판을 잡은 손가락을 확실히
 * 바깥에 두면서, 상자 밖으로 끌고 나가려는 손가락은 확실히 안에 넣는 값이다.
 */
export const AUTO_SCROLL_EDGE_PX = 24;

/**
 * 문턱 안에서의 속도 상한 — `acceleration`은 곧 「간격당 최대 픽셀」이다.
 *
 * dnd-kit은 `speed = acceleration × (문턱 안으로 들어간 깊이 / 문턱)`을
 * `interval`마다 더한다. 기본값 10/5ms는 최대 2000px/s로, 폰 그리드를 한
 * 호흡에 통과시킨다. 1.2/10ms면 「따라온다」고 느껴지되 날뛰지 않는다.
 */
export const AUTO_SCROLL_ACCELERATION = 1.2;
export const AUTO_SCROLL_INTERVAL_MS = 10;

/** The four numbers {@link nearScrollEdge} needs — a `DOMRect` in miniature. */
export interface EdgeBox {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/**
 * 손가락이 이 상자의 가장자리 안쪽에 들어와 있는가.
 *
 * 가로·세로를 **또는**으로 묶는다: 가로로 흐르는 보드 레일은 손가락이 세로로
 * 한복판에 있어도 좌우 끝에서는 흘러야 하고, 세로 그리드는 그 반대다.
 */
export function nearScrollEdge(
  x: number,
  y: number,
  box: EdgeBox,
  edge: number = AUTO_SCROLL_EDGE_PX,
): boolean {
  const nearY = y <= box.top + edge || y >= box.bottom - edge;
  const nearX = x <= box.left + edge || x >= box.right - edge;
  return nearY || nearX;
}
