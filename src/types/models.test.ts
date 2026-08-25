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

  it('메모 맵은 만들지 않는다 — seenBy와 같은 이유다 (M21)', () => {
    // 없던 필드를 `{}`로 만들어 두면 그것만으로 "달라졌다"가 되어, M21 이전
    // 워크스페이스가 병합 한 번에 무의미한 푸시를 부른다.
    expect(emptyWorkspace().memos).toBeUndefined();
    expect('memos' in emptyWorkspace()).toBe(false);
  });

  it('returns a fresh object each call', () => {
    const a = emptyWorkspace();
    const b = emptyWorkspace();
    expect(a).not.toBe(b);
    expect(a.trips).not.toBe(b.trips);
    expect(a.tombstones).not.toBe(b.tombstones);
  });
});
