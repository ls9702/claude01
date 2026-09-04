/**
 * 드로우 편집기의 고정 목록들 (M52a) — 데이터뿐, 로직 없음.
 *
 * `gourmet/userGenres.ts`가 그런 것처럼 화면 밖에 있다: 색 여섯이 무엇인지·
 * 스티커가 무엇인지는 컴포넌트의 사정이 아니라 이 앱의 사정이고, 여기 있으면
 * 시험도 다음 회차의 교체도 한 곳에서 끝난다.
 */

import type { IconName } from '../components/common/Icon';

/** 페이지의 로컬 좌표계 — 4000×4000 고정. */
export const DRAW_PAGE_SIZE = 4000;

/** 뷰 배율의 상·하한. 아래로는 페이지 전체가 보이고 위로는 획 하나가 두껍다. */
export const DRAW_MIN_SCALE = 0.15;
export const DRAW_MAX_SCALE = 6;

/** 도구 하나. `select`·`eraser`·`hand`는 그리지 않고 만진다. */
export type DrawTool =
  | 'pen'
  | 'highlight'
  | 'eraser'
  | 'select'
  | 'line'
  | 'arrow'
  | 'rect'
  | 'ellipse'
  | 'text'
  | 'sticker'
  | 'hand';

export interface DrawToolSpec {
  id: DrawTool;
  label: string;
  icon: IconName;
}

/** 도구 바에 서는 순서 — 자주 쓰는 것이 앞이다. */
export const DRAW_TOOLS: readonly DrawToolSpec[] = [
  { id: 'pen', label: '펜', icon: 'pencil' },
  { id: 'highlight', label: '형광펜', icon: 'highlighter' },
  { id: 'eraser', label: '지우개', icon: 'eraser' },
  { id: 'select', label: '선택', icon: 'drag' },
  { id: 'line', label: '직선', icon: 'line' },
  { id: 'arrow', label: '화살표', icon: 'arrow' },
  { id: 'rect', label: '사각형', icon: 'square' },
  { id: 'ellipse', label: '타원', icon: 'circle' },
  { id: 'text', label: '글자', icon: 'text' },
  { id: 'sticker', label: '스티커', icon: 'sticker' },
  { id: 'hand', label: '손', icon: 'hand' },
];

/**
 * 색 여섯.
 *
 * 디자인 시스템의 토큰(`--color-ink` 등)이 아니라 **날 hex**인 이유는 이 값이
 * 데이터로 저장되기 때문이다: 토큰 이름을 저장하면 다음 회차에 팔레트를 손대는
 * 순간 작년에 그린 그림의 색이 바뀐다. 화면의 잉크와 같은 값에서 시작하되,
 * 저장되는 것은 언제나 그때 고른 색 자신이다.
 */
export const DRAW_COLORS: readonly { value: string; label: string }[] = [
  { value: '#3d3a36', label: '먹' },
  { value: '#d64545', label: '빨강' },
  { value: '#e08b2f', label: '주황' },
  { value: '#2f9e5f', label: '초록' },
  { value: '#2f74d0', label: '파랑' },
  { value: '#8b5cf6', label: '보라' },
];

/** 굵기 세 단. 형광펜은 이 값을 {@link HIGHLIGHT_WIDTH_FACTOR}배 해서 쓴다. */
export const DRAW_WIDTHS: readonly { value: number; label: string }[] = [
  { value: 2, label: '얇게' },
  { value: 4, label: '보통' },
  { value: 8, label: '굵게' },
];

/**
 * 형광펜은 같은 굵기 단계에서도 훨씬 두껍다 — 그것이 형광펜이다.
 *
 * 굵기를 저장할 때 미리 곱해 두는 이유는 맞힘 판정(`draw/geometry`) 때문이다:
 * 화면에서만 두꺼우면 보이는 것보다 좁은 자리에서만 지워진다.
 */
export const HIGHLIGHT_WIDTH_FACTOR = 4;

/** 형광펜의 불투명도 — 밑의 그림이 비쳐야 형광펜이다. */
export const HIGHLIGHT_OPACITY = 0.35;

/** 글자 크기 두 단(스티커와 같은 결). */
export const DRAW_TEXT_SIZES: readonly { value: number; label: string }[] = [
  { value: 24, label: '작게' },
  { value: 48, label: '크게' },
];

/** 스티커 크기 두 단. */
export const DRAW_STICKER_SIZES: readonly { value: number; label: string }[] = [
  { value: 48, label: '작게' },
  { value: 96, label: '크게' },
];

/**
 * 스티커 24종 — 여행 브레인스토밍에서 실제로 쓰는 것들.
 *
 * 이모지 고르기를 통째로 열어 주지 않는 이유는 그것이 다른 물건이기 때문이다:
 * 여기서 필요한 것은 「여기 좋아」·「밥」·「사진」 스물몇 개이고, 검색창이 붙는
 * 순간 이 도구는 스티커 붙이기가 아니라 이모지 고르기가 된다.
 */
export const DRAW_STICKERS: readonly string[] = [
  '📍',
  '⭐',
  '❤️',
  '👍',
  '🔥',
  '✅',
  '❓',
  '❗',
  '🍜',
  '🍣',
  '🍰',
  '☕',
  '🍺',
  '🏨',
  '🚃',
  '✈️',
  '🚗',
  '🎡',
  '⛩️',
  '🏯',
  '🛍️',
  '📷',
  '💰',
  '☀️',
];
