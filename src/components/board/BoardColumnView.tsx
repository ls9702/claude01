import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { DND_COLUMN } from '../../dnd/boardDnd';
import type { BoardColumn, Card } from '../../types/models';
import { colorClasses } from '../../utils/colors';
import CardItem from './CardItem';

interface BoardColumnViewProps {
  column: BoardColumn;
  /** The column's cards, already in `cardOrder`. */
  cards: Card[];
  currency: string;
  onAddCard: (column: BoardColumn) => void;
  onOpenCard: (card: Card) => void;
  onEditColumn: (column: BoardColumn) => void;
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
  onAddCard,
  onOpenCard,
  onEditColumn,
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
        'flex w-[85vw] shrink-0 snap-start flex-col rounded-2xl border transition-colors sm:w-72 lg:min-w-72',
        isOver ? 'border-stone-400 bg-stone-100/80' : 'border-stone-200/70 bg-stone-50/70',
      ].join(' ')}
    >
      <header
        className={`flex items-center gap-2 rounded-t-2xl px-3 py-2.5 ${colors.header}`}
      >
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
        <button
          type="button"
          data-testid="add-card"
          aria-label={`${column.name}에 카드 추가`}
          onClick={() => onAddCard(column)}
          className="rounded-full px-1.5 py-0.5 text-base leading-none hover:bg-white/70"
        >
          ＋
        </button>
        <button
          type="button"
          data-testid="edit-column"
          aria-label={`${column.name} 카테고리 수정`}
          onClick={() => onEditColumn(column)}
          className="rounded-full px-1.5 py-0.5 text-sm leading-none opacity-60 hover:bg-white/70 hover:opacity-100"
        >
          ⋯
        </button>
      </header>

      <div className="flex flex-1 flex-col gap-2 p-2">
        <SortableContext items={cards.map((card) => card.id)} strategy={verticalListSortingStrategy}>
          {cards.map((card) => (
            <CardItem
              key={card.id}
              card={card}
              currency={currency}
              color={column.color}
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

        <button
          type="button"
          data-testid="add-card-footer"
          onClick={() => onAddCard(column)}
          className="mt-auto rounded-xl px-3 py-2 text-left text-xs font-medium text-stone-400 transition-colors hover:bg-white hover:text-stone-600"
        >
          ＋ 카드 추가
        </button>
      </div>
    </section>
  );
}
