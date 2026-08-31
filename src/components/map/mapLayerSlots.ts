/**
 * 지도 위 두 층(🍜 주변 맛집 · ⭐ 내 맛집)이 자리를 두고 합의하는 곳 (M50).
 *
 * 두 층은 서로를 모르는 형제 컴포넌트로 자랐고, 각자 「나는 위, 너는 아래」라는
 * 배치 규약 하나로 겹침을 피해 왔다. 그 규약은 지도 상자가 충분히 높을 때만
 * 참이다 — 전체화면이 아닌 폰(360×640·390×844)에서는 상자가 325~530px뿐이라
 * 위 패널(12.25rem 아래에서 시작 + 55%)과 아래 패널(45%)이 실제로 겹쳤고,
 * 360×640에서는 121px이 포개졌다 (헌터M2 #1 = 헌터B #1).
 *
 * 그래서 규약을 **런타임 합의**로 바꾼다: 한 층의 패널이 펼쳐지면 다른 층은
 * 알약으로 접힌다. 화면에 크게 펼쳐진 패널은 언제나 하나뿐이므로, 남은 하나가
 * 쓸 자리는 계산할 수 있는 상수가 된다(각 패널의 `max-h`가 그 계산이다).
 *
 * 팝업도 같은 규칙을 쓴다 (헌터B #2): 한 층의 말풍선이 열리면 다른 층의 것은
 * 닫고, 방금 연 쪽이 위에 선다. 전에는 둘이 동시에 떠서 서로를 가렸고 z가
 * 뒤집혀 「눌러서 연 것」이 밑에 깔리기도 했다.
 *
 * 모듈 수준의 슬롯인 이유는 `HoverNote`의 `openNote`와 같다: 「앱을 통틀어
 * 하나」는 어느 한 컴포넌트의 상태로는 표현할 수 없다.
 */

/** 자리를 다투는 층. */
export type MapLayerId = 'gourmet' | 'usergourmet';

/** 팝업이 없을 때 패널이 서는 높이 — Leaflet 컨트롤(1000)보다 위. */
export const MAP_PANEL_Z = 1050;
/** 팝업의 기본 높이. 패널보다 위, 둥근 버튼(1100)보다도 위. */
export const MAP_POPUP_Z = 1160;
/** 방금 연 팝업이 올라서는 한 칸 — 「최근 것이 위」. */
export const MAP_POPUP_Z_TOP = 1165;

const panelCollapsers = new Map<MapLayerId, () => void>();
const popupClosers = new Map<MapLayerId, () => void>();

/** 가장 최근에 팝업을 연 층 — z 한 칸을 더 받는다. */
let lastPopupOwner: MapLayerId | null = null;

/**
 * 「내 패널을 접는 법」을 등록한다. 언마운트되면 반드시 풀 것 — 사라진
 * 컴포넌트의 setState를 붙들고 있으면 다음 합의가 허공에 대고 말하게 된다.
 */
export function registerMapPanel(id: MapLayerId, collapse: () => void): () => void {
  panelCollapsers.set(id, collapse);
  return () => {
    if (panelCollapsers.get(id) === collapse) panelCollapsers.delete(id);
  };
}

/** 내 패널을 펼치기 **직전에** 부른다 — 남의 패널을 접는다. */
export function claimMapPanel(id: MapLayerId): void {
  for (const [other, collapse] of panelCollapsers) {
    if (other !== id) collapse();
  }
}

/** 「내 팝업을 닫는 법」을 등록한다. */
export function registerMapPopup(id: MapLayerId, close: () => void): () => void {
  popupClosers.set(id, close);
  return () => {
    if (popupClosers.get(id) === close) popupClosers.delete(id);
  };
}

/** 내 팝업을 열기 **직전에** 부른다 — 남의 팝업을 닫고 내가 위에 선다. */
export function claimMapPopup(id: MapLayerId): void {
  lastPopupOwner = id;
  for (const [other, close] of popupClosers) {
    if (other !== id) close();
  }
}

/** 이 층의 팝업이 지금 서야 할 z. 방금 연 쪽이 한 칸 위. */
export function mapPopupZ(id: MapLayerId): number {
  return lastPopupOwner === id ? MAP_POPUP_Z_TOP : MAP_POPUP_Z;
}

/** 테스트가 슬롯을 비우는 문 — 모듈 상태는 파일 하나를 넘어 새면 안 된다. */
export function resetMapLayerSlots(): void {
  panelCollapsers.clear();
  popupClosers.clear();
  lastPopupOwner = null;
}
