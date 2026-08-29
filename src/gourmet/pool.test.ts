import { describe, expect, it } from 'vitest';
import { GOURMET_POOL_WIDTH, runPool } from './pool';

/** 손으로 풀 수 있는 약속 하나. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('runPool', () => {
  it('폭은 여섯이다', () => {
    expect(GOURMET_POOL_WIDTH).toBe(6);
  });

  it('모든 칸을 정확히 한 번씩 훑는다', async () => {
    const items = Array.from({ length: 25 }, (_, i) => i);
    const seen: number[] = [];
    await runPool(items, 6, async (item) => {
      await Promise.resolve();
      seen.push(item);
    });
    expect(seen).toHaveLength(items.length);
    expect([...seen].sort((a, b) => a - b)).toEqual(items);
  });

  it('동시에 살아 있는 작업이 폭을 넘지 않는다', async () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    let live = 0;
    let peak = 0;
    await runPool(items, 4, async () => {
      live += 1;
      peak = Math.max(peak, live);
      await Promise.resolve();
      await Promise.resolve();
      live -= 1;
    });
    expect(peak).toBe(4);
  });

  it('시작 순서는 목록 순서다 — 첫 요청은 언제나 첫 칸의 것이다', async () => {
    const items = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const started: string[] = [];
    const gate = deferred();
    const run = runPool(items, 3, async (item) => {
      started.push(item);
      await gate.promise;
    });
    // 처음 세 개가 폭만큼, 목록 순서대로 나갔다.
    await Promise.resolve();
    expect(started).toEqual(['a', 'b', 'c']);
    gate.resolve();
    await run;
    expect(started[0]).toBe('a');
  });

  it('stop이 참이 되면 남은 칸은 집지 않는다', async () => {
    const items = Array.from({ length: 30 }, (_, i) => i);
    const seen: number[] = [];
    let stopped = false;
    await runPool(
      items,
      2,
      async (item) => {
        await Promise.resolve();
        seen.push(item);
        if (seen.length >= 6) stopped = true;
      },
      { stop: () => stopped },
    );
    expect(seen.length).toBeGreaterThanOrEqual(6);
    expect(seen.length).toBeLessThan(items.length);
  });

  it('빈 목록은 아무 일도 하지 않는다', async () => {
    let calls = 0;
    await runPool([], 6, async () => {
      calls += 1;
    });
    expect(calls).toBe(0);
  });

  it('폭이 목록보다 커도 칸 수만큼만 돈다', async () => {
    const seen: number[] = [];
    await runPool([1, 2], 10, async (item) => {
      seen.push(item);
    });
    expect(seen).toEqual([1, 2]);
  });

  it('망가진 폭은 1로 접힌다', async () => {
    const items = [1, 2, 3];
    let live = 0;
    let peak = 0;
    await runPool(items, Number.NaN, async () => {
      live += 1;
      peak = Math.max(peak, live);
      await Promise.resolve();
      live -= 1;
    });
    expect(peak).toBe(1);
  });

  it('task가 던지면 전체가 던진다', async () => {
    await expect(
      runPool([1, 2, 3], 2, async (item) => {
        if (item === 2) throw new Error('nope');
      }),
    ).rejects.toThrow('nope');
  });
});
