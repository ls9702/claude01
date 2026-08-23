import { useEffect } from 'react';
import { isTabId, useUiStore, type TabId } from '../../stores/uiStore';

const DEFAULT_TAB: TabId = 'trips';

/** `#/board` → `'board'`; anything unrecognized → undefined. */
export function parseHash(hash: string): TabId | undefined {
  const raw = hash.replace(/^#\/?/, '').split(/[/?]/)[0] ?? '';
  return isTabId(raw) ? raw : undefined;
}

export const hashForTab = (tab: TabId): string => `#/${tab}`;

/**
 * Two-way sync between `uiStore.activeTab` and `location.hash`.
 *
 * - On mount: adopt the tab from the URL, or rewrite the URL to the default
 *   (`#/trips`) when the hash is missing/unknown.
 * - hashchange (back/forward, manual edit) → store.
 * - store change (tab tap) → `location.hash`.
 */
export function useHashSync(): void {
  useEffect(() => {
    const applyHash = () => {
      const tab = parseHash(window.location.hash);
      if (tab) {
        if (useUiStore.getState().activeTab !== tab) useUiStore.getState().setTab(tab);
      } else {
        // Unknown/empty hash: normalize the URL without adding a history entry.
        const target = hashForTab(useUiStore.getState().activeTab ?? DEFAULT_TAB);
        window.history.replaceState(null, '', target);
      }
    };

    applyHash();
    window.addEventListener('hashchange', applyHash);

    const unsubscribe = useUiStore.subscribe((state) => {
      const target = hashForTab(state.activeTab);
      if (window.location.hash !== target) window.location.hash = target;
    });

    return () => {
      window.removeEventListener('hashchange', applyHash);
      unsubscribe();
    };
  }, []);
}
