import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAP_POPUP_Z,
  MAP_POPUP_Z_TOP,
  claimMapPanel,
  claimMapPopup,
  mapPopupZ,
  registerMapPanel,
  registerMapPopup,
  resetMapLayerSlots,
} from './mapLayerSlots';

beforeEach(() => resetMapLayerSlots());

describe('패널 자리 합의 (M50, 헌터B #1)', () => {
  it('collapses the other layer when one expands', () => {
    const collapseRamen = vi.fn();
    const collapseStar = vi.fn();
    registerMapPanel('gourmet', collapseRamen);
    registerMapPanel('usergourmet', collapseStar);

    claimMapPanel('usergourmet');
    expect(collapseRamen).toHaveBeenCalledTimes(1);
    // 자기 자신은 접지 않는다 — 펼치려고 부른 것이다.
    expect(collapseStar).not.toHaveBeenCalled();

    claimMapPanel('gourmet');
    expect(collapseStar).toHaveBeenCalledTimes(1);
    expect(collapseRamen).toHaveBeenCalledTimes(1);
  });

  it('forgets a layer that unmounted', () => {
    const collapseRamen = vi.fn();
    const unregister = registerMapPanel('gourmet', collapseRamen);
    unregister();

    claimMapPanel('usergourmet');
    expect(collapseRamen).not.toHaveBeenCalled();
  });

  it('does not let a stale unregister drop the layer that replaced it', () => {
    // 리마운트: 새 콜백이 자리를 차지한 뒤 옛 정리 함수가 뒤늦게 돈다.
    const first = vi.fn();
    const undoFirst = registerMapPanel('gourmet', first);
    const second = vi.fn();
    registerMapPanel('gourmet', second);
    undoFirst();

    claimMapPanel('usergourmet');
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });
});

describe('팝업 자리 합의 (M50, 헌터B #2)', () => {
  it('closes the other layer’s popup and puts the newest on top', () => {
    const closeRamen = vi.fn();
    const closeStar = vi.fn();
    registerMapPopup('gourmet', closeRamen);
    registerMapPopup('usergourmet', closeStar);

    claimMapPopup('gourmet');
    expect(closeStar).toHaveBeenCalledTimes(1);
    expect(closeRamen).not.toHaveBeenCalled();
    expect(mapPopupZ('gourmet')).toBe(MAP_POPUP_Z_TOP);
    expect(mapPopupZ('usergourmet')).toBe(MAP_POPUP_Z);

    // 방금 연 쪽이 언제나 위 — 순서가 뒤집혀도 규칙은 하나다.
    claimMapPopup('usergourmet');
    expect(closeRamen).toHaveBeenCalledTimes(1);
    expect(mapPopupZ('usergourmet')).toBe(MAP_POPUP_Z_TOP);
    expect(mapPopupZ('gourmet')).toBe(MAP_POPUP_Z);
  });

  it('starts with nobody on top', () => {
    expect(mapPopupZ('gourmet')).toBe(MAP_POPUP_Z);
    expect(mapPopupZ('usergourmet')).toBe(MAP_POPUP_Z);
  });

  it('keeps the popup above the panel layer', () => {
    // 팝업이 패널 뒤로 숨으면 M49가 고친 버그가 되돌아온다.
    expect(MAP_POPUP_Z).toBeGreaterThan(1050);
    expect(MAP_POPUP_Z_TOP).toBeGreaterThan(MAP_POPUP_Z);
  });
});
