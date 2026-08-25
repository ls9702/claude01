import { describe, expect, it } from 'vitest';
import { POLL_IDLE_MS, POLL_MAX_MS, POLL_MEMO_MS, nextPollDelay } from './poll';

describe('nextPollDelay', () => {
  it('메모 탭은 5초, 나머지 탭은 30초마다 확인한다', () => {
    expect(nextPollDelay({ memoActive: true, failures: 0 })).toBe(POLL_MEMO_MS);
    expect(nextPollDelay({ memoActive: false, failures: 0 })).toBe(POLL_IDLE_MS);
    expect(POLL_MEMO_MS).toBeLessThan(POLL_IDLE_MS);
  });

  it('실패할 때마다 간격이 두 배가 된다', () => {
    expect(nextPollDelay({ memoActive: true, failures: 1 })).toBe(POLL_MEMO_MS * 2);
    expect(nextPollDelay({ memoActive: true, failures: 2 })).toBe(POLL_MEMO_MS * 4);
    expect(nextPollDelay({ memoActive: false, failures: 1 })).toBe(POLL_IDLE_MS * 2);
    expect(nextPollDelay({ memoActive: false, failures: 3 })).toBe(POLL_IDLE_MS * 8);
  });

  it('아무리 실패해도 5분을 넘지 않는다', () => {
    expect(nextPollDelay({ memoActive: true, failures: 10 })).toBe(POLL_MAX_MS);
    expect(nextPollDelay({ memoActive: false, failures: 10 })).toBe(POLL_MAX_MS);
    // NAS를 잃은 채 밤을 새운 기기 — 지수가 폭주해 Infinity가 되면
    // setTimeout이 도리어 즉시 발화한다.
    const overnight = nextPollDelay({ memoActive: false, failures: 100_000 });
    expect(Number.isFinite(overnight)).toBe(true);
    expect(overnight).toBe(POLL_MAX_MS);
  });

  it('간격은 실패 횟수에 대해 단조 증가한다', () => {
    let previous = 0;
    for (let failures = 0; failures <= 12; failures += 1) {
      const delay = nextPollDelay({ memoActive: true, failures });
      expect(delay).toBeGreaterThanOrEqual(previous);
      expect(delay).toBeLessThanOrEqual(POLL_MAX_MS);
      previous = delay;
    }
  });

  it('성공하면(=failures 0) 원래 간격으로 돌아온다', () => {
    // 백오프는 상태가 아니라 인자다: 호출자가 0을 돌려주면 그걸로 끝.
    expect(nextPollDelay({ memoActive: true, failures: 6 })).toBe(POLL_MAX_MS);
    expect(nextPollDelay({ memoActive: true, failures: 0 })).toBe(POLL_MEMO_MS);
    expect(nextPollDelay({ memoActive: false, failures: 0 })).toBe(POLL_IDLE_MS);
  });

  it('음수 failures도 기본 간격으로 다룬다', () => {
    expect(nextPollDelay({ memoActive: true, failures: -1 })).toBe(POLL_MEMO_MS);
    expect(nextPollDelay({ memoActive: false, failures: -5 })).toBe(POLL_IDLE_MS);
  });
});
