import { beforeEach, describe, expect, it } from 'vitest';
import {
  PERSIST_FAIL_THRESHOLD,
  isPersistFailing,
  selectPersistFailing,
  usePersistHealthStore,
} from './persistHealth';

const health = () => usePersistHealthStore.getState();

beforeEach(() => {
  usePersistHealthStore.setState({ failCount: 0, lastFailAt: undefined });
});

describe('persistHealth', () => {
  it('stays quiet after a single failure', () => {
    health().fail(1_000);

    expect(health().failCount).toBe(1);
    expect(health().lastFailAt).toBe(1_000);
    expect(selectPersistFailing(health())).toBe(false);
  });

  it('raises the flag on the second consecutive failure', () => {
    health().fail(1_000);
    health().fail(2_000);

    expect(health().failCount).toBe(PERSIST_FAIL_THRESHOLD);
    expect(health().lastFailAt).toBe(2_000);
    expect(selectPersistFailing(health())).toBe(true);
  });

  it('keeps counting past the threshold', () => {
    for (const at of [1, 2, 3, 4]) health().fail(at);

    expect(health().failCount).toBe(4);
    expect(selectPersistFailing(health())).toBe(true);
  });

  it('clears the streak on a successful write', () => {
    health().fail(1_000);
    health().fail(2_000);
    expect(selectPersistFailing(health())).toBe(true);

    health().ok();

    expect(health().failCount).toBe(0);
    expect(selectPersistFailing(health())).toBe(false);
    // The last failure time survives a recovery — it is history, not state.
    expect(health().lastFailAt).toBe(2_000);
  });

  it('needs two *consecutive* failures, not two in total', () => {
    health().fail(1_000);
    health().ok();
    health().fail(3_000);

    expect(health().failCount).toBe(1);
    expect(selectPersistFailing(health())).toBe(false);
  });

  it('keeps the same object identity when ok() changes nothing', () => {
    const before = usePersistHealthStore.getState();
    health().ok();
    expect(usePersistHealthStore.getState()).toBe(before);
  });

  it('reset() wipes both fields', () => {
    health().fail(1_000);
    health().fail(2_000);
    health().reset();

    expect(health().failCount).toBe(0);
    expect(health().lastFailAt).toBeUndefined();
  });

  it('isPersistFailing is a plain threshold test', () => {
    expect(isPersistFailing(0)).toBe(false);
    expect(isPersistFailing(1)).toBe(false);
    expect(isPersistFailing(2)).toBe(true);
    expect(isPersistFailing(99)).toBe(true);
  });
});
