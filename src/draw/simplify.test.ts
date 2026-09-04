import { describe, expect, it } from 'vitest';
import {
  DRAW_SIMPLIFY_TOLERANCE,
  finishStroke,
  perpendicularDistance,
  pointCount,
  quantize,
  quantizePoints,
  simplifyPoints,
} from './simplify';

describe('quantize', () => {
  it('좌표를 정수로 떨어뜨린다', () => {
    expect(quantize(3.4)).toBe(3);
    expect(quantize(3.5)).toBe(4);
    expect(quantize(-0.4)).toBe(-0);
  });

  it('양자화가 만든 중복 점을 접는다', () => {
    // 천천히 그은 획 — 한 픽셀 안에 점 넷.
    expect(quantizePoints([10.1, 20.2, 10.3, 20.1, 9.9, 19.8, 11.6, 20.4])).toEqual([
      10, 20, 12, 20,
    ]);
  });

  it('꼬리가 홀수로 잘린 배열은 그 꼬리를 버린다', () => {
    expect(quantizePoints([1, 2, 3])).toEqual([1, 2]);
    expect(pointCount([1, 2, 3])).toBe(1);
  });

  it('NaN·Infinity는 통과시키지 않는다', () => {
    expect(quantizePoints([1, 2, Number.NaN, 5, 3, Number.POSITIVE_INFINITY, 7, 8])).toEqual([
      1, 2, 7, 8,
    ]);
  });
});

describe('perpendicularDistance', () => {
  it('선분이 아니라 무한 직선까지의 거리다', () => {
    // (0,0)-(10,0)의 연장선 위에 있는 점은 거리가 0이다 — 선분이면 10이었다.
    expect(perpendicularDistance(20, 0, 0, 0, 10, 0)).toBe(0);
    expect(perpendicularDistance(5, 3, 0, 0, 10, 0)).toBe(3);
  });

  it('길이 0인 「직선」은 그 점까지의 거리다', () => {
    expect(perpendicularDistance(3, 4, 0, 0, 0, 0)).toBe(5);
  });
});

describe('simplifyPoints', () => {
  it('직선 위의 중간 점을 전부 걷어 낸다', () => {
    const straight = [0, 0, 10, 0, 20, 0, 30, 0, 40, 0];
    expect(simplifyPoints(straight)).toEqual([0, 0, 40, 0]);
  });

  it('허용오차를 넘는 꼭짓점은 남긴다', () => {
    const bent = [0, 0, 10, 0, 20, 20, 30, 20];
    const out = simplifyPoints(bent, 1);
    expect(out).toContain(20);
    expect(out.slice(0, 2)).toEqual([0, 0]);
    expect(out.slice(-2)).toEqual([30, 20]);
  });

  it('첫 점과 끝 점은 언제나 남는다', () => {
    const wobble = [0, 0, 5, 0.2, 10, -0.3, 15, 0.1, 20, 0];
    const out = simplifyPoints(wobble, DRAW_SIMPLIFY_TOLERANCE);
    expect(out.slice(0, 2)).toEqual([0, 0]);
    expect(out.slice(-2)).toEqual([20, 0]);
    expect(out).toEqual([0, 0, 20, 0]);
  });

  it('두 점 이하는 그대로 돌아온다', () => {
    expect(simplifyPoints([])).toEqual([]);
    expect(simplifyPoints([1, 2])).toEqual([1, 2]);
    expect(simplifyPoints([1, 2, 3, 4])).toEqual([1, 2, 3, 4]);
  });

  it('깊은 곡선에서도 스택으로 돈다 (재귀 아님)', () => {
    const points: number[] = [];
    for (let i = 0; i < 4000; i += 1) points.push(i, Math.round(Math.sin(i / 40) * 200));
    const out = simplifyPoints(points, 1);
    expect(pointCount(out)).toBeGreaterThan(2);
    expect(pointCount(out)).toBeLessThan(pointCount(points));
  });
});

describe('finishStroke', () => {
  it('실제 손 떨림 획의 점 수를 크게 줄인다', () => {
    const raw: number[] = [];
    for (let i = 0; i <= 300; i += 1) {
      raw.push(i * 1.37, 100 + Math.sin(i / 50) * 0.4);
    }
    const out = finishStroke(raw);
    expect(pointCount(out)).toBeLessThan(pointCount(raw) / 4);
    // 그리고 결과는 전부 정수다 — 저장되는 좌표의 약속.
    expect(out.every((value) => Number.isInteger(value))).toBe(true);
  });

  it('콕 찍은 점은 두 점으로 늘어난다 (폴리라인이 점을 그릴 수 있게)', () => {
    expect(finishStroke([12.2, 40.7])).toEqual([12, 41, 12, 41]);
    expect(finishStroke([12.2, 40.7, 12.1, 40.9])).toEqual([12, 41, 12, 41]);
  });

  it('빈 입력만 빈 배열이다', () => {
    expect(finishStroke([])).toEqual([]);
  });

  it('같은 입력에 같은 답 — 두 기기가 같은 획을 같은 숫자로 적는다', () => {
    const raw = [0, 0, 3.2, 1.1, 9.8, 0.4, 20.5, 0.2, 31.4, 12.9];
    expect(finishStroke(raw)).toEqual(finishStroke([...raw]));
  });
});
