import { describe, expect, it } from 'vitest';
import { DAY_HEIGHT_PX, PX_PER_MIN, laneMap, layoutLanes, type LaneItem } from './layout';

const item = (id: string, startMin: number, durationMin: number): LaneItem => ({
  id,
  startMin,
  durationMin,
});

/** `id → 'lane/lanes'`, so expectations read at a glance. */
const shape = (items: LaneItem[]): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const box of layoutLanes(items)) out[box.id] = `${box.lane}/${box.lanes}`;
  return out;
};

describe('layoutLanes', () => {
  it('gives every entry the full width when nothing overlaps', () => {
    expect(shape([item('a', 540, 60), item('b', 700, 30)])).toEqual({
      a: '0/1',
      b: '0/1',
    });
  });

  it('treats touching entries as non-overlapping', () => {
    // 10:00–11:00 and 11:00–12:00 share only an instant.
    expect(shape([item('a', 600, 60), item('b', 660, 60)])).toEqual({
      a: '0/1',
      b: '0/1',
    });
  });

  it('splits two overlapping entries in half', () => {
    expect(shape([item('a', 600, 60), item('b', 630, 60)])).toEqual({
      a: '0/2',
      b: '1/2',
    });
  });

  it('packs a three-way overlap into three lanes', () => {
    expect(shape([item('a', 600, 90), item('b', 615, 60), item('c', 630, 30)])).toEqual({
      a: '0/3',
      b: '1/3',
      c: '2/3',
    });
  });

  it('reuses a lane once its previous occupant has ended', () => {
    // b ends at 11:00, so c can take lane 1 again; all three are one cluster
    // because a spans the whole window.
    const boxes = shape([item('a', 600, 180), item('b', 615, 45), item('c', 660, 60)]);
    expect(boxes.a).toBe('0/2');
    expect(boxes.b).toBe('1/2');
    expect(boxes.c).toBe('1/2');
  });

  it('keeps clusters independent of one another', () => {
    const boxes = shape([
      item('a', 540, 60),
      item('b', 570, 60),
      item('far1', 900, 60),
      item('far2', 930, 60),
      item('alone', 1200, 30),
    ]);
    expect(boxes).toEqual({
      a: '0/2',
      b: '1/2',
      far1: '0/2',
      far2: '1/2',
      alone: '0/1',
    });
  });

  it('returns boxes in input order and is stable', () => {
    const items = [item('c', 630, 60), item('a', 600, 60), item('b', 615, 60)];
    expect(layoutLanes(items).map((box) => box.id)).toEqual(['c', 'a', 'b']);
    expect(layoutLanes(items)).toEqual(layoutLanes([...items]));
  });

  it('handles the empty case', () => {
    expect(layoutLanes([])).toEqual([]);
    expect(laneMap([])).toEqual({});
  });

  it('laneMap keys the same result by id', () => {
    const items = [item('a', 600, 60), item('b', 630, 60)];
    expect(laneMap(items)).toEqual({
      a: { id: 'a', lane: 0, lanes: 2 },
      b: { id: 'b', lane: 1, lanes: 2 },
    });
  });
});

describe('grid constants', () => {
  it('keeps a day roughly one pixel per minute', () => {
    expect(PX_PER_MIN).toBeGreaterThanOrEqual(0.8);
    expect(PX_PER_MIN).toBeLessThanOrEqual(1);
    expect(DAY_HEIGHT_PX).toBeCloseTo(1440 * PX_PER_MIN, 6);
  });
});
