import { describe, expect, it } from 'vitest';
import { hashFor, parseDrawPageId, parseHash } from './HashSync';

describe('parseHash', () => {
  it('탭 이름을 읽는다', () => {
    expect(parseHash('#/board')).toBe('board');
    expect(parseHash('#/draw')).toBe('draw');
  });

  it('두 번째 칸이 있어도 탭은 첫 칸이다 (M52a 딥링크)', () => {
    expect(parseHash('#/draw/abc123')).toBe('draw');
  });

  it('모르는 해시는 undefined', () => {
    expect(parseHash('#/nope')).toBeUndefined();
    expect(parseHash('')).toBeUndefined();
  });
});

describe('parseDrawPageId', () => {
  it('드로우 해시의 두 번째 칸만 읽는다', () => {
    expect(parseDrawPageId('#/draw/abc123')).toBe('abc123');
    expect(parseDrawPageId('#/draw')).toBeUndefined();
    expect(parseDrawPageId('#/draw/')).toBeUndefined();
  });

  it('다른 탭의 두 번째 칸은 읽지 않는다', () => {
    expect(parseDrawPageId('#/board/abc123')).toBeUndefined();
  });

  it('물음표 뒤는 버린다', () => {
    expect(parseDrawPageId('#/draw/abc123?x=1')).toBe('abc123');
  });

  it('터무니없이 긴 값은 무시한다', () => {
    expect(parseDrawPageId(`#/draw/${'a'.repeat(200)}`)).toBeUndefined();
  });

  it('%가 섞인 값도 원래 글자로 돌려준다', () => {
    expect(parseDrawPageId(`#/draw/${encodeURIComponent('a b')}`)).toBe('a b');
  });
});

describe('hashFor', () => {
  it('보통 탭은 한 칸이다', () => {
    expect(hashFor('memo')).toBe('#/memo');
    // 드로우여도 열린 페이지가 없으면 한 칸이다.
    expect(hashFor('draw')).toBe('#/draw');
    // 다른 탭에서는 페이지 id를 싣지 않는다 — 그 주소는 그 탭의 것이 아니다.
    expect(hashFor('map', 'abc123')).toBe('#/map');
  });

  it('드로우 + 페이지는 두 칸이다', () => {
    expect(hashFor('draw', 'abc123')).toBe('#/draw/abc123');
  });

  it('왕복한다', () => {
    expect(parseDrawPageId(hashFor('draw', 'xyz'))).toBe('xyz');
  });
});

/**
 * 딥링크가 한 번의 상태 갱신으로 반영된다 (M52a-fix ②).
 *
 * 예전에는 `setTab('draw')` → (구독자가 주소를 `#/draw`로 고쳐 씀) →
 * `parseDrawPageId`가 그 고쳐진 주소를 읽는 순서라, 다른 탭에서 딥링크를 밟으면
 * id가 사라졌다(D6). 여기서는 그 한 걸음을 스토어 쪽에서 못 박는다: 탭과 페이지가
 * **같은 `set`**으로 바뀌므로 구독자가 그 사이에 깨어날 자리가 없다.
 */
describe('openDrawPage (M52a-fix ②)', () => {
  it('탭과 페이지를 한 번에 바꾼다 — 구독자가 보는 상태는 언제나 둘 다 갖춰져 있다', async () => {
    const { useUiStore } = await import('../../stores/uiStore');
    useUiStore.setState({ activeTab: 'board', activeDrawPageId: undefined });

    const seen: { tab: string; page?: string }[] = [];
    const stop = useUiStore.subscribe((state) =>
      seen.push({ tab: state.activeTab, page: state.activeDrawPageId }),
    );
    useUiStore.getState().openDrawPage('abc123');
    stop();

    expect(seen).toEqual([{ tab: 'draw', page: 'abc123' }]);
    expect(hashFor('draw', useUiStore.getState().activeDrawPageId)).toBe('#/draw/abc123');
  });
});
