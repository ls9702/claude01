import { describe, expect, it } from 'vitest';
import { emptyWorkspace, type Card, type Id, type Workspace } from '../types/models';
import {
  currentAndNext,
  currentAndNextWindowed,
  nowMin,
  todayDayId,
  todayFocus,
  todayIso,
  todayWindowIso,
} from './today';
import { clockToOffset } from './dayWindow';

const AT = 1_760_000_000_000;

/** One trip, one sheet, and the days the caller asks for (by date). */
function scaffold(dates: (string | undefined)[]): Workspace {
  const ws = emptyWorkspace();
  ws.trips.t1 = {
    id: 't1',
    title: '오사카',
    currency: 'KRW',
    columnOrder: ['c1'],
    sheetOrder: ['s1'],
    createdAt: AT,
    updatedAt: AT,
  };
  ws.columns.c1 = {
    id: 'c1',
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
    dayOrder: [],
    createdAt: AT,
    updatedAt: AT,
  };
  dates.forEach((date, index) => {
    const dayId = `d${index + 1}`;
    ws.days[dayId] = {
      id: dayId,
      tripId: 't1',
      sheetId: 's1',
      date,
      createdAt: AT,
      updatedAt: AT,
    };
    ws.sheets.s1.dayOrder.push(dayId);
  });
  return ws;
}

const card = (id: Id): Card => ({
  id,
  tripId: 't1',
  columnId: 'c1',
  title: id,
  createdAt: AT,
  updatedAt: AT,
});

/** An entry of `d1`, with an explicit id so the assertions can name it. */
const entry = (id: Id, cardId: Id, startMin: number, durationMin = 60) => ({
  id,
  tripId: 't1',
  cardId,
  dayId: 'd1',
  startMin,
  durationMin,
  createdAt: AT,
  updatedAt: AT,
});

const CARDS: Record<Id, Card> = { k1: card('k1'), k2: card('k2'), k3: card('k3') };

describe('todayIso', () => {
  it('reads the local calendar day, zero-padded', () => {
    expect(todayIso(new Date(2026, 7, 23, 14, 5))).toBe('2026-08-23');
    expect(todayIso(new Date(2026, 0, 2, 0, 0))).toBe('2026-01-02');
    // 23:59 local is still that local day, whatever UTC thinks.
    expect(todayIso(new Date(2026, 4, 3, 23, 59))).toBe('2026-05-03');
  });

  it('is empty for an invalid date', () => {
    expect(todayIso(new Date(Number.NaN))).toBe('');
  });
});

describe('nowMin', () => {
  it('counts minutes from local midnight', () => {
    expect(nowMin(new Date(2026, 4, 3, 0, 0))).toBe(0);
    expect(nowMin(new Date(2026, 4, 3, 9, 30))).toBe(570);
    expect(nowMin(new Date(2026, 4, 3, 23, 59))).toBe(1439);
  });

  it('is 0 for an invalid date', () => {
    expect(nowMin(new Date(Number.NaN))).toBe(0);
  });
});

describe('todayDayId', () => {
  it('finds the day of the active sheet carrying today', () => {
    const ws = scaffold(['2026-05-03', '2026-05-04', '2026-05-05']);
    expect(todayDayId(ws, 's1', '2026-05-04')).toBe('d2');
  });

  it('is null when no day matches, or the sheet has no dates', () => {
    const ws = scaffold(['2026-05-03', '2026-05-04']);
    expect(todayDayId(ws, 's1', '2026-05-09')).toBeNull();
    expect(todayDayId(scaffold([undefined, undefined]), 's1', '2026-05-03')).toBeNull();
  });

  it('is null for an unknown sheet, no sheet, or a garbled date', () => {
    const ws = scaffold(['2026-05-03']);
    expect(todayDayId(ws, 'nope', '2026-05-03')).toBeNull();
    expect(todayDayId(ws, undefined, '2026-05-03')).toBeNull();
    expect(todayDayId(ws, 's1', '오늘')).toBeNull();
  });

  it('ignores a day of another sheet', () => {
    const ws = scaffold(['2026-05-03']);
    ws.sheets.s2 = { ...ws.sheets.s1, id: 's2', name: '플랜 B', dayOrder: ['d9'] };
    ws.days.d9 = { ...ws.days.d1, id: 'd9', sheetId: 's2', date: '2026-05-09' };
    expect(todayDayId(ws, 's1', '2026-05-09')).toBeNull();
    expect(todayDayId(ws, 's2', '2026-05-09')).toBe('d9');
  });
});

describe('currentAndNext', () => {
  const entries = [
    entry('e1', 'k1', 540), // 09:00–10:00
    entry('e2', 'k2', 660), // 11:00–12:00
    entry('e3', 'k3', 900), // 15:00–16:00
  ];

  it('names the entry the clock is inside, and the one after it', () => {
    const result = currentAndNext(entries, CARDS, 570); // 09:30
    expect(result.current?.id).toBe('e1');
    expect(result.next?.id).toBe('e2');
    expect(result.gapMin).toBe(90);
  });

  it('leaves 지금 empty in a gap, and counts the minutes to 다음', () => {
    const result = currentAndNext(entries, CARDS, 630); // 10:30, between e1 and e2
    expect(result.current).toBeUndefined();
    expect(result.next?.id).toBe('e2');
    expect(result.gapMin).toBe(30);
  });

  it('treats the minute an entry starts as 지금, not 다음', () => {
    const result = currentAndNext(entries, CARDS, 660);
    expect(result.current?.id).toBe('e2');
    expect(result.next?.id).toBe('e3');
  });

  it('treats the minute an entry ends as over', () => {
    const result = currentAndNext(entries, CARDS, 600); // e1 ends at 10:00
    expect(result.current).toBeUndefined();
    expect(result.next?.id).toBe('e2');
  });

  it('has no 다음 once the day is done', () => {
    const result = currentAndNext(entries, CARDS, 1_000); // 16:40
    expect(result.current).toBeUndefined();
    expect(result.next).toBeUndefined();
    expect(result.gapMin).toBeUndefined();
  });

  it('sorts before it looks, and skips entries whose card is gone', () => {
    const shuffled = [entry('e3', 'k3', 900), entry('ghost', 'gone', 545), entry('e1', 'k1', 540)];
    const result = currentAndNext(shuffled, CARDS, 550);
    expect(result.current?.id).toBe('e1');
    expect(result.next?.id).toBe('e3');
  });

  it('is empty for an empty day, and survives a garbled clock', () => {
    expect(currentAndNext([], CARDS, 600)).toEqual({});
    expect(currentAndNext(entries, CARDS, Number.NaN).next?.id).toBe('e1');
  });
});

/* ------------------------------------------------------------------ *
 * M16-B — 하루 시작 05시
 * ------------------------------------------------------------------ */

describe('todayWindowIso', () => {
  it('05시 이후는 달력 날짜 그대로다', () => {
    expect(todayWindowIso(new Date(2026, 4, 4, 5, 0))).toBe('2026-05-04');
    expect(todayWindowIso(new Date(2026, 4, 4, 10, 30))).toBe('2026-05-04');
    expect(todayWindowIso(new Date(2026, 4, 4, 23, 59))).toBe('2026-05-04');
  });

  it('새벽 2시는 전날 밤이다', () => {
    expect(todayWindowIso(new Date(2026, 4, 4, 2, 0))).toBe('2026-05-03');
    expect(todayWindowIso(new Date(2026, 4, 4, 4, 59))).toBe('2026-05-03');
    expect(todayWindowIso(new Date(2026, 4, 4, 0, 0))).toBe('2026-05-03');
  });

  it('달을 넘어가도 어제는 어제다', () => {
    expect(todayWindowIso(new Date(2026, 4, 1, 3, 0))).toBe('2026-04-30');
    expect(todayWindowIso(new Date(2026, 0, 1, 3, 0))).toBe('2025-12-31');
  });

  it('잘못된 날짜는 빈 문자열', () => {
    expect(todayWindowIso(new Date(Number.NaN))).toBe('');
  });
});

describe('todayDayId — 02시', () => {
  it('새벽 2시에는 어제 칸이 오늘로 잡힌다', () => {
    const ws = scaffold(['2026-05-03', '2026-05-04', '2026-05-05']);
    const at2am = new Date(2026, 4, 4, 2, 0);
    expect(todayDayId(ws, 's1', todayWindowIso(at2am))).toBe('d1');
    // 같은 시각의 달력 날짜로 물으면 2일차가 나온다 — 그래서 창을 쓴다.
    expect(todayDayId(ws, 's1', todayIso(at2am))).toBe('d2');
  });
});

/* ------------------------------------------------------------------ *
 * B6 — 첫날 새벽에도 오늘 모드는 켜져 있다
 * ------------------------------------------------------------------ */

describe('todayFocus', () => {
  it('한낮에는 그 날 칸을, 시계 그대로의 자리를 가리킨다', () => {
    const ws = scaffold(['2026-05-01', '2026-05-02', '2026-05-03']);
    const focus = todayFocus(ws, 's1', new Date(2026, 4, 2, 14, 0));
    expect(focus).toEqual({
      dayId: 'd2',
      nowOffsetMin: clockToOffset(840),
      nowRawOffsetMin: clockToOffset(840),
      dawn: false,
    });
  });

  it('둘째 날 새벽 2시는 첫날 칸의 아래쪽이다', () => {
    const ws = scaffold(['2026-05-01', '2026-05-02', '2026-05-03']);
    const focus = todayFocus(ws, 's1', new Date(2026, 4, 2, 2, 0));
    expect(focus?.dayId).toBe('d1');
    expect(focus?.dawn).toBe(false);
    expect(focus?.nowOffsetMin).toBe(1260);
  });

  it('첫날 새벽 4시에도 오늘 모드가 켜지고, 선은 칸 꼭대기에 붙는다', () => {
    const ws = scaffold(['2026-05-01', '2026-05-02', '2026-05-03']);
    // 창으로 치면 4월 30일 — 이 시트에 없는 날짜다. 그래도 여행자는 5월 1일에
    // 서 있다: 달력 오늘로 되짚어 1일차를 고른다.
    const focus = todayFocus(ws, 's1', new Date(2026, 4, 1, 4, 0));
    expect(focus?.dayId).toBe('d1');
    expect(focus?.dawn).toBe(true);
    // 그려지는 자리는 창의 맨 위 (첫날 새벽 블록과 같은 규칙),
    expect(focus?.nowOffsetMin).toBe(0);
    // 실제 시각은 창이 열리기 60분 전이다 — 지금/다음은 이 값을 쓴다.
    expect(focus?.nowRawOffsetMin).toBe(-60);
  });

  it('첫날 새벽에는 아직 시작한 일정이 없고, 다음은 그날 아침이다', () => {
    const ws = scaffold(['2026-05-01', '2026-05-02']);
    const focus = todayFocus(ws, 's1', new Date(2026, 4, 1, 4, 0));
    const morning = entry('e1', 'k1', 540); // 1일차 09:00
    const result = currentAndNextWindowed(
      [morning],
      CARDS,
      ['d1', 'd2'],
      nowMin(new Date(2026, 4, 1, 4, 0)),
      focus?.nowRawOffsetMin,
    );
    expect(result.current).toBeUndefined();
    expect(result.next?.id).toBe('e1');
    expect(result.gapMin).toBe(300); // 04:00 → 09:00
  });

  it('시트에 오늘도 어제도 없으면 오늘 모드는 없다', () => {
    const ws = scaffold(['2026-06-01', '2026-06-02']);
    expect(todayFocus(ws, 's1', new Date(2026, 4, 1, 4, 0))).toBeNull();
    expect(todayFocus(ws, undefined, new Date(2026, 5, 1, 12, 0))).toBeNull();
  });

  it('날짜 없는 일수 시트에는 오늘이 없다', () => {
    const ws = scaffold([undefined, undefined]);
    expect(todayFocus(ws, 's1', new Date(2026, 4, 1, 4, 0))).toBeNull();
  });
});

describe('currentAndNextWindowed', () => {
  const ORDER: Id[] = ['d1', 'd2'];
  /** 2일차 새벽 항목 — 창 기준으로는 1일차 밤에 속한다. */
  const dawn = (id: Id, cardId: Id, startMin: number, durationMin = 60) => ({
    ...entry(id, cardId, startMin, durationMin),
    dayId: 'd2',
  });

  it('01:30에는 23:00 일정이 지금이고 02:00 일정이 다음이다', () => {
    const entries = [entry('e1', 'k1', 1380, 240), dawn('e2', 'k2', 120)];
    const result = currentAndNextWindowed(entries, CARDS, ORDER, 90);
    expect(result.current?.id).toBe('e1');
    expect(result.next?.id).toBe('e2');
    expect(result.gapMin).toBe(30);
  });

  it('자정을 건너뛰는 순서로 정렬한다', () => {
    const entries = [dawn('e-late', 'k2', 60), entry('e-early', 'k1', 600)];
    const result = currentAndNextWindowed(entries, CARDS, ORDER, 540); // 09:00
    expect(result.next?.id).toBe('e-early');
  });

  it('창이 열리기 전(첫날 새벽)의 일정은 이미 지나간 것으로 본다', () => {
    // 1일차 02:00 — 앞 일자가 없어 1일차 맨 위에 고정되지만, 05:30에는 과거다.
    const entries = [entry('e-dawn', 'k1', 120)];
    const result = currentAndNextWindowed(entries, CARDS, ORDER, 330);
    expect(result.current).toBeUndefined();
    expect(result.next).toBeUndefined();
  });

  it('카드가 지워진 항목은 건너뛴다', () => {
    const entries = [entry('e1', 'gone', 600), entry('e2', 'k1', 660)];
    const result = currentAndNextWindowed(entries, CARDS, ORDER, 610);
    expect(result.current).toBeUndefined();
    expect(result.next?.id).toBe('e2');
  });
});
