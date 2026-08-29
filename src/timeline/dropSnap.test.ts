import { describe, expect, it } from 'vitest';
import { DROP_SNAP_MIN, snapDropMin } from './dropSnap';
import { DAY_START_MIN, snapMin } from '../utils/time';
import { dropTarget } from './dayWindow';

describe('snapDropMin', () => {
  it('격자는 30분이다', () => {
    expect(DROP_SNAP_MIN).toBe(30);
  });

  it('가장 가까운 :00 / :30으로 붙는다', () => {
    expect(snapDropMin(0)).toBe(0);
    expect(snapDropMin(7)).toBe(0);
    expect(snapDropMin(14)).toBe(0);
    // 정확히 가운데는 위로 — `Math.round`의 규칙 그대로.
    expect(snapDropMin(15)).toBe(30);
    expect(snapDropMin(22)).toBe(30);
    expect(snapDropMin(44)).toBe(30);
    expect(snapDropMin(45)).toBe(60);
    expect(snapDropMin(307)).toBe(300);
    expect(snapDropMin(316)).toBe(330);
  });

  it('창 위로는 넘어가지 않는다', () => {
    expect(snapDropMin(-1)).toBe(0);
    expect(snapDropMin(-500)).toBe(0);
  });

  it('좌표를 못 읽은 드롭은 시간을 발명하지 않는다', () => {
    expect(snapDropMin(Number.NaN)).toBe(0);
    expect(snapDropMin(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('결과는 언제나 30의 배수라 스토어의 15분 격자가 다시 움직이지 않는다', () => {
    for (const raw of [0, 3, 17, 61, 119, 646, 1231, 1439.5]) {
      const snapped = snapDropMin(raw);
      expect(snapped % DROP_SNAP_MIN).toBe(0);
      expect(snapMin(snapped)).toBe(snapped);
    }
  });
});

describe('05시 창을 지나도 :00 / :30이다', () => {
  const axis = [{ id: 'd1' }, { id: 'd2' }];

  it('창 안의 드롭은 그 날의 :00 / :30에 선다', () => {
    // 오프셋 307 → 10:07쯤을 가리킨 손가락. 10:00에 붙는다.
    const target = dropTarget('d1', snapDropMin(307), axis);
    expect(target).toEqual({ dayId: 'd1', startMin: 300 + 300 });
    expect((target!.startMin - DAY_START_MIN) % DROP_SNAP_MIN).toBe(0);
    expect(target!.startMin % DROP_SNAP_MIN).toBe(0);
  });

  it('자정을 넘긴 새벽 드롭도 다음 날의 :00 / :30이다', () => {
    // 오프셋 1213 → 다음 날 01:13. 01:00에 붙는다.
    const target = dropTarget('d1', snapDropMin(1213), axis);
    expect(target).toEqual({ dayId: 'd2', startMin: 60 });
  });

  it('창 끝을 넘긴 드롭은 다음 날 05:00으로 잘린다 — 시각을 발명하지 않는다', () => {
    expect(dropTarget('d1', snapDropMin(1439), axis)).toEqual({ dayId: 'd2', startMin: 300 });
  });
});
