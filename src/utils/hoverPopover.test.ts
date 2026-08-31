import { describe, expect, it } from 'vitest';
import { HOVER_GAP_PX, HOVER_MARGIN_PX, placeHoverPopover } from './hoverPopover';

const viewport = { width: 1000, height: 800 };
const popover = { width: 280, height: 100 };

describe('placeHoverPopover', () => {
  it('자리가 있으면 오른쪽에 선다', () => {
    const placed = placeHoverPopover({
      anchor: { left: 100, top: 200, width: 240, height: 80 },
      popover,
      viewport,
    });
    expect(placed.side).toBe('right');
    expect(placed.left).toBe(100 + 240 + HOVER_GAP_PX);
    // 세로는 카드의 윗줄에 맞춘다 — 가운데 맞춤은 짧은 메모를 허공에 띄운다.
    expect(placed.top).toBe(200);
  });

  it('오른쪽이 모자라면 왼쪽으로 뒤집는다', () => {
    // 보드의 맨 오른쪽 칸, 일정표의 마지막 날 — 이 기능이 존재하는 이유다.
    const placed = placeHoverPopover({
      anchor: { left: 700, top: 100, width: 260, height: 80 },
      popover,
      viewport,
    });
    expect(placed.side).toBe('left');
    expect(placed.left).toBe(700 - HOVER_GAP_PX - popover.width);
  });

  it('양쪽 다 모자라면 창 안으로 밀어 넣는다', () => {
    const narrow = { width: 360, height: 700 };
    const placed = placeHoverPopover({
      anchor: { left: 20, top: 40, width: 320, height: 80 },
      popover: { width: 280, height: 100 },
      viewport: narrow,
    });
    expect(placed.left).toBeGreaterThanOrEqual(HOVER_MARGIN_PX);
    expect(placed.left + 280).toBeLessThanOrEqual(narrow.width - HOVER_MARGIN_PX);
  });

  it('아래로 넘칠 것 같으면 위로 끌어올린다', () => {
    const placed = placeHoverPopover({
      anchor: { left: 100, top: 760, width: 240, height: 40 },
      popover,
      viewport,
    });
    expect(placed.top).toBe(viewport.height - popover.height - HOVER_MARGIN_PX);
  });

  it('위쪽 여백 아래로는 내려가지 않는다', () => {
    const placed = placeHoverPopover({
      anchor: { left: 100, top: -50, width: 240, height: 80 },
      popover,
      viewport,
    });
    expect(placed.top).toBe(HOVER_MARGIN_PX);
  });

  it('팝오버가 창보다 커도 좌표를 돌려준다', () => {
    // 뒤집힌 범위에서 clamp가 NaN이나 음수 폭을 내지 않는지 — 320px 폰에서
    // 실제로 일어날 수 있는 조합이다.
    const placed = placeHoverPopover({
      anchor: { left: 10, top: 10, width: 100, height: 40 },
      popover: { width: 500, height: 900 },
      viewport: { width: 320, height: 600 },
    });
    expect(Number.isFinite(placed.left)).toBe(true);
    expect(Number.isFinite(placed.top)).toBe(true);
    expect(placed.left).toBe(HOVER_MARGIN_PX);
    expect(placed.top).toBe(HOVER_MARGIN_PX);
  });

  // 표식 탭 (M48) — 폰에서도 같은 함수가 자리를 잡는다. 390px에는 카드 옆에
  // 280px를 세울 자리가 어느 쪽에도 없으므로, 유일하게 참이어야 하는 것은
  // 「화면 밖으로 나가지 않는다」다.
  it('390px 폰에서 보드 카드 옆이든 위든 창 안에 들어온다', () => {
    const phone = { width: 390, height: 844 };
    const placed = placeHoverPopover({
      // 폰의 보드 카드는 화면 폭을 거의 다 쓴다.
      anchor: { left: 16, top: 300, width: 358, height: 92 },
      popover: { width: 280, height: 64 },
      viewport: phone,
    });
    expect(placed.left).toBeGreaterThanOrEqual(HOVER_MARGIN_PX);
    expect(placed.left + 280).toBeLessThanOrEqual(phone.width - HOVER_MARGIN_PX);
    expect(placed.top).toBeGreaterThanOrEqual(HOVER_MARGIN_PX);
    expect(placed.top + 64).toBeLessThanOrEqual(phone.height - HOVER_MARGIN_PX);
  });

  it('390px 폰에서 일정 그리드 맨 아래 블록도 창 안에 들어온다', () => {
    const phone = { width: 390, height: 844 };
    const placed = placeHoverPopover({
      // 하단 탭 바 위, 창 바닥에 걸친 15분짜리 블록.
      anchor: { left: 60, top: 820, width: 300, height: 14 },
      popover: { width: 280, height: 120 },
      viewport: phone,
    });
    expect(placed.left).toBeGreaterThanOrEqual(HOVER_MARGIN_PX);
    expect(placed.left + 280).toBeLessThanOrEqual(phone.width - HOVER_MARGIN_PX);
    expect(placed.top).toBe(phone.height - 120 - HOVER_MARGIN_PX);
  });

  it('gap과 margin은 바꿀 수 있다', () => {
    const placed = placeHoverPopover({
      anchor: { left: 0, top: 0, width: 100, height: 40 },
      popover,
      viewport,
      gap: 20,
      margin: 40,
    });
    expect(placed.left).toBe(120);
    expect(placed.top).toBe(40);
  });
});
