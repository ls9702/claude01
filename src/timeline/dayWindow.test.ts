import { describe, expect, it } from 'vitest';
import { emptyWorkspace, type Id, type TimelineEntry, type Workspace } from '../types/models';
import { legPlacements } from '../utils/flights';
import { DAY_MIN } from '../utils/time';
import {
  DAWN_PIN_MIN,
  DAY_START_MIN,
  WINDOW_HOUR_OFFSETS,
  clockToOffset,
  dropTarget,
  effectiveDayId,
  offsetToClock,
  visualPlacement,
  windowHourLabel,
  windowedDayEntries,
  windowedEntriesByDay,
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
    expect(placed.offsetMin).toBe(299 + DAY_MIN - DAY_START_MIN);
    expect(placed.offsetMin).toBe(1439);
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
      expect(dropTarget('d1', placed.offsetMin, ORDER)).toEqual({ dayId: 'd2', startMin });
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

  it('머리는 05:00에서 잘리고, 남은 05:00–06:15는 2일차 꼭대기에 남는다', () => {
    const [, head] = legPlacements(RED_EYE);
    const headPlaced = visualPlacement({ dayId: 'd2', ...head }, ORDER);
    // 1일차 창은 1440에서 닫힌다: 00:00–05:00의 300분만 그려진다.
    expect(headPlaced.drawMin).toBe(300);
    expect(headPlaced.clipped).toBe(true);
    expect(headPlaced.offsetMin + headPlaced.drawMin).toBe(DAY_MIN);
    // 나머지 75분(05:00–06:15)은 2일차 창의 0..75에 해당한다 — 사라지지 않는다.
    expect(head.durationMin - headPlaced.drawMin).toBe(75);
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
