import { useEffect, useRef, useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { DND_CARD } from '../../dnd/boardDnd';
import type { SheetScheduleCount } from '../../timeline/scheduleSummary';
import type { Card } from '../../types/models';
import { colorClasses } from '../../utils/colors';
import { shortPlace } from '../../utils/geo';
import { formatBudget } from '../../utils/money';
import { cardSpent } from '../../utils/spend';
import { formatDuration } from '../../utils/time';
import Icon, { type IconName } from '../common/Icon';
import { CHIP_MONEY, CHIP_NEUTRAL, POPOVER_CLASS } from '../common/formStyles';

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
}: CardSurfaceProps) {
  const colors = colorClasses(color);
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

  const chips: {
    key: string;
    icon: IconName;
    text: string;
    title?: string;
    tone?: 'money';
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
        <h3 className="min-w-0 flex-1 break-words text-label font-semibold text-ink">
          {card.title}
        </h3>
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
              // the card's own open-on-click may fire when it is tapped.
              onPointerDown={(event) => event.stopPropagation()}
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
            target="_blank"
            rel="noreferrer noopener"
            aria-label="링크 열기"
            data-testid="card-link"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
            className="-m-1 shrink-0 rounded-xs p-1 text-ink-faint transition-colors duration-[140ms] ease-quick hover:text-ink"
          >
            <Icon name="link" size={16} />
          </a>
        ) : null}
      </div>

      {card.memo && !terse ? (
        <p className="mt-1 truncate text-micro font-normal text-ink-faint">{card.memo}</p>
      ) : null}

      {shown.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {shown.map((chip) => (
            <span
              key={chip.key}
              title={chip.title}
              data-testid={`card-chip-${chip.key}`}
              className={chip.tone === 'money' ? CHIP_MONEY : CHIP_NEUTRAL}
            >
              <Icon name={chip.icon} size={16} />
              <span className="truncate">{chip.text}</span>
            </span>
          ))}
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
  onOpen: (card: Card) => void;
}

/**
 * A draggable board card.
 *
 * `touch-action: none` lives on this element only — never on the board's
 * scroll containers, or horizontal scrolling would die on touch devices.
 */
export default function CardItem({
  card,
  currency,
  color,
  scheduledCount = 0,
  scheduleBreakdown,
  onOpen,
}: CardItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    data: { type: DND_CARD, columnId: card.columnId },
  });

  return (
    <div
      ref={setNodeRef}
      style={{
        // Translate only (no scale): a sortable card must keep its own size.
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        transition,
        touchAction: 'none',
      }}
      {...attributes}
      {...listeners}
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
      />
    </div>
  );
}
