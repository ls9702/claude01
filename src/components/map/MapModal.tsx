import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

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
        className="absolute inset-0 h-full w-full cursor-default bg-stone-900/50"
      />
      <div
        className={[
          'tb-sheet-panel relative flex w-full flex-col overflow-hidden bg-white shadow-2xl',
          full ? 'h-full' : 'max-h-[88dvh] rounded-t-2xl sm:max-w-md sm:rounded-2xl',
        ].join(' ')}
      >
        <header className="flex items-center justify-between gap-3 border-b border-stone-100 px-5 py-3.5">
          <h2 className="text-base font-semibold text-stone-800">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            data-testid="map-modal-close"
            aria-label="닫기"
            className="-mr-2 rounded-full px-2 py-1 text-lg leading-none text-stone-400 hover:bg-stone-100 hover:text-stone-600"
          >
            ✕
          </button>
        </header>

        <div className={full ? 'relative min-h-0 flex-1' : 'flex-1 overflow-y-auto px-5 py-4'}>
          {children}
        </div>

        {footer ? (
          <footer className="border-t border-stone-100 px-5 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:pb-3">
            {footer}
          </footer>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
