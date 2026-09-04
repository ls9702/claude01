import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { UNDO_DEFAULT_MS, useUndoStore } from '../../stores/undoStore';

/**
 * Default lifetime of the toast (and therefore of the undo offer). Each offer
 * may override it — 삭제 asks for {@link UNDO_DESTRUCTIVE_MS}.
 */
export const UNDO_MS = UNDO_DEFAULT_MS;

/**
 * Bottom toast for the single-slot undo. Mounted once by the app shell; it
 * renders nothing while no action is pending.
 *
 * Sits above the tab bar on mobile (`bottom-20`) and at the bottom on desktop.
 */
export default function UndoToast() {
  const current = useUndoStore((s) => s.current);
  const runUndo = useUndoStore((s) => s.runUndo);
  const clear = useUndoStore((s) => s.clear);

  const token = current?.token;
  const durationMs = current?.durationMs ?? UNDO_MS;

  useEffect(() => {
    if (token == null) return;
    const timer = window.setTimeout(clear, durationMs);
    return () => window.clearTimeout(timer);
  }, [token, durationMs, clear]);

  if (!current) return null;

  return createPortal(
    <div
      role="status"
      data-testid="undo-toast"
      data-duration={durationMs}
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
        <span data-testid="undo-message" className="min-w-0 flex-1 truncate">
          {current.message}
        </span>
        {/* A notice (`undo: null`) is the same strip without the button — see
            `undoStore.notify`. */}
        {current.undo ? (
          <button
            type="button"
            data-testid="undo-action"
            onClick={runUndo}
            // M19 — 27px였다. 되돌리기는 5초 안에 눌러야 하는 버튼이라 작을수록
            // 손해다: 글자 크기는 그대로 두고 위아래로 눌러 44px을 만든다.
            className="-my-2 inline-flex min-h-11 shrink-0 items-center rounded-xs px-2 py-1 text-label font-semibold text-surface underline decoration-surface/40 underline-offset-4 hover:decoration-surface"
          >
            실행 취소
          </button>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
