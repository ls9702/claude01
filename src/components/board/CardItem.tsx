import { useEffect, useRef, useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { useHoverNote, type NoteMarkProps } from '../common/HoverNote';
import { useUiStore } from '../../stores/uiStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { DND_CARD } from '../../dnd/boardDnd';
import { isProfileId } from '../../profile/profile';
import type { SheetScheduleCount } from '../../timeline/scheduleSummary';
import type { Card } from '../../types/models';
import { colorClasses } from '../../utils/colors';
import { shortPlace } from '../../utils/geo';
import { isInAppHash } from '../../utils/url';
import { formatBudget } from '../../utils/money';
import { cardSpent } from '../../utils/spend';
import { formatDuration } from '../../utils/time';
import { isCardDone } from '../../todo/checklist';
import { USER_GENRE_EMOJI, USER_GENRE_LABEL, userGenreOf } from '../../gourmet/userGenres';
import Avatar from '../common/Avatar';
import Icon, { type IconName } from '../common/Icon';
import TodoCheck from '../common/TodoCheck';
import { CHIP_MONEY, CHIP_NEUTRAL, POPOVER_CLASS, UNREAD_BADGE_CLASS } from '../common/formStyles';

interface CardSurfaceProps {
  card: Card;
  /** Trip currency used to render the budget chip. */
  currency: string;
  /** Column color token — drives the left accent border. */
  color: string;
  /** Slight lift used by the drag overlay ghost. */
  lifted?: boolean;
  /**
   * How many timeline entries this card has, across every sheet. `0` hides the
   * badge — and stays the badge's `data-count`, whatever the breakdown says.
   */
  scheduledCount?: number;
  /**
   * Per-sheet split of {@link scheduledCount}. When present the badge becomes a
   * button that opens a read-only "일정 1: 2회" popover.
   */
  scheduleBreakdown?: readonly SheetScheduleCount[];
  /** Tray variant: title + one chip, no memo — a drag source needs no more. */
  terse?: boolean;
  /**
   * The other person has commented since this device's profile last opened the
   * card (M24) — draws the NEW dot. Skipped in the tray for the same reason
   * the author avatar is: a drag source is not a place one reads.
   */
  hasNewComments?: boolean;
  /**
   * 이 카드가 체크리스트 카테고리에 있는가 (M29) — 체크박스를 그릴지의 유일한
   * 조건. `card.doneAt`이 남아 있어도 칸이 체크리스트가 아니면 상자는 없다.
   */
  todo?: boolean;
  /**
   * 체크박스를 눌렀을 때. 없으면 상자는 **장식**이 된다 — `DragOverlay`의
   * 유령 카드처럼 누를 수 없는 사본이 쓰는 길이다.
   */
  onToggleDone?: () => void;
  /**
   * 메모 줄을 **누를 수 있게** 만드는 손잡이 (M48). 없으면 메모 줄은 예전 그대로
   * 읽기만 하는 한 줄이다 — 체크박스와 같은 규칙이고, 같은 이유(유령 카드)다.
   */
  noteMarkProps?: NoteMarkProps;
}

/** How many chips a card may show before the rest fold into `＋N`. */
const MAX_CHIPS = 3;

/**
 * The card's looks, with no drag wiring — shared by the sortable card and by
 * the `DragOverlay` ghost.
 *
 * Chips are **neutral** (M9 §2.1): the 3px left bar already says which category
 * this is, and repeating it four times in colour was what made 예산 and 지출
 * indistinguishable. The single exception is 지출 — money actually spent is the
 * one thing on a card that has to catch the eye.
 */
export function CardSurface({
  card,
  currency,
  color,
  lifted = false,
  scheduledCount = 0,
  scheduleBreakdown,
  terse = false,
  hasNewComments = false,
  todo = false,
  onToggleDone,
  noteMarkProps,
}: CardSurfaceProps) {
  const colors = colorClasses(color);
  // 트레이의 terse 카드는 끌기 위한 손잡이라 상자를 달지 않는다 — 아바타와
  // NEW가 같은 이유로 빠져 있는 자리다.
  const showCheck = todo && !terse;
  const done = showCheck && isCardDone(card);
  /**
   * 이 카드가 든 맛집 장르 (M49) — 모르는 값은 `null`이라 아무것도 그리지 않는다.
   *
   * 칸이 맛집 칸인지 **묻지 않는다**: 그건 픽커를 그릴지의 규칙이고
   * (`CardEditSheetProps.gourmet`), 카드를 옮겼다고 그 집이 라멘집이 아니게 되지는
   * 않는다 (`Card.doneAt`이 체크리스트 칸을 묻지 않는 것과 같은 결정). 트레이의
   * terse 카드에는 서지 않는다 — 거기 제목 줄은 끌기 위한 손잡이다.
   */
  const genre = terse ? null : userGenreOf(card.gourmetGenre);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const badgeRef = useRef<HTMLDivElement | null>(null);
  const hasBreakdown = (scheduleBreakdown?.length ?? 0) > 0;

  useEffect(() => {
    if (!popoverOpen) return;
    const onDown = (event: PointerEvent) => {
      if (!badgeRef.current?.contains(event.target as Node)) setPopoverOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [popoverOpen]);

  /**
   * 이 카드가 가리키는 드로우 페이지 (M52b) — 없거나 지워졌으면 `undefined`.
   *
   * 지워진 페이지를 가리키는 카드는 **조용히** 칩을 잃는다(필드는 남는다 —
   * {@link Card.drawPageId}). 「없는 페이지」라고 적힌 칩을 세워 두면 그것을
   * 누르는 사람이 생기고, 눌러도 아무 일이 없는 것이 가장 나쁜 답이다.
   */
  const linkedPage = useWorkspaceStore((state) =>
    card.drawPageId ? state.workspace.drawPages?.[card.drawPageId] : undefined,
  );
  const openDrawPage = useUiStore((state) => state.openDrawPage);

  const chips: {
    key: string;
    icon: IconName;
    text: string;
    title?: string;
    tone?: 'money';
    /** 누를 수 있는 칩(M52b의 🎨 하나뿐) — 트레이의 유령 카드에서는 무시된다. */
    onTap?: () => void;
  }[] = [];

  // Priority, most decision-worthy first: 지출 > 예산 > 소요시간 > 위치.
  // 💰 is the plan, 💸 is what it actually cost — they sit side by side on
  // purpose, so a card that ran over its budget says so at a glance.
  const spent = cardSpent(card);
  if (spent > 0) {
    chips.push({
      key: 'spent',
      icon: 'receipt',
      text: formatBudget(spent, currency),
      title: `지출 ${card.expenses?.length ?? 0}건`,
      tone: 'money',
    });
  }
  if (typeof card.budget === 'number' && Number.isFinite(card.budget)) {
    chips.push({ key: 'budget', icon: 'wallet', text: formatBudget(card.budget, currency) });
  }
  if (typeof card.defaultDurationMin === 'number' && card.defaultDurationMin > 0) {
    chips.push({ key: 'duration', icon: 'clock', text: formatDuration(card.defaultDurationMin) });
  }
  if (card.location?.address) {
    chips.push({
      key: 'location',
      icon: 'pin',
      // Display-only shortening; the stored address is untouched.
      text: shortPlace(card.location.address),
      title: card.location.address,
    });
  }
  // Last on purpose (M10): 사진 is the one chip that says nothing about the
  // *decision* to go, so it folds into ＋N first when a card is busy.
  const photoCount = card.photos?.length ?? 0;
  if (photoCount > 0) {
    chips.push({ key: 'photos', icon: 'camera', text: `${photoCount}장` });
  }
  // 🎨 (M52b) — 사진 칩과 같은 이유로 **맨 끝**이다: 「갈까 말까」에 답하지 않는
  // 칩이 먼저 접힌다. 누르면 그 페이지가 열린다(탭+페이지를 한 번에 — `uiStore`).
  if (linkedPage && !linkedPage.deletedAt && card.drawPageId) {
    const pageId = card.drawPageId;
    chips.push({
      key: 'draw',
      icon: 'palette',
      text: '스케치',
      title: linkedPage.title,
      onTap: () => openDrawPage(pageId),
    });
  }

  const shown = terse ? chips.slice(0, 1) : chips.slice(0, MAX_CHIPS);
  // A tray card only has to be identifiable; it does not owe a chip count.
  const folded = terse ? 0 : chips.length - shown.length;
  // ＋2 says how many, never what. The tooltip says what, so the count is a
  // question the card can answer without being opened (M9 §4.2-5).
  const foldedTitle = chips
    .slice(shown.length)
    .map((chip) => chip.text)
    .join(' · ');

  return (
    <article
      className={[
        'relative rounded-lg border border-line border-l-[3px] bg-surface px-3 py-3',
        'transition-shadow duration-[140ms] ease-quick',
        colors.accent,
        lifted ? 'rotate-[0.75deg] shadow-float' : 'shadow-raise',
      ].join(' ')}
    >
      <div className="flex items-start gap-2">
        {/* 체크박스는 제목 **앞**에 선다 (M29): 이 줄에서 먼저 답해야 하는
            질문이 「끝났나」이고, 오른쪽 라벨 지대(아바타·일정 배지)는 카드가
            바쁠수록 붐비는 자리다.

            드래그와 싸우지 않는 법은 일정 배지·링크가 이미 쓰고 있는 것과 같다:
            센서가 듣는 것은 mousedown/touchstart이므로 포인터 이벤트 세 개를
            여기서 멈춰 세운 뒤, 열기(onClick)까지 함께 막는다. */}
        {showCheck ? (
          onToggleDone ? (
            <button
              type="button"
              data-testid="card-done-toggle"
              data-card-id={card.id}
              data-done={done ? 'true' : 'false'}
              role="checkbox"
              aria-checked={done}
              aria-label={`${card.title} ${done ? '완료 취소' : '완료'}`}
              onPointerDown={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.stopPropagation()}
              onTouchStart={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                onToggleDone();
              }}
              // 32px — 24px 최소치는 넘기면서 제목 줄의 높이는 건드리지 않는다.
              className="-my-1 -ml-1 grid h-8 w-8 shrink-0 place-items-center rounded-md transition-colors duration-[140ms] ease-quick hover:bg-sunken"
            >
              <TodoCheck done={done} />
            </button>
          ) : (
            <span className="-my-1 -ml-1 grid h-8 w-8 shrink-0 place-items-center">
              <TodoCheck done={done} />
            </span>
          )
        ) : null}
        {/* 장르 이모지 (M49) — 제목 **앞**, 체크박스와 같은 자리 규칙이다.
            칩 줄에 넣지 않은 이유는 M48이 📝 표식을 칩으로 넣지 않은 이유와 같다:
            칩은 우선순위대로 ＋N으로 접히는 자리라, 정작 바쁜 카드에서 이름표가
            사라진다. 여기 있으면 접히지 않고, 카드 높이도 늘지 않는다. */}
        {genre ? (
          <span
            data-testid="card-genre-mark"
            data-genre={genre}
            title={USER_GENRE_LABEL[genre]}
            aria-label={USER_GENRE_LABEL[genre]}
            className="shrink-0 text-label leading-tight"
          >
            <span aria-hidden="true">{USER_GENRE_EMOJI[genre]}</span>
          </span>
        ) : null}
        <h3
          data-done={done ? 'true' : 'false'}
          className={[
            'min-w-0 flex-1 break-words text-label font-semibold',
            // 끝난 일은 지워지지 않고 **가라앉는다** — 줄을 긋고 색을 낮출 뿐,
            // 칩은 그대로다. 얼마 썼고 어디였는지는 끝난 뒤에도 사실이다.
            done ? 'text-ink-faint line-through' : 'text-ink',
          ].join(' ')}
        >
          {card.title}
        </h3>
        {/* 상대의 새 코멘트 (M24). 칩 줄이 아니라 제목 줄에 붙는다: 칩은
            우선순위대로 잘려 ＋N으로 접히는 줄이고, 「새 것이 있다」는 접히면
            안 되는 소식이다. 그래서 아바타·일정 배지와 같은 라벨 지대에 선다. */}
        {hasNewComments && !terse ? (
          <span
            data-testid="card-new-comments"
            title="상대가 남긴 새 코멘트가 있어요"
            className={`${UNREAD_BADGE_CLASS} mt-px`}
          >
            NEW
          </span>
        ) : null}
        {/* Who put this idea up (M13). First in the right-hand group and
            18px across: it is a *label*, not a control, so it must not read
            louder than the 일정 badge next to it — and it is skipped in the
            tray, where a card only has to be identifiable enough to drag. */}
        {isProfileId(card.createdBy) && !terse ? (
          <span data-testid="card-author" data-profile={card.createdBy} className="mt-px shrink-0">
            <Avatar id={card.createdBy} size="sm" />
          </span>
        ) : null}
        {scheduledCount > 0 ? (
          <div ref={badgeRef} className="relative shrink-0">
            <button
              type="button"
              data-testid="card-schedule-badge"
              data-count={scheduledCount}
              aria-expanded={hasBreakdown ? popoverOpen : undefined}
              disabled={!hasBreakdown}
              title={`시간표에 ${scheduledCount}번 배치됨`}
              // The badge lives inside a draggable card: neither the drag nor
              // the card's own open-on-click may fire when it is tapped. The
              // sensors listen for mousedown/touchstart, so stopping the
              // pointer event alone would no longer reach them.
              onPointerDown={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.stopPropagation()}
              onTouchStart={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                if (hasBreakdown) setPopoverOpen((open) => !open);
              }}
              className="inline-flex h-5 items-center gap-1 rounded-full bg-sunken px-2 text-micro tabular-nums text-ink-muted"
            >
              <Icon name="calendar" size={16} />
              {scheduledCount}
            </button>

            {popoverOpen && hasBreakdown ? (
              <div data-testid="card-schedule-popover" className={`${POPOVER_CLASS} right-0 top-full`}>
                {scheduleBreakdown?.map((row) => (
                  <p
                    key={row.sheetId}
                    data-testid="card-schedule-popover-row"
                    data-sheet-id={row.sheetId}
                    data-count={row.count}
                    className="flex items-baseline gap-2 px-3 py-2 text-label text-ink"
                  >
                    <span className="min-w-0 flex-1 truncate">{row.sheetName}</span>
                    <span className="font-semibold tabular-nums">{row.count}회</span>
                  </p>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        {card.url ? (
          <a
            href={card.url}
            // 앱 안의 주소(`#/draw/…`)는 **새 탭이 아니다** (M52b): 같은 문서
            // 안에서 해시만 갈리고 `HashSync`가 그 자리를 연다.
            {...(isInAppHash(card.url)
              ? {}
              : { target: '_blank', rel: 'noreferrer noopener' })}
            aria-label="링크 열기"
            data-testid="card-link"
            onPointerDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onTouchStart={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
            className="-m-1 shrink-0 rounded-xs p-1 text-ink-faint transition-colors duration-[140ms] ease-quick hover:text-ink"
          >
            <Icon name="link" size={16} />
          </a>
        ) : null}
      </div>

      {/* 메모 줄 — 그리고 M48부터는 그 **끝에 표식 하나**가 선다.

          폰에서 메모를 통째로 보려면 누를 자리가 필요하고, 카드의 탭(편집)과
          롱프레스(드래그)는 이미 임자가 있다. 그래서 표식을 하나 만든다.

          **줄 전체를 탭 타깃으로 삼지 않는다.** 잘린 줄을 눌러 펼치는 것이 말은
          되지만, 이 줄은 카드 한가운데를 가로지른다 — 그 자리를 가져가면 카드
          가운데를 눌러 카드를 여는 길이 막힌다(실제로 막혔다). 표식은 줄 끝의
          32px 하나로 족하다.

          칩 줄에 📝 칩으로 넣지 않은 이유도 같은 종류다: 칩은 우선순위대로 ＋N
          으로 접히는 자리라(사진 칩이 늘 먼저 접힌다) 정작 바쁜 카드에서 표식이
          사라진다. 카드 높이는 그대로다 — 32px 버튼의 위아래 9px를 마진으로
          되돌려 놓아 줄 높이가 글자 한 줄 그대로다. */}
      {card.memo && !terse ? (
        noteMarkProps ? (
          <div className="mt-1 flex items-center gap-1">
            <p className="min-w-0 flex-1 truncate text-micro font-normal text-ink-faint">
              {card.memo}
            </p>
            <button
              type="button"
              data-testid="card-note-mark"
              aria-label="메모 보기"
              {...noteMarkProps}
              style={{ marginTop: -9, marginBottom: -9, touchAction: 'manipulation' }}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-micro leading-none transition-colors duration-[140ms] ease-quick hover:bg-sunken"
            >
              <span aria-hidden="true">📝</span>
            </button>
          </div>
        ) : (
          <p className="mt-1 truncate text-micro font-normal text-ink-faint">{card.memo}</p>
        )
      ) : null}

      {shown.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {shown.map((chip) =>
            chip.onTap && !terse ? (
              // 드래그와 싸우지 않는 법은 링크·체크박스가 쓰는 것과 같다:
              // 센서가 듣는 세 이벤트를 여기서 멈춰 세운 뒤 click까지 삼킨다.
              <button
                key={chip.key}
                type="button"
                title={chip.title}
                data-testid={`card-chip-${chip.key}`}
                aria-label={`${chip.text} 열기`}
                onPointerDown={(event) => event.stopPropagation()}
                onMouseDown={(event) => event.stopPropagation()}
                onTouchStart={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  chip.onTap?.();
                }}
                className={`${CHIP_NEUTRAL} hover:bg-line`}
              >
                <Icon name={chip.icon} size={16} />
                <span className="truncate">{chip.text}</span>
              </button>
            ) : (
              <span
                key={chip.key}
                title={chip.title}
                data-testid={`card-chip-${chip.key}`}
                className={chip.tone === 'money' ? CHIP_MONEY : CHIP_NEUTRAL}
              >
                <Icon name={chip.icon} size={16} />
                <span className="truncate">{chip.text}</span>
              </span>
            ),
          )}
          {folded > 0 ? (
            <span title={foldedTitle} className={CHIP_NEUTRAL}>
              ＋{folded}
            </span>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

interface CardItemProps {
  card: Card;
  currency: string;
  color: string;
  /** Timeline entries for this card; drives the 일정 badge. */
  scheduledCount?: number;
  /** Per-sheet split behind the badge's popover. */
  scheduleBreakdown?: readonly SheetScheduleCount[];
  /** Draws the NEW dot (M24) — see {@link CardSurfaceProps.hasNewComments}. */
  hasNewComments?: boolean;
  /** Draws the checkbox (M29) — see {@link CardSurfaceProps.todo}. */
  todo?: boolean;
  /** Called by that checkbox; omitted, the box is not there at all. */
  onToggleDone?: (card: Card) => void;
  onOpen: (card: Card) => void;
}

/**
 * A draggable board card.
 *
 * **Not** `touch-action: none`: the cards cover most of a column, and a finger
 * that lands on one still has to be able to scroll the board. The drag is
 * gated by the `TouchSensor`'s 250 ms long-press instead, and dnd-kit stops
 * the page from moving itself (it `preventDefault`s `touchmove`) once the lift
 * has actually happened — which is exactly when the card takes the gesture
 * over, and not one moment earlier.
 */
export default function CardItem({
  card,
  currency,
  color,
  scheduledCount = 0,
  scheduleBreakdown,
  hasNewComments = false,
  todo = false,
  onToggleDone,
  onOpen,
}: CardItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    data: { type: DND_CARD, columnId: card.columnId },
  });

  /**
   * 메모 미리보기 (M47) + 메모 줄 탭 (M48) — the truncated line on the surface
   * says a note exists; this says what it is. Hover is desktop pointers only;
   * the tap works anywhere, and both are attached to the drag wrapper rather
   * than to the surface so the rectangle they measure is the card the eye sees.
   */
  const hoverNote = useHoverNote(card.memo, 'card-note-hover');

  return (
    <>
    <div
      ref={setNodeRef}
      style={{
        // Translate only (no scale): a sortable card must keep its own size.
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        transition,
        // Only while it is actually being carried: `manipulation` keeps the
        // scroll and kills the double-tap zoom delay.
        touchAction: isDragging ? 'none' : 'manipulation',
      }}
      {...attributes}
      {...listeners}
      {...hoverNote.anchorProps}
      onClick={() => onOpen(card)}
      data-testid="board-card"
      data-card-id={card.id}
      data-column-id={card.columnId}
      className={[
        'cursor-grab select-none outline-none focus-visible:ring-2 focus-visible:ring-line-strong',
        isDragging ? 'opacity-40' : '',
      ].join(' ')}
    >
      <CardSurface
        card={card}
        currency={currency}
        color={color}
        scheduledCount={scheduledCount}
        scheduleBreakdown={scheduleBreakdown}
        hasNewComments={hasNewComments}
        todo={todo}
        onToggleDone={onToggleDone ? () => onToggleDone(card) : undefined}
        noteMarkProps={hoverNote.markProps}
      />
    </div>
    {hoverNote.popover}
    </>
  );
}
