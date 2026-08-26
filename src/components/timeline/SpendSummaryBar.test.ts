import { describe, expect, it } from 'vitest';
import type { BoardColumn } from '../../types/models';
import type { SpendTotals } from '../../utils/spend';
import { categoryRows } from './SpendSummaryBar';

const AT = 1_760_000_000_000;

const column = (id: string, name: string): BoardColumn => ({
  id,
  tripId: 't1',
  name,
  color: 'emerald',
  icon: '🎡',
  cardOrder: [],
  createdAt: AT,
  updatedAt: AT,
});

const COLUMNS: BoardColumn[] = [
  column('c1', '이동수단'),
  column('c2', '식사'),
  column('c3', '숙소'),
];

const spend = (spent: number): SpendTotals => ({ budget: 0, spent });

describe('categoryRows', () => {
  it('예산이 큰 것부터, 같으면 보드 순서대로', () => {
    const rows = categoryRows(COLUMNS, { c1: 10_000, c2: 30_000, c3: 30_000 });
    expect(rows.map((row) => row.column.id)).toEqual(['c2', 'c3', 'c1']);
    expect(rows.map((row) => row.budget)).toEqual([30_000, 30_000, 10_000]);
    // 지출을 안 넘겨준 호출은 예전 그대로 0을 단다.
    expect(rows.every((row) => row.spent === 0)).toBe(true);
  });

  it('예산도 지출도 없는 카테고리는 줄이 되지 않는다', () => {
    const rows = categoryRows(COLUMNS, { c2: 30_000 }, { c1: spend(0) });
    expect(rows.map((row) => row.column.id)).toEqual(['c2']);
  });

  it('예산이 0이어도 이미 쓴 돈이 있으면 줄이 선다 (M31)', () => {
    // 예산 칸을 비워 둔 선결제 숙소 — M25의 규칙에서는 이 여행에 숙소가 아예
    // 없는 것처럼 보였다.
    const rows = categoryRows(COLUMNS, { c2: 30_000 }, { c3: spend(400_000) });
    expect(rows.map((row) => row.column.id)).toEqual(['c2', 'c3']);
    expect(rows[1]).toMatchObject({ budget: 0, spent: 400_000 });
  });

  it('정렬은 예산이 먼저, 지출은 동점을 가를 때만', () => {
    const rows = categoryRows(
      COLUMNS,
      { c1: 0, c2: 10_000, c3: 0 },
      { c1: spend(50_000), c2: spend(0), c3: spend(900_000) },
    );
    // 90만원을 쓴 숙소도 1만원짜리 계획 아래에 선다: 이 목록은 「필요 예산」
    // 아래 걸리는 목록이고, 그 순서로 읽혀야 한다.
    expect(rows.map((row) => row.column.id)).toEqual(['c2', 'c3', 'c1']);
    expect(rows.map((row) => row.spent)).toEqual([0, 900_000, 50_000]);
  });

  it('두 rollup에 실린 카테고리를 한 줄로 합친다', () => {
    const rows = categoryRows(COLUMNS, { c3: 400_000 }, { c3: spend(400_000) });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ budget: 400_000, spent: 400_000 });
  });
});
