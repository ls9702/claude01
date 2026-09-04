import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { registerSW } from 'virtual:pwa-register';

/** Type of the updater `registerSW` hands back. */
type UpdateSW = (reloadPage?: boolean) => Promise<void>;

/**
 * `registerSW` must run exactly once per page. React 19's StrictMode mounts
 * effects twice in dev, so the guard lives at module scope rather than in a
 * ref.
 */
let registered = false;

/**
 * Service-worker update prompt.
 *
 * The app registers with `registerType: 'prompt'`, so a new build waits in the
 * wings until the user says so — mid-trip is exactly the wrong moment to have
 * the page reload itself out from under a half-typed card.
 *
 * Renders nothing until a waiting worker appears, which means it is invisible
 * in dev (the SW is disabled there) and on a first visit.
 */
export default function UpdateToast() {
  const [needRefresh, setNeedRefresh] = useState(false);
  const updateSW = useRef<UpdateSW | null>(null);

  useEffect(() => {
    if (registered) return;
    registered = true;
    updateSW.current = registerSW({
      immediate: true,
      onNeedRefresh: () => setNeedRefresh(true),
      onRegisterError: (error) => console.warn('[pwa] service worker 등록 실패', error),
    });
  }, []);

  if (!needRefresh) return null;

  return createPortal(
    <div
      role="status"
      data-testid="update-toast"
      /* `tb-vp-bottom` — 탭 바와 같은 못 (M51). 늘어난 레이아웃 뷰포트에서
         `bottom`은 화면 아래로 내려가 버리므로, 자기 높이만큼 되올리는 규칙으로
         가시 뷰포트 안에 붙든다. 올라갈 높이(탭 바 + 12px)는 아래 `bottom-…`에
         적힌 그 값을 `--tb-vp-bottom-offset`으로 한 번 더 말한 것이다 —
         `dvh` 미지원 브라우저는 여전히 `bottom-…`을 쓴다. */
      style={
        {
          '--tb-vp-bottom-offset': 'calc(3.5rem + env(safe-area-inset-bottom) + 0.75rem)',
        } as React.CSSProperties
      }
      className="tb-vp-bottom pointer-events-none fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom)+0.75rem)] z-50 flex justify-center px-4 lg:bottom-6"
    >
      <div className="tb-sheet-panel pointer-events-auto flex w-full max-w-[24rem] items-center gap-3 rounded-md bg-inverse px-4 py-3 text-body text-surface shadow-float">
        <span className="min-w-0 flex-1">새 버전이 있어요</span>
        <button
          type="button"
          data-testid="update-reload"
          onClick={() => {
            setNeedRefresh(false);
            void updateSW.current?.(true);
          }}
          className="shrink-0 rounded-xs px-2 py-1 text-label font-semibold text-surface underline decoration-surface/40 underline-offset-4 hover:decoration-surface"
        >
          새로고침
        </button>
      </div>
    </div>,
    document.body,
  );
}
