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
  | 'camera'
  | 'route'
  | 'drag'
  | 'sparkle'
  | 'chat'
  | 'copy'
  | 'gift'
  | 'locate'
  | 'expand'
  | 'shrink'
  | 'info'
  | 'lock'
  | 'upload'
  | 'palette'
  | 'eraser'
  | 'hand'
  | 'undo'
  | 'redo'
  | 'square'
  | 'circle'
  | 'line'
  | 'arrow'
  | 'text'
  | 'highlighter'
  | 'sticker';

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
  camera:
    'M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1ZM12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z',
  route: 'M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM18 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM18 9v3a4 4 0 0 1-4 4h-4a4 4 0 0 0-4 3',
  drag: 'M9 6h.01M9 12h.01M9 18h.01M15 6h.01M15 12h.01M15 18h.01',
  // AI 도우미 (M11). Two four-point stars rather than the usual ✨ emoji: the
  // rest of the chrome is stroked line art, and an emoji here would be the one
  // glyph in the set that ignores `currentColor`.
  sparkle:
    'M10 3l1.9 5.1L17 10l-5.1 1.9L10 17l-1.9-5.1L3 10l5.1-1.9L10 3ZM18 14l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9L18 14Z',
  // 메모 탭 (M21). A bubble with a tail, like `comment`, but with the three
  // dots of a conversation in it — the tab is a thread, not one note, and the
  // two glyphs have to be told apart at 24px in a five-cell tab row.
  chat:
    'M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-7l-4.5 3.5V15H6a2 2 0 0 1-2-2V6ZM9 9.5h.01M12 9.5h.01M15 9.5h.01',
  // 시트 복제 (M40). 두 장의 종이가 반쯤 겹친 자리 — 「하나를 둘로」를 이보다
  // 짧게 말하는 그림이 없다.
  copy: 'M9 9a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2V9ZM5 15H4a1 1 0 0 1-1-1V5a2 2 0 0 1 2-2h9a1 1 0 0 1 1 1v1',
  // 새 소식 = 패치노트 (M40). 리본 두른 상자 — 종(알림)은 재촉하는 물건이라
  // 이 조용한 배지와 어울리지 않고, ✨는 이미 AI 것이다.
  gift: 'M3 11h18M4 11v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8M3 8h18v3H3zM12 8v12M12 8C11 5 9.5 4 8.5 4a2 2 0 0 0 0 4H12ZM12 8c1-3 2.5-4 3.5-4a2 2 0 0 1 0 4H12Z',
  // 내 위치 (M42). 조준선 — 지도 앱들이 쓰는 그 그림이라 설명이 필요 없다.
  // `pin`과 헷갈릴 수 없는 것도 중요하다: 핀은 「저기 어딘가」고, 이건 「나」다.
  locate: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10ZM12 2v3M12 19v3M2 12h3M19 12h3',
  // 지도 최대화 / 복귀 (M45). 네 모서리의 꺾쇠 — 바깥을 향하면 「화면 가득」,
  // 안을 향하면 「원래대로」다. 화살표를 쓰지 않는 이유는 이 화면에서 화살표가
  // 이미 동선(`route`)과 페이저의 것이기 때문이다.
  expand: 'M9 4H4v5M15 4h5v5M15 20h5v-5M9 20H4v-5',
  shrink: 'M4 9h5V4M20 9h-5V4M20 15h-5v5M4 15h5v5',
  // 공지 (M47). 알림 아이콘이 아니라 안내 아이콘이다 — 종은 재촉하고, 이건
  // 「읽어 두세요」다. `alert`(경고 삼각형)와는 톤이 정반대라 나란히 둬도 섞이지
  // 않는다.
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 11v5M12 7.6h.01',
  // 보관된 세션 = 읽기 전용 (M47). 자물쇠는 「잠겼다」를 말하는 유일한 그림이다.
  lock: 'M7 10V7a5 5 0 0 1 10 0v3M5.5 10h13v10.5h-13z',
  // 사진 보관 (M46). 상자로 들어가는 화살표 — `package`(백업 상자)와 달리
  // 방향이 있고, `camera`와 달리 찍는 것이 아니라 보내는 것이다.
  upload: 'M12 15V3.5M8 7l4-4 4 4M4 15v4.5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V15',

  /* ── 드로우 (M52a) ──────────────────────────────────────────────────
     탭 아이콘은 **팔레트**다. 연필(`pencil`)은 이미 「고친다」의 뜻으로 카드
     편집·일정 수정 토글에 붙어 있어서, 탭 줄에 같은 글자를 하나 더 세우면
     여섯 칸 중 둘이 같은 말을 한다. 팔레트는 「그린다」만 말한다. */
  palette:
    'M12 3a9 9 0 0 0 0 18 1.6 1.6 0 0 0 1.2-2.7 1.6 1.6 0 0 1 1.2-2.7H16a5 5 0 0 0 5-5c0-4.1-4-7.6-9-7.6ZM8 9h.01M12 7h.01M16 10h.01M8.5 13.5h.01',
  // 지우개 — 기울어진 몸통과 그것이 지나간 바닥선.
  eraser: 'M8.5 19H21M4.5 15.5 12 8l5 5-6 6H7l-2.5-2.5a1 1 0 0 1 0-1.4Z',
  // 손 모드(드래그 팬). 손가락 넷과 엄지 — 지도 앱들이 쓰는 그 그림이다.
  hand: 'M7 12V6.5a1.5 1.5 0 0 1 3 0V11m0-.5V5.5a1.5 1.5 0 0 1 3 0V11m0-.5V6.5a1.5 1.5 0 0 1 3 0V13m0-2.5a1.5 1.5 0 0 1 3 0V16a5 5 0 0 1-5 5h-2a5 5 0 0 1-5-5v-3l-1.2-1.2a1.4 1.4 0 0 1 2-2L7 12',
  undo: 'M4 9h9a5 5 0 0 1 0 10H8M4 9l4-4M4 9l4 4',
  redo: 'M20 9h-9a5 5 0 0 0 0 10h5M20 9l-4-4M20 9l-4 4',
  square: 'M5 5h14v14H5z',
  circle: 'M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z',
  line: 'M5 19 19 5',
  arrow: 'M5 19 19 5M19 5h-6M19 5v6',
  // 「T」 — 글자 도구는 어느 앱에서나 이 글자다.
  text: 'M5 6V4.5h14V6M12 4.5V19.5M9 19.5h6',
  // 형광펜 — 굵은 촉과 그것이 남긴 두꺼운 자국.
  highlighter: 'M9 14l-2 4h4l1-2M9 14 16 5a2 2 0 0 1 3 2l-7 9-3-2ZM4 21h16',
  // 스티커 — 모서리가 접힌 종이 위의 웃는 얼굴.
  sticker:
    'M20 12a8 8 0 1 1-8-8c4.4 0 8 3.6 8 8Zm0 0h-4a4 4 0 0 0-4 4v4M9.5 9.5h.01M14.5 9.5h.01',
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
