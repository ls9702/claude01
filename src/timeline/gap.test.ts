import { describe, expect, it } from 'vitest';
import { emptyWorkspace, type GeoPoint, type Id, type Workspace } from '../types/models';
import { dayGaps, dayGapsWindowed } from './gap';
import { dayRoute, dayRouteWindowed } from './route';

const AT = 1_760_000_000_000;

/** 오사카-ish coordinates: `NAMBA` → `UMEDA` is roughly 3.4km apart. */
const NAMBA: GeoPoint = { lat: 34.6659, lng: 135.5011 };
const UMEDA: GeoPoint = { lat: 34.7025, lng: 135.4959 };
/** ~330m from 난바 — a walk, not a problem. */
const NEXT_DOOR: GeoPoint = { lat: 34.6689, lng: 135.5011 };

/** One trip with a 이동수단 (`c-move`) and a 볼거리 (`c-see`) column, one day. */
function scaffold(): Workspace {
  const ws = emptyWorkspace();
  ws.trips.t1 = {
    id: 't1',
    title: '오사카',
    currency: 'KRW',
    columnOrder: ['c-move', 'c-see'],
    sheetOrder: ['s1'],
    createdAt: AT,
    updatedAt: AT,
  };
  ws.columns['c-move'] = {
    id: 'c-move',
    tripId: 't1',
    name: '이동수단',
    color: 'sky',
    icon: '🚗',
    cardOrder: [],
    createdAt: AT,
    updatedAt: AT,
  };
  ws.columns['c-see'] = {
    id: 'c-see',
    tripId: 't1',
    name: '볼거리',
    color: 'emerald',
    icon: '🎡',
    cardOrder: [],
    createdAt: AT,
    updatedAt: AT,
  };
  ws.sheets.s1 = {
    id: 's1',
    tripId: 't1',
    name: '일정 1',
    dayOrder: ['d1'],
    createdAt: AT,
    updatedAt: AT,
  };
  ws.days.d1 = {
    id: 'd1',
    tripId: 't1',
    sheetId: 's1',
    label: '1일차',
    createdAt: AT,
    updatedAt: AT,
  };
  return ws;
}

function addCard(ws: Workspace, id: Id, columnId: Id, location?: GeoPoint): void {
  ws.cards[id] = {
    id,
    tripId: 't1',
    columnId,
    title: id,
    location,
    createdAt: AT,
    updatedAt: AT,
  };
  ws.columns[columnId].cardOrder.push(id);
}

function place(
  ws: Workspace,
  entryId: Id,
  cardId: Id,
  startMin: number,
  durationMin = 60,
): void {
  ws.entries[entryId] = {
    id: entryId,
    tripId: 't1',
    cardId,
    dayId: 'd1',
    startMin,
    durationMin,
    createdAt: AT,
    updatedAt: AT,
  };
}

describe('dayGaps', () => {
  it('measures the straight line between two consecutive located stops', () => {
    const ws = scaffold();
    addCard(ws, 'namba', 'c-see', NAMBA);
    addCard(ws, 'umeda', 'c-see', UMEDA);
    place(ws, 'e1', 'namba', 600); // 10:00–11:00
    place(ws, 'e2', 'umeda', 720); // 12:00–13:00

    const [gap, ...rest] = dayGaps(ws, 'd1');
    expect(rest).toEqual([]);
    expect(gap.afterEntryId).toBe('e1');
    expect(gap.gapMin).toBe(60);
    expect(gap.distanceKm).toBeGreaterThan(3);
    expect(gap.distanceKm).toBeLessThan(4.5);
    expect(gap.impossible).toBe(false);
  });

  it('flags a back-to-back pair more than 1km apart as 시간이 부족', () => {
    const ws = scaffold();
    addCard(ws, 'namba', 'c-see', NAMBA);
    addCard(ws, 'umeda', 'c-see', UMEDA);
    place(ws, 'e1', 'namba', 600); // 10:00–11:00
    place(ws, 'e2', 'umeda', 660); // 11:00–12:00 — no minute in between

    const [gap] = dayGaps(ws, 'd1');
    expect(gap.gapMin).toBe(0);
    expect(gap.impossible).toBe(true);
  });

  it('does not flag a short hop, however tight the schedule', () => {
    const ws = scaffold();
    addCard(ws, 'namba', 'c-see', NAMBA);
    addCard(ws, 'shop', 'c-see', NEXT_DOOR);
    place(ws, 'e1', 'namba', 600);
    place(ws, 'e2', 'shop', 660);

    const [gap] = dayGaps(ws, 'd1');
    expect(gap.distanceKm).toBeLessThan(1);
    expect(gap.impossible).toBe(false);
  });

  it('stays quiet when a 이동수단 card already fills the gap', () => {
    const ws = scaffold();
    addCard(ws, 'namba', 'c-see', NAMBA);
    addCard(ws, 'subway', 'c-move'); // no location → a ride, not a stop
    addCard(ws, 'umeda', 'c-see', UMEDA);
    place(ws, 'e1', 'namba', 600);
    place(ws, 'e2', 'subway', 660);
    place(ws, 'e3', 'umeda', 700);

    expect(dayGaps(ws, 'd1')).toEqual([]);
  });

  it('reports the hops around a ride that only covers one of them', () => {
    const ws = scaffold();
    addCard(ws, 'namba', 'c-see', NAMBA);
    addCard(ws, 'subway', 'c-move');
    addCard(ws, 'umeda', 'c-see', UMEDA);
    addCard(ws, 'shop', 'c-see', NEXT_DOOR);
    place(ws, 'e1', 'namba', 540);
    place(ws, 'e2', 'subway', 600);
    place(ws, 'e3', 'umeda', 660);
    place(ws, 'e4', 'shop', 780);

    const gaps = dayGaps(ws, 'd1');
    expect(gaps.map((gap) => gap.afterEntryId)).toEqual(['e3']);
  });

  it('needs both ends located', () => {
    const ws = scaffold();
    addCard(ws, 'namba', 'c-see', NAMBA);
    addCard(ws, 'lunch', 'c-see'); // no location at all
    place(ws, 'e1', 'namba', 600);
    place(ws, 'e2', 'lunch', 660);

    expect(dayGaps(ws, 'd1')).toEqual([]);
  });

  it('reads a negative gap for overlapping entries without clamping it', () => {
    const ws = scaffold();
    addCard(ws, 'namba', 'c-see', NAMBA);
    addCard(ws, 'umeda', 'c-see', UMEDA);
    place(ws, 'e1', 'namba', 600, 120); // 10:00–12:00
    place(ws, 'e2', 'umeda', 660); // starts inside it

    const [gap] = dayGaps(ws, 'd1');
    expect(gap.gapMin).toBe(-60);
    expect(gap.impossible).toBe(true);
  });

  it('maps a card placed twice on the day onto the right entries', () => {
    const ws = scaffold();
    addCard(ws, 'hotel', 'c-see', NAMBA);
    addCard(ws, 'umeda', 'c-see', UMEDA);
    place(ws, 'e1', 'hotel', 540); // 09:00–10:00
    place(ws, 'e2', 'umeda', 660); // 11:00–12:00
    place(ws, 'e3', 'hotel', 1_200); // 20:00 — the same card, again

    const gaps = dayGaps(ws, 'd1');
    expect(gaps.map((gap) => gap.afterEntryId)).toEqual(['e1', 'e2']);
    expect(gaps[0].gapMin).toBe(60);
    expect(gaps[1].gapMin).toBe(480);
  });

  it('is empty for one stop, an unknown day, and an empty day', () => {
    const ws = scaffold();
    addCard(ws, 'namba', 'c-see', NAMBA);
    place(ws, 'e1', 'namba', 600);
    expect(dayGaps(ws, 'd1')).toEqual([]);
    expect(dayGaps(ws, 'nope')).toEqual([]);
    expect(dayGaps(scaffold(), 'd1')).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * M16-B — 하루 시작 05시
 * ------------------------------------------------------------------ */

describe('dayGapsWindowed / dayRouteWindowed', () => {
  const ORDER: Id[] = ['d1', 'd2'];

  /** Adds a second day so the window has somewhere to fold 새벽 into. */
  function withSecondDay(ws: Workspace): Workspace {
    ws.days.d2 = {
      id: 'd2',
      tripId: 't1',
      sheetId: 's1',
      label: '2일차',
      createdAt: AT,
      updatedAt: AT,
    };
    ws.sheets.s1.dayOrder = [...ORDER];
    return ws;
  }

  /** Places `cardId` on `d2` — a 새벽 hour, i.e. the previous night's window. */
  function placeOnD2(
    ws: Workspace,
    entryId: Id,
    cardId: Id,
    startMin: number,
    durationMin = 60,
  ): void {
    ws.entries[entryId] = {
      id: entryId,
      tripId: 't1',
      cardId,
      dayId: 'd2',
      startMin,
      durationMin,
      createdAt: AT,
      updatedAt: AT,
    };
  }

  it('자정을 건너는 두 정거장이 한 창의 이웃이 된다', () => {
    const ws = withSecondDay(scaffold());
    addCard(ws, 'k-night', 'c-see', NAMBA);
    addCard(ws, 'k-dawn', 'c-see', UMEDA);
    place(ws, 'e1', 'k-night', 1380, 40); // 1일차 23:00–23:40
    placeOnD2(ws, 'e2', 'k-dawn', 20); // 2일차 00:20

    const route = dayRouteWindowed(ws, 'd1', ORDER);
    expect(route.stops.map((stop) => stop.cardId)).toEqual(['k-night', 'k-dawn']);

    const gaps = dayGapsWindowed(ws, 'd1', ORDER);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].afterEntryId).toBe('e1');
    // 23:40 → 00:20 은 40분이다. 달력 기준이었다면 -1400분(겹침)이 나왔을 것이다.
    expect(gaps[0].gapMin).toBe(40);
    expect(gaps[0].impossible).toBe(false);
  });

  it('창 기준으로 붙어 있으면 시간이 부족하다고 말한다', () => {
    const ws = withSecondDay(scaffold());
    addCard(ws, 'k-night', 'c-see', NAMBA);
    addCard(ws, 'k-dawn', 'c-see', UMEDA);
    place(ws, 'e1', 'k-night', 1380, 60); // 23:00–24:00
    placeOnD2(ws, 'e2', 'k-dawn', 0); // 00:00 — 이동 시간 0분

    const gaps = dayGapsWindowed(ws, 'd1', ORDER);
    expect(gaps[0].gapMin).toBe(0);
    expect(gaps[0].impossible).toBe(true);
  });

  it('새벽 정거장은 다음 날 창에서는 보이지 않는다', () => {
    const ws = withSecondDay(scaffold());
    addCard(ws, 'k-dawn', 'c-see', UMEDA);
    placeOnD2(ws, 'e1', 'k-dawn', 60); // 2일차 01:00
    expect(dayRouteWindowed(ws, 'd2', ORDER).stops).toHaveLength(0);
    expect(dayRouteWindowed(ws, 'd1', ORDER).stops).toHaveLength(1);
  });

  /* ---------------------------------------------------------------- *
   * B3 — 같은 카드 두 조각은 이동이 아니다
   * ---------------------------------------------------------------- */

  it('심야편의 꼬리와 머리 사이에는 갭 칩이 없다', () => {
    const ws = withSecondDay(scaffold());
    addCard(ws, 'k-flight', 'c-see', NAMBA);
    place(ws, 'e-tail', 'k-flight', 1425, 15); // 1일차 23:45–24:00
    placeOnD2(ws, 'e-head', 'k-flight', 0, 375); // 2일차 00:00–06:15

    // 창 안에서는 나란히 붙어 있지만, 같은 카드다 — 「직선 0m」는 이동이 아니다.
    expect(dayGapsWindowed(ws, 'd1', ORDER)).toEqual([]);
  });

  it('달력 기준으로도 같은 카드가 잇달으면 갭을 만들지 않는다', () => {
    const ws = scaffold();
    addCard(ws, 'hotel', 'c-see', NAMBA);
    place(ws, 'e1', 'hotel', 540, 60); // 09:00–10:00
    place(ws, 'e2', 'hotel', 600, 60); // 10:00–11:00, 같은 카드

    expect(dayGaps(ws, 'd1')).toEqual([]);
  });

  it('그 사이에 다른 장소가 끼면 갭은 두 개 그대로다', () => {
    const ws = scaffold();
    addCard(ws, 'hotel', 'c-see', NAMBA);
    addCard(ws, 'umeda', 'c-see', UMEDA);
    place(ws, 'e1', 'hotel', 540); // 09:00
    place(ws, 'e2', 'umeda', 660); // 11:00
    place(ws, 'e3', 'hotel', 1_200); // 20:00

    expect(dayGaps(ws, 'd1').map((gap) => gap.afterEntryId)).toEqual(['e1', 'e2']);
  });

  it('창 안에서 같은 카드가 잇달으면 정거장 하나로 합쳐진다 (지도 번호 1-1)', () => {
    const ws = withSecondDay(scaffold());
    addCard(ws, 'k-flight', 'c-see', NAMBA);
    addCard(ws, 'k-hotel', 'c-see', UMEDA);
    place(ws, 'e-tail', 'k-flight', 1425, 15);
    placeOnD2(ws, 'e-head', 'k-flight', 0, 375);

    const route = dayRouteWindowed(ws, 'd1', ORDER);
    expect(route.stops.map((stop) => stop.cardId)).toEqual(['k-flight']);
    // 남은 것은 **첫 조각**의 자리다 — 여정이 시작된 시각.
    expect(route.stops[0].startMin).toBe(1425);
    expect(route.stops[0].order).toBe(1);
    expect(route.legs).toHaveLength(0);

    // 뒤에 진짜 다음 장소가 오면 번호는 1, 2 — 1, 2, 3이 아니다.
    place(ws, 'e-hotel', 'k-hotel', 1000);
    placeOnD2(ws, 'e-hotel2', 'k-hotel', 200); // 2일차 03:20 — 같은 창의 끝
    const next = dayRouteWindowed(ws, 'd1', ORDER);
    expect(next.stops.map((stop) => stop.order)).toEqual([1, 2, 3]);
    expect(next.stops.map((stop) => stop.cardId)).toEqual(['k-hotel', 'k-flight', 'k-hotel']);
  });

  it('달력 경로는 합치지 않는다 — 호텔에 두 번 들르는 하루는 두 번이다', () => {
    const ws = scaffold();
    addCard(ws, 'hotel', 'c-see', NAMBA);
    place(ws, 'e1', 'hotel', 540);
    place(ws, 'e2', 'hotel', 600);
    expect(dayRoute(ws, 'd1').stops).toHaveLength(2);
  });
});
