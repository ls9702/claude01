import { describe, expect, it } from 'vitest';
import { emptyWorkspace, type Id, type Workspace } from '../types/models';
import {
  DEFAULT_MAP_SCOPE,
  dayCardIdsWindowed,
  emptyFilterHint,
  isLocated,
  locatedCards,
  scopeCards,
  sheetPlacedCardIds,
  visibleCardIds,
  visibleCards,
} from './filter';

const AT = 1_760_000_000_000;

/**
 * 여행 하나 · 카테고리 둘(볼거리 `c1` / 맛집 `c2`) · 일정표 둘(`s1` 2일,
 * `s2` 1일). 날짜가 없는(=일수) 시트라 1일차와 2일차는 서로 이웃한 날이다 —
 * 새벽 접힘이 일어나는 조건이 그대로 산다.
 */
function scaffold(): Workspace {
  const ws = emptyWorkspace();
  ws.trips.t1 = {
    id: 't1',
    title: '오사카',
    currency: 'KRW',
    columnOrder: ['c1', 'c2'],
    sheetOrder: ['s1', 's2'],
    createdAt: AT,
    updatedAt: AT,
  };
  for (const [id, name, icon] of [
    ['c1', '볼거리', '🎡'],
    ['c2', '맛집', '🍜'],
  ] as const) {
    ws.columns[id] = {
      id,
      tripId: 't1',
      name,
      color: 'emerald',
      icon,
      cardOrder: [],
      createdAt: AT,
      updatedAt: AT,
    };
  }
  ws.sheets.s1 = {
    id: 's1',
    tripId: 't1',
    name: '일정 1',
    dayOrder: ['d1', 'd2'],
    createdAt: AT,
    updatedAt: AT,
  };
  ws.sheets.s2 = {
    id: 's2',
    tripId: 't1',
    name: '일정 2',
    dayOrder: ['d9'],
    createdAt: AT,
    updatedAt: AT,
  };
  for (const [dayId, sheetId] of [
    ['d1', 's1'],
    ['d2', 's1'],
    ['d9', 's2'],
  ] as const) {
    ws.days[dayId] = { id: dayId, tripId: 't1', sheetId, createdAt: AT, updatedAt: AT };
  }
  return ws;
}

/** 카드 하나. `at`가 있으면 위치를, 없으면 위치 없는 카드를 만든다. */
function addCard(
  ws: Workspace,
  id: Id,
  columnId: Id,
  at?: { lat: number; lng: number },
): void {
  ws.cards[id] = {
    id,
    tripId: 't1',
    columnId,
    title: id,
    location: at ? { lat: at.lat, lng: at.lng } : undefined,
    createdAt: AT,
    updatedAt: AT,
  };
  ws.columns[columnId].cardOrder.push(id);
}

/** 배치 하나 — 시각은 그 카드 자신의 자정 기준 분이다. */
function place(ws: Workspace, id: Id, cardId: Id, dayId: Id, startMin: number): void {
  ws.entries[id] = {
    id,
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
 * 이 파일 대부분이 쓰는 표준 여행.
 *
 * - `k1` 볼거리, 1일차 10:00
 * - `k2` 맛집, 2일차 02:00 → 05시 창에서는 **1일차** 밤
 * - `k3` 맛집, 2일차 12:00
 * - `k4` 볼거리, 위치는 있지만 s1에는 없음(다른 시트 s2에만 배치) → 미확정
 * - `k5` 맛집, 위치 없음 → 지도의 물음이 아니다
 */
function standard(): Workspace {
  const ws = scaffold();
  addCard(ws, 'k1', 'c1', { lat: 35, lng: 135 });
  addCard(ws, 'k2', 'c2', { lat: 35.1, lng: 135.1 });
  addCard(ws, 'k3', 'c2', { lat: 35.2, lng: 135.2 });
  addCard(ws, 'k4', 'c1', { lat: 35.3, lng: 135.3 });
  addCard(ws, 'k5', 'c2');
  place(ws, 'e1', 'k1', 'd1', 600);
  place(ws, 'e2', 'k2', 'd2', 120);
  place(ws, 'e3', 'k3', 'd2', 720);
  place(ws, 'e4', 'k4', 'd9', 600);
  return ws;
}

const ids = (ws: Workspace, tripId: Id | undefined, filter: Parameters<typeof visibleCards>[2]) =>
  visibleCards(ws, tripId, filter).map((card) => card.id);

describe('isLocated', () => {
  it('좌표가 둘 다 유한할 때만 참이다', () => {
    const ws = standard();
    expect(isLocated(ws.cards.k1)).toBe(true);
    expect(isLocated(ws.cards.k5)).toBe(false);
    expect(isLocated(undefined)).toBe(false);
    ws.cards.k1.location = { lat: Number.NaN, lng: 135 };
    expect(isLocated(ws.cards.k1)).toBe(false);
    ws.cards.k1.location = { lat: 35, lng: Number.POSITIVE_INFINITY };
    expect(isLocated(ws.cards.k1)).toBe(false);
  });
});

describe('locatedCards', () => {
  it('위치 있는 카드만, 보드 순서대로 준다', () => {
    const ws = standard();
    expect(locatedCards(ws, 't1').map((card) => card.id)).toEqual(['k1', 'k4', 'k2', 'k3']);
  });

  it('모르는 여행은 빈 목록이다', () => {
    const ws = standard();
    expect(locatedCards(ws, 'nope')).toEqual([]);
    expect(locatedCards(ws, undefined)).toEqual([]);
  });
});

describe('sheetPlacedCardIds', () => {
  it('그 시트의 어느 날짜에든 배치된 카드를 모은다', () => {
    const ws = standard();
    expect([...sheetPlacedCardIds(ws, 's1')].sort()).toEqual(['k1', 'k2', 'k3']);
    expect([...sheetPlacedCardIds(ws, 's2')]).toEqual(['k4']);
  });

  it('모르는 시트는 빈 집합이다', () => {
    const ws = standard();
    expect(sheetPlacedCardIds(ws, 'nope').size).toBe(0);
    expect(sheetPlacedCardIds(ws, undefined).size).toBe(0);
  });
});

describe('dayCardIdsWindowed', () => {
  it('새벽 배치는 앞 일자의 창에 든다 (05시 경계)', () => {
    const ws = standard();
    const dayOrder = ws.sheets.s1.dayOrder;
    // 2일차 02:00의 맛집은 1일차 밤이다 — 일정표가 그리는 곳과 같은 열.
    expect([...dayCardIdsWindowed(ws, 'd1', dayOrder)].sort()).toEqual(['k1', 'k2']);
    expect([...dayCardIdsWindowed(ws, 'd2', dayOrder)]).toEqual(['k3']);
  });

  it('05시 정각은 자기 일자에 남는다', () => {
    const ws = standard();
    ws.entries.e2.startMin = 300;
    expect([...dayCardIdsWindowed(ws, 'd1', ws.sheets.s1.dayOrder)]).toEqual(['k1']);
    expect([...dayCardIdsWindowed(ws, 'd2', ws.sheets.s1.dayOrder)].sort()).toEqual(['k2', 'k3']);
  });

  it('첫 일자의 새벽은 접힐 곳이 없어 제자리에 남는다', () => {
    const ws = standard();
    place(ws, 'e5', 'k4', 'd1', 120);
    expect([...dayCardIdsWindowed(ws, 'd1', ws.sheets.s1.dayOrder)].sort()).toEqual([
      'k1',
      'k2',
      'k4',
    ]);
  });

  it('시트에 없는 일자·없는 일자는 빈 집합이다', () => {
    const ws = standard();
    expect(dayCardIdsWindowed(ws, 'd9', ws.sheets.s1.dayOrder).size).toBe(0);
    expect(dayCardIdsWindowed(ws, undefined, ws.sheets.s1.dayOrder).size).toBe(0);
    expect(dayCardIdsWindowed(ws, 'nope', ws.sheets.s1.dayOrder).size).toBe(0);
  });
});

describe('scopeCards', () => {
  const base = { sheetId: 's1', mutedColumns: [] as Id[] };

  it('전체 아이템 — 위치 있는 카드 전부', () => {
    const ws = standard();
    expect(ids(ws, 't1', { ...base, scope: DEFAULT_MAP_SCOPE })).toEqual([
      'k1',
      'k4',
      'k2',
      'k3',
    ]);
  });

  it('일정 전체 — 그 시트에 배치된 것만', () => {
    const ws = standard();
    expect(ids(ws, 't1', { ...base, scope: { kind: 'sheet' } })).toEqual(['k1', 'k2', 'k3']);
  });

  it('일자별 — 그 창에 배치된 것만', () => {
    const ws = standard();
    expect(ids(ws, 't1', { ...base, scope: { kind: 'day', dayId: 'd1' } })).toEqual(['k1', 'k2']);
    expect(ids(ws, 't1', { ...base, scope: { kind: 'day', dayId: 'd2' } })).toEqual(['k3']);
  });

  it('일자를 안 고른 일자별은 빈 목록이다', () => {
    const ws = standard();
    expect(ids(ws, 't1', { ...base, scope: { kind: 'day' } })).toEqual([]);
  });

  it('미확정 — 그 시트에 없는 위치 카드', () => {
    const ws = standard();
    // k4는 다른 시트(s2)에만 있다: 이 일정표에서는 아직 미확정이다.
    expect(ids(ws, 't1', { ...base, scope: { kind: 'unscheduled' } })).toEqual(['k4']);
    // 다른 시트 기준으로 보면 정반대가 된다.
    expect(ids(ws, 't1', { ...base, sheetId: 's2', scope: { kind: 'unscheduled' } })).toEqual([
      'k1',
      'k2',
      'k3',
    ]);
  });

  it('일정 전체와 미확정은 서로의 여집합이다', () => {
    const ws = standard();
    const all = ids(ws, 't1', { ...base, scope: { kind: 'all' } });
    const placed = ids(ws, 't1', { ...base, scope: { kind: 'sheet' } });
    const rest = ids(ws, 't1', { ...base, scope: { kind: 'unscheduled' } });
    expect([...placed, ...rest].sort()).toEqual([...all].sort());
  });

  it('일정표가 없으면 일정 범위는 비고, 미확정은 전부다', () => {
    const ws = standard();
    const none = { sheetId: undefined, mutedColumns: [] as Id[] };
    expect(ids(ws, 't1', { ...none, scope: { kind: 'sheet' } })).toEqual([]);
    expect(ids(ws, 't1', { ...none, scope: { kind: 'day', dayId: 'd1' } })).toEqual([]);
    expect(ids(ws, 't1', { ...none, scope: { kind: 'unscheduled' } })).toEqual([
      'k1',
      'k4',
      'k2',
      'k3',
    ]);
  });

  it('배치는 그 시트 기준이다 — 다른 시트의 배치는 세지 않는다', () => {
    const ws = standard();
    expect(scopeCards(ws, 't1', { sheetId: 's2', scope: { kind: 'sheet' } }).map((c) => c.id)).toEqual(
      ['k4'],
    );
  });
});

describe('visibleCards — 범위 × 카테고리', () => {
  it('꺼 둔 카테고리를 범위 안에서 다시 걸러 낸다', () => {
    const ws = standard();
    const matrix: [Parameters<typeof visibleCards>[2]['scope'], Id[], Id[]][] = [
      [{ kind: 'all' }, ['k1', 'k4'], ['k2', 'k3']],
      [{ kind: 'sheet' }, ['k1'], ['k2', 'k3']],
      [{ kind: 'day', dayId: 'd1' }, ['k1'], ['k2']],
      [{ kind: 'day', dayId: 'd2' }, [], ['k3']],
      [{ kind: 'unscheduled' }, ['k4'], []],
    ];
    for (const [scope, onlySightseeing, onlyFood] of matrix) {
      // 맛집(c2)을 끄면 볼거리만, 볼거리(c1)를 끄면 맛집만 남는다.
      expect(ids(ws, 't1', { sheetId: 's1', scope, mutedColumns: ['c2'] })).toEqual(
        onlySightseeing,
      );
      expect(ids(ws, 't1', { sheetId: 's1', scope, mutedColumns: ['c1'] })).toEqual(onlyFood);
      expect(ids(ws, 't1', { sheetId: 's1', scope, mutedColumns: ['c1', 'c2'] })).toEqual([]);
    }
  });

  it('새로 만든 카테고리는 끄기 전까지 언제나 켜져 있다', () => {
    const ws = standard();
    // 사용자가 「맛집」을 방금 만들었다면 muted 목록에는 그 id가 없다.
    expect(ids(ws, 't1', { sheetId: 's1', scope: { kind: 'all' }, mutedColumns: [] })).toContain(
      'k2',
    );
  });

  it('id 집합 버전도 같은 답을 준다', () => {
    const ws = standard();
    const filter = { sheetId: 's1', scope: { kind: 'sheet' } as const, mutedColumns: ['c2'] };
    expect([...visibleCardIds(ws, 't1', filter)]).toEqual(['k1']);
  });
});

describe('emptyFilterHint', () => {
  const filter = (kind: 'all' | 'sheet' | 'day' | 'unscheduled') => ({
    scope: { kind },
    sheetId: 's1',
    mutedColumns: [],
  });

  it('범위에는 있는데 카테고리가 다 꺼진 경우를 구분해 말한다', () => {
    expect(emptyFilterHint(filter('day'), 3)).toContain('카테고리');
  });

  it('범위 자체가 비면 왜 비었는지 말한다', () => {
    expect(emptyFilterHint(filter('day'), 0)).toContain('일자');
    expect(emptyFilterHint(filter('sheet'), 0)).toContain('일정표');
    expect(emptyFilterHint(filter('unscheduled'), 0)).toContain('일정표에 들어가');
    expect(emptyFilterHint(filter('all'), 0)).toContain('보여 줄');
  });
});
