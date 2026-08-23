import { useCallback, useEffect, useRef, useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { useRegisterDayGrid } from '../../dnd/PlanDndContext';
import { DND_DAY, dayDroppableId } from '../../dnd/planDnd';
import type { BoardColumn, Card, Day, Id, TimelineEntry } from '../../types/models';
import {
  DAY_COLUMN_PX,
  DAY_HEIGHT_PX,
  HEADER_PX,
  PX_PER_MIN,
  laneMap,
} from '../../timeline/layout';
import type { SpendTotals } from '../../utils/spend';
import { formatDayDate, minToY } from '../../utils/time';
import EntryBlock from './EntryBlock';
import SpendChip from './SpendChip';
import { HOURS } from './TimeAxis';

/** `label` → date → `N일차`. Kept here so the pager can show the same text. */
export function dayTitle(day: Day, index: number): string {
  if (day.label?.trim()) return day.label.trim();
  if (day.date) return formatDayDate(day.date);
  return `${index + 1}일차`;
}

/** Secondary line: the date when the title is already a label, else the index. */
export function daySubtitle(day: Day, index: number): string {
  if (day.label?.trim() && day.date) return formatDayDate(day.date);
  return `${index + 1}일차`;
}

interface DayColumnProps {
  day: Day;
  /** Position inside the sheet's `dayOrder`, for the `N일차` fallback. */
  index: number;
  entries: readonly TimelineEntry[];
  cards: Record<Id, Card>;
  columns: Record<Id, BoardColumn>;
  /** 예산/지출 of this day's cards (M6); the header chip. */
  spend: SpendTotals;
  /** Trip currency, for the money chip. */
  currency: string;
  onOpenEntry: (entry: TimelineEntry) => void;
  onDeleteDay: (day: Day) => void;
  /** Mobile pager: the single visible day fills the width. */
  fullWidth?: boolean;
}

/**
 * One day of the sheet: a sticky header plus the 00:00–24:00 grid.
 *
 * The **grid is a single droppable** — entries inside it are draggable but not
 * droppable, so a drop always resolves to this day and the exact minute comes
 * from the pointer's Y offset inside this element.
 */
export default function DayColumn({
  day,
  index,
  entries,
  cards,
  columns,
  spend,
  currency,
  onOpenEntry,
  onDeleteDay,
  fullWidth = false,
}: DayColumnProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const headerRef = useRef<HTMLElement | null>(null);

  const { setNodeRef, isOver } = useDroppable({
    id: dayDroppableId(day.id),
    data: { type: DND_DAY, dayId: day.id },
  });
  const registerGrid = useRegisterDayGrid(day.id);

  const gridRef = useCallback(
    (element: HTMLDivElement | null) => {
      setNodeRef(element);
      registerGrid(element);
    },
    [setNodeRef, registerGrid],
  );

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (event: PointerEvent) => {
      if (!headerRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [menuOpen]);

  const lanes = laneMap(entries);

  return (
    <section
      data-testid="timeline-day"
      data-day-id={day.id}
      aria-label={dayTitle(day, index)}
      className={`flex flex-col border-l border-stone-200 ${fullWidth ? 'min-w-0 flex-1' : 'shrink-0'}`}
      style={fullWidth ? undefined : { width: DAY_COLUMN_PX }}
    >
      <header
        ref={headerRef}
        data-testid="timeline-day-header"
        className="sticky top-0 z-20 flex items-center gap-1 border-b border-stone-200 bg-white/95 px-2 backdrop-blur"
        style={{ height: HEADER_PX }}
      >
        <div className="min-w-0 flex-1">
          <p
            data-testid="timeline-day-title"
            className="truncate text-xs font-semibold text-stone-700"
          >
            {dayTitle(day, index)}
          </p>
          <p className="truncate text-[10px] text-stone-400">{daySubtitle(day, index)}</p>
        </div>
        {/* On mobile the pager carries the day's money chip instead — one
            `day-spend` per visible day, wherever the day heading lives. */}
        {fullWidth ? null : (
          <SpendChip totals={spend} currency={currency} testId="day-spend" dayId={day.id} />
        )}
        <span
          data-testid="timeline-day-count"
          className="rounded-full bg-stone-100 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-stone-500"
        >
          {entries.length}
        </span>
        <button
          type="button"
          data-testid="day-menu"
          aria-label={`${dayTitle(day, index)} 메뉴`}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
          className="rounded-full px-1.5 py-0.5 text-sm leading-none text-stone-400 hover:bg-stone-100 hover:text-stone-600"
        >
          ⋯
        </button>

        {menuOpen ? (
          <div
            data-testid="day-menu-panel"
            className="absolute right-1 top-full z-30 w-24 overflow-hidden rounded-xl border border-stone-200 bg-white shadow-lg"
          >
            <button
              type="button"
              data-testid="day-delete"
              onClick={() => {
                setMenuOpen(false);
                onDeleteDay(day);
              }}
              className="block w-full px-3 py-2 text-left text-xs font-medium text-rose-500 hover:bg-rose-50"
            >
              삭제
            </button>
          </div>
        ) : null}
      </header>

      <div
        ref={gridRef}
        data-testid="timeline-day-grid"
        data-day-id={day.id}
        className={`relative transition-colors ${isOver ? 'bg-sky-50' : 'bg-white'}`}
        style={{ height: DAY_HEIGHT_PX }}
      >
        {HOURS.map((hour) => (
          <div
            key={hour}
            aria-hidden="true"
            className={hour % 6 === 0 ? 'absolute inset-x-0 border-t border-stone-200' : 'absolute inset-x-0 border-t border-stone-100'}
            style={{ top: minToY(hour * 60, PX_PER_MIN) }}
          />
        ))}

        {entries.map((entry) => {
          const card = cards[entry.cardId];
          const column = card ? columns[card.columnId] : undefined;
          return (
            <EntryBlock
              key={entry.id}
              entry={entry}
              card={card}
              color={column?.color ?? 'slate'}
              icon={column?.icon ?? '🗓'}
              lane={lanes[entry.id] ?? { id: entry.id, lane: 0, lanes: 1 }}
              onOpen={onOpenEntry}
            />
          );
        })}
      </div>
    </section>
  );
}
