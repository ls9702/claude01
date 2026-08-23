import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface SheetProps {
  /** Title rendered in the sticky header and used as the dialog label. */
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Sticky action row at the bottom of the panel. */
  footer?: ReactNode;
  testId?: string;
}

/**
 * Bottom sheet on mobile, centered modal from `sm` up.
 *
 * Rendered in a portal on `document.body` so it escapes the tab bar's stacking
 * context. Mount/unmount it (don't keep it mounted with an `open` flag) — the
 * slide-up animation and the form state both reset that way.
 */
export default function Sheet({ title, onClose, children, footer, testId }: SheetProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      data-testid={testId}
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4"
    >
      <button
        type="button"
        aria-label="닫기"
        data-testid="sheet-overlay"
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default bg-stone-900/40"
      />
      <div className="tb-sheet-panel relative flex max-h-[88dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:max-w-md sm:rounded-2xl">
        <header className="flex items-center justify-between gap-3 border-b border-stone-100 px-5 py-3.5">
          <h2 className="text-base font-semibold text-stone-800">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            data-testid="sheet-close"
            aria-label="닫기"
            className="-mr-2 rounded-full px-2 py-1 text-lg leading-none text-stone-400 hover:bg-stone-100 hover:text-stone-600"
          >
            ✕
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>

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
