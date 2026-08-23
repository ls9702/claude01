import { useMemo, useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { DND_CARD } from '../../dnd/boardDnd';
import type { BoardColumn, Card, Id } from '../../types/models';
import { CardSurface } from '../board/CardItem';

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
        'w-44 shrink-0 cursor-grab select-none outline-none focus-visible:ring-2 focus-visible:ring-stone-400',
        isDragging ? 'opacity-40' : '',
      ].join(' ')}
    >
      <CardSurface card={card} currency={currency} color={color} />
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
 * Rendered above the tab bar, which owns the bottom `4.5rem` of the screen.
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
      className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 border-t border-stone-200 bg-white/95 backdrop-blur lg:hidden"
    >
      <button
        type="button"
        data-testid="tray-toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 px-4 py-2 text-left"
      >
        <span aria-hidden="true" className="text-sm">
          🗂️
        </span>
        <span className="text-xs font-semibold text-stone-600">
          미배치 카드{' '}
          <span data-testid="tray-count" data-count={cards.length} className="tabular-nums">
            {cards.length}
          </span>
          장
        </span>
        <span aria-hidden="true" className="ml-auto text-xs text-stone-400">
          {open ? '▾' : '▴'}
        </span>
      </button>

      {open ? (
        cards.length === 0 ? (
          <p data-testid="tray-empty" className="px-4 pb-3 text-xs text-stone-400">
            모든 카드를 이 시트에 배치했어요.
          </p>
        ) : (
          <>
            <div data-testid="tray-filters" className="flex gap-1.5 overflow-x-auto px-4 pb-2">
              {[
                { id: 'all' as Filter, icon: '🗂️', name: '전체' },
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
                    className={[
                      'shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors',
                      active
                        ? 'bg-stone-800 text-white'
                        : 'bg-stone-100 text-stone-500 hover:bg-stone-200',
                    ].join(' ')}
                  >
                    {chip.icon} {chip.name}
                  </button>
                );
              })}
            </div>

            <div
              data-testid="tray-strip"
              className="flex gap-2 overflow-x-auto px-4 pb-3"
              style={{ maxHeight: '9.5rem' }}
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
