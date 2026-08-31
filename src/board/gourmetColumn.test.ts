import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BoardColumn } from '../types/models';
import { emptyWorkspace } from '../types/models';
import { useWorkspaceStore } from '../stores/workspaceStore';
import {
  GOURMET_COLUMN_ICON,
  GOURMET_COLUMN_NAME,
  adoptGourmetColumns,
  isGourmetColumnName,
  pickGourmetColumn,
  planGourmetColumns,
} from './gourmetColumn';

// Same in-memory `StateStorage` swap the other store tests use.
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

/** 이 여행의 칸들, 보드 순서대로. */
const columnsOf = (tripId: string): BoardColumn[] =>
  ws().trips[tripId].columnOrder.map((id) => ws().columns[id]);

/** 새 여행을 M49 이전의 모양으로 되돌린다 — 맛집 칸을 통째로 들어낸다. */
function stripGourmetColumn(tripId: string): void {
  store().mutate((draft) => {
    const trip = draft.trips[tripId];
    const gourmetId = trip.columnOrder.find((id) => draft.columns[id]?.gourmet === true);
    if (!gourmetId) return;
    delete draft.columns[gourmetId];
    draft.trips[tripId] = {
      ...trip,
      columnOrder: trip.columnOrder.filter((id) => id !== gourmetId),
    };
  });
}

beforeEach(() => {
  useWorkspaceStore.setState({ workspace: emptyWorkspace(), dirty: false });
});

describe('isGourmetColumnName', () => {
  it('accepts 맛집 with any spacing and gourmet in any case', () => {
    expect(isGourmetColumnName('맛집')).toBe(true);
    expect(isGourmetColumnName(' 맛 집 ')).toBe(true);
    expect(isGourmetColumnName('Gourmet')).toBe(true);
    expect(isGourmetColumnName('GOURMET')).toBe(true);
  });

  it('refuses names that merely contain it', () => {
    expect(isGourmetColumnName('맛집 후보')).toBe(false);
    expect(isGourmetColumnName('식사')).toBe(false);
    expect(isGourmetColumnName('')).toBe(false);
  });
});

describe('SEED_COLUMNS', () => {
  it('gives a brand-new trip a 맛집 column that is already flagged', () => {
    const tripId = store().addTrip('오사카');
    const gourmet = columnsOf(tripId).filter((column) => column.gourmet === true);
    expect(gourmet).toHaveLength(1);
    expect(gourmet[0].name).toBe(GOURMET_COLUMN_NAME);
    expect(gourmet[0].icon).toBe(GOURMET_COLUMN_ICON);
    // 맨 뒤 — 앞의 다섯 자리는 M0부터의 그 자리 그대로다.
    expect(columnsOf(tripId).map((column) => column.name)).toEqual([
      '이동수단',
      '할일',
      '식사',
      '숙소',
      '볼거리',
      '맛집',
    ]);
  });

  it('leaves the plain columns with no key at all', () => {
    const tripId = store().addTrip('교토');
    const plain = columnsOf(tripId).find((column) => column.name === '볼거리')!;
    expect('gourmet' in plain).toBe(false);
  });
});

describe('planGourmetColumns', () => {
  it('asks for a new column when the trip has none', () => {
    const tripId = store().addTrip('오사카');
    stripGourmetColumn(tripId);

    const plan = planGourmetColumns(ws());
    expect(plan.create).toEqual([tripId]);
    expect(plan.flag).toEqual([]);
  });

  it('flags an existing 「맛집」 column instead of making a second one', () => {
    const tripId = store().addTrip('오사카');
    stripGourmetColumn(tripId);
    const columnId = store().addColumn(tripId, '맛집', 'teal', '🍽️')!;

    const plan = planGourmetColumns(ws());
    expect(plan.flag).toEqual([columnId]);
    expect(plan.create).toEqual([]);
  });

  it('does nothing for a trip that already answered — true or explicit false', () => {
    const tripId = store().addTrip('오사카');
    expect(planGourmetColumns(ws())).toEqual({ flag: [], create: [] });

    // 사람이 직접 끈 칸: 되살리지도, 새 칸을 만들지도 않는다.
    const gourmetId = columnsOf(tripId).find((column) => column.gourmet === true)!.id;
    store().setColumnGourmet(gourmetId, false);
    expect(planGourmetColumns(ws())).toEqual({ flag: [], create: [] });
  });

  it('handles several trips at once', () => {
    const a = store().addTrip('오사카');
    const b = store().addTrip('도쿄');
    stripGourmetColumn(a);
    stripGourmetColumn(b);
    store().addColumn(b, 'gourmet', 'teal', '🍽️');

    const plan = planGourmetColumns(ws());
    expect(plan.create).toEqual([a]);
    expect(plan.flag).toHaveLength(1);
  });
});

describe('adoptGourmetColumns', () => {
  it('creates the column, flags it, and puts it at the end of the board', () => {
    const tripId = store().addTrip('오사카');
    stripGourmetColumn(tripId);
    expect(columnsOf(tripId)).toHaveLength(5);

    expect(adoptGourmetColumns()).toBe(1);
    const columns = columnsOf(tripId);
    expect(columns).toHaveLength(6);
    expect(columns[5].name).toBe(GOURMET_COLUMN_NAME);
    expect(columns[5].gourmet).toBe(true);
  });

  it('is idempotent — a second run changes nothing', () => {
    const tripId = store().addTrip('오사카');
    stripGourmetColumn(tripId);
    expect(adoptGourmetColumns()).toBe(1);
    expect(adoptGourmetColumns()).toBe(0);
    expect(columnsOf(tripId).filter((column) => column.gourmet === true)).toHaveLength(1);
  });

  it('only flags a matching name, keeping the user’s own colour and icon', () => {
    const tripId = store().addTrip('오사카');
    stripGourmetColumn(tripId);
    const columnId = store().addColumn(tripId, '맛집', 'teal', '🍜')!;

    expect(adoptGourmetColumns()).toBe(1);
    expect(columnsOf(tripId)).toHaveLength(6);
    expect(ws().columns[columnId].gourmet).toBe(true);
    expect(ws().columns[columnId].color).toBe('teal');
    expect(ws().columns[columnId].icon).toBe('🍜');
  });

  it('respects an explicit false — the trip is never handed a column again', () => {
    const tripId = store().addTrip('오사카');
    const gourmetId = columnsOf(tripId).find((column) => column.gourmet === true)!.id;
    store().setColumnGourmet(gourmetId, false);

    expect(adoptGourmetColumns()).toBe(0);
    expect(columnsOf(tripId)).toHaveLength(6);
    expect(ws().columns[gourmetId].gourmet).toBe(false);
  });

  it('marks the workspace dirty so the other device gets the same column', () => {
    const tripId = store().addTrip('오사카');
    stripGourmetColumn(tripId);
    useWorkspaceStore.setState({ dirty: false });

    adoptGourmetColumns();
    expect(store().dirty).toBe(true);
  });

  it('does nothing at all against an empty workspace', () => {
    expect(adoptGourmetColumns()).toBe(0);
  });
});

describe('pickGourmetColumn', () => {
  it('finds the flagged column whatever it is called', () => {
    const tripId = store().addTrip('오사카');
    const columns = columnsOf(tripId);
    const gourmet = columns.find((column) => column.gourmet === true)!;
    store().updateColumn(gourmet.id, { name: '먹킷리스트' });

    expect(pickGourmetColumn(columnsOf(tripId))?.id).toBe(gourmet.id);
  });

  it('answers null when there is none — the caller falls back to 「식사」', () => {
    const tripId = store().addTrip('오사카');
    stripGourmetColumn(tripId);
    expect(pickGourmetColumn(columnsOf(tripId))).toBeNull();
    expect(pickGourmetColumn([])).toBeNull();
  });
});
