/**
 * Trip Board 디자인 시스템 — 클래스 레시피 단일 출처 (M9).
 *
 * 이 파일 밖에서 버튼/칩/입력의 색·크기를 직접 쓰지 않는다. 새 변종이 필요하면
 * 여기에 이름을 붙여 추가한다. (파일명은 import 호환을 위해 유지한다.)
 */

/* ── 버튼 ────────────────────────────────────────────── */
const BTN_BASE =
  'inline-flex items-center justify-center gap-1 rounded-md text-body font-semibold ' +
  'transition-colors duration-[140ms] ease-quick select-none ' +
  'outline-none focus-visible:ring-2 focus-visible:ring-line-strong focus-visible:ring-offset-2 ' +
  'focus-visible:ring-offset-surface disabled:cursor-not-allowed';

/** 44px 모바일 / 36px 데스크톱. 모든 버튼의 최소 높이. */
const BTN_SIZE = 'h-11 px-4 lg:h-9';

/** 칩·아이콘 버튼용 축소 사이즈. */
export const BTN_SIZE_SM = 'h-9 px-3 lg:h-8';

/**
 * 버튼 레시피의 사이즈만 갈아끼운다.
 *
 * `${SECONDARY_BUTTON_CLASS} ${BTN_SIZE_SM}` 처럼 뒤에 덧붙이면 두 높이가 한
 * 클래스 문자열 안에서 충돌하고, 승자는 CSS 출력 순서(=h-11)가 정한다. 치환은
 * 그 충돌 자체를 없앤다.
 */
export const withBtnSize = (recipe: string, size: string): string =>
  recipe.replace(BTN_SIZE, size);

export const PRIMARY_BUTTON_CLASS =
  `${BTN_BASE} ${BTN_SIZE} bg-inverse text-surface shadow-raise ` +
  'hover:brightness-125 active:brightness-95 ' +
  'disabled:bg-sunken disabled:text-ink-faint disabled:shadow-none ' +
  'disabled:border disabled:border-dashed disabled:border-line';

export const SECONDARY_BUTTON_CLASS =
  `${BTN_BASE} ${BTN_SIZE} border border-line bg-surface text-ink ` +
  'hover:border-line-strong hover:bg-sunken ' +
  'disabled:border-line disabled:bg-surface disabled:text-ink-faint';

/** 예전 GHOST_BUTTON_CLASS 이름을 유지한다 (import 깨짐 방지). */
export const GHOST_BUTTON_CLASS =
  `${BTN_BASE} ${BTN_SIZE} font-medium text-ink-muted ` +
  'hover:bg-sunken hover:text-ink disabled:text-ink-faint disabled:hover:bg-transparent';

/** 파괴적 — 트리거(시트 푸터, 메뉴). 컨테이너가 **있다**. */
export const DANGER_TEXT_BUTTON_CLASS =
  `${BTN_BASE} ${BTN_SIZE} text-danger hover:bg-danger-wash disabled:text-ink-faint`;

/** 파괴적 — 확인(ConfirmDialog의 accept 하나뿐). */
export const DANGER_SOLID_BUTTON_CLASS =
  `${BTN_BASE} ${BTN_SIZE} bg-danger text-surface hover:brightness-110`;

/** 아이콘 전용 버튼(닫기, ⋯, 스크롤 화살표). 터치 44px는 호출부에서 확보한다. */
export const ICON_BUTTON_CLASS =
  'inline-grid h-9 w-9 shrink-0 place-items-center rounded-full text-ink-faint ' +
  'transition-colors duration-[140ms] ease-quick outline-none ' +
  'hover:bg-sunken hover:text-ink focus-visible:ring-2 focus-visible:ring-line-strong ' +
  'disabled:text-ink-faint disabled:hover:bg-transparent';

/* ── 칩 ──────────────────────────────────────────────── */
export const CHIP_BASE =
  'inline-flex h-6 max-w-full shrink-0 items-center gap-1 rounded-full px-2 ' +
  'text-micro tabular-nums transition-colors duration-[140ms] ease-quick';

export const CHIP_NEUTRAL = `${CHIP_BASE} bg-sunken text-ink-muted`;
/** 지출 전용 — 앰버 wash. 예산은 중립이다. */
export const CHIP_MONEY = `${CHIP_BASE} bg-warn-wash text-warn-ink`;
/** 오늘/지금 전용 — 화면에서 코랄은 이것과 now-line 둘뿐. */
export const CHIP_NOW = `${CHIP_BASE} bg-now text-surface`;

/** 누를 수 있는 칩(필터·세그먼트). 터치 타깃 h-9. */
const CHIP_PRESSABLE = `${CHIP_BASE} h-9 px-3 lg:h-8`;

export const CHIP_BUTTON = `${CHIP_PRESSABLE} bg-sunken text-ink-muted hover:bg-line`;
export const CHIP_SELECTED = `${CHIP_PRESSABLE} bg-inverse text-surface`;
/** 이미 sunken 위에 올라간 칩(세그먼트 컨트롤 안) — 바탕을 한 겹 더 깔지 않는다. */
export const CHIP_BUTTON_QUIET = `${CHIP_PRESSABLE} text-ink-muted hover:bg-sunken`;
/** 칩 줄 안의 파괴적 액션(위치 제거). */
export const CHIP_BUTTON_DANGER = `${CHIP_PRESSABLE} text-danger hover:bg-danger-wash`;

/* ── 입력 ────────────────────────────────────────────── */
export const LABEL_CLASS = 'block text-label font-medium text-ink-muted';

/**
 * 섹션 제목 — 필드 라벨과 절대 같은 활자를 쓰지 않는다 (S1).
 *
 * 라벨보다는 무겁고 시트 헤더(`text-title`)보다는 가볍다. 같은 크기를 쓰면
 * 시트 안의 섹션이 시트 제목과 동급으로 읽힌다.
 */
export const SECTION_TITLE_CLASS = 'text-label font-semibold text-ink';

export const INPUT_CLASS =
  'mt-2 h-11 w-full rounded-md border border-line bg-surface px-3 text-body text-ink ' +
  'outline-none transition-colors duration-[140ms] ease-quick ' +
  'placeholder:text-ink-faint ' +
  'hover:border-line-strong focus:border-ink focus:ring-2 focus:ring-line ' +
  'disabled:bg-sunken disabled:text-ink-faint';

/** textarea. 높이는 rows가 정한다. */
export const TEXTAREA_CLASS = `${INPUT_CLASS.replace('h-11 ', '')} resize-none py-2`;

/* ── 표면 ────────────────────────────────────────────── */
export const CARD_SURFACE_CLASS = 'rounded-lg border border-line bg-surface shadow-raise';

export const INSET_CLASS = 'rounded-md bg-sunken px-3 py-2';

/** 팝오버 — 일정 배지 · 지출 칩 · 일자 메뉴 · 시트 메뉴가 전부 이 모양이다. */
export const POPOVER_CLASS =
  'absolute z-40 mt-1 min-w-36 overflow-hidden rounded-lg border border-line ' +
  'bg-surface py-1 shadow-float';

export const POPOVER_ROW_CLASS =
  'flex w-full items-center gap-2 px-3 py-2 text-left text-label text-ink hover:bg-sunken';

export const POPOVER_ROW_DANGER_CLASS =
  'flex w-full items-center gap-2 px-3 py-2 text-left text-label text-danger hover:bg-danger-wash';
