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
  /**
   * Escape는 **이 층에서 멈춘다** (M50, 헌터D2 #1).
   *
   * 전에는 버블 단계에서 듣고 흘려보냈으므로, 시트 위에 뜬 확인 대화상자에서
   * Escape를 한 번 누르면 대화상자와 **그 아래 시트가 함께** 닫혔다. 「정말
   * 지울까요?」에 「아니오」라고 답했을 뿐인데 하던 작업까지 사라진 셈이다.
   *
   * 캡처 단계에서 먼저 받고 `stopPropagation`으로 삼키면, 가장 위에 있는 것
   * 하나만 닫힌다 — `MapModal`이 같은 이유로 쓰는 바로 그 방법이다.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onCancel();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onCancel]);

  return createPortal(
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label={title}
      data-testid={testId}
      // Above every other layer (시트 z-50, 지도 모달/라이트박스 z-60): a
      // question is always the topmost thing on screen while it is being asked.
      className="fixed inset-0 z-70 flex items-center justify-center p-6"
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
