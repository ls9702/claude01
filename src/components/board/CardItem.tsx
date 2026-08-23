import { useSortable } from '@dnd-kit/sortable';
import { DND_CARD } from '../../dnd/boardDnd';
import type { Card } from '../../types/models';
import { colorClasses } from '../../utils/colors';
import { formatBudget } from '../../utils/money';
import { formatDuration } from '../../utils/time';

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
   * badge. Per-sheet detail arrives with M2b's multi-sheet UI.
   */
  scheduledCount?: number;
}

/**
 * The card's looks, with no drag wiring — shared by the sortable card and by
 * the `DragOverlay` ghost.
 */
export function CardSurface({
  card,
  currency,
  color,
  lifted = false,
  scheduledCount = 0,
}: CardSurfaceProps) {
  const colors = colorClasses(color);
  const chips: { key: string; icon: string; text: string; title?: string }[] = [];

  if (typeof card.defaultDurationMin === 'number' && card.defaultDurationMin > 0) {
    chips.push({ key: 'duration', icon: '⏱', text: formatDuration(card.defaultDurationMin) });
  }
  if (card.location?.address) {
    chips.push({
      key: 'location',
      icon: '📍',
      text: card.location.address,
      title: card.location.address,
    });
  }
  if (typeof card.budget === 'number' && Number.isFinite(card.budget)) {
    chips.push({ key: 'budget', icon: '💰', text: formatBudget(card.budget, currency) });
  }

  return (
    <article
      className={[
        'rounded-xl border border-stone-200/70 border-l-4 bg-white px-3 py-2.5',
        colors.accent,
        lifted ? 'rotate-1 shadow-lg' : 'shadow-sm',
      ].join(' ')}
    >
      <div className="flex items-start gap-2">
        <h3 className="min-w-0 flex-1 break-words text-sm font-semibold leading-snug text-stone-800">
          {card.title}
        </h3>
        {scheduledCount > 0 ? (
          <span
            data-testid="card-schedule-badge"
            data-count={scheduledCount}
            title={`시간표에 ${scheduledCount}번 배치됨`}
            className="shrink-0 rounded-full bg-stone-800 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-white"
          >
            🗓 {scheduledCount}
          </span>
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
            className="-mr-1 shrink-0 rounded-md px-1 text-xs text-stone-300 hover:text-sky-500"
          >
            🔗
          </a>
        ) : null}
      </div>

      {card.memo ? (
        <p className="mt-1 truncate text-xs leading-relaxed text-stone-400">{card.memo}</p>
      ) : null}

      {chips.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {chips.map((chip) => (
            <span
              key={chip.key}
              title={chip.title}
              data-testid={`card-chip-${chip.key}`}
              className={`inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${colors.chip}`}
            >
              <span aria-hidden="true">{chip.icon}</span>
              <span className="truncate">{chip.text}</span>
            </span>
          ))}
        </div>
      ) : null}
    </article>
  );
}

interface CardItemProps {
  card: Card;
  currency: string;
  color: string;
  /** Timeline entries for this card; drives the 🗓 badge. */
  scheduledCount?: number;
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
        'cursor-grab select-none outline-none focus-visible:ring-2 focus-visible:ring-stone-400',
        isDragging ? 'opacity-40' : '',
      ].join(' ')}
    >
      <CardSurface
        card={card}
        currency={currency}
        color={color}
        scheduledCount={scheduledCount}
      />
    </div>
  );
}
