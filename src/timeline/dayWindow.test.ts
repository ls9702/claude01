import { describe, expect, it } from 'vitest';
import { emptyWorkspace, type Id, type TimelineEntry, type Workspace } from '../types/models';
import { legPlacements } from '../utils/flights';
import { DAY_MIN } from '../utils/time';
import {
  DAWN_PIN_MIN,
  DAY_START_MIN,
  WINDOW_HOUR_OFFSETS,
  WINDOW_MIN,
  calendarAdjacent,
  clockToOffset,
  dropTarget,
  effectiveDayId,
  offsetToClock,
  visualPlacement,
  windowHourLabel,
  windowedDayEntries,
  windowedEntriesByDay,
  type DayRef,
} from './dayWindow';

const AT = 1_760_000_000_000;
const ORDER: Id[] = ['d1', 'd2', 'd3'];

const at = (dayId: Id, startMin: number, durationMin = 60) => ({ dayId, startMin, durationMin });

describe('DAY_START_MIN', () => {
  it('05시다', () => {
    expect(DAY_START_MIN).toBe(300);
  });
});

describe('visualPlacement — 경계', () => {
  it('04:59는 전날 창의 거의 끝에 놓인다', () => {
    const placed = visualPlacement(at('d2', 299), ORDER);
    expect(placed.renderDayId).toBe('d1');
    // 시각은 1439분째다 — 정렬·갭·지금/다음이 쓰는 값.
    expect(placed.rawOffsetMin).toBe(299 + DAY_MIN - DAY_START_MIN);
    expect(placed.rawOffsetMin).toBe(1439);
    // 그림은 1분짜리 실선이 될 수 없어 30분 자리만큼 위로 당겨진다 (B2).
    expect(placed.offsetMin).toBe(WINDOW_MIN - DAWN_PIN_MIN);
    expect(placed.dawn).toBe(false);
  });

  it('05:00은 제 날의 맨 위다', () => {
    const placed = visualPlacement(at('d2', 300), ORDER);
    expect(placed.renderDayId).toBe('d2');
    expect(placed.offsetMin).toBe(0);
    expect(placed.rawOffsetMin).toBe(0);
    expect(placed.dawn).toBe(false);
    expect(placed.clipped).toBe(false);
  });

  it('05:01은 제 날의 1분 아래다', () => {
    const placed = visualPlacement(at('d2', 301), ORDER);
    expect(placed.renderDayId).toBe('d2');
    expect(placed.offsetMin).toBe(1);
  });

  it('자정(00:00)은 전날 창의 19시간째다', () => {
    const placed = visualPlacement(at('d2', 0), ORDER);
    expect(placed.renderDayId).toBe('d1');
    expect(placed.offsetMin).toBe(1140);
    expect(offsetToClock(placed.offsetMin)).toBe(0);
  });

  it('낮 시간은 창 안에서 잘리지 않는다', () => {
    const placed = visualPlacement(at('d2', 600, 120), ORDER);
    expect(placed.offsetMin).toBe(300);
    expect(placed.drawMin).toBe(120);
    expect(placed.clipped).toBe(false);
  });
});

describe('visualPlacement — 첫날 새벽 (앞 일자가 없을 때)', () => {
  it('제 날 맨 위에 얇게 고정되고 새벽 표시가 붙는다', () => {
    const placed = visualPlacement(at('d1', 120, 60), ORDER);
    expect(placed.renderDayId).toBe('d1');
    expect(placed.offsetMin).toBe(0);
    expect(placed.dawn).toBe(true);
    // 실제 창 위치는 음수 — 정렬·지금/다음은 이 값을 쓴다.
    expect(placed.rawOffsetMin).toBe(120 - DAY_START_MIN);
    expect(placed.drawMin).toBe(DAWN_PIN_MIN);
    expect(placed.clipped).toBe(true);
  });

  it('05시를 넘겨 이어지면 넘어간 만큼만큼 그려진다', () => {
    // 04:00 + 120분 → 06:00에 끝난다. 창 기준 0..60.
    const placed = visualPlacement(at('d1', 240, 120), ORDER);
    expect(placed.dawn).toBe(true);
    expect(placed.offsetMin).toBe(0);
    expect(placed.drawMin).toBe(60);
  });

  it('dayOrder에 없는 일자도 앞 일자가 없는 것으로 본다', () => {
    const placed = visualPlacement(at('unknown', 60), ORDER);
    expect(placed.renderDayId).toBe('unknown');
    expect(placed.dawn).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * B1 — dayOrder의 이웃이 달력의 이웃은 아니다
 * ------------------------------------------------------------------ */

describe('visualPlacement — 앞 일자가 달력으로도 어제일 때만 데려간다', () => {
  /** 하루 걸러 짜둔 시트: 5월 1일, 5월 3일. */
  const GAPPED: DayRef[] = [
    { id: 'd1', date: '2026-05-01' },
    { id: 'd3', date: '2026-05-03' },
  ];

  it('5월 3일 02:00은 5월 1일 칸으로 넘어가지 않고 제자리에 고정된다', () => {
    const placed = visualPlacement(at('d3', 120, 60), GAPPED);
    // 5월 3일 02:00의 밤은 5월 2일이고, 그 날짜는 이 시트에 없다.
    expect(placed.renderDayId).toBe('d3');
    expect(placed.dawn).toBe(true);
    expect(placed.offsetMin).toBe(0);
    expect(placed.rawOffsetMin).toBe(120 - DAY_START_MIN);
  });

  it('하루 차이면 여느 때처럼 앞 칸의 밤이 된다', () => {
    const order: DayRef[] = [
      { id: 'd1', date: '2026-05-01' },
      { id: 'd2', date: '2026-05-02' },
    ];
    const placed = visualPlacement(at('d2', 120, 60), order);
    expect(placed.renderDayId).toBe('d1');
    expect(placed.dawn).toBe(false);
    expect(placed.offsetMin).toBe(120 + WINDOW_MIN - DAY_START_MIN);
  });

  it('날짜 없는 일수 시트는 두 줄이 곧 이어지는 하루다', () => {
    const order: DayRef[] = [{ id: 'd1' }, { id: 'd2' }];
    const placed = visualPlacement(at('d2', 120, 60), order);
    expect(placed.renderDayId).toBe('d1');
    expect(placed.dawn).toBe(false);
  });

  it('한쪽만 날짜가 있으면 이어져 있다고 말할 수 없다', () => {
    const mixed: DayRef[] = [{ id: 'd1' }, { id: 'd2', date: '2026-05-02' }];
    expect(visualPlacement(at('d2', 120), mixed).renderDayId).toBe('d2');
    expect(visualPlacement(at('d2', 120), mixed).dawn).toBe(true);
  });

  it('calendarAdjacent가 그 규칙 하나를 그대로 말한다', () => {
    const may1 = { id: 'a', date: '2026-05-01' };
    expect(calendarAdjacent(may1, { id: 'b', date: '2026-05-02' })).toBe(true);
    expect(calendarAdjacent(may1, { id: 'b', date: '2026-05-03' })).toBe(false);
    expect(calendarAdjacent(may1, { id: 'b', date: '2026-05-01' })).toBe(false);
    // 거꾸로 적힌 시트도 이웃이 아니다.
    expect(calendarAdjacent({ id: 'a', date: '2026-05-03' }, may1)).toBe(false);
    expect(calendarAdjacent('a', 'b')).toBe(true);
    expect(calendarAdjacent('a', may1)).toBe(false);
  });

  it('창 소속도 같은 규칙을 따른다 — 5월 3일 새벽은 5월 3일 칸에 남는다', () => {
    const ws = scaffold();
    ws.sheets.s1.dayOrder = ['d1', 'd3'];
    ws.days.d1.date = '2026-05-01';
    ws.days.d3.date = '2026-05-03';
    delete ws.days.d2;
    addEntry(ws, 'e-dawn', 'd3', 120);

    // 워크스페이스를 받는 함수는 날짜를 스스로 채워 넣는다 (datedAxis).
    expect(windowedDayEntries(ws, 'd1', ['d1', 'd3'])).toHaveLength(0);
    const rows = windowedDayEntries(ws, 'd3', ['d1', 'd3']);
    expect(rows.map((row) => row.entry.id)).toEqual(['e-dawn']);
    expect(rows[0].placement.dawn).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * B2 — 창 바닥에 걸린 블록도 손가락이 닿는다
 * ------------------------------------------------------------------ */

describe('visualPlacement — 창 바닥의 최소 높이', () => {
  it('04:59 + 15분은 1분이 아니라 30분 높이로, 창 바닥에 맞춰 그려진다', () => {
    const placed = visualPlacement(at('d2', 299, 15), ORDER);
    expect(placed.renderDayId).toBe('d1');
    expect(placed.drawMin).toBe(DAWN_PIN_MIN);
    // 아래로 삐져나가지 않는다: 위로 당겨서 자리를 만든다.
    expect(placed.offsetMin + placed.drawMin).toBe(WINDOW_MIN);
    expect(placed.offsetMin).toBe(1410);
    // 그래도 잘린 블록이다 — 15분 중 1분만이 이 창의 것이다.
    expect(placed.clipped).toBe(true);
    // 시각 자체는 손대지 않는다.
    expect(placed.rawOffsetMin).toBe(1439);
  });

  it('04:50 + 30분도 마찬가지다', () => {
    const placed = visualPlacement(at('d2', 290, 30), ORDER);
    expect(placed.drawMin).toBe(DAWN_PIN_MIN);
    expect(placed.offsetMin + placed.drawMin).toBe(WINDOW_MIN);
    expect(placed.clipped).toBe(true);
    expect(placed.rawOffsetMin).toBe(1430);
  });

  it('자리가 넉넉한 블록은 건드리지 않는다', () => {
    const placed = visualPlacement(at('d2', 240, 120), ORDER);
    expect(placed.offsetMin).toBe(1380);
    expect(placed.drawMin).toBe(60);
    expect(placed.clipped).toBe(true);
  });
});

describe('visualPlacement — 05:00을 가로지르는 일정', () => {
  it('전날 창 아래 끝에서 잘려 그려지고, 저장된 길이는 그대로다', () => {
    // 2일차 04:00 + 120분 → 1일차 창의 1380부터, 창은 1440에서 끝난다.
    const entry = at('d2', 240, 120);
    const placed = visualPlacement(entry, ORDER);
    expect(placed.renderDayId).toBe('d1');
    expect(placed.offsetMin).toBe(1380);
    expect(placed.drawMin).toBe(60);
    expect(placed.clipped).toBe(true);
    // 데이터는 손대지 않는다.
    expect(entry.durationMin).toBe(120);
  });
});

describe('effectiveDayId', () => {
  it('새벽은 전날, 그 외는 제 날', () => {
    expect(effectiveDayId(at('d2', 60), ORDER)).toBe('d1');
    expect(effectiveDayId(at('d2', 300), ORDER)).toBe('d2');
    expect(effectiveDayId(at('d3', 299), ORDER)).toBe('d2');
  });
});

describe('dropTarget — 역방향', () => {
  it('창 위쪽은 같은 날의 05시 이후로 떨어진다', () => {
    expect(dropTarget('d1', 0, ORDER)).toEqual({ dayId: 'd1', startMin: 300 });
    expect(dropTarget('d1', 300, ORDER)).toEqual({ dayId: 'd1', startMin: 600 });
    expect(dropTarget('d1', 1139, ORDER)).toEqual({ dayId: 'd1', startMin: 1439 });
  });

  it('24시 선 아래(24~29시 구간)는 다음 날 새벽이 된다', () => {
    expect(dropTarget('d1', 1140, ORDER)).toEqual({ dayId: 'd2', startMin: 0 });
    expect(dropTarget('d1', 1200, ORDER)).toEqual({ dayId: 'd2', startMin: 60 });
    expect(dropTarget('d1', 1440, ORDER)).toEqual({ dayId: 'd2', startMin: 300 });
  });

  it('마지막 일자의 새벽 구간은 거절한다', () => {
    expect(dropTarget('d3', 1200, ORDER)).toBeNull();
    // 24시 선 위쪽은 마지막 일자에서도 멀쩡히 받는다.
    expect(dropTarget('d3', 1139, ORDER)).toEqual({ dayId: 'd3', startMin: 1439 });
  });

  it('dayOrder에 없는 일자의 새벽 구간도 거절한다', () => {
    expect(dropTarget('unknown', 1200, ORDER)).toBeNull();
  });

  it('창 밖으로 벗어난 Y는 창 안으로 물린다', () => {
    expect(dropTarget('d1', -500, ORDER)).toEqual({ dayId: 'd1', startMin: 300 });
    expect(dropTarget('d1', 9_999, ORDER)).toEqual({ dayId: 'd2', startMin: 300 });
    expect(dropTarget('d1', Number.NaN, ORDER)).toEqual({ dayId: 'd1', startMin: 300 });
  });

  it('visualPlacement와 서로 역이다 (05시 이후 구간)', () => {
    for (const startMin of [300, 315, 600, 1439]) {
      const placed = visualPlacement(at('d2', startMin), ORDER);
      expect(dropTarget(placed.renderDayId, placed.offsetMin, ORDER)).toEqual({
        dayId: 'd2',
        startMin,
      });
    }
  });

  it('visualPlacement와 서로 역이다 (새벽 구간)', () => {
    for (const startMin of [0, 60, 299]) {
      const placed = visualPlacement(at('d2', startMin), ORDER);
      expect(placed.renderDayId).toBe('d1');
      // 역함수의 짝은 `rawOffsetMin`이다: `offsetMin`은 픽셀이고, 창 바닥에
      // 걸린 블록은 최소 높이를 확보하려 위로 당겨져 있다 (B2).
      expect(dropTarget('d1', placed.rawOffsetMin, ORDER)).toEqual({ dayId: 'd2', startMin });
    }
  });
});

describe('clockToOffset / offsetToClock', () => {
  it('05:00이 0이고 04:59가 창의 끝이다', () => {
    expect(clockToOffset(300)).toBe(0);
    expect(clockToOffset(299)).toBe(1439);
    expect(clockToOffset(120)).toBe(1260); // 새벽 2시 → 창의 21시간째
    expect(clockToOffset(1439)).toBe(1139);
  });

  it('서로 역이다', () => {
    for (const clock of [0, 120, 299, 300, 600, 1439]) {
      expect(offsetToClock(clockToOffset(clock))).toBe(clock);
    }
  });
});

describe('windowHourLabel', () => {
  it('05:00에서 시작해 24:00을 지나 04:00으로 끝난다', () => {
    const labels = WINDOW_HOUR_OFFSETS.map(windowHourLabel);
    expect(labels).toHaveLength(24);
    expect(labels[0]).toBe('05:00');
    expect(labels[1]).toBe('06:00');
    expect(labels[18]).toBe('23:00');
    // 자정은 하루의 끝으로 읽는다.
    expect(labels[19]).toBe('24:00');
    expect(labels[20]).toBe('01:00');
    expect(labels[23]).toBe('04:00');
  });
});

/* ------------------------------------------------------------------ *
 * 워크스페이스 단위 — 창별 소속
 * ------------------------------------------------------------------ */

function scaffold(): Workspace {
  const ws = emptyWorkspace();
  ws.trips.t1 = {
    id: 't1',
    title: '오사카',
    currency: 'KRW',
    columnOrder: [],
    sheetOrder: ['s1'],
    createdAt: AT,
    updatedAt: AT,
  };
  ws.sheets.s1 = {
    id: 's1',
    tripId: 't1',
    name: '일정 1',
    dayOrder: [...ORDER],
    createdAt: AT,
    updatedAt: AT,
  };
  for (const dayId of ORDER) {
    ws.days[dayId] = {
      id: dayId,
      tripId: 't1',
      sheetId: 's1',
      label: dayId,
      createdAt: AT,
      updatedAt: AT,
    };
  }
  return ws;
}

function addEntry(ws: Workspace, id: Id, dayId: Id, startMin: number, durationMin = 60): void {
  ws.entries[id] = {
    id,
    tripId: 't1',
    cardId: `card-${id}`,
    dayId,
    startMin,
    durationMin,
    createdAt: AT,
    updatedAt: AT,
  };
}

describe('windowedDayEntries', () => {
  it('제 날의 05시 이후 + 다음 날의 새벽을 한 창으로 모은다', () => {
    const ws = scaffold();
    addEntry(ws, 'e-morning', 'd1', 600); // 1일차 10:00
    addEntry(ws, 'e-night', 'd1', 1380); // 1일차 23:00
    addEntry(ws, 'e-dawn', 'd2', 60); // 2일차 01:00 → 1일차 밤
    addEntry(ws, 'e-next', 'd2', 540); // 2일차 09:00

    const rows = windowedDayEntries(ws, 'd1', ORDER);
    expect(rows.map((row) => row.entry.id)).toEqual(['e-morning', 'e-night', 'e-dawn']);
    // 순서는 창 기준이다: 23:00 다음이 01:00.
    expect(rows.map((row) => row.placement.rawOffsetMin)).toEqual([300, 1080, 1200]);

    expect(windowedDayEntries(ws, 'd2', ORDER).map((row) => row.entry.id)).toEqual(['e-next']);
  });

  it('첫날 새벽은 갈 곳이 없어 제자리에 남는다', () => {
    const ws = scaffold();
    addEntry(ws, 'e-dawn', 'd1', 120);
    const rows = windowedDayEntries(ws, 'd1', ORDER);
    expect(rows).toHaveLength(1);
    expect(rows[0].placement.dawn).toBe(true);
  });

  it('windowedEntriesByDay는 같은 결과를 한 번에 낸다', () => {
    const ws = scaffold();
    addEntry(ws, 'e1', 'd1', 600);
    addEntry(ws, 'e2', 'd2', 60);
    addEntry(ws, 'e3', 'd3', 600);

    const byDay = windowedEntriesByDay(Object.values(ws.entries), ORDER);
    expect(byDay.d1.map((row) => row.entry.id)).toEqual(['e1', 'e2']);
    expect(byDay.d2).toBeUndefined();
    expect(byDay.d3.map((row) => row.entry.id)).toEqual(['e3']);
  });
});

/* ------------------------------------------------------------------ *
 * 심야편 — 마법사가 만든 두 조각이 화면에서 붙어 보이는가 (B10 × M16-B)
 * ------------------------------------------------------------------ */

describe('심야 항공편 두 조각', () => {
  const RED_EYE = {
    date: '2026-05-03',
    depTime: '23:45',
    arrTime: '06:20',
    arrNextDay: true,
  };

  it('데이터는 그대로 두 조각이다', () => {
    const [tail, head] = legPlacements(RED_EYE);
    expect(tail).toEqual({ date: '2026-05-03', startMin: 1425, durationMin: 15 });
    // 도착 06:20은 15분 격자로 스냅되어 06:15가 된다 (utils/flights).
    expect(head).toEqual({ date: '2026-05-04', startMin: 0, durationMin: 375 });
  });

  it('꼬리는 1일차 창 안에서 자정에 닿고, 머리는 그 뒤로 이어진다', () => {
    const [tail, head] = legPlacements(RED_EYE);

    const tailPlaced = visualPlacement({ dayId: 'd1', ...tail }, ORDER);
    expect(tailPlaced.renderDayId).toBe('d1');
    expect(tailPlaced.offsetMin).toBe(1125);
    expect(tailPlaced.drawMin).toBe(15);
    // 꼬리의 끝 = 24:00 선.
    expect(tailPlaced.offsetMin + tailPlaced.drawMin).toBe(1140);

    // 머리는 00:00 시작 → 같은 1일차 창의 24:00 선에서 이어 붙는다. 빈틈 0분.
    const headPlaced = visualPlacement({ dayId: 'd2', ...head }, ORDER);
    expect(headPlaced.renderDayId).toBe('d1');
    expect(headPlaced.offsetMin).toBe(1140);
    expect(tailPlaced.offsetMin + tailPlaced.drawMin).toBe(headPlaced.offsetMin);
  });

  it('머리는 1일차 창의 05:00에서 잘리고, 남은 75분은 어디에도 다시 그려지지 않는다', () => {
    const [, head] = legPlacements(RED_EYE);
    const headPlaced = visualPlacement({ dayId: 'd2', ...head }, ORDER);
    // 1일차 창은 1440에서 닫힌다: 00:00–05:00의 300분만 그려진다.
    expect(headPlaced.drawMin).toBe(300);
    expect(headPlaced.clipped).toBe(true);
    expect(headPlaced.offsetMin + headPlaced.drawMin).toBe(DAY_MIN);
    // 남은 75분(05:00–06:15)은 **2일차 칸에 다시 나타나지 않는다**. 한 일정은
    // 한 칸에만 그려지고, 이 조각의 소속은 1일차 창이다 (B11).
    expect(head.durationMin - headPlaced.drawMin).toBe(75);
    expect(headPlaced.renderDayId).toBe('d1');
    const ws = scaffold();
    addEntry(ws, 'flight-head', 'd2', head.startMin, head.durationMin);
    expect(windowedDayEntries(ws, 'd2', ORDER)).toHaveLength(0);
    // 그 75분이 있다는 사실은 잘린 표시(clipped)와 상세 시트의 시각이 말한다.
  });

  it('두 조각 모두 어느 창엔가 반드시 그려진다 (사라지지 않는다)', () => {
    const ws = scaffold();
    const [tail, head] = legPlacements(RED_EYE);
    addEntry(ws, 'flight-tail', 'd1', tail.startMin, tail.durationMin);
    addEntry(ws, 'flight-head', 'd2', head.startMin, head.durationMin);

    const drawn: TimelineEntry[] = ORDER.flatMap((dayId) =>
      windowedDayEntries(ws, dayId, ORDER).map((row) => row.entry),
    );
    expect(drawn.map((entry) => entry.id).sort()).toEqual(['flight-head', 'flight-tail']);
  });
});
