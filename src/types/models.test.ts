import { describe, expect, it } from 'vitest';
import { emptyWorkspace } from './models';

describe('emptyWorkspace', () => {
  it('has schemaVersion 1 and empty collections', () => {
    const ws = emptyWorkspace();
    expect(ws.schemaVersion).toBe(1);
    expect(ws.trips).toEqual({});
    expect(ws.sheets).toEqual({});
    expect(ws.columns).toEqual({});
    expect(ws.cards).toEqual({});
    expect(ws.days).toEqual({});
    expect(ws.entries).toEqual({});
    expect(ws.tombstones).toEqual([]);
  });

  it('returns a fresh object each call', () => {
    const a = emptyWorkspace();
    const b = emptyWorkspace();
    expect(a).not.toBe(b);
    expect(a.trips).not.toBe(b.trips);
    expect(a.tombstones).not.toBe(b.tombstones);
  });
});
