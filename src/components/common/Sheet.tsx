import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon';
import { raiseTapShield, watchPointerType } from './tapShield';

/** 그래버를 이만큼 끌어내리면 닫는다. */
const CLOSE_DRAG_PX = 80;

/**
 * 방금 열린 시트의 오버레이가 클릭을 무시하는 창 (M53-fix ③).
 *
 * 시트를 여는 손짓이 pointerdown이면, 브라우저는 그 뒤에 호환용 click을 하나 더
 * 쏜다 — 그때 시트는 이미 떠 있으므로 그 click은 오버레이(=닫기) 위에 떨어지고,
 * 사람에게는 「눌렀는데 아무 반응이 없다」로 보인다. 여는 손짓의 뒤끝은 열림
 * 애니메이션(240ms)보다 오래 걸리지 않으므로 그 창만 닫아 둔다 — 사람이 밖을
 * 눌러 닫는 일은 그보다 늦고, 그래서 「밖을 누르면 닫힌다」는 그대로 산다.
 */
const OVERLAY_GUARD_MS = 300;

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
  /** 이 시트가 열린 시각 — 오버레이의 300ms 가드가 본다. */
  const openedAt = useRef(Date.now());
  const [scrolled, setScrolled] = useState(false);
  /** Is there anything left below the fold? The fade lies unless we ask. */
  const [moreBelow, setMoreBelow] = useState(false);
  /** How far the grabber has been pulled down, in px. `0` = not dragging. */
  const [dragY, setDragY] = useState(0);

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

  /**
   * 닫히는 *모든* 길(닫기 버튼, 오버레이, Escape, 부모가 그냥 언마운트)을 한
   * 곳에서 잡을 수 있는 지점은 언마운트뿐이다. 그래서 방패는 여기서 올린다.
   *
   * 개발 모드의 StrictMode는 마운트 직후 한 번 언마운트했다가 다시 붙이는데,
   * 그건 사람이 시트를 닫은 게 아니다. 실제 닫기는 열림 애니메이션(240ms)보다
   * 빠를 수 없으므로, 방금 열린 시트의 언마운트는 방패 없이 넘긴다.
   */
  useEffect(() => {
    watchPointerType();
    const mountedAt = Date.now();
    return () => {
      if (Date.now() - mountedAt > 250) raiseTapShield();
    };
  }, []);

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

  /**
   * 그래버를 끌어내려 닫기 (모바일).
   *
   * 손잡이 위에서만 듣는다. 본문에 달면 스크롤과 싸우게 되고, 「밑으로 조금
   * 내렸을 뿐인데 시트가 닫힌다」가 된다. 손잡이는 원래 그것 말고 할 일이
   * 없으므로 `touch-action: none`이 정당한 유일한 자리이기도 하다.
   */
  const startGrabberDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const zone = event.currentTarget;
    const originY = event.clientY;
    let offset = 0;

    const onMove = (moveEvent: PointerEvent) => {
      // 위로 끄는 건 시트를 늘리는 동작이 아니다 — 0에서 멈춘다.
      offset = Math.max(0, moveEvent.clientY - originY);
      setDragY(offset);
    };
    const stop = () => {
      zone.removeEventListener('pointermove', onMove);
      zone.removeEventListener('pointerup', stop);
      zone.removeEventListener('pointercancel', stop);
      try {
        zone.releasePointerCapture(event.pointerId);
      } catch {
        /* the capture may already be gone */
      }
      setDragY(0);
      if (offset > CLOSE_DRAG_PX) onClose();
    };

    zone.setPointerCapture(event.pointerId);
    zone.addEventListener('pointermove', onMove);
    zone.addEventListener('pointerup', stop);
    zone.addEventListener('pointercancel', stop);
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      data-testid={testId}
      /* `tb-vp-fill` — 시트를 **가시 뷰포트**에 맞춘다 (M51). `inset-0`만으로는
         레이아웃 뷰포트가 늘어난 안드로이드에서 오른쪽 39px이 화면 밖으로 나가고
         (푸터의 저장 버튼이 안 보였다), 아래로도 밀려 나갔다. 규칙은
         `index.css`에 있고 `lg` 미만·`dvw`/`dvh` 지원 브라우저에서만 켜진다 —
         `inset-0`은 그대로 두어 나머지 환경의 동작을 산다. */
      className="tb-vp-fill fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4"
    >
      <button
        type="button"
        aria-label="닫기"
        data-testid="sheet-overlay"
        onClick={() => {
          // 열자마자 떨어지는 click은 여는 손짓의 뒤끝이지 「밖을 눌렀다」가
          // 아니다 (M53-fix ③).
          if (Date.now() - openedAt.current < OVERLAY_GUARD_MS) return;
          onClose();
        }}
        className="tb-overlay absolute inset-0 h-full w-full cursor-default bg-ink/45 backdrop-blur-[2px]"
      />
      <div
        style={dragY > 0 ? { transform: `translateY(${dragY}px)` } : undefined}
        className="tb-sheet-panel relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-lg bg-surface shadow-float sm:max-w-[26rem] sm:rounded-lg lg:max-w-[32rem]"
      >
        {/* Says "drag me" on a phone — and now means it. The bar is 4px tall,
            so the *zone* that listens is the padded row around it; pointless on
            a centered desktop card, which is why the pair is `sm:hidden`. */}
        <div
          data-testid="sheet-grabber"
          onPointerDown={startGrabberDrag}
          style={{ touchAction: 'none' }}
          className="flex shrink-0 cursor-grab justify-center py-2 sm:hidden"
        >
          <span aria-hidden="true" className="h-1 w-9 rounded-full bg-line" />
        </div>

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
