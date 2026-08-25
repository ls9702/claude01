/**
 * How often the engine asks the server "did anything change?" (M22).
 *
 * Until now the engine only looked at the server when something *happened* —
 * init, a tab coming back into focus, an `online` event. That is exactly right
 * for a board somebody edits alone, and exactly wrong for the 메모 탭 (M21),
 * where the whole point is that a line typed on one phone lands on the other
 * one while its owner is looking at the screen.
 *
 * So there is a probe on a timer now. It is the cheap `?meta=1` call, not a
 * pull: one version number, and the engine's ordinary cycle only runs when that
 * number moved. What is left to decide is *when* the next probe is due, and
 * that is this module — pure, so the cadence and the backoff can be tested
 * without a clock or a browser, the same way `planGc` keeps the photo GC's
 * arithmetic testable. The impure half (the timer, the listeners) stays in
 * `syncEngine`.
 *
 * The two speeds are a battery decision:
 *
 * - **5초 on the 메모 탭.** A chat that takes half a minute to show the other
 *   person's message is not a chat. This is the only place in the app where the
 *   user is *waiting* for the other device.
 * - **30초 everywhere else.** A card that appears half a minute late costs
 *   nobody anything; four probes a minute for hours would cost a phone real
 *   battery for no one's benefit.
 *
 * And a device whose NAS is unreachable — home wifi behind it, laptop in a
 * café, server rebooting — must not keep knocking at the same rate for an
 * afternoon. Each failure doubles the wait, up to {@link POLL_MAX_MS}; a probe
 * that gets through resets it (as does coming back to the tab, or saving new
 * settings — both are moments when the situation has plausibly changed).
 */

/** Probe interval while 메모 is the tab on screen. */
export const POLL_MEMO_MS = 5_000;

/** Probe interval on every other tab. */
export const POLL_IDLE_MS = 30_000;

/** Ceiling the backoff climbs to and stops — 5분. */
export const POLL_MAX_MS = 300_000;

/** Everything the cadence depends on. */
export interface PollState {
  /** Is 메모 the tab currently on screen? */
  memoActive: boolean;
  /** Consecutive failed probes since the last one that got through. */
  failures: number;
}

/**
 * How long to wait before the next probe.
 *
 * @param memoActive picks the base interval.
 * @param failures   doubles it once each, capped at {@link POLL_MAX_MS}.
 */
export function nextPollDelay({ memoActive, failures }: PollState): number {
  const base = memoActive ? POLL_MEMO_MS : POLL_IDLE_MS;
  // Clamped before it becomes an exponent: a device left offline overnight
  // would otherwise hand `2 ** 1000` — Infinity — to `setTimeout`, which fires
  // it immediately. The cap below makes anything past a handful of failures
  // identical anyway.
  const steps = Math.min(Math.max(failures, 0), 20);
  return Math.min(base * 2 ** steps, POLL_MAX_MS);
}
