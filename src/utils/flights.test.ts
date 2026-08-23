import { describe, expect, it } from 'vitest';
import type { FlightLeg } from '../types/models';
import {
  MAX_SHEET_DAYS,
  addDaysIso,
  dayLabelAt,
  diffDaysIso,
  flightCardTitle,
  formatSheetPlan,
  formatShortDate,
  isIsoDate,
  legArrivalDate,
  legDurationMin,
  parseHm,
  planSheetDays,
} from './flights';

const leg = (over: Partial<FlightLeg> = {}): FlightLeg => ({
  date: '2026-05-03',
  depTime: '10:00',
  arrTime: '12:30',
  ...over,
});

describe('date helpers', () => {
  it('validates, adds and subtracts calendar days', () => {
    expect(isIsoDate('2026-05-03')).toBe(true);
    expect(isIsoDate('2026-02-31')).toBe(false);
    expect(isIsoDate('26-05-03')).toBe(false);
    expect(isIsoDate(undefined)).toBe(false);

    expect(addDaysIso('2026-05-03', 4)).toBe('2026-05-07');
    // Month, year and leap-day rollovers.
    expect(addDaysIso('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysIso('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDaysIso('2026-05-03', -3)).toBe('2026-04-30');
    expect(addDaysIso('nope', 1)).toBe('nope');

    expect(diffDaysIso('2026-05-03', '2026-05-07')).toBe(4);
    expect(diffDaysIso('2026-05-07', '2026-05-03')).toBe(-4);
    expect(diffDaysIso('nope', '2026-05-03')).toBe(0);
  });

  it('parses HH:mm into minutes from midnight', () => {
    expect(parseHm('00:00')).toBe(0);
    expect(parseHm('10:00')).toBe(600);
    expect(parseHm('18:00')).toBe(1080);
    expect(parseHm('9:05')).toBe(545);
    expect(parseHm('24:00')).toBeNull();
    expect(parseHm('10:60')).toBeNull();
    expect(parseHm(undefined)).toBeNull();
  });
});

describe('legDurationMin / legArrivalDate', () => {
  it('measures a same-day leg', () => {
    expect(legDurationMin(leg())).toBe(150);
    expect(legArrivalDate(leg())).toBe('2026-05-03');
  });

  it('adds a day for a red-eye', () => {
    const redEye = leg({ depTime: '23:40', arrTime: '06:20', arrNextDay: true });
    expect(legDurationMin(redEye)).toBe(400);
    expect(legArrivalDate(redEye)).toBe('2026-05-04');
  });

  it('never returns a non-positive length', () => {
    expect(legDurationMin(leg({ depTime: '23:00', arrTime: '06:00' }))).toBe(15);
    expect(legDurationMin(leg({ depTime: '', arrTime: '' }))).toBe(15);
  });
});

describe('planSheetDays', () => {
  it('spans outbound departure → inbound arrival, inclusive', () => {
    const plan = planSheetDays({
      outbound: leg(),
      inbound: leg({ date: '2026-05-07', depTime: '18:00', arrTime: '20:30' }),
    });
    expect(plan.count).toBe(5);
    expect(plan.dates).toEqual([
      '2026-05-03',
      '2026-05-04',
      '2026-05-05',
      '2026-05-06',
      '2026-05-07',
    ]);
  });

  it('counts the extra day when the return flight lands after midnight', () => {
    const plan = planSheetDays({
      outbound: leg(),
      inbound: leg({ date: '2026-05-07', depTime: '23:30', arrTime: '05:10', arrNextDay: true }),
    });
    expect(plan.count).toBe(6);
    expect(plan.dates?.at(-1)).toBe('2026-05-08');
  });

  it('uses dayCount for a one-way sheet', () => {
    const plan = planSheetDays({ outbound: leg(), dayCount: 3 });
    expect(plan.dates).toEqual(['2026-05-03', '2026-05-04', '2026-05-05']);
  });

  it('falls back to a single day when a one-way leg has no dayCount', () => {
    expect(planSheetDays({ outbound: leg() })).toEqual({
      count: 1,
      dates: ['2026-05-03'],
    });
  });

  it('makes dateless days when there are no flights', () => {
    expect(planSheetDays({ dayCount: 3 })).toEqual({ count: 3 });
    // Nothing at all asks for nothing — the caller leaves the days alone.
    expect(planSheetDays({})).toEqual({ count: 0 });
  });

  it('collapses a backwards range and caps a silly one', () => {
    const backwards = planSheetDays({
      outbound: leg({ date: '2026-05-07' }),
      inbound: leg({ date: '2026-05-03' }),
    });
    expect(backwards.count).toBe(1);
    expect(backwards.dates).toEqual(['2026-05-07']);

    expect(planSheetDays({ dayCount: 999 }).count).toBe(MAX_SHEET_DAYS);
    expect(planSheetDays({ outbound: leg(), dayCount: 999 }).count).toBe(MAX_SHEET_DAYS);
  });
});

describe('labels and titles', () => {
  it('numbers days from 1', () => {
    expect(dayLabelAt(0)).toBe('1일차');
    expect(dayLabelAt(4)).toBe('5일차');
  });

  it('builds a flight card title from whatever the leg carries', () => {
    expect(flightCardTitle(leg({ from: 'ICN', to: 'KIX', flightNo: 'OZ112' }), 'outbound')).toBe(
      '✈️ ICN→KIX OZ112',
    );
    expect(flightCardTitle(leg({ from: 'ICN', to: 'KIX' }), 'outbound')).toBe('✈️ ICN→KIX');
    expect(flightCardTitle(leg({ flightNo: 'OZ111' }), 'inbound')).toBe('✈️ OZ111');
    expect(flightCardTitle(leg(), 'outbound')).toBe('✈️ 출발편');
    expect(flightCardTitle(leg(), 'inbound')).toBe('✈️ 귀국편');
  });

  it('formats the wizard preview line', () => {
    expect(formatShortDate('2026-05-03')).toBe('5월 3일');
    expect(
      formatSheetPlan(
        planSheetDays({
          outbound: leg(),
          inbound: leg({ date: '2026-05-07' }),
        }),
      ),
    ).toBe('5월 3일 ~ 5월 7일 · 5일');
    expect(formatSheetPlan(planSheetDays({ outbound: leg() }))).toBe('5월 3일 · 1일');
    expect(formatSheetPlan(planSheetDays({ dayCount: 3 }))).toBe('3일');
    expect(formatSheetPlan(planSheetDays({}))).toBe('');
  });
});
