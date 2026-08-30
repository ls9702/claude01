import { useCallback, useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { placeHoverPopover, type HoverPlacement, type Rect } from '../../utils/hoverPopover';

/**
 * 메모 미리보기 (M47) — the note, beside the thing that has it, on hover.
 *
 * Boards fill up with cards whose interesting part is the 메모, and 일정 blocks
 * carry their own (M39). Both used to say "there is a note here" and make you
 * open a sheet to read it. On a desktop, where there is a pointer and there is
 * room, the note itself can simply appear.
 *
 * **Desktop only, and by capability rather than by width.** The gate is
 * `(hover: hover) and (pointer: fine)`: a touch screen fires `pointerenter` on
 * tap, so a popover keyed to hover would appear on every card you press and
 * then have to be dismissed. A phone plugged into a monitor with a mouse gets
 * it; a 1400px tablet does not. Nothing about the touch path changes — the
 * handlers are not even attached.
 *
 * The delay matters as much as the gate. Without it, dragging a card across a
 * board opens and closes a dozen popovers on the way; {@link HOVER_DELAY_MS}
 * is long enough that only a deliberate pause produces one.
 */

/** How long the pointer must rest before the note appears. */
export const HOVER_DELAY_MS = 300;

/** Widest the popover gets. Beyond this a note is a document, not a hint. */
const MAX_WIDTH_PX = 280;

/** The media query that decides whether this feature exists at all. */
export const HOVER_CAPABLE_QUERY = '(hover: hover) and (pointer: fine)';

export interface HoverNoteHandle {
  /** Spread onto the element the note belongs to. */
  anchorProps: {
    onPointerEnter?: (event: PointerEvent<HTMLElement>) => void;
    onPointerLeave?: () => void;
    onPointerDown?: () => void;
  };
  /** Render this anywhere; it portals itself. `null` when nothing is showing. */
  popover: React.ReactNode;
}

/**
 * Attaches a hover preview of `note` to whatever element takes `anchorProps`.
 *
 * The anchor is measured from the event rather than through a ref, so it
 * composes with elements that already have one — a dnd-kit draggable's
 * `setNodeRef`, for instance, which is most cards in this app.
 *
 * Placement is a two-pass affair: the popover is rendered invisible so the
 * browser can measure it, then a layout effect puts it where
 * {@link placeHoverPopover} says. One frame, no flicker, and no guessing at how
 * tall two lines of Korean wrap to.
 */
export function useHoverNote(note: string | undefined, testId: string): HoverNoteHandle {
  const capable = useMediaQuery(HOVER_CAPABLE_QUERY);
  const [anchor, setAnchor] = useState<Rect | null>(null);
  const [placement, setPlacement] = useState<HoverPlacement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  const text = note?.trim() ?? '';
  const enabled = capable && text !== '';

  const cancel = useCallback((): void => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    setAnchor(null);
    setPlacement(null);
  }, []);

  const onPointerEnter = useCallback(
    (event: PointerEvent<HTMLElement>): void => {
      // A pen or a mouse only. `pointerenter` also fires for touch on the tap
      // that opens the card, and a popover on top of the sheet that is opening
      // is nobody's idea of a preview.
      if (event.pointerType === 'touch') return;
      const rect = event.currentTarget.getBoundingClientRect();
      const box: Rect = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        setAnchor(box);
      }, HOVER_DELAY_MS);
    },
    [],
  );

  // Measured *after* the invisible first paint, so the height is the real
  // wrapped height rather than an estimate.
  useLayoutEffect(() => {
    if (!anchor) return;
    const node = popoverRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    setPlacement(
      placeHoverPopover({
        anchor,
        popover: { width: rect.width, height: rect.height },
        viewport: { width: window.innerWidth, height: window.innerHeight },
      }),
    );
  }, [anchor]);

  // A stray timer outliving the card it belonged to would open a popover
  // pointing at a rectangle that is no longer there.
  useLayoutEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  if (!enabled) return { anchorProps: {}, popover: null };

  const popover =
    anchor && typeof document !== 'undefined'
      ? createPortal(
          <div
            ref={popoverRef}
            data-testid={testId}
            data-side={placement?.side ?? 'right'}
            role="tooltip"
            style={{
              left: placement?.left ?? anchor.left,
              top: placement?.top ?? anchor.top,
              maxWidth: MAX_WIDTH_PX,
              // Invisible until placed — one frame, and never in the wrong spot.
              visibility: placement ? 'visible' : 'hidden',
            }}
            className="pointer-events-none fixed z-[55] whitespace-pre-wrap break-words rounded-md border border-line bg-surface px-3 py-2 text-label font-normal text-ink-muted shadow-float"
          >
            {text}
          </div>,
          document.body,
        )
      : null;

  return {
    anchorProps: {
      onPointerEnter,
      onPointerLeave: cancel,
      // Pressing means the user is doing something else now — dragging the
      // card, opening the sheet — and the preview has stopped being helpful.
      onPointerDown: cancel,
    },
    popover,
  };
}
