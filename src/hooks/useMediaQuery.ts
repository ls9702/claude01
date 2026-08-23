import { useEffect, useState } from 'react';

/**
 * Subscribes to a CSS media query.
 *
 * Used where a layout has to *branch* rather than restyle — the timeline
 * renders one day at a time with a pager below `lg`, and all days side by side
 * above it, which Tailwind alone cannot express. Returns `false` during SSR /
 * a missing `matchMedia` so the mobile layout is the safe default.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const list = window.matchMedia(query);
    const onChange = () => setMatches(list.matches);
    onChange();
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

/** `≥1024px` — the breakpoint the plan view uses to switch to the rail layout. */
export const useIsDesktop = (): boolean => useMediaQuery('(min-width: 1024px)');
