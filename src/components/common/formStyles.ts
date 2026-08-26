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

/* ── 레시피에서 유틸리티 걷어내기 ────────────────────── */

/**
 * 레시피에서 한 유틸리티 그룹을 통째로 걷어낸다.
 *
 * {@link withBtnSize}와 같은 이유로 존재한다: 클래스 문자열은 계단식이 아니라
 * *집합*이고, 같은 속성을 두 번 쓰면 승자를 정하는 건 뒤에 쓴 쪽이 아니라 CSS
 * 출력 순서다. `${INPUT_CLASS} w-28`의 실제 폭이 `w-full`인 것이 그 증거다.
 * 호출부가 값을 정하고 싶으면 먼저 레시피 쪽 값을 없앤다.
 *
 * 토큰 단위로 지우므로 문자열 위치나 앞뒤 공백을 가정하지 않고, `sm:`/`lg:`
 * 변종도 같이 걷힌다(`max-w-full`처럼 이름이 다른 유틸리티는 남는다).
 */
export const overrideClasses = (recipe: string, strip: RegExp): string =>
  recipe
    .split(/\s+/)
    .filter((token) => token !== '' && !strip.test(token))
    .join(' ');

/** `lg:px-4` 같은 변종까지 포함해 한 유틸리티 이름을 잡는 패턴. */
const utility = (name: string) => new RegExp(`^(?:[\\w.-]+:)*${name}-`);

const WIDTH = utility('w');
const HEIGHT = utility('h');
const PAD_X = utility('px');
const MARGIN_TOP = utility('mt');

/** 폭은 호출부가 정한다 — 레시피의 `w-*`를 걷어낸다. */
export const withoutWidth = (recipe: string): string => overrideClasses(recipe, WIDTH);

/** 높이는 호출부가 정한다 — 레시피의 `h-*`를 걷어낸다. */
export const withoutHeight = (recipe: string): string => overrideClasses(recipe, HEIGHT);

/** 좌우 패딩은 호출부가 정한다 — 아이콘 하나만 든 정사각 버튼 등. */
export const withoutPadX = (recipe: string): string => overrideClasses(recipe, PAD_X);

/** 위 여백은 호출부가 정한다 — 라벨 없이 줄 안에 놓이는 입력 등. */
export const withoutMarginTop = (recipe: string): string => overrideClasses(recipe, MARGIN_TOP);

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

/**
 * 정사각 아이콘 버튼 — 스테퍼의 ＋/－.
 *
 * 폭이 높이와 같고 좌우 패딩이 없다. `${SECONDARY_BUTTON_CLASS} px-0`으로는
 * 만들 수 없다: 레시피의 `px-4`가 CSS 출력 순서로 이겨서 44px 버튼이 옆으로
 * 퍼졌다. 그래서 패딩을 *덧쓰지* 않고 걷어낸다.
 */
export const SQUARE_BUTTON_CLASS = `${withoutPadX(SECONDARY_BUTTON_CLASS)} w-11 shrink-0`;

/**
 * 좁은 화면에서 라벨을 접고 정사각 아이콘으로 줄어드는 액션 버튼 (M18).
 *
 * 화면 제목은 **줄바꿈되지 않는다**. 그래서 한 줄이 모자라면 양보하는 쪽은
 * 언제나 버튼이다 — 「일정」이 「일 / 정」으로 쪼개진 실기기 스크린샷이 이
 * 레시피가 생긴 이유다.
 *
 * `sm` 아래에서 44×44 정사각(터치 타깃 유지), `sm` 위에서 라벨이 돌아온다.
 * 라벨을 감출 때 `aria-label`은 호출부의 **의무**다: 아이콘만 남은 버튼은
 * 스크린리더에게 이름이 없는 버튼이다.
 */
export const COMPACT_ACTION_BUTTON_CLASS =
  `${withoutPadX(SECONDARY_BUTTON_CLASS)} w-11 shrink-0 sm:w-auto sm:px-4`;

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
/** 오늘/지금 전용 — 화면에서 코랄은 이것과 now-line, 그리고 안 읽음 표시뿐. */
export const CHIP_NOW = `${CHIP_BASE} bg-now text-surface`;

/* ── 안 읽음 (M24) ───────────────────────────────────── */

/**
 * 코랄의 세 번째(이자 마지막) 쓰임 — 안 읽은 것이 있다는 표시.
 *
 * M9는 코랄을 「지금」 하나에만 허락했다. 여기에 하나를 더하는 이유는 안 읽은
 * 메시지가 정확히 같은 성질이기 때문이다: 화면에서 **지금 나를 기다리는** 유일한
 * 것이고, 눈이 가야만 제 일을 한다. 중립 칩으로 그리면 배지가 배지로 읽히지
 * 않고, 새 색을 하나 들이면 팔레트가 넷이 된다.
 */

/** 개수를 말하는 배지 — 탭의 안 읽은 메모 수. `9+`에서 멈춘다. */
export const UNREAD_BADGE_CLASS =
  'inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full px-1 ' +
  'bg-now text-micro tabular-nums text-surface';

/** 개수 없이 「새 것이 있다」만 말하는 점 — 보드 카드, 여행 목록. */
export const UNREAD_DOT_CLASS = 'inline-block h-2 w-2 shrink-0 rounded-full bg-now';

/**
 * 재촉하지 않는 개수 배지 — 「할 일 3」의 3 (M29).
 *
 * 위의 코랄 배지와 모양은 같고 색만 중립이다. 남은 할 일은 안 읽은 메시지와
 * 다르다: 상대가 방금 말을 걸어 **지금** 나를 기다리는 것이 아니라, 여행 전에
 * 언젠가 하면 되는 일이다. 코랄로 칠하면 화면에서 「지금」이라는 말이 하나 더
 * 늘어나 now-line과 안 읽음이 갖고 있던 뜻이 그만큼 묽어진다.
 */
export const COUNT_BADGE_CLASS =
  'inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full px-1 ' +
  'bg-sunken text-micro tabular-nums text-ink-muted';

/** 누를 수 있는 칩(필터·세그먼트). 터치 타깃 h-9. */
const CHIP_PRESSABLE = `${withoutPadX(withoutHeight(CHIP_BASE))} h-9 px-3 lg:h-8`;

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
export const TEXTAREA_CLASS = `${withoutHeight(INPUT_CLASS)} resize-none py-2`;

/** 줄 안에 놓이는 입력 — 폭과 위 여백을 호출부가 정한다(지출 입력 행 등). */
export const INLINE_INPUT_CLASS = withoutMarginTop(withoutWidth(INPUT_CLASS));

/* ── 표면 ────────────────────────────────────────────── */
export const CARD_SURFACE_CLASS = 'rounded-lg border border-line bg-surface shadow-raise';

export const INSET_CLASS = 'rounded-md bg-sunken px-3 py-2';

/** 팝오버 — 일정 배지 · 지출 칩 · 일자 메뉴 · 시트 메뉴가 전부 이 모양이다. */
export const POPOVER_CLASS =
  'absolute z-40 mt-1 min-w-36 overflow-hidden rounded-lg border border-line ' +
  'bg-surface py-1 shadow-float';

/**
 * 팝오버 한 줄. `min-h-11`은 장식이 아니다 (M19).
 *
 * 35px이던 시절 이 줄들은 M9가 모든 버튼에 요구한 44px 아래였다. 시트 메뉴의
 * 「시트 삭제」처럼 되돌리기 어려운 항목이 이 줄을 쓰는데, 줄이 얇으면 노려서
 * 누르기도 어렵고 옆줄을 잘못 누르기도 쉽다.
 */
export const POPOVER_ROW_CLASS =
  'flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-label text-ink hover:bg-sunken';

export const POPOVER_ROW_DANGER_CLASS =
  'flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-label text-danger ' +
  'hover:bg-danger-wash';
