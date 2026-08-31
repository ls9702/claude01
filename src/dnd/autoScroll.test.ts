import { describe, expect, it } from 'vitest';
import { nearScrollEdge, type EdgeBox } from './autoScroll';

/**
 * 헌터M1이 잡은 폭주의 재현 조건 — 320×568 폰의 일정 그리드.
 *
 * 보이는 그리드는 170.75px뿐이고 한 시간짜리 블록이 벌써 54px이다. dnd-kit의
 * 기본 문턱은 **컨테이너 높이의 20%**(34px)를 재고 그 안에 **끌고 있는 블록**이
 * 들어왔는지 보므로, 블록의 아래 모서리는 손가락이 가만히 있어도 이미 문턱
 * 안이었다 — 5px만 움직여 스크롤 의도가 잡히는 순간 최고 속도가 붙었고, 40px
 * 끌었을 뿐인데 그리드가 636px 굴렀다.
 */
const PHONE_GRID: EdgeBox = { top: 189, bottom: 359.75, left: 0, right: 320 };

describe('nearScrollEdge', () => {
  it('stays shut in the middle of a short phone grid (M50, 헌터M1)', () => {
    // 블록 한복판을 잡은 손가락: 아래 가장자리까지 35.75px 남았다. 예전 규칙은
    // 여기서 이미 최고 속도로 굴렀다 — 재는 것이 블록의 아래 모서리였으니까.
    expect(nearScrollEdge(160, 324, PHONE_GRID)).toBe(false);
    // 아래로 10px 더 가도 아직 문 밖이다.
    expect(nearScrollEdge(160, 334, PHONE_GRID)).toBe(false);
  });

  it('opens only at the real edges, in absolute pixels', () => {
    // 아래 가장자리 24px 안.
    expect(nearScrollEdge(160, 340, PHONE_GRID)).toBe(true);
    // 상자 밖 — 여기서는 사람이 정말 더 내려가고 싶은 것이다.
    expect(nearScrollEdge(160, 400, PHONE_GRID)).toBe(true);
    // 위쪽도 대칭으로.
    expect(nearScrollEdge(160, 200, PHONE_GRID)).toBe(true);
    expect(nearScrollEdge(160, 214, PHONE_GRID)).toBe(false);
  });

  it('keeps a horizontal rail scrolling from its left/right edges', () => {
    // 가로 레일: 세로로는 한복판이어도 좌우 끝에서는 흘러야 한다.
    const rail: EdgeBox = { top: 100, bottom: 400, left: 0, right: 800 };
    expect(nearScrollEdge(790, 250, rail)).toBe(true);
    expect(nearScrollEdge(10, 250, rail)).toBe(true);
    expect(nearScrollEdge(400, 250, rail)).toBe(false);
  });

  it('does not scale with the container — a tall grid has the same 24px door', () => {
    // 데스크톱의 700px 그리드. 비율 문턱(20% = 140px)이었다면 560px 지점이
    // 벌써 열렸겠지만, 절대 픽셀은 진짜 가장자리에서만 연다.
    const desktop: EdgeBox = { top: 0, bottom: 700, left: 0, right: 1000 };
    expect(nearScrollEdge(500, 560, desktop)).toBe(false);
    expect(nearScrollEdge(500, 680, desktop)).toBe(true);
  });

  it('honours a custom edge width', () => {
    expect(nearScrollEdge(160, 300, PHONE_GRID, 80)).toBe(true);
    expect(nearScrollEdge(160, 300, PHONE_GRID, 4)).toBe(false);
  });
});
