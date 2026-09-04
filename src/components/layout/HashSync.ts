import { useEffect } from 'react';
import { isTabId, useUiStore, type TabId } from '../../stores/uiStore';

const DEFAULT_TAB: TabId = 'trips';

/** `#/board` → `'board'`; anything unrecognized → undefined. */
export function parseHash(hash: string): TabId | undefined {
  const raw = hash.replace(/^#\/?/, '').split(/[/?]/)[0] ?? '';
  return isTabId(raw) ? raw : undefined;
}

/**
 * `#/draw/<pageId>` → `'<pageId>'` (M52a) — 그 밖의 모든 해시는 `undefined`.
 *
 * 두 번째 칸을 읽는 유일한 탭이다. 나머지 탭에 딥링크가 없는 이유는 그것들이
 * 「어디를 보고 있나」를 이미 다른 곳에 적어 두기 때문이고(활성 여행·시트는
 * `uiPersist`), 드로우 페이지만 URL이 유일한 주인이다.
 *
 * id 모양을 검사하지 않는 대신 길이를 자른다: 여기서 나온 값은 곧바로
 * `drawPages[…]` 조회에 쓰이고, 없는 페이지면 화면이 목록으로 되돌아간다.
 */
export function parseDrawPageId(hash: string): string | undefined {
  const parts = hash.replace(/^#\/?/, '').split('?')[0].split('/');
  if (parts[0] !== 'draw') return undefined;
  const raw = (parts[1] ?? '').trim();
  return raw.length > 0 && raw.length <= 64 ? decodeURIComponent(raw) : undefined;
}

/** 지금 상태가 가리키는 해시 — 드로우만 두 칸을 쓴다. */
export function hashFor(tab: TabId, drawPageId?: string): string {
  if (tab === 'draw' && drawPageId) return `#/draw/${encodeURIComponent(drawPageId)}`;
  return `#/${tab}`;
}

/**
 * Two-way sync between `uiStore.activeTab` and `location.hash`.
 *
 * - On mount: adopt the tab from the URL, or rewrite the URL to the default
 *   (`#/trips`) when the hash is missing/unknown.
 * - hashchange (back/forward, manual edit) → store.
 * - store change (tab tap) → `location.hash`.
 *
 * 드로우 탭은 여기에 한 칸을 더 싣는다 (M52a): `#/draw/<pageId>`. 그래서 새
 * 페이지를 열면 주소가 따라가고, 그 주소를 다시 열면 그 페이지가 열린다 —
 * 카드에서 페이지로 이어 주는 링크(M52b)가 기댈 자리이기도 하다.
 */
export function useHashSync(): void {
  useEffect(() => {
    const applyHash = () => {
      const tab = parseHash(window.location.hash);
      if (tab) {
        const state = useUiStore.getState();
        if (state.activeTab !== tab) state.setTab(tab);
        // 드로우가 아닌 탭으로 갈 때 페이지를 닫지 **않는다**: 지도에 다녀와도
        // 그리던 페이지로 돌아오는 편이 낫고, 탭을 옮기는 것은 페이지를 닫는
        // 뜻이 아니다. 드로우 해시일 때만 두 번째 칸이 주인 노릇을 한다.
        if (tab === 'draw') {
          const pageId = parseDrawPageId(window.location.hash);
          if (state.activeDrawPageId !== pageId) state.setActiveDrawPage(pageId);
        }
      } else {
        // Unknown/empty hash: normalize the URL without adding a history entry.
        const state = useUiStore.getState();
        const target = hashFor(state.activeTab ?? DEFAULT_TAB, state.activeDrawPageId);
        window.history.replaceState(null, '', target);
      }
    };

    applyHash();
    window.addEventListener('hashchange', applyHash);

    const unsubscribe = useUiStore.subscribe((state) => {
      const target = hashFor(state.activeTab, state.activeDrawPageId);
      if (window.location.hash !== target) window.location.hash = target;
    });

    return () => {
      window.removeEventListener('hashchange', applyHash);
      unsubscribe();
    };
  }, []);
}
