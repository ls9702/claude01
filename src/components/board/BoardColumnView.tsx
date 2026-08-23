import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { DND_COLUMN } from '../../dnd/boardDnd';
import type { SheetScheduleCount } from '../../timeline/scheduleSummary';
import type { BoardColumn, Card, Id } from '../../types/models';
import { colorClasses } from '../../utils/colors';
import CardItem from './CardItem';

interface BoardColumnViewProps {
  column: BoardColumn;
  /** The column's cards, already in `cardOrder`. */
  cards: Card[];
  currency: string;
  /** cardId → how many timeline entries it has, for the 🗓 badge. */
  scheduledCounts?: Record<Id, number>;
  /** cardId → per-sheet split behind the badge's popover. */
  scheduleBreakdowns?: Record<Id, SheetScheduleCount[]>;
  onOpenCard: (card: Card) => void;
  /** Omitted in the timeline rail — the rail does not create cards. */
  onAddCard?: (column: BoardColumn) => void;
  /** Omitted in the timeline rail — categories are edited on the 보드 tab. */
  onEditColumn?: (column: BoardColumn) => void;
  /**
   * Narrow, stacked variant used by the timeline's board rail: full width of
   * its (already narrow) container instead of a snap-scrolled board column.
   */
  compact?: boolean;
}

/**
 * One kanban column: header, sortable card list, add-card footer.
 *
 * The whole column is a droppable so cards can be dropped onto empty space;
 * the cards themselves are the sortable targets.
 */
export default function BoardColumnView({
  column,
  cards,
  currency,
  scheduledCounts,
  scheduleBreakdowns,
  onAddCard,
  onOpenCard,
  onEditColumn,
  compact = false,
}: BoardColumnViewProps) {
  const colors = colorClasses(column.color);
  const { setNodeRef, isOver } = useDroppable({
    id: column.id,
    data: { type: DND_COLUMN, columnId: column.id },
  });

  return (
    <section
      ref={setNodeRef}
      data-testid="board-column"
      data-column-id={column.id}
      data-column-name={column.name}
      aria-label={column.name}
      className={[
        'flex shrink-0 flex-col rounded-2xl border transition-colors',
        compact ? 'w-full' : 'w-[85vw] snap-start sm:w-72 lg:min-w-72',
        isOver ? 'border-stone-400 bg-stone-100/80' : 'border-stone-200/70 bg-stone-50/70',
      ].join(' ')}
    >
      <header className={`flex items-center gap-2 rounded-t-2xl px-3 py-2.5 ${colors.header}`}>
        <span aria-hidden="true" className="text-base leading-none">
          {column.icon}
        </span>
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{column.name}</h2>
        <span
          data-testid="column-count"
          className="rounded-full bg-white/70 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums"
        >
          {cards.length}
        </span>
        {onAddCard ? (
          <button
            type="button"
            data-testid="add-card"
            aria-label={`${column.name}에 카드 추가`}
            onClick={() => onAddCard(column)}
            className="rounded-full px-1.5 py-0.5 text-base leading-none hover:bg-white/70"
          >
            ＋
          </button>
        ) : null}
        {onEditColumn ? (
          <button
            type="button"
            data-testid="edit-column"
            aria-label={`${column.name} 카테고리 수정`}
            onClick={() => onEditColumn(column)}
            className="rounded-full px-1.5 py-0.5 text-sm leading-none opacity-60 hover:bg-white/70 hover:opacity-100"
          >
            ⋯
          </button>
        ) : null}
      </header>

      <div className={`flex flex-1 flex-col gap-2 ${compact ? 'p-1.5' : 'p-2'}`}>
        <SortableContext items={cards.map((card) => card.id)} strategy={verticalListSortingStrategy}>
          {cards.map((card) => (
            <CardItem
              key={card.id}
              card={card}
              currency={currency}
              color={column.color}
              scheduledCount={scheduledCounts?.[card.id] ?? 0}
              scheduleBreakdown={scheduleBreakdowns?.[card.id]}
              onOpen={onOpenCard}
            />
          ))}
        </SortableContext>

        {cards.length === 0 ? (
          <p
            data-testid="column-empty"
            className="rounded-xl border border-dashed border-stone-200 px-3 py-6 text-center text-xs text-stone-300"
          >
            카드를 여기로 옮겨보세요
          </p>
        ) : null}

        {onAddCard ? (
          <button
            type="button"
            data-testid="add-card-footer"
            onClick={() => onAddCard(column)}
            className="mt-auto rounded-xl px-3 py-2 text-left text-xs font-medium text-stone-400 transition-colors hover:bg-white hover:text-stone-600"
          >
            ＋ 카드 추가
          </button>
        ) : null}
      </div>
    </section>
  );
}
