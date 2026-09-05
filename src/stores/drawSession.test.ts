import { beforeEach, describe, expect, it } from 'vitest';
import type { DrawElement } from '../types/models';
import {
  clipboardElements,
  copyElements,
  forgetDrawPage,
  nextPasteStep,
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
    const step = { ops: [{ id: 'e1', before: null, after: null }] };
    undoStack('p1').push(step);
    expect(undoStack('p1')).toHaveLength(1);
    expect(undoStack('p1')[0]).toBe(step);
    // 다른 페이지의 스택은 비어 있다.
    expect(undoStack('p2')).toHaveLength(0);
    expect(redoStack('p1')).toHaveLength(0);
  });

  it('페이지를 잊으면 그 스택도 사라진다 (삭제·되살림은 새 방문이다)', () => {
    undoStack('p1').push({ ops: [{ id: 'e1', before: null, after: null }] });
    rememberView('p1', { x: 1, y: 2, scale: 1 });

    forgetDrawPage('p1');
    expect(undoStack('p1')).toHaveLength(0);
    expect(rememberedView('p1')).toBeUndefined();
  });
});

describe('drawSession — 도구', () => {
  it('도구는 사람의 것이라 페이지가 아니라 세션에 붙는다', () => {
    // 기본은 **손**이다 (M54) — 폰의 첫 손가락이 획이 되지 않게.
    expect(rememberedTools().tool).toBe('hand');
    rememberTools({ tool: 'highlight', color: '#d64545' });
    expect(rememberedTools()).toMatchObject({ tool: 'highlight', color: '#d64545' });
    // 나머지는 그대로다.
    expect(rememberedTools().width).toBeGreaterThan(0);
  });

  it('초기화하면 처음으로 돌아간다 (새로고침과 같은 상태)', () => {
    rememberTools({ tool: 'eraser' });
    resetDrawSession();
    expect(rememberedTools().tool).toBe('hand');
  });
});

describe('drawSession — 클립보드 (M53-1)', () => {
  const rect = (id: string): DrawElement => ({
    id,
    updatedAt: 1,
    type: 'rect',
    x: 0,
    y: 0,
    w: 10,
    h: 10,
    color: '#000',
    width: 2,
  });

  it('복사한 것은 페이지 밖에 산다 — 그래서 페이지 간 복사가 공짜다', () => {
    copyElements([rect('e1'), rect('e2')]);
    expect(clipboardElements()).toHaveLength(2);
    // 원본을 나중에 바꿔도 클립보드는 그때의 사본이다.
    expect(clipboardElements()[0].id).toBe('e1');
  });

  it('빈 복사는 이미 담긴 것을 지우지 않는다', () => {
    copyElements([rect('e1')]);
    copyElements([]);
    expect(clipboardElements()).toHaveLength(1);
  });

  it('붙여넣기 계단은 연타마다 한 칸 내려가고, 새로 복사하면 처음으로', () => {
    copyElements([rect('e1')]);
    expect(nextPasteStep()).toBe(1);
    expect(nextPasteStep()).toBe(2);
    copyElements([rect('e2')]);
    expect(nextPasteStep()).toBe(1);
  });

  it('초기화하면 클립보드도 비운다 (새로고침과 같은 상태)', () => {
    copyElements([rect('e1')]);
    resetDrawSession();
    expect(clipboardElements()).toHaveLength(0);
  });
});
