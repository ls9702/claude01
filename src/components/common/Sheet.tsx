import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon';

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
 * Every sheet in the app has the **same four parts** (M9 §3.2): grabber (mobile
 * only), header, scrolling body with a bottom fade, and a footer. Nothing is
 * optional except the footer's contents — a sheet always has one explicit way
 * out, and the body never gets cut off without saying so.
 *
 * Rendered in a portal on `document.body` so it escapes the tab bar's stacking
 * context. Mount/unmount it (don't keep it mounted with an `open` flag) — the
 * slide-up animation and the form state both reset that way.
 */
export default function Sheet({ title, onClose, children, footer, testId }: SheetProps) {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [scrolled, setScrolled] = useState(false);
  /** Is there anything left below the fold? The fade lies unless we ask. */
  const [moreBelow, setMoreBelow] = useState(false);

  /**
   * A fade that is always on says "there is more" on a short sheet with
   * nothing under it, and keeps saying it after you have read the last line —
   * so it stops meaning anything (M9 §3.2). It shows only while the body can
   * actually scroll further.
   */
  const measureFade = useCallback(() => {
    const node = bodyRef.current;
    if (!node) return;
    const more = node.scrollHeight - node.scrollTop - node.clientHeight > 4;
    setMoreBelow((current) => (current === more ? current : more));
  }, []);

  // No dep array: the body's contents change with the form inside it (a chip
  // row folding a field open, a ledger gaining a row), and every one of those
  // changes the answer.
  useEffect(() => {
    measureFade();
    const node = bodyRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measureFade);
    observer.observe(node);
    if (node.firstElementChild) observer.observe(node.firstElementChild);
    return () => observer.disconnect();
  });

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
        className="tb-overlay absolute inset-0 h-full w-full cursor-default bg-ink/45 backdrop-blur-[2px]"
      />
      <div className="tb-sheet-panel relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-lg bg-surface shadow-float sm:max-w-[26rem] sm:rounded-lg lg:max-w-[32rem]">
        {/* Says "drag me" on a phone; pointless on a centered desktop card. */}
        <span aria-hidden="true" className="mx-auto mt-2 h-1 w-9 rounded-full bg-line sm:hidden" />

        <header
          data-scrolled={scrolled ? 'true' : 'false'}
          className={[
            'flex items-center justify-between gap-3 px-4 pb-3 pt-3 sm:pt-4',
            scrolled ? 'border-b border-line' : '',
          ].join(' ')}
        >
          <h2 className="min-w-0 truncate text-title text-ink">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            data-testid="sheet-close"
            aria-label="닫기"
            className="-mr-1 grid h-9 w-9 shrink-0 place-items-center rounded-full text-ink-faint transition-colors duration-[140ms] ease-quick hover:bg-sunken hover:text-ink"
          >
            <Icon name="close" size={20} />
          </button>
        </header>

        {/* A flex column, not a `h-full` child: a percentage height against a
            flex item is not reliably definite, and when it resolves to `auto`
            the body grows straight over the footer. */}
        <div className="relative flex min-h-0 flex-1 flex-col">
          <div
            ref={bodyRef}
            onScroll={(event) => {
              setScrolled(event.currentTarget.scrollTop > 2);
              measureFade();
            }}
            className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-1"
          >
            {children}
          </div>
          {/* Says "there is more below" so the body never just stops — and
              says nothing once there isn't. */}
          {moreBelow ? <span aria-hidden="true" className="tb-scroll-fade" /> : null}
        </div>

        <footer className="border-t border-line bg-surface px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:pb-3">
          {footer ?? (
            <button
              type="button"
              data-testid="sheet-done"
              onClick={onClose}
              className="inline-flex h-11 w-full items-center justify-center rounded-md bg-inverse text-body font-semibold text-surface shadow-raise transition-colors duration-[140ms] ease-quick hover:brightness-125 lg:h-9"
            >
              닫기
            </button>
          )}
        </footer>
      </div>
    </div>,
    document.body,
  );
}
