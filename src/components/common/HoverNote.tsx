import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent,
  type TouchEvent as ReactTouchEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { placeHoverPopover, type HoverPlacement, type Rect } from '../../utils/hoverPopover';

/**
 * 메모 미리보기 (M47, M48) — the note, beside the thing that has it.
 *
 * Boards fill up with cards whose interesting part is the 메모, and 일정 blocks
 * carry their own (M39). Both used to say "there is a note here" and make you
 * open a sheet to read it. There are two ways to ask for it, and they share one
 * popover and one piece of state.
 *
 * ## 호버 (M47) — 데스크톱 전용, 폭이 아니라 **능력**으로 가른다
 *
 * The gate is `(hover: hover) and (pointer: fine)`: a touch screen fires
 * `pointerenter` on tap, so a popover keyed to hover would appear on every card
 * you press and then have to be dismissed. A phone plugged into a monitor with
 * a mouse gets it; a 1400px tablet does not.
 *
 * The delay matters as much as the gate. Without it, dragging a card across a
 * board opens and closes a dozen popovers on the way; {@link HOVER_DELAY_MS}
 * is long enough that only a deliberate pause produces one.
 *
 * ## 탭 (M48) — 포인터와 무관하게, **표식을 눌러서**
 *
 * A phone has no hover, and the card's own tap is already taken (it opens the
 * editor) as is the long press (it starts a drag). So the tap target is the
 * *mark* that says a note exists — the folded corner on a 일정 block, the memo
 * line on a board card — and nothing else moves. {@link HoverNoteHandle.markProps}
 * is what makes an element that target: it swallows the pointer/mouse/touch
 * trio the dnd sensors listen for (so a tap on the mark can never lift the
 * card) and its click toggles the popover.
 *
 * A tapped popover is **pinned**: it outlives the pointer leaving, and closes
 * on an outside press, on a scroll, on a resize, or on a second tap of the same
 * mark. Only one is ever open in the whole app ({@link openNote}) — hover and
 * tap are the same state, so hovering a card whose note is already pinned open
 * cannot produce a second copy of it.
 */

/** How long the pointer must rest before the note appears. */
export const HOVER_DELAY_MS = 300;

/** Widest the popover gets. Beyond this a note is a document, not a hint. */
const MAX_WIDTH_PX = 280;

/** The media query that decides whether the **hover** half exists at all. */
export const HOVER_CAPABLE_QUERY = '(hover: hover) and (pointer: fine)';

/**
 * 지금 열려 있는 팝오버를 닫는 함수, 앱을 통틀어 하나 (M48).
 *
 * 카드 스무 장이 각자 훅을 하나씩 들고 있으므로 「한 번에 하나」는 컴포넌트 안에서
 * 표현할 수 없다. 여는 쪽이 먼저 이 자리의 것을 닫고 자기를 적어 넣는다.
 */
let openNote: (() => void) | null = null;

/** Props that turn an element into the mark you tap to see the note (M48). */
export interface NoteMarkProps {
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  onMouseDown: (event: ReactMouseEvent<HTMLElement>) => void;
  onTouchStart: (event: ReactTouchEvent<HTMLElement>) => void;
  onClick: (event: ReactMouseEvent<HTMLElement>) => void;
  'aria-expanded': boolean;
}

export interface HoverNoteHandle {
  /** Spread onto the element the note belongs to. */
  anchorProps: {
    /** The rectangle the popover is placed against — see {@link NoteMarkProps}. */
    'data-note-anchor'?: string;
    onPointerEnter?: (event: PointerEvent<HTMLElement>) => void;
    onPointerLeave?: () => void;
    onPointerDown?: () => void;
  };
  /** Spread onto the 메모 표식 to make it a tap target (M48). */
  markProps: NoteMarkProps;
  /** Render this anywhere; it portals itself. `null` when nothing is showing. */
  popover: React.ReactNode;
}

/**
 * Attaches a preview of `note` — on hover, and on a tap of the mark.
 *
 * The anchor is measured from the event rather than through a ref, so it
 * composes with elements that already have one — a dnd-kit draggable's
 * `setNodeRef`, for instance, which is most cards in this app. The tap path
 * measures the same rectangle by walking up to `[data-note-anchor]`, which
 * {@link HoverNoteHandle.anchorProps} plants: the popover belongs beside the
 * **card**, not beside the 9px corner that was pressed.
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
  /** 탭으로 연 것인가 — 포인터가 떠나도 남고, 자기 위를 눌러 닫을 수 있다. */
  const [pinned, setPinned] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  /** Read by the stable callbacks, which must not close over a render's state. */
  const pinnedRef = useRef(false);
  const cancelRef = useRef<() => void>(() => {});
  const hasNoteRef = useRef(false);

  const text = note?.trim() ?? '';
  const hasNote = text !== '';
  hasNoteRef.current = hasNote;

  const cancel = useCallback((): void => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (openNote === cancelRef.current) openNote = null;
    pinnedRef.current = false;
    setPinned(false);
    setAnchor(null);
    setPlacement(null);
  }, []);
  cancelRef.current = cancel;

  const openAt = useCallback((box: Rect, pin: boolean): void => {
    // 뜨기를 기다리던 호버 타이머가 있으면 여기서 죽는다: 표식을 눌러 고정해 둔
    // 뒤 300ms가 지나 그것이 깨어나면 방금 고정한 것을 도로 풀어 버린다.
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    // 남의 것을 먼저 닫는다 — 화면에 메모 팝오버는 늘 하나다.
    if (openNote !== null && openNote !== cancelRef.current) openNote();
    openNote = cancelRef.current;
    pinnedRef.current = pin;
    setPinned(pin);
    setAnchor(box);
    // 새 자리를 재기 전까지는 숨어 있는다 (아래 layout effect).
    setPlacement(null);
  }, []);

  const onPointerEnter = useCallback(
    (event: PointerEvent<HTMLElement>): void => {
      // A pen or a mouse only. `pointerenter` also fires for touch on the tap
      // that opens the card, and a popover on top of the sheet that is opening
      // is nobody's idea of a preview.
      if (event.pointerType === 'touch') return;
      // 탭으로 고정해 둔 것을 호버가 슬그머니 풀지 않는다.
      if (pinnedRef.current) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const box: Rect = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        // 기다리는 300ms 사이에 표식을 눌러 고정했을 수 있다.
        if (pinnedRef.current) return;
        openAt(box, false);
      }, HOVER_DELAY_MS);
    },
    [openAt],
  );

  const onPointerLeave = useCallback((): void => {
    if (pinnedRef.current) return;
    cancel();
  }, [cancel]);

  /** 표식을 눌렀다 — 열려 있으면 닫고, 아니면 **고정으로** 연다 (M48). */
  const onMarkClick = useCallback(
    (event: ReactMouseEvent<HTMLElement>): void => {
      // The card's own click opens the editor and the block's opens the detail
      // sheet; a tap on the mark is neither.
      event.stopPropagation();
      if (pinnedRef.current) {
        cancel();
        return;
      }
      // 공백뿐인 메모는 표식이 남아 있어도 보여 줄 것이 없다 — 상태만 켜 놓고
      // 아무것도 그리지 않는 자리가 되지 않게 여기서 끝낸다.
      if (!hasNoteRef.current) return;
      const host = (event.currentTarget.closest('[data-note-anchor]') ??
        event.currentTarget) as HTMLElement;
      const rect = host.getBoundingClientRect();
      openAt({ left: rect.left, top: rect.top, width: rect.width, height: rect.height }, true);
    },
    [cancel, openAt],
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

  /**
   * 열려 있는 동안에만 사는 닫기 규칙 (M48).
   *
   * 바깥을 누르면·스크롤하면·창이 바뀌면 닫는다. 표식 자신의 `pointerdown`은
   * {@link NoteMarkProps}가 멈춰 세우므로 여기까지 올라오지 않는다 — 그래서 같은
   * 표식을 다시 누르는 것이 「닫고 곧바로 다시 열기」가 되지 않는다.
   */
  useEffect(() => {
    if (anchor === null) return;
    const close = (): void => cancelRef.current();
    /**
     * 팝오버 **자신을 누른 것**은 바깥 누르기가 아니다 (M50, 헌터A #3).
     *
     * 고정된 팝오버는 자기를 낳은 카드 위에 겹쳐 있고 `pointerEvents: auto`다.
     * 예전에는 그 위를 눌러도 이 리스너가 곧바로 닫아 버렸는데, 팝오버가
     * 사라진 뒤에 도착하는 `click`은 갈 곳을 잃고 **밑에 있던 카드**로
     * 다시 겨냥된다 — 메모를 닫으려던 탭이 카드 편집 시트를 열었다.
     *
     * 그래서 누르기는 여기서 무시하고, 닫는 일은 팝오버의 `onClick`이 맡는다:
     * 그때는 클릭이 이미 팝오버에게 배달된 뒤라 재겨냥될 것이 없다.
     */
    const onPointerDown = (event: Event): void => {
      const node = popoverRef.current;
      if (node && event.target instanceof Node && node.contains(event.target)) return;
      cancelRef.current();
    };
    window.addEventListener('pointerdown', onPointerDown);
    // 스크롤은 버블하지 않는다 — 그리드 안쪽에서 일어나므로 캡처로 듣는다.
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [anchor]);

  // A stray timer outliving the card it belonged to would open a popover
  // pointing at a rectangle that is no longer there — and the app-wide slot
  // would stay pointing at a component that is gone.
  useLayoutEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
      if (openNote === cancelRef.current) openNote = null;
    },
    [],
  );

  const markProps: NoteMarkProps = {
    // The board and the grid both drag with MouseSensor + TouchSensor, which
    // listen for `mousedown`/`touchstart`; the popover state watches
    // `pointerdown`. All three stop here.
    onPointerDown: (event) => event.stopPropagation(),
    onMouseDown: (event) => event.stopPropagation(),
    onTouchStart: (event) => event.stopPropagation(),
    onClick: onMarkClick,
    'aria-expanded': pinned,
  };

  if (!hasNote) return { anchorProps: {}, markProps, popover: null };

  const popover =
    anchor && typeof document !== 'undefined'
      ? createPortal(
          <div
            ref={popoverRef}
            data-testid={testId}
            data-side={placement?.side ?? 'right'}
            data-pinned={pinned ? 'true' : 'false'}
            role="tooltip"
            // 고정된 팝오버 위의 탭이 그것을 닫는 유일한 길 (M50). `click`이
            // 이 요소에 배달된 뒤에 닫으므로 밑의 카드로 새지 않고,
            // `stopPropagation`이 혹시 남은 버블 경로까지 막는다. 호버로 뜬
            // 것은 `pointerEvents: none`이라 여기 닿지 않는다.
            onClick={
              pinned
                ? (event) => {
                    event.stopPropagation();
                    cancel();
                  }
                : undefined
            }
            style={{
              left: placement?.left ?? anchor.left,
              top: placement?.top ?? anchor.top,
              maxWidth: MAX_WIDTH_PX,
              // Invisible until placed — one frame, and never in the wrong spot.
              visibility: placement ? 'visible' : 'hidden',
              // 호버 팝오버는 유리다: 밑에 있는 카드의 호버도 클릭도 막지 않는다.
              // 탭으로 연 것은 반대다 — 폰에서는 팝오버가 자기를 낳은 카드 위에
              // 겹치므로, 통과시키면 「닫으려는 탭」이 카드를 열어 버린다.
              pointerEvents: pinned ? 'auto' : 'none',
            }}
            className="fixed z-[55] whitespace-pre-wrap break-words rounded-md border border-line bg-surface px-3 py-2 text-label font-normal text-ink-muted shadow-float"
          >
            {text}
          </div>,
          document.body,
        )
      : null;

  return {
    anchorProps: {
      'data-note-anchor': '',
      ...(capable
        ? {
            onPointerEnter,
            onPointerLeave,
            // Pressing means the user is doing something else now — dragging
            // the card, opening the sheet — and the preview has stopped being
            // helpful.
            onPointerDown: cancel,
          }
        : {}),
    },
    markProps,
    popover,
  };
}
