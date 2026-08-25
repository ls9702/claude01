import { describe, expect, it } from 'vitest';
import type { Id, MemoMessage, Millis } from '../types/models';
import { byMemoTime, groupByDay, isRemoved, memoClock, threadOf } from './thread';

/** A local clock: `at(2026, 7, 25, 9, 30)` — month is 0-based, like `Date`. */
const at = (y: number, m: number, d: number, h = 0, min = 0): Millis =>
  new Date(y, m, d, h, min).getTime();

const memo = (id: Id, tripId: Id, createdAt: Millis, over: Partial<MemoMessage> = {}): MemoMessage => ({
  id,
  tripId,
  text: `메시지 ${id}`,
  createdAt,
  updatedAt: createdAt,
  ...over,
});

describe('byMemoTime', () => {
  it('오래된 것이 먼저다', () => {
    const older = memo('a', 't1', at(2026, 7, 25, 9, 0));
    const newer = memo('b', 't1', at(2026, 7, 25, 9, 1));
    expect(byMemoTime(older, newer)).toBeLessThan(0);
    expect(byMemoTime(newer, older)).toBeGreaterThan(0);
  });

  it('같은 밀리초는 id로 갈린다 — 두 기기가 서로 다른 순서를 보면 안 된다', () => {
    const same = at(2026, 7, 25, 9, 0);
    const a = memo('a', 't1', same);
    const b = memo('b', 't1', same);
    expect(byMemoTime(a, b)).toBeLessThan(0);
    expect(byMemoTime(b, a)).toBeGreaterThan(0);
    expect(byMemoTime(a, a)).toBe(0);
  });
});

describe('threadOf', () => {
  const memos: Record<Id, MemoMessage> = {
    m3: memo('m3', 't1', at(2026, 7, 25, 12, 0)),
    m1: memo('m1', 't1', at(2026, 7, 25, 9, 0)),
    other: memo('other', 't2', at(2026, 7, 25, 10, 0)),
    m2: memo('m2', 't1', at(2026, 7, 25, 11, 0)),
  };

  it('그 여행의 메시지만, 오래된 순으로 준다', () => {
    expect(threadOf(memos, 't1').map((item) => item.id)).toEqual(['m1', 'm2', 'm3']);
    expect(threadOf(memos, 't2').map((item) => item.id)).toEqual(['other']);
  });

  it('메모가 없거나 여행이 없으면 빈 스레드다 (M21 이전 워크스페이스)', () => {
    expect(threadOf(undefined, 't1')).toEqual([]);
    expect(threadOf(memos, undefined)).toEqual([]);
    expect(threadOf(memos, 'nope')).toEqual([]);
  });

  it('삭제된 메시지도 자리를 지킨다 — 스텁으로 그려야 하니까', () => {
    const removed = memo('m4', 't1', at(2026, 7, 25, 13, 0), {
      text: undefined,
      removedAt: at(2026, 7, 25, 14, 0),
    });
    const thread = threadOf({ ...memos, m4: removed }, 't1');
    expect(thread.map((item) => item.id)).toEqual(['m1', 'm2', 'm3', 'm4']);
  });
});

describe('groupByDay', () => {
  it('달력 하루씩 묶고, 칩 문구를 붙인다', () => {
    const thread = [
      memo('m1', 't1', at(2026, 7, 24, 22, 0)),
      memo('m2', 't1', at(2026, 7, 25, 9, 0)),
      memo('m3', 't1', at(2026, 7, 25, 21, 0)),
    ];
    const days = groupByDay(thread);

    expect(days.map((day) => day.date)).toEqual(['2026-08-24', '2026-08-25']);
    expect(days[0].label).toBe('8월 24일 (월)');
    expect(days[1].messages.map((item) => item.id)).toEqual(['m2', 'm3']);
  });

  it('새벽 메시지는 그날 것이다 — 05시 경계는 일정 탭의 규칙이지 대화의 규칙이 아니다', () => {
    const days = groupByDay([
      memo('m1', 't1', at(2026, 7, 24, 23, 30)),
      memo('m2', 't1', at(2026, 7, 25, 2, 0)),
    ]);
    expect(days.map((day) => day.date)).toEqual(['2026-08-24', '2026-08-25']);
  });

  it('빈 스레드는 빈 목록이다', () => {
    expect(groupByDay([])).toEqual([]);
  });
});

describe('memoClock', () => {
  it('HH:mm 한 줄', () => {
    expect(memoClock(at(2026, 7, 25, 9, 5))).toBe('09:05');
    expect(memoClock(at(2026, 7, 25, 23, 59))).toBe('23:59');
    expect(memoClock(at(2026, 7, 25, 0, 0))).toBe('00:00');
  });

  it('망가진 값은 빈 문자열로 물러난다', () => {
    expect(memoClock(Number.NaN)).toBe('');
  });
});

describe('isRemoved', () => {
  it('removedAt이 있을 때만 참이다', () => {
    expect(isRemoved(memo('m1', 't1', at(2026, 7, 25)))).toBe(false);
    expect(isRemoved(memo('m1', 't1', at(2026, 7, 25), { removedAt: at(2026, 7, 25, 1) }))).toBe(
      true,
    );
    // 0은 스탬프가 아니다 — 손상된 값이 메시지를 지우게 두지 않는다.
    expect(isRemoved(memo('m1', 't1', at(2026, 7, 25), { removedAt: 0 }))).toBe(false);
  });
});
