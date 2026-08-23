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
      className="pointer-events-none fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom)+0.75rem)] z-50 flex justify-center px-4 lg:bottom-6"
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
