import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../common/Icon';

interface MapModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Sticky action row at the bottom of the panel. */
  footer?: ReactNode;
  /** `panel` = centered card, `full` = edge-to-edge (the pin picker). */
  variant?: 'panel' | 'full';
  testId?: string;
}

/**
 * The modal the two location pickers sit in.
 *
 * It cannot be {@link ../common/Sheet}: both pickers open **on top of** the
 * card sheet, and `Sheet` closes itself on any Escape reaching `window`, which
 * would throw away the half-edited card underneath. This one listens in the
 * *capture* phase and stops the event there, so Escape closes exactly one
 * layer. It also sits a step higher (`z-60`) and, for `full`, lets its child
 * own the whole viewport so a map can fill it.
 */
export default function MapModal({
  title,
  onClose,
  children,
  footer,
  variant = 'panel',
  testId,
}: MapModalProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // Keep the card sheet underneath open — this layer swallows the key.
      event.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const full = variant === 'full';

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      data-testid={testId}
      className={[
        'fixed inset-0 z-60 flex justify-center',
        full ? 'items-stretch' : 'items-end sm:items-center sm:p-4',
      ].join(' ')}
    >
      <button
        type="button"
        aria-label="닫기"
        data-testid="map-modal-overlay"
        onClick={onClose}
        className="tb-overlay absolute inset-0 h-full w-full cursor-default bg-ink/45 backdrop-blur-[2px]"
      />
      <div
        className={[
          'tb-sheet-panel relative flex w-full flex-col overflow-hidden bg-surface shadow-float',
          full
            ? 'h-full'
            : 'max-h-[92dvh] rounded-t-lg sm:max-w-[26rem] sm:rounded-lg lg:max-w-[32rem]',
        ].join(' ')}
      >
        {full ? null : (
          <span aria-hidden="true" className="mx-auto mt-2 h-1 w-9 rounded-full bg-line sm:hidden" />
        )}

        <header className="flex items-center justify-between gap-3 px-4 pb-3 pt-3 sm:pt-4">
          <h2 className="min-w-0 truncate text-title text-ink">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            data-testid="map-modal-close"
            aria-label="닫기"
            className="-mr-1 grid h-9 w-9 shrink-0 place-items-center rounded-full text-ink-faint transition-colors duration-[140ms] ease-quick hover:bg-sunken hover:text-ink"
          >
            <Icon name="close" size={20} />
          </button>
        </header>

        <div className={full ? 'relative min-h-0 flex-1' : 'min-h-0 flex-1 overflow-y-auto px-4 pb-4'}>
          {children}
        </div>

        {footer ? (
          <footer className="border-t border-line bg-surface px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:pb-3">
            {footer}
          </footer>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
