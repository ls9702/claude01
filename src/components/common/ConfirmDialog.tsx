import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  DANGER_SOLID_BUTTON_CLASS,
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
} from './formStyles';

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
 * Centered yes/no dialog — a sheet shrunk to one question (M9 §3.2).
 * Mount it only while it should be visible.
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
        className="tb-overlay absolute inset-0 h-full w-full cursor-default bg-ink/45 backdrop-blur-[2px]"
      />
      <div className="tb-sheet-panel relative w-full max-w-[20rem] rounded-lg bg-surface p-5 shadow-float">
        <h2 className="text-title text-ink">{title}</h2>
        {description ? (
          <div className="mt-2 text-label font-normal text-ink-muted">{description}</div>
        ) : null}
        <div className="mt-6 flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            data-testid="confirm-cancel"
            className={`flex-1 ${SECONDARY_BUTTON_CLASS}`}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            data-testid="confirm-accept"
            className={`flex-1 ${danger ? DANGER_SOLID_BUTTON_CLASS : PRIMARY_BUTTON_CLASS}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
