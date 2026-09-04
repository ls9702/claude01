import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface AnchoredMenuProps {
  /** The button the menu hangs from; `null` while it has not mounted yet. */
  anchor: HTMLElement | null;
  onClose: () => void;
  testId: string;
  /** Menu rows — usually `POPOVER_ROW_CLASS` buttons. */
  children: ReactNode;
}

/**
 * A popover that no ancestor can clip (M15 §1).
 *
 * The 시트 메뉴 used to be an `absolute` panel inside the chip strip, and the
 * strip is `overflow-x-auto` — which, per CSS, makes the *other* axis `auto`
 * too. The panel therefore hung 130px below a 36px-tall clipping box and was
 * simply not on screen: tapping ⋯ opened a menu nobody could see, so 시트 삭제
 * looked broken. (Playwright still passed, because `.click()` scrolls its
 * target into view before clicking; a finger does not.)
 *
 * So the panel leaves the strip entirely: it renders into `document.body`
 * through a portal and positions itself `fixed` against the anchor's rect,
 * clamped to the viewport and flipped above the anchor when there is no room
 * below. Nothing between it and the body can clip it any more.
 *
 * Dismissal lives here too, and deliberately: an outside-pointerdown handler
 * that does not know about the portal would close the menu *before* the click
 * on a row could land, which is the same bug wearing a different hat.
 */
export default function AnchoredMenu({ anchor, onClose, testId, children }: AnchoredMenuProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Measured after mount (the panel has to exist before it can be sized), and
  // again on scroll/resize so the menu never floats away from its button.
  useLayoutEffect(() => {
    const place = () => {
      const panel = panelRef.current;
      if (!panel || !anchor) return;
      const a = anchor.getBoundingClientRect();
      const p = panel.getBoundingClientRect();
      const margin = 8;
      const gap = 4;

      // Right-aligned with the button, then pulled back inside the viewport.
      let left = a.right - p.width;
      left = Math.min(left, window.innerWidth - p.width - margin);
      left = Math.max(left, margin);

      // Below the button, unless that would run off the bottom.
      let top = a.bottom + gap;
      if (top + p.height > window.innerHeight - margin) {
        const above = a.top - p.height - gap;
        top = above >= margin ? above : Math.max(window.innerHeight - p.height - margin, margin);
      }

      setPos((current) =>
        current && current.top === top && current.left === left ? current : { top, left },
      );
    };

    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [anchor]);

  useEffect(() => {
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target)) return;
      // The trigger toggles itself — closing here too would re-open instantly.
      if (anchor?.contains(target)) return;
      onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [anchor, onClose]);

  return createPortal(
    <div
      ref={panelRef}
      data-testid={testId}
      role="menu"
      // Above the sheets (z-50) and the map modal (z-60) — a menu is the thing
      // being used while it is open. `ConfirmDialog` portals in later and so
      // still paints over it.
      // `tb-vp-cap` — 가시 뷰포트보다 넓어지지 않는다 (M51). 자리는 JS가 앵커
      // 사각형으로 잡으므로 `dvh` 앵커는 필요 없고, 폭 상한만 둔다.
      className="tb-vp-cap fixed z-70 min-w-44 overflow-hidden rounded-lg border border-line bg-surface py-1 shadow-float"
      style={{
        top: pos?.top ?? 0,
        left: pos?.left ?? 0,
        // One frame of invisibility rather than one frame in the wrong corner.
        visibility: pos ? 'visible' : 'hidden',
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
