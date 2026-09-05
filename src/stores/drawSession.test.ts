import { beforeEach, describe, expect, it } from 'vitest';
import {
  forgetDrawPage,
  redoStack,
  rememberTools,
  rememberView,
  rememberedTools,
  rememberedView,
  resetDrawSession,
  undoStack,
} from './drawSession';

beforeEach(() => {
  resetDrawSession();
});

describe('drawSession — 뷰 (M52b)', () => {
  it('한 번도 연 적 없는 페이지는 기억이 없다 (그때는 가운데에서 시작)', () => {
    expect(rememberedView('p1')).toBeUndefined();
  });

  it('페이지마다 따로 기억한다 — 탭을 다녀와도 그 자리다', () => {
    rememberView('p1', { x: 10, y: 20, scale: 2 });
    rememberView('p2', { x: 0, y: 0, scale: 0.5 });

    expect(rememberedView('p1')).toEqual({ x: 10, y: 20, scale: 2 });
    expect(rememberedView('p2')!.scale).toBe(0.5);
  });
});

describe('drawSession — 실행취소 스택', () => {
  it('같은 배열을 돌려준다 — 밀어 넣은 걸음이 다음 방문에도 있다', () => {
    const op = { id: 'e1', before: null, after: null };
    undoStack('p1').push(op);
    expect(undoStack('p1')).toHaveLength(1);
    expect(undoStack('p1')[0]).toBe(op);
    // 다른 페이지의 스택은 비어 있다.
    expect(undoStack('p2')).toHaveLength(0);
    expect(redoStack('p1')).toHaveLength(0);
  });

  it('페이지를 잊으면 그 스택도 사라진다 (삭제·되살림은 새 방문이다)', () => {
    undoStack('p1').push({ id: 'e1', before: null, after: null });
    rememberView('p1', { x: 1, y: 2, scale: 1 });

    forgetDrawPage('p1');
    expect(undoStack('p1')).toHaveLength(0);
    expect(rememberedView('p1')).toBeUndefined();
  });
});

describe('drawSession — 도구', () => {
  it('도구는 사람의 것이라 페이지가 아니라 세션에 붙는다', () => {
    expect(rememberedTools().tool).toBe('pen');
    rememberTools({ tool: 'highlight', color: '#d64545' });
    expect(rememberedTools()).toMatchObject({ tool: 'highlight', color: '#d64545' });
    // 나머지는 그대로다.
    expect(rememberedTools().width).toBeGreaterThan(0);
  });

  it('초기화하면 처음으로 돌아간다 (새로고침과 같은 상태)', () => {
    rememberTools({ tool: 'eraser' });
    resetDrawSession();
    expect(rememberedTools().tool).toBe('pen');
  });
});
