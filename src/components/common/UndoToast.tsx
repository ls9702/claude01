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
      className="pointer-events-none fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom)+0.75rem)] z-50 flex justify-center px-4 lg:bottom-6"
    >
      <div className="tb-sheet-panel pointer-events-auto flex w-full max-w-[24rem] items-center gap-3 rounded-md bg-inverse px-4 py-3 text-body text-surface shadow-float">
        <span data-testid="undo-message" className="min-w-0 flex-1 truncate">
          {current.message}
        </span>
        <button
          type="button"
          data-testid="undo-action"
          onClick={runUndo}
          className="shrink-0 rounded-xs px-2 py-1 text-label font-semibold text-surface underline decoration-surface/40 underline-offset-4 hover:decoration-surface"
        >
          실행 취소
        </button>
      </div>
    </div>,
    document.body,
  );
}
