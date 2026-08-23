/**
 * The app's only icon set — hand-drawn inline SVG, zero dependencies (M9 §3.7).
 *
 * Every glyph is a 24×24 stroke drawing on `currentColor` with a 1.5 stroke and
 * round caps, so an icon inherits the colour and optical weight of the text it
 * sits next to. Emoji survive in exactly two places, both of them *user data*
 * rather than chrome: a column's own `icon` field and the ✈️ prefix a flight
 * card's title carries.
 */

export type IconName =
  | 'luggage'
  | 'board'
  | 'calendar'
  | 'map'
  | 'plus'
  | 'minus'
  | 'more'
  | 'close'
  | 'chevron-left'
  | 'chevron-right'
  | 'chevron-up'
  | 'chevron-down'
  | 'clock'
  | 'wallet'
  | 'receipt'
  | 'pin'
  | 'link'
  | 'search'
  | 'trash'
  | 'pencil'
  | 'chart'
  | 'package'
  | 'check'
  | 'alert'
  | 'arrow-up-down'
  | 'comment'
  | 'route'
  | 'drag';

/** `name` → the path data drawn inside a `0 0 24 24` box. */
const PATHS: Record<IconName, string> = {
  luggage:
    'M6 8h12a1 1 0 0 1 1 1v9a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V9a1 1 0 0 1 1-1ZM9 8V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3M10 12v4M14 12v4',
  board: 'M4 5h16v14H4zM10 5v14M16 5v14',
  calendar: 'M4 6h16v14H4zM4 10h16M9 3v4M15 3v4',
  map: 'M9 4 3 6.5v13L9 17l6 3 6-2.5v-13L15 7 9 4ZM9 4v13M15 7v13',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  more: 'M6 12h.01M12 12h.01M18 12h.01',
  close: 'M6 6l12 12M18 6 6 18',
  'chevron-left': 'M15 5l-7 7 7 7',
  'chevron-right': 'M9 5l7 7-7 7',
  'chevron-up': 'M5 15l7-7 7 7',
  'chevron-down': 'M5 9l7 7 7-7',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3 2',
  wallet: 'M4 8a2 2 0 0 1 2-2h11a1 1 0 0 1 1 1v1M4 8v9a2 2 0 0 0 2 2h12a1 1 0 0 0 1-1v-3M4 8h14a1 1 0 0 1 1 1v3h-4a2 2 0 1 0 0 4h4',
  receipt: 'M6 3h12v18l-2.5-1.5L13 21l-2.5-1.5L8 21l-2-1.5V3ZM9 8h6M9 12h6',
  pin: 'M12 21s6-5.4 6-10a6 6 0 1 0-12 0c0 4.6 6 10 6 10ZM12 13a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
  link: 'M10 13a4 4 0 0 0 5.7.3l2.6-2.6a4 4 0 1 0-5.7-5.7L11.4 6M14 11a4 4 0 0 0-5.7-.3l-2.6 2.6a4 4 0 1 0 5.7 5.7L12.6 18',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-4-4',
  trash: 'M4 7h16M10 4h4M6 7l1 13h10l1-13M10 11v5M14 11v5',
  pencil: 'M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3ZM15 6l3 3',
  chart: 'M4 20h16M8 20V10M13 20V5M18 20v-7',
  package: 'M4 8l8-4 8 4v9l-8 4-8-4V8ZM4 8l8 4 8-4M12 12v9',
  check: 'M5 13l4 4L19 7',
  alert: 'M12 3 2 20h20L12 3ZM12 10v4M12 17h.01',
  'arrow-up-down': 'M8 4v16M8 4 5 7M8 4l3 3M16 20V4M16 20l3-3M16 20l-3-3',
  comment: 'M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H9l-4 4V6a1 1 0 0 1 1-1Z',
  route: 'M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM18 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM18 9v3a4 4 0 0 1-4 4h-4a4 4 0 0 0-4 3',
  drag: 'M9 6h.01M9 12h.01M9 18h.01M15 6h.01M15 12h.01M15 18h.01',
};

interface IconProps {
  name: IconName;
  /** Rendered size in px. 24 / 20 / 16 are the sanctioned steps. */
  size?: 16 | 20 | 24;
  className?: string;
  /** Accessible name; omit for decorative icons (the default). */
  label?: string;
}

/** One glyph from {@link PATHS}, coloured by `currentColor`. */
export default function Icon({ name, size = 20, className = '', label }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={label ? undefined : true}
      role={label ? 'img' : undefined}
      aria-label={label}
      className={`shrink-0 ${className}`}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

/**
 * A user-chosen emoji (column icon, flight prefix) on a neutral disc.
 *
 * Emoji have no shared baseline or optical weight, so the disc gives them one
 * and the 16px floor keeps them from dissolving the way 🍽️ did at 11px.
 */
export function EmojiIcon({
  emoji,
  className = '',
}: {
  emoji: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      // 16px is the floor at which an emoji still reads as a shape; there is no
      // type token for it because no *text* in this app is 16px.
      style={{ fontSize: 16, lineHeight: 1 }}
      className={`grid h-5 w-5 shrink-0 place-items-center rounded-full bg-sunken ${className}`}
    >
      {emoji}
    </span>
  );
}
