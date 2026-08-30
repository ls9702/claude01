/**
 * 호버 팝오버 자리 잡기 (M47) — pure geometry for the 메모 미리보기.
 *
 * A note popover has one job and one failure mode: it must appear beside the
 * thing you are pointing at, and it must never leave the window. The second half
 * is what makes this a function rather than three Tailwind classes — a card in
 * the rightmost board column and a block on the last day of the grid are both
 * flush against the right edge, and a popover that opens rightwards from there
 * is a popover nobody can read.
 *
 * So: prefer the right side, flip to the left when the right does not fit, and
 * clamp into the viewport either way. Pure, and unit-tested, because it is the
 * one part of a hover interaction that cannot be checked by hovering.
 */

/** A rectangle, in viewport coordinates — what `getBoundingClientRect` gives. */
export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface HoverPlacementInput {
  /** The card or block being pointed at. */
  anchor: Rect;
  /** The popover, already measured. */
  popover: { width: number; height: number };
  viewport: { width: number; height: number };
  /** Space between anchor and popover. */
  gap?: number;
  /** Closest the popover may come to a window edge. */
  margin?: number;
}

export interface HoverPlacement {
  left: number;
  top: number;
  /** Which side it ended up on — the arrow, and the specs, want to know. */
  side: 'right' | 'left';
}

/** Default gap between the anchor and the popover. */
export const HOVER_GAP_PX = 8;

/** Default distance kept from every window edge. */
export const HOVER_MARGIN_PX = 8;

/** Keeps `value` inside `[min, max]`, tolerating an inverted range. */
const clamp = (value: number, min: number, max: number): number =>
  max < min ? min : Math.min(Math.max(value, min), max);

/**
 * Where the popover goes.
 *
 * Vertically it starts level with the anchor's top — a note reads as belonging
 * to the row it is beside — and slides up only as far as it must to stay on
 * screen. Centring it on the anchor instead would make a two-line note next to
 * a tall card float in the middle of nothing.
 */
export function placeHoverPopover(input: HoverPlacementInput): HoverPlacement {
  const gap = input.gap ?? HOVER_GAP_PX;
  const margin = input.margin ?? HOVER_MARGIN_PX;
  const { anchor, popover, viewport } = input;

  const rightEdge = anchor.left + anchor.width;
  const rightLeft = rightEdge + gap;
  const leftLeft = anchor.left - gap - popover.width;

  // Right unless right does not fit; then left unless left does not fit either
  // (a narrow window with a wide card), in which case right is no worse and the
  // clamp below is what actually saves it.
  const fitsRight = rightLeft + popover.width + margin <= viewport.width;
  const fitsLeft = leftLeft >= margin;
  const side: 'right' | 'left' = fitsRight || !fitsLeft ? 'right' : 'left';

  const rawLeft = side === 'right' ? rightLeft : leftLeft;
  const left = clamp(rawLeft, margin, viewport.width - popover.width - margin);
  const top = clamp(anchor.top, margin, viewport.height - popover.height - margin);

  return { left, top, side };
}
