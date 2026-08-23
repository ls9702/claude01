import { useEffect, useState } from 'react';

/** How often 오늘 모드 re-reads the clock while the app is on screen. */
export const TICK_MS = 60_000;

/**
 * A `Date` that refreshes every minute — the clock behind 오늘 모드 (M7b).
 *
 * Two rules keep it cheap:
 *
 * - the interval is **cleared while `document.hidden`**, so a phone in a pocket
 *   is not woken 1,440 times a day, and it re-reads the clock the instant the
 *   tab comes back (which is also what makes crossing midnight in the
 *   background correct);
 * - it is only armed when `active` — the 일정 tab asks for it, the other tabs
 *   do not.
 *
 * `active: false` still returns a `Date`, just a frozen one, so callers can use
 * it unconditionally.
 */
export function useNowTick(active: boolean = true): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!active) return;

    let timer: ReturnType<typeof setInterval> | undefined;

    const stop = () => {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
    };

    const start = () => {
      stop();
      setNow(new Date());
      timer = setInterval(() => setNow(new Date()), TICK_MS);
    };

    const onVisibility = () => {
      if (document.hidden) stop();
      else start();
    };

    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [active]);

  return now;
}
