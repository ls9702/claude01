import type { BoardColumn, Card, Id } from '../../types/models';
import BoardColumnView from '../board/BoardColumnView';

interface BoardRailProps {
  columns: readonly BoardColumn[];
  cardsByColumn: Record<Id, Card[]>;
  currency: string;
  scheduledCounts: Record<Id, number>;
  onOpenCard: (card: Card) => void;
  /** Matches the grid's height so the rail scrolls on its own. */
  height: string;
}

/**
 * Desktop-only board rail beside the day grid.
 *
 * Same `BoardColumnView`/`CardItem` as the 보드 tab — only narrower and
 * without the create/edit affordances — so a card dragged out of here is the
 * exact same draggable the board uses, and the shared `PlanDndContext` can
 * resolve either a board reorder or a drop onto a day.
 */
export default function BoardRail({
  columns,
  cardsByColumn,
  currency,
  scheduledCounts,
  onOpenCard,
  height,
}: BoardRailProps) {
  return (
    <aside
      data-testid="timeline-rail"
      aria-label="보드 카드"
      className="hidden w-60 shrink-0 flex-col overflow-y-auto border-r border-stone-200 bg-stone-50/40 lg:flex"
      style={{ height }}
    >
      <p className="sticky top-0 z-10 bg-white/90 px-3 py-2 text-[11px] font-medium text-stone-400 backdrop-blur">
        카드를 오른쪽 시간표로 끌어다 놓으세요
      </p>
      <div className="flex flex-col gap-2 p-2">
        {columns.map((column) => (
          <BoardColumnView
            key={column.id}
            column={column}
            cards={cardsByColumn[column.id] ?? []}
            currency={currency}
            scheduledCounts={scheduledCounts}
            onOpenCard={onOpenCard}
            compact
          />
        ))}
      </div>
    </aside>
  );
}
