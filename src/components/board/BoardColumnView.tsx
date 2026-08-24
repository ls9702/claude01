import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { DND_COLUMN } from '../../dnd/boardDnd';
import { useCollapsedStore, useColumnCollapsed } from '../../stores/collapsedColumns';
import type { SheetScheduleCount } from '../../timeline/scheduleSummary';
import type { BoardColumn, Card, Id } from '../../types/models';
import { colorClasses } from '../../utils/colors';
import Icon from '../common/Icon';
import { EmojiIcon } from '../common/Icon';
import CardItem from './CardItem';

interface BoardColumnViewProps {
  column: BoardColumn;
  /** The column's cards, already in `cardOrder`. */
  cards: Card[];
  currency: string;
  /** cardId → how many timeline entries it has, for the 일정 badge. */
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
 * Only the **header** carries the category colour (M9 §2.1). The body is plain
 * canvas so the white cards inside it read as objects on a surface rather than
 * as tint on tint.
 *
 * The whole column is a droppable so cards can be dropped onto empty space;
 * the cards themselves are the sortable targets.
 *
 * **접힘 (M15 §2)** — tapping the header's title zone folds the body away and
 * leaves the header, its count and a turned chevron. The state is per device
 * (`stores/collapsedColumns`) and shared by the 보드 탭 and the 일정 탭's rail,
 * because both draw the same categories. `useDroppable` stays registered while
 * a column is folded, so a card dragged over one still lands in it rather than
 * falling into a hole.
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
  const collapsed = useColumnCollapsed(column.id);
  const toggleCollapsed = useCollapsedStore((state) => state.toggle);
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
      data-collapsed={collapsed ? 'true' : 'false'}
      aria-label={column.name}
      className={[
        'flex shrink-0 flex-col overflow-hidden rounded-lg border bg-canvas transition-colors duration-[140ms] ease-quick',
        compact ? 'w-full' : 'w-[85vw] snap-start sm:w-[17rem]',
        // Folded: as tall as its own header and no taller, whatever the row
        // around it is doing.
        collapsed ? 'self-start' : '',
        isOver ? 'border-line-strong ring-2 ring-line-strong ring-inset' : 'border-line',
      ].join(' ')}
    >
      <header className={`flex h-11 shrink-0 items-center gap-2 px-3 ${colors.header}`}>
        {/* The header *is* the fold toggle (M15 §2) — the whole row bar the
            two action buttons, so it is a target you cannot miss. */}
        <button
          type="button"
          data-testid="column-collapse"
          data-column-id={column.id}
          data-collapsed={collapsed ? 'true' : 'false'}
          aria-expanded={!collapsed}
          aria-label={`${column.name} ${collapsed ? '펼치기' : '접기'}`}
          onClick={() => toggleCollapsed(column.id)}
          className="-mx-1 flex h-11 min-w-0 flex-1 items-center gap-2 rounded-md px-1 text-left transition-colors duration-[140ms] ease-quick hover:bg-surface/40"
        >
          <Icon
            name="chevron-down"
            size={16}
            className={[
              'shrink-0 opacity-70 transition-transform duration-[140ms] ease-quick',
              collapsed ? '-rotate-90' : '',
            ].join(' ')}
          />
          <EmojiIcon emoji={column.icon} className="bg-surface/70" />
          <h2 className="min-w-0 flex-1 truncate text-label font-semibold">{column.name}</h2>
          <span
            data-testid="column-count"
            className="rounded-full bg-surface/70 px-2 py-px text-micro tabular-nums"
          >
            {cards.length}
          </span>
        </button>
        {onAddCard ? (
          <button
            type="button"
            data-testid="add-card"
            aria-label={`${column.name}에 카드 추가`}
            onClick={() => onAddCard(column)}
            // M19 — 32px는 M9의 아이콘 버튼 표준(36px)보다도 작았다. 옆의 ⋯와
            // 붙어 있어 44px까지는 못 키운다: 서로의 영역을 먹기 때문이다.
            className="-m-1 grid h-9 w-9 shrink-0 place-items-center rounded-full p-1 transition-colors duration-[140ms] ease-quick hover:bg-surface/70"
          >
            <Icon name="plus" size={16} />
          </button>
        ) : null}
        {onEditColumn ? (
          <button
            type="button"
            data-testid="edit-column"
            aria-label={`${column.name} 카테고리 수정`}
            onClick={() => onEditColumn(column)}
            className="-m-1 grid h-9 w-9 shrink-0 place-items-center rounded-full p-1 opacity-60 transition-colors duration-[140ms] ease-quick hover:bg-surface/70 hover:opacity-100"
          >
            <Icon name="more" size={16} />
          </button>
        ) : null}
      </header>

      {/* `data-column-body` is how the board's scroll arrows find where the
          real content of the tallest column ends. Unmounted while the column
          is folded — the header keeps saying how many cards wait inside, and
          the section stays droppable either way. */}
      {collapsed ? null : (
        <div data-column-body className="flex flex-1 flex-col gap-2 p-2">
          <SortableContext
            items={cards.map((card) => card.id)}
            strategy={verticalListSortingStrategy}
          >
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
              className="rounded-md bg-surface/60 px-3 py-8 text-center text-micro font-normal text-ink-faint"
            >
              카드를 여기로 옮겨보세요
            </p>
          ) : null}

          {onAddCard ? (
            <button
              type="button"
              data-testid="add-card-footer"
              onClick={() => onAddCard(column)}
              // Right under the last card, not pinned to the bottom of a
              // viewport-tall column: 「＋ 카드 추가」 belongs to the list it adds
              // to. The space left over below it stays a drop zone (M9 §4.2-3).
              // M19 — 34.8px였다. 카드를 만드는 두 손잡이 중 하나인데 44px 아래
              // 였고, 폭이 칸 전체라 높이만 채우면 그대로 44px 타깃이 된다.
              className="flex min-h-11 items-center gap-1 rounded-md px-3 py-2 text-left text-label text-ink-faint transition-colors duration-[140ms] ease-quick hover:bg-surface hover:text-ink"
            >
              <Icon name="plus" size={16} />
              카드 추가
            </button>
          ) : null}
        </div>
      )}
    </section>
  );
}
