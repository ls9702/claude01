import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyWorkspace } from '../types/models';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { adoptTodoColumns } from './migrate';

// Same in-memory `StateStorage` swap `workspaceStore.test.ts` uses — IndexedDB
// does not exist under vitest's node environment.
vi.mock('../stores/persistMiddleware', () => {
  const memory = new Map<string, string>();
  return {
    idbStorage: {
      getItem: async (key: string) => memory.get(key) ?? null,
      setItem: async (key: string, value: string) => {
        memory.set(key, value);
      },
      removeItem: async (key: string) => {
        memory.delete(key);
      },
    },
  };
});

const store = () => useWorkspaceStore.getState();
const ws = () => useWorkspaceStore.getState().workspace;

beforeEach(() => {
  useWorkspaceStore.setState({ workspace: emptyWorkspace(), dirty: false });
});

describe('adoptTodoColumns', () => {
  it('flags a pre-M29 할일 column and leaves the rest alone', () => {
    const tripId = store().addTrip('오사카');
    const [movement, todo, food] = ws().trips[tripId].columnOrder;
    // 새 여행은 이미 플래그를 갖고 태어난다 — M29 이전의 모양으로 되돌려 놓는다.
    store().mutate((draft) => {
      const { todo: _dropped, ...rest } = draft.columns[todo];
      draft.columns[todo] = rest;
    });
    expect(ws().columns[todo].todo).toBeUndefined();

    expect(adoptTodoColumns()).toBe(1);
    expect(ws().columns[todo].todo).toBe(true);
    expect(ws().columns[movement].todo).toBeUndefined();
    expect(ws().columns[food].todo).toBeUndefined();
  });

  it('stamps updatedAt and marks the workspace dirty', () => {
    const tripId = store().addTrip('삿포로');
    const [, todo] = ws().trips[tripId].columnOrder;
    store().mutate((draft) => {
      const { todo: _dropped, ...rest } = draft.columns[todo];
      draft.columns[todo] = { ...rest, updatedAt: 1 };
    });
    useWorkspaceStore.setState({ dirty: false });

    adoptTodoColumns();
    expect(ws().columns[todo].updatedAt).toBeGreaterThan(1);
    expect(store().dirty).toBe(true);
  });

  it('is idempotent — a second run changes nothing at all', () => {
    const tripId = store().addTrip('제주');
    const [, todo] = ws().trips[tripId].columnOrder;
    store().mutate((draft) => {
      const { todo: _dropped, ...rest } = draft.columns[todo];
      draft.columns[todo] = rest;
    });

    expect(adoptTodoColumns()).toBe(1);
    const after = ws();
    expect(adoptTodoColumns()).toBe(0);
    expect(ws()).toBe(after);
  });

  it('never revives a column the user explicitly turned off', () => {
    const tripId = store().addTrip('부산');
    const [, todo] = ws().trips[tripId].columnOrder;
    store().setColumnTodo(todo, false);

    expect(adoptTodoColumns()).toBe(0);
    expect(ws().columns[todo].todo).toBe(false);
  });

  it('adopts a renamed column on the next load', () => {
    const tripId = store().addTrip('후쿠오카');
    const [movement] = ws().trips[tripId].columnOrder;
    // 이름만 바꾼 칸에는 플래그가 붙지 않는다 (`updateColumn`은 이름·색·아이콘뿐).
    store().updateColumn(movement, { name: '할 일' });
    expect(ws().columns[movement].todo).toBeUndefined();

    expect(adoptTodoColumns()).toBe(1);
    expect(ws().columns[movement].todo).toBe(true);
  });

  it('does nothing on an empty workspace', () => {
    const before = ws();
    expect(adoptTodoColumns()).toBe(0);
    expect(ws()).toBe(before);
    expect(store().dirty).toBe(false);
  });
});
