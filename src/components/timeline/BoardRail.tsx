import type { SheetScheduleCount } from '../../timeline/scheduleSummary';
import type { BoardColumn, Card, Id } from '../../types/models';
import BoardColumnView from '../board/BoardColumnView';

interface BoardRailProps {
  columns: readonly BoardColumn[];
  cardsByColumn: Record<Id, Card[]>;
  currency: string;
  scheduledCounts: Record<Id, number>;
  /** cardId → per-sheet split behind the badge's popover. */
  scheduleBreakdowns?: Record<Id, SheetScheduleCount[]>;
  onOpenCard: (card: Card) => void;
  /** Explicit height; omitted, the rail stretches to the grid row it sits in. */
  height?: string;
  /** True while this sheet is still empty — the drag hint is worth a line then. */
  showHint?: boolean;
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
  scheduleBreakdowns,
  onOpenCard,
  height,
  showHint = false,
}: BoardRailProps) {
  return (
    <aside
      data-testid="timeline-rail"
      aria-label="보드 카드"
      className="hidden w-60 shrink-0 flex-col overflow-y-auto border-r border-line bg-canvas lg:flex"
      style={{ height }}
    >
      {/* Shown only while there is something to drag and nowhere it has landed
          yet — a permanent instruction is wallpaper (M9 §4.4-9). */}
      {showHint ? (
        <p className="sticky top-0 z-10 bg-surface/90 px-3 py-2 text-micro font-normal text-ink-faint backdrop-blur">
          카드를 오른쪽 시간표로 끌어다 놓으세요
        </p>
      ) : null}
      <div className="flex flex-col gap-2 p-2">
        {columns.map((column) => (
          <BoardColumnView
            key={column.id}
            column={column}
            cards={cardsByColumn[column.id] ?? []}
            currency={currency}
            scheduledCounts={scheduledCounts}
            scheduleBreakdowns={scheduleBreakdowns}
            onOpenCard={onOpenCard}
            compact
          />
        ))}
      </div>
    </aside>
  );
}
