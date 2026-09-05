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

/* ── 컬러 보드 (M53-2) ──────────────────────────────── */

/**
 * hex 하나를 저장될 모양으로 — 소문자 `#rrggbb`. 아니면 `null`.
 *
 * 대소문자를 그대로 두면 **「최근 색」이 같은 색을 둘로 센다**(`#FF0000`과
 * `#ff0000`). 세 자리(`#f00`)를 펴는 것도 같은 이유다 — `<input type="color">`는
 * 여섯 자리를 주지만 사람이 손으로 적은 값·옛 데이터가 세 자리일 수 있다.
 *
 * 잘못된 값에 기본색을 돌려주지 않고 `null`을 주는 이유는 부르는 쪽마다 기본이
 * 다르기 때문이다(획의 색은 먹, 채우기는 「없음」).
 */
export function normalizeHex(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/.exec(value.trim().toLowerCase());
  if (!match) return null;
  const body = match[1];
  const full =
    body.length === 3
      ? body
          .split('')
          .map((ch) => ch + ch)
          .join('')
      : body;
  return `#${full}`;
}

/** 색조 하나 — 밝게·기본·진하게 셋. 기본 다섯은 {@link DRAW_COLORS}와 값이 같다. */
const PALETTE_HUES: readonly { name: string; shades: readonly [string, string, string] }[] = [
  { name: '빨강', shades: ['#f2a1a1', '#d64545', '#8f2b2b'] },
  { name: '주황', shades: ['#f2c48a', '#e08b2f', '#96591a'] },
  { name: '노랑', shades: ['#f6de8a', '#e3bc2f', '#94781a'] },
  { name: '연두', shades: ['#c3e29a', '#86bf45', '#4f7a24'] },
  { name: '초록', shades: ['#93d3ae', '#2f9e5f', '#1c6339'] },
  { name: '청록', shades: ['#8fd6d0', '#2f9e97', '#1c625e'] },
  { name: '하늘', shades: ['#9ccdf0', '#3fa2dd', '#1f6a94'] },
  { name: '파랑', shades: ['#9dbdec', '#2f74d0', '#1c4886'] },
  { name: '남색', shades: ['#a0a6dd', '#4550b8', '#2a3170'] },
  { name: '보라', shades: ['#c4aef9', '#8b5cf6', '#5b34ad'] },
  { name: '자주', shades: ['#dba6e0', '#a844b3', '#6d2874'] },
  { name: '분홍', shades: ['#f4a8c6', '#e05288', '#932f56'] },
];

/** 무채색 다섯 — 먹은 {@link DRAW_COLORS}의 첫 색과 같은 값이다. */
const PALETTE_NEUTRALS: readonly { value: string; label: string }[] = [
  { value: '#ffffff', label: '흰색' },
  { value: '#c9c3ba', label: '연회색' },
  { value: '#9a948b', label: '회색' },
  { value: '#6b665f', label: '진회색' },
  { value: '#3d3a36', label: '먹' },
];

const SHADE_LABELS = ['밝게', '', '진하게'] as const;

/**
 * 색 시트의 팔레트 (M53-2) — 12색조 × 3명도 + 무채색 5 = **41색**.
 *
 * 도구 바의 여섯은 그대로 남는다(근육 기억). 이 표는 그 뒤의 「⋯」이 여는 서랍이고,
 * 여섯 색은 여기서도 **같은 값**으로 한 번씩 나온다 — 같은 빨강이 두 값이면
 * 「최근 색」과 선택 표시가 서로 어긋난다.
 */
export const DRAW_PALETTE: readonly { value: string; label: string }[] = [
  ...PALETTE_HUES.flatMap((hue) =>
    hue.shades.map((value, index) => ({
      value,
      label: `${hue.name} ${SHADE_LABELS[index]}`.trim(),
    })),
  ),
  ...PALETTE_NEUTRALS,
];

/** 「최근 색」이 기억하는 개수 — 한 줄에 들어가는 만큼. */
export const DRAW_RECENT_COLORS = 8;

/* ── 격자·종이 (M53-2, #5) ──────────────────────────── */

/** 스냅이 붙는 격자 한 칸(로컬 px). */
export const DRAW_GRID = 8;

/** 종이 무늬 한 칸 — 격자 넷이 한 칸이다(8px 무늬는 4000×4000에서 잿빛이 된다). */
export const DRAW_PAPER_CELL = DRAW_GRID * 4;

/** 종이 세 가지. `plain`이 기본이고, 저장되지 않는다(없음 = 무지). */
export const DRAW_PAPERS: readonly { value: 'plain' | 'grid' | 'dot'; label: string }[] = [
  { value: 'plain', label: '무지' },
  { value: 'grid', label: '모눈' },
  { value: 'dot', label: '점' },
];

/* ── 지우개 크기 (M53-2, #11) ───────────────────────── */

/**
 * 지우개의 세 단 — **굵기 선택을 지우개에서 다시 읽은 것**이다.
 *
 * 도구마다 따로 상태를 두지 않는 이유는 손이 하나이기 때문이다: 「굵게」를 골라
 * 두고 지우개로 바꾸면 굵게 지워지는 것이 사람이 기대하는 일이다. 값(화면 px)이
 * 굵기와 다른 것은 지우개가 「선」이 아니라 「닿는 넓이」이기 때문이다.
 */
export const DRAW_ERASER_SIZES: readonly { width: number; pad: number; label: string }[] = [
  { width: 2, pad: 6, label: '작게' },
  { width: 4, pad: 14, label: '보통' },
  { width: 8, pad: 28, label: '크게' },
];

/** 이 굵기에서 지우개가 닿는 반지름(화면 px) — 모르는 값은 가운데 단. */
export const eraserRadius = (width: number): number =>
  DRAW_ERASER_SIZES.find((step) => step.width === width)?.pad ?? DRAW_ERASER_SIZES[1].pad;

/* ── 붙인 사진 (M53-2, B2) ──────────────────────────── */

/**
 * 붙인 사진이 처음 차지하는 폭 — **보이는 화면의 60%**.
 *
 * `preparePhoto`가 주는 긴 변 1600px을 그대로 놓으면 사진 한 장이 화면을 다 덮고,
 * 그 순간 사람은 자기가 무엇을 붙였는지 볼 수 없다. 60%면 사진이 통째로 보이면서도
 * 둘레에 낙서할 자리가 남는다.
 */
export const DRAW_IMAGE_FIT = 0.6;

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

/* ── 배경 사진 (M52b) ──────────────────────────────── */

/**
 * 배경 투명도의 하한과 기본값.
 *
 * 0까지 내려가지 않는 이유는 **사라진 사진은 되돌릴 손잡이가 없기 때문**이다:
 * 0으로 내린 배경은 화면에서 완전히 없어지고, 그 상태에서 페이지를 닫으면 다음에
 * 열었을 때 「배경을 넣었던가?」가 된다. 0.2는 아직 보이는 가장 옅은 값이다.
 */
export const DRAW_BG_MIN_OPACITY = 0.2;
export const DRAW_BG_DEFAULT_OPACITY = 1;

/**
 * 붙인 사진에도 **같은 문**을 쓴다 (M53-fix ⑤).
 *
 * 요소의 투명도를 배경과 다른 규칙으로 두면 「배경은 안 사라지는데 붙인 사진은
 * 사라지는」 화면이 생긴다. 하한이 있어야 하는 이유는 그쪽이 더 크다: 요소는
 * 선택 테두리 말고는 자기가 거기 있다고 말할 방법이 없다.
 */

/** 저장되기 전에 한 번 지나는 문 — 0.2~1, 소수 둘째 자리까지. */
export function clampOpacity(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DRAW_BG_DEFAULT_OPACITY;
  const clamped = Math.min(1, Math.max(DRAW_BG_MIN_OPACITY, value));
  return Math.round(clamped * 100) / 100;
}

/**
 * 새로 여는 페이지가 보는 자리 (M53-fix ①).
 *
 * 4000×4000의 **왼쪽 위 구석은 아무것도 없는 자리**다. 페이지는 한가운데에서
 * 열려야 하고, 그러려면 뷰의 원점이 「페이지의 절반에서 화면의 절반을 뺀 곳」
 * 이어야 한다 — 그래야 페이지의 한가운데가 화면의 한가운데에 온다.
 *
 * 화면 크기를 **아직 모를 때**(0×0)의 답은 그냥 페이지의 한가운데다. 그 값은
 * 화면에 쓰이지 않는다: 크기를 재기 전의 뷰는 뷰가 아니라 자리채움이고, 그것을
 * 「지난 방문의 자리」로 적어 두었다가 다시 읽은 것이 M53-fix ①의 결함이었다.
 */
export function centeredView(
  width: number,
  height: number,
): { x: number; y: number; scale: number } {
  const half = DRAW_PAGE_SIZE / 2;
  const w = Number.isFinite(width) ? Math.max(0, width) : 0;
  const h = Number.isFinite(height) ? Math.max(0, height) : 0;
  return { x: half - w / 2, y: half - h / 2, scale: 1 };
}

/**
 * 글자 요소 하나의 상한 (M52a-fix ⑨).
 *
 * 붙여넣기 한 번이면 500자는 쉽게 넘고, 그 한 줄은 페이지를 가로지른 뒤 어디서도
 * 잡히지 않는다. 여기서 자르는 이유는 **저장되는 값**이 화면의 값과 같아야 하기
 * 때문이다.
 */
export const DRAW_TEXT_MAX = 500;

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
