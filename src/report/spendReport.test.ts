import { describe, expect, it } from 'vitest';
import { emptyWorkspace, type Card, type Id, type Workspace } from '../types/models';
import {
  sheetCardFirstDay,
  sheetCardMoney,
  sheetPlacements,
  sheetPlannedBudget,
  sheetSpend,
} from '../utils/spend';
import { categoryReport, dayReport, isFlightCard } from './spendReport';

const AT = 1_760_000_000_000;
const ORDER: Id[] = ['d1', 'd2', 'd3', 'd4'];

/**
 * 시트 하나(4일) + 보드 칸 넷 — 실제 여행이 태어날 때의 그 칸들이다
 * (`SEED_COLUMNS`): 이동수단·숙소(예산 한 번)·식사·볼거리.
 */
function scaffold(): Workspace {
  const ws = emptyWorkspace();
  ws.trips.t1 = {
    id: 't1',
    title: '오사카',
    currency: 'KRW',
    columnOrder: ['c1', 'c2', 'c3', 'c4'],
    sheetOrder: ['s1'],
    createdAt: AT,
    updatedAt: AT,
  };
  const seeds: [Id, string, boolean][] = [
    ['c1', '이동수단', false],
    ['c2', '숙소', true],
    ['c3', '식사', false],
    ['c4', '볼거리', false],
  ];
  for (const [id, name, budgetOnce] of seeds) {
    ws.columns[id] = {
      id,
      tripId: 't1',
      name,
      color: 'sky',
      icon: '🚗',
      cardOrder: [],
      ...(budgetOnce ? { budgetOnce: true } : {}),
      createdAt: AT,
      updatedAt: AT,
    };
  }
  ws.sheets.s1 = {
    id: 's1',
    tripId: 't1',
    name: '본 일정',
    dayOrder: [...ORDER],
    createdAt: AT,
    updatedAt: AT,
  };
  for (const dayId of ORDER) {
    ws.days[dayId] = { id: dayId, tripId: 't1', sheetId: 's1', createdAt: AT, updatedAt: AT };
  }
  return ws;
}

/** Adds a card to `columnId`, optionally with a 예산 and 지출 amounts. */
function addCard(
  ws: Workspace,
  id: Id,
  columnId: Id,
  opts: { title?: string; budget?: number; expenses?: number[] } = {},
): Card {
  const card: Card = {
    id,
    tripId: 't1',
    columnId,
    title: opts.title ?? id,
    budget: opts.budget,
    expenses: opts.expenses?.map((amount, index) => ({
      id: `${id}-x${index}`,
      amount,
      at: AT + index,
    })),
    createdAt: AT,
    updatedAt: AT,
  };
  ws.cards[id] = card;
  ws.columns[columnId].cardOrder.push(id);
  return card;
}

/** Places `cardId` on `dayId`; the entry id keeps every placement distinct. */
function place(ws: Workspace, entryId: Id, cardId: Id, dayId: Id, startMin = 600): void {
  ws.entries[entryId] = {
    id: entryId,
    tripId: 't1',
    cardId,
    dayId,
    startMin,
    durationMin: 60,
    createdAt: AT,
    updatedAt: AT,
  };
}

/**
 * 실사용에 가까운 한 시트: 항공권 두 장, 4박 호텔 하나, 네 번 걸린 식사 카드,
 * 볼거리 하나, 그리고 보드에만 남은 미확정 카드 하나.
 */
function fullTrip(ws: Workspace): void {
  addCard(ws, 'out', 'c1', { title: '✈️ ICN→KIX OZ112', budget: 300_000, expenses: [280_000] });
  place(ws, 'e-out', 'out', 'd1', 600);
  addCard(ws, 'in', 'c1', { title: '✈️ KIX→ICN OZ111', budget: 300_000 });
  place(ws, 'e-in', 'in', 'd4', 1_080);

  addCard(ws, 'hotel', 'c2', { title: '난바 호텔', budget: 400_000, expenses: [380_000] });
  place(ws, 'h1', 'hotel', 'd1', 900);
  place(ws, 'h2', 'hotel', 'd2', 900);
  place(ws, 'h3', 'hotel', 'd3', 900);

  addCard(ws, 'meal', 'c3', { title: '이치란', budget: 20_000, expenses: [18_000] });
  place(ws, 'm2', 'meal', 'd2', 720);
  place(ws, 'm3', 'meal', 'd3', 720);

  addCard(ws, 'tower', 'c4', { title: '츠텐카쿠', budget: 10_000 });
  place(ws, 't2', 'tower', 'd2', 1_020);

  // 아이디어일 뿐, 시간표에는 없다 — 어느 표에도 나오면 안 된다.
  addCard(ws, 'idea', 'c4', { title: '유니버설', budget: 90_000, expenses: [70_000] });
}

describe('줄 단위 내역 (utils/spend.ts) — 표의 재료', () => {
  it('sheetCardMoney: 카드마다 한 줄, 합계는 시트 합계와 같다', () => {
    const ws = scaffold();
    fullTrip(ws);
    const items = sheetCardMoney(ws, 's1');

    expect(items.map((item) => item.card.id).sort()).toEqual(
      ['hotel', 'in', 'meal', 'out', 'tower'].sort(),
    );
    const hotel = items.find((item) => item.card.id === 'hotel');
    expect(hotel).toMatchObject({ placements: 3, countsOnce: true, budget: 400_000 });
    const meal = items.find((item) => item.card.id === 'meal');
    expect(meal).toMatchObject({ placements: 2, countsOnce: false, budget: 40_000 });

    const total = (pick: 'spent' | 'budget') =>
      items.reduce((sum, item) => sum + item[pick], 0);
    expect(total('spent')).toBe(sheetSpend(ws, 's1').spent);
    expect(total('budget')).toBe(sheetPlannedBudget(ws, 's1'));
  });

  it('sheetPlacements: 배치마다 한 줄, 창 기준 일자로', () => {
    const ws = scaffold();
    addCard(ws, 'ramen', 'c3', { budget: 12_000 });
    place(ws, 'r1', 'ramen', 'd3', 120); // 3일차 02:00 → 2일차 창

    const rows = sheetPlacements(ws, 's1', ORDER);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ entryId: 'r1', cardId: 'ramen', dayId: 'd2' });
  });

  it('sheetCardFirstDay: 가장 이른 배치가 그려지는 창', () => {
    const ws = scaffold();
    addCard(ws, 'meal', 'c3', { budget: 20_000 });
    place(ws, 'z-late', 'meal', 'd3', 720);
    place(ws, 'a-early', 'meal', 'd2', 720);
    expect(sheetCardFirstDay(ws, 's1', ORDER).meal).toBe('d2');
  });
});

describe('isFlightCard — 항공편 마법사가 찍어 둔 표식', () => {
  it('제목의 ✈️ 접두사로 알아본다', () => {
    const ws = scaffold();
    expect(isFlightCard(addCard(ws, 'f', 'c1', { title: '✈️ ICN→KIX OZ112' }))).toBe(true);
    expect(isFlightCard(addCard(ws, 'f2', 'c1', { title: '✈️ 출발편' }))).toBe(true);
    // 앞의 공백은 세지 않는다 — `EntryBlock`·`NowBar`가 쓰는 그 규칙 그대로.
    expect(isFlightCard(addCard(ws, 'f3', 'c1', { title: '  ✈️ 귀국편' }))).toBe(true);
  });

  it('표식이 없으면 이름이 무엇이든 항공권이 아니다', () => {
    const ws = scaffold();
    expect(isFlightCard(addCard(ws, 'n1', 'c1', { title: '공항버스' }))).toBe(false);
    expect(isFlightCard(addCard(ws, 'n2', 'c1', { title: '비행기 예약 확인' }))).toBe(false);
    expect(isFlightCard(undefined)).toBe(false);
  });
});

describe('categoryReport — 카테고리별 지출 내역', () => {
  it('보드 칸 순서대로 묶고, 칸마다 소계를 낸다', () => {
    const ws = scaffold();
    fullTrip(ws);
    const report = categoryReport(ws, 's1');

    expect(report.categories.map((group) => group.column.name)).toEqual([
      '이동수단',
      '숙소',
      '식사',
      '볼거리',
    ]);

    const [air, stay, meal, sights] = report.categories;
    expect(air.rows.map((row) => row.card.id)).toEqual(['out', 'in']);
    expect(air).toMatchObject({ spent: 280_000, budget: 600_000 });
    // 4박을 걸어도 숙소는 한 번 (M31).
    expect(stay.rows).toHaveLength(1);
    expect(stay.rows[0]).toMatchObject({ spent: 380_000, budget: 400_000 });
    // 식사는 배치 단위 — 두 번 걸었으니 예산도 두 번, 영수증은 하나 (M25/M6).
    expect(meal.rows[0]).toMatchObject({ spent: 18_000, budget: 40_000 });
    expect(sights.rows[0]).toMatchObject({ spent: 0, budget: 10_000 });
  });

  it('총계는 요약 바가 말하는 그 숫자와 **정확히** 같다', () => {
    const ws = scaffold();
    fullTrip(ws);
    const report = categoryReport(ws, 's1');

    expect(report.spent).toBe(sheetSpend(ws, 's1').spent);
    expect(report.budget).toBe(sheetPlannedBudget(ws, 's1'));
    // 그리고 표의 줄들을 더해도 같은 곳에 떨어진다.
    const sum = (pick: 'spent' | 'budget') =>
      report.categories.reduce((total, group) => total + group[pick], 0);
    expect(sum('spent')).toBe(report.spent);
    expect(sum('budget')).toBe(report.budget);
  });

  it('미확정 카드는 표에도 총계에도 없다', () => {
    const ws = scaffold();
    fullTrip(ws);
    const report = categoryReport(ws, 's1');

    const ids = report.categories.flatMap((group) => group.rows.map((row) => row.card.id));
    expect(ids).not.toContain('idea');
    expect(report.spent).toBe(678_000);
    expect(report.budget).toBe(1_050_000);
  });

  it('돈이 한 푼도 안 걸린 줄과 빈 카테고리는 서지 않는다', () => {
    const ws = scaffold();
    addCard(ws, 'walk', 'c4', { title: '산책' });
    place(ws, 'w1', 'walk', 'd1');
    addCard(ws, 'meal', 'c3', { budget: 20_000 });
    place(ws, 'm1', 'meal', 'd1');

    const report = categoryReport(ws, 's1');
    expect(report.categories.map((group) => group.column.name)).toEqual(['식사']);
    expect(report.categories[0].rows.map((row) => row.card.id)).toEqual(['meal']);
  });

  it('지출만 있고 예산이 없는 카드도 줄을 얻는다', () => {
    const ws = scaffold();
    addCard(ws, 'hotel', 'c2', { expenses: [400_000] });
    place(ws, 'h1', 'hotel', 'd1');

    const report = categoryReport(ws, 's1');
    expect(report.categories[0].rows[0]).toMatchObject({ spent: 400_000, budget: 0 });
    expect(report.spent).toBe(sheetSpend(ws, 's1').spent);
  });

  it('없는 시트는 빈 표다', () => {
    const ws = scaffold();
    expect(categoryReport(ws, 'nope')).toEqual({ categories: [], spent: 0, budget: 0 });
  });
});

describe('dayReport — 일자별 리포트', () => {
  it('숙소비와 항공권은 날 밖에서, 딱 한 번씩만 선다', () => {
    const ws = scaffold();
    fullTrip(ws);
    const report = dayReport(ws, 's1', ORDER);

    expect(report.pinned.map((row) => row.label)).toEqual(['숙소비', '항공권']);
    const [stay, flight] = report.pinned;
    expect(stay).toMatchObject({ kind: 'stay', count: 1, spent: 380_000, budget: 400_000 });
    expect(flight).toMatchObject({ kind: 'flight', count: 2, spent: 280_000, budget: 600_000 });
  });

  it('일자 줄은 못 박힌 것들을 빼고 센다', () => {
    const ws = scaffold();
    fullTrip(ws);
    const report = dayReport(ws, 's1', ORDER);

    expect(report.days.map((row) => row.label)).toEqual(['1일차', '2일차', '3일차', '4일차']);
    // 식사 카드는 2·3일차에 하나씩(예산 2만원씩), 영수증 1.8만원은 가장 이른
    // 배치가 있는 2일차에 통째로. 볼거리는 2일차 예산 1만원.
    expect(report.days.map((row) => row.budget)).toEqual([0, 30_000, 20_000, 0]);
    expect(report.days.map((row) => row.spent)).toEqual([0, 18_000, 0, 0]);
  });

  it('못 박힌 줄 + 일자들 = 총계 (지출도 예산도)', () => {
    const ws = scaffold();
    fullTrip(ws);
    const report = dayReport(ws, 's1', ORDER);

    const pinned = (pick: 'spent' | 'budget') =>
      report.pinned.reduce((total, row) => total + row[pick], 0);
    const days = (pick: 'spent' | 'budget') =>
      report.days.reduce((total, row) => total + row[pick], 0);

    expect(pinned('spent') + days('spent')).toBe(report.spent);
    expect(pinned('budget') + days('budget')).toBe(report.budget);
    // 그리고 그 총계는 요약 바의 것이다.
    expect(report.spent).toBe(sheetSpend(ws, 's1').spent);
    expect(report.budget).toBe(sheetPlannedBudget(ws, 's1'));
  });

  it('총액은 지출 + 예산이다', () => {
    const ws = scaffold();
    fullTrip(ws);
    const report = dayReport(ws, 's1', ORDER);
    expect(report.total).toBe(report.spent + report.budget);
    expect(report.total).toBe(678_000 + 1_050_000);
  });

  it('미확정 카드는 어느 줄에도 얹히지 않는다', () => {
    const ws = scaffold();
    fullTrip(ws);
    const bare = dayReport(ws, 's1', ORDER);

    delete ws.cards.idea;
    const without = dayReport(ws, 's1', ORDER);
    expect(without.spent).toBe(bare.spent);
    expect(without.budget).toBe(bare.budget);
    expect(without.days).toEqual(bare.days);
  });

  it('여러 날에 걸린 카드의 영수증은 가장 이른 날에 한 번만 얹힌다', () => {
    const ws = scaffold();
    addCard(ws, 'meal', 'c3', { budget: 20_000, expenses: [50_000] });
    // 늦은 날을 먼저 만들어도 답은 2일차다.
    place(ws, 'z-late', 'meal', 'd3', 720);
    place(ws, 'a-early', 'meal', 'd2', 720);

    const report = dayReport(ws, 's1', ORDER);
    expect(report.days.map((row) => row.spent)).toEqual([0, 50_000, 0, 0]);
    expect(report.days.map((row) => row.budget)).toEqual([0, 20_000, 20_000, 0]);
    expect(report.spent).toBe(sheetSpend(ws, 's1').spent);
  });

  it('새벽 배치는 전날 창에 얹힌다 — 그리드가 그리는 그 자리다 (M16-B)', () => {
    const ws = scaffold();
    addCard(ws, 'ramen', 'c3', { budget: 12_000, expenses: [9_000] });
    place(ws, 'r1', 'ramen', 'd3', 120); // 3일차 02:00 = 2일차 밤

    const report = dayReport(ws, 's1', ORDER);
    expect(report.days.map((row) => row.budget)).toEqual([0, 12_000, 0, 0]);
    expect(report.days.map((row) => row.spent)).toEqual([0, 9_000, 0, 0]);
  });

  it('숙소도 항공권도 없으면 못 박힌 줄이 아예 없다', () => {
    const ws = scaffold();
    addCard(ws, 'meal', 'c3', { budget: 20_000 });
    place(ws, 'm1', 'meal', 'd1');

    const report = dayReport(ws, 's1', ORDER);
    expect(report.pinned).toEqual([]);
    expect(report.days[0].budget).toBe(20_000);
  });

  it('숙소 칸에 앉은 항공권 카드는 숙소 줄 하나에만 선다', () => {
    const ws = scaffold();
    addCard(ws, 'weird', 'c2', { title: '✈️ 이상한 카드', budget: 100_000 });
    place(ws, 'w1', 'weird', 'd1');

    const report = dayReport(ws, 's1', ORDER);
    expect(report.pinned).toHaveLength(1);
    expect(report.pinned[0]).toMatchObject({ kind: 'stay', budget: 100_000, count: 1 });
    expect(report.budget).toBe(sheetPlannedBudget(ws, 's1'));
  });

  it('없는 시트는 빈 표다', () => {
    const ws = scaffold();
    const report = dayReport(ws, 'nope', []);
    expect(report).toEqual({ pinned: [], days: [], spent: 0, budget: 0, total: 0 });
  });
});
