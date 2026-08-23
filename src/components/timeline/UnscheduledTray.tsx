import { useMemo, useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { DND_CARD } from '../../dnd/boardDnd';
import type { BoardColumn, Card, Id } from '../../types/models';
import { CardSurface } from '../board/CardItem';
import Icon, { EmojiIcon } from '../common/Icon';
import { CHIP_BUTTON, CHIP_SELECTED } from '../common/formStyles';

/** `'all'` is the "전체" chip; anything else is a column id. */
type Filter = Id | 'all';

interface TrayCardProps {
  card: Card;
  currency: string;
  color: string;
  onOpen: (card: Card) => void;
}

/**
 * A tray card: draggable with the **bare card id**, exactly like a rail card,
 * so `PlanDndContext` resolves a drop on a day column without knowing the tray
 * exists. `useDraggable` rather than `useSortable` — the tray is a source, not
 * a sortable list.
 */
function TrayCard({ card, currency, color, onOpen }: TrayCardProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: card.id,
    data: { type: DND_CARD, columnId: card.columnId },
  });

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={() => onOpen(card)}
      data-testid="tray-card"
      data-card-id={card.id}
      data-column-id={card.columnId}
      // Touch scrolling of the strip must survive: only the card itself opts out.
      style={{ touchAction: 'none' }}
      className={[
        'w-36 shrink-0 cursor-grab select-none outline-none focus-visible:ring-2 focus-visible:ring-line-strong',
        isDragging ? 'opacity-40' : '',
      ].join(' ')}
    >
      <CardSurface card={card} currency={currency} color={color} terse />
    </div>
  );
}

interface UnscheduledTrayProps {
  /** Cards with no entry on the **active** sheet, in board order. */
  cards: readonly Card[];
  columns: readonly BoardColumn[];
  currency: string;
  /** Tap-to-schedule fallback — opens {@link ScheduleSheet}. */
  onOpenCard: (card: Card) => void;
}

/**
 * Mobile-only bottom tray of 미배치 cards.
 *
 * Collapsed it is a one-line bar ("미배치 카드 4장"); expanded it becomes a
 * horizontal strip with per-category filter chips. Long-pressing a card starts
 * the very same drag the desktop rail uses (the shared `PlanDndContext` has a
 * `TouchSensor` with a 250 ms delay), and tapping it opens the schedule sheet —
 * so a phone has both paths onto the visible day column.
 *
 * A flex sibling of the grid rather than a layer on top of it: the grid is the
 * drop target, so covering it mid-drag would be absurd (M9 §4.4-6).
 */
export default function UnscheduledTray({
  cards,
  columns,
  currency,
  onOpenCard,
}: UnscheduledTrayProps) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');

  const colorOf = useMemo(() => {
    const map: Record<Id, string> = {};
    for (const column of columns) map[column.id] = column.color;
    return map;
  }, [columns]);

  /** Only categories that actually have a 미배치 card get a chip. */
  const chips = useMemo(
    () => columns.filter((column) => cards.some((card) => card.columnId === column.id)),
    [columns, cards],
  );

  const visible =
    filter === 'all' ? cards : cards.filter((card) => card.columnId === filter);

  return (
    <div
      data-testid="unscheduled-tray"
      data-open={open ? 'true' : 'false'}
      aria-label="미배치 카드"
      // A flex sibling of the grid, not a layer on top of it: the grid is the
      // drop target, and covering it while dragging would be absurd (§4.4-6).
      className="z-30 shrink-0 border-t border-line bg-surface lg:hidden"
    >
      <button
        type="button"
        data-testid="tray-toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex h-11 w-full items-center gap-2 px-4 text-left"
      >
        <Icon name="board" size={16} className="text-ink-faint" />
        <span className="text-label font-semibold text-ink">
          미배치 카드{' '}
          <span data-testid="tray-count" data-count={cards.length} className="tabular-nums">
            {cards.length}
          </span>
          장
        </span>
        <Icon
          name={open ? 'chevron-down' : 'chevron-up'}
          size={16}
          className="ml-auto text-ink-faint"
        />
      </button>

      {open ? (
        cards.length === 0 ? (
          <p data-testid="tray-empty" className="px-4 pb-3 text-label font-normal text-ink-faint">
            모든 카드를 이 시트에 배치했어요.
          </p>
        ) : (
          <>
            <div data-testid="tray-filters" className="flex gap-2 overflow-x-auto px-4 pb-2">
              {[
                { id: 'all' as Filter, icon: '', name: '전체' },
                ...chips.map((column) => ({
                  id: column.id as Filter,
                  icon: column.icon,
                  name: column.name,
                })),
              ].map((chip) => {
                const active = filter === chip.id;
                return (
                  <button
                    key={chip.id}
                    type="button"
                    data-testid="tray-filter"
                    data-column-id={chip.id}
                    aria-pressed={active}
                    onClick={() => setFilter(chip.id)}
                    className={active ? CHIP_SELECTED : CHIP_BUTTON}
                  >
                    {chip.icon ? <EmojiIcon emoji={chip.icon} /> : null}
                    {chip.name}
                  </button>
                );
              })}
            </div>

            <div
              data-testid="tray-strip"
              className="flex max-h-[38dvh] gap-2 overflow-x-auto px-4 pb-3"
            >
              {visible.map((card) => (
                <TrayCard
                  key={card.id}
                  card={card}
                  currency={currency}
                  color={colorOf[card.columnId] ?? 'slate'}
                  onOpen={onOpenCard}
                />
              ))}
            </div>
          </>
        )
      ) : null}
    </div>
  );
}
