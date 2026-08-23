import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface ConfirmDialogProps {
  title: string;
  /** Body copy — usually spells out what else gets removed. */
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button; `false` renders the neutral one. */
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  testId?: string;
}

/**
 * Centered yes/no dialog. Mount it only while it should be visible.
 */
export default function ConfirmDialog({
  title,
  description,
  confirmLabel = '삭제',
  cancelLabel = '취소',
  danger = true,
  onConfirm,
  onCancel,
  testId = 'confirm-dialog',
}: ConfirmDialogProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return createPortal(
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label={title}
      data-testid={testId}
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
    >
      <button
        type="button"
        aria-label="취소"
        onClick={onCancel}
        className="absolute inset-0 h-full w-full cursor-default bg-stone-900/40"
      />
      <div className="tb-sheet-panel relative w-full max-w-xs rounded-2xl bg-white p-5 shadow-2xl">
        <h2 className="text-base font-semibold text-stone-800">{title}</h2>
        {description ? (
          <div className="mt-2 text-sm leading-relaxed text-stone-500">{description}</div>
        ) : null}
        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            data-testid="confirm-cancel"
            className="flex-1 rounded-xl bg-stone-100 px-4 py-2.5 text-sm font-medium text-stone-600 hover:bg-stone-200"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            data-testid="confirm-accept"
            className={[
              'flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold text-white',
              danger ? 'bg-rose-500 hover:bg-rose-600' : 'bg-stone-800 hover:bg-stone-900',
            ].join(' ')}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
