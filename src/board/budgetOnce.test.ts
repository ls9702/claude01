import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyWorkspace } from '../types/models';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { adoptStayColumns, columnsNeedingBudgetOnceFlag, isStayColumnName } from './budgetOnce';

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

/** The seeded 숙소 column of a fresh trip, back in its pre-M31 shape. */
function stripFlag(columnId: string): void {
  store().mutate((draft) => {
    const { budgetOnce: _dropped, ...rest } = draft.columns[columnId];
    draft.columns[columnId] = rest;
  });
}

beforeEach(() => {
  useWorkspaceStore.setState({ workspace: emptyWorkspace(), dirty: false });
});

describe('isStayColumnName', () => {
  it('숙소·호텔·hotel을 알아본다 — 공백과 대소문자는 무시한다', () => {
    expect(isStayColumnName('숙소')).toBe(true);
    expect(isStayColumnName(' 숙 소 ')).toBe(true);
    expect(isStayColumnName('호텔')).toBe(true);
    expect(isStayColumnName('Hotel')).toBe(true);
    expect(isStayColumnName('HOTEL')).toBe(true);
  });

  it('이름 안에 든 경우까지 삼키지는 않는다', () => {
    expect(isStayColumnName('숙소 후보')).toBe(false);
    expect(isStayColumnName('에어비앤비')).toBe(false);
    expect(isStayColumnName('')).toBe(false);
  });
});

describe('adoptStayColumns', () => {
  it('새 여행의 숙소 칸은 이미 켜진 채 태어난다', () => {
    const tripId = store().addTrip('오사카');
    const columns = ws().trips[tripId].columnOrder.map((id) => ws().columns[id]);
    const stay = columns.find((column) => column.name === '숙소');

    expect(stay?.budgetOnce).toBe(true);
    // 나머지 칸에는 키가 아예 없다 — 배치 단위 셈법 그대로다.
    for (const column of columns) {
      if (column.name !== '숙소') expect(column.budgetOnce).toBeUndefined();
    }
    expect(columnsNeedingBudgetOnceFlag(ws())).toEqual([]);
  });

  it('M31 이전 여행의 숙소 칸에 플래그를 달고, 나머지는 두고 온다', () => {
    const tripId = store().addTrip('삿포로');
    const order = ws().trips[tripId].columnOrder;
    const stay = order.find((id) => ws().columns[id].name === '숙소') as string;
    stripFlag(stay);
    expect(ws().columns[stay].budgetOnce).toBeUndefined();

    expect(adoptStayColumns()).toBe(1);
    expect(ws().columns[stay].budgetOnce).toBe(true);
    for (const id of order) {
      if (id !== stay) expect(ws().columns[id].budgetOnce).toBeUndefined();
    }
  });

  it('updatedAt을 찍고 워크스페이스를 dirty로 만든다', () => {
    const tripId = store().addTrip('제주');
    const stay = ws().trips[tripId].columnOrder.find(
      (id) => ws().columns[id].name === '숙소',
    ) as string;
    store().mutate((draft) => {
      const { budgetOnce: _dropped, ...rest } = draft.columns[stay];
      draft.columns[stay] = { ...rest, updatedAt: 1 };
    });
    useWorkspaceStore.setState({ dirty: false });

    adoptStayColumns();
    expect(ws().columns[stay].updatedAt).toBeGreaterThan(1);
    expect(store().dirty).toBe(true);
  });

  it('두 번 돌려도 두 번째는 아무 일이 없다', () => {
    const tripId = store().addTrip('부산');
    const stay = ws().trips[tripId].columnOrder.find(
      (id) => ws().columns[id].name === '숙소',
    ) as string;
    stripFlag(stay);

    expect(adoptStayColumns()).toBe(1);
    const after = ws();
    expect(adoptStayColumns()).toBe(0);
    expect(ws()).toBe(after);
  });

  it('사람이 직접 끈 칸은 되살리지 않는다', () => {
    const tripId = store().addTrip('후쿠오카');
    const stay = ws().trips[tripId].columnOrder.find(
      (id) => ws().columns[id].name === '숙소',
    ) as string;
    store().setColumnBudgetOnce(stay, false);

    expect(adoptStayColumns()).toBe(0);
    expect(ws().columns[stay].budgetOnce).toBe(false);
  });

  it('「호텔」로 이름을 바꾼 칸은 다음 로드에 켜진다', () => {
    const tripId = store().addTrip('도쿄');
    const movement = ws().trips[tripId].columnOrder[0];
    store().updateColumn(movement, { name: '호텔' });
    expect(ws().columns[movement].budgetOnce).toBeUndefined();

    expect(adoptStayColumns()).toBe(1);
    expect(ws().columns[movement].budgetOnce).toBe(true);
  });

  it('빈 워크스페이스에서는 아무 일도 하지 않는다', () => {
    const before = ws();
    expect(adoptStayColumns()).toBe(0);
    expect(ws()).toBe(before);
    expect(store().dirty).toBe(false);
  });
});
