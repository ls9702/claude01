import { useCallback, useEffect, useRef, useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { useRegisterDayGrid } from '../../dnd/PlanDndContext';
import { DND_DAY, dayDroppableId } from '../../dnd/planDnd';
import type { BoardColumn, Card, Day, Id, TimelineEntry } from '../../types/models';
import type { DayGap } from '../../timeline/gap';
import { formatDistanceKm } from '../../timeline/route';
import {
  DAY_COLUMN_PX,
  DAY_HEIGHT_PX,
  HEADER_PX,
  PX_PER_MIN,
  laneMap,
} from '../../timeline/layout';
import type { SpendTotals } from '../../utils/spend';
import { formatClock, formatDayDate, minToY } from '../../utils/time';
import Icon from '../common/Icon';
import { POPOVER_CLASS, POPOVER_ROW_DANGER_CLASS } from '../common/formStyles';
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
  /**
   * Minutes from midnight of the red 현재 시각 line (M7b). Only the day that
   * *is* today gets one — on any other column the line would be a lie.
   */
  nowMin?: number;
  /** Straight-line gaps between consecutive located stops (M7b). */
  gaps?: readonly DayGap[];
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
  nowMin,
  gaps,
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
  const entryById = new Map(entries.map((entry) => [entry.id, entry]));
  const showNow = nowMin !== undefined && Number.isFinite(nowMin);

  return (
    <section
      data-testid="timeline-day"
      data-day-id={day.id}
      aria-label={dayTitle(day, index)}
      className={`flex flex-col border-l border-line ${fullWidth ? 'min-w-0 flex-1' : 'shrink-0'}`}
      style={fullWidth ? undefined : { width: DAY_COLUMN_PX }}
    >
      {/* Below `lg` the pager above the grid says all of this, so the header
          folds down to a screen-reader line rather than repeating itself
          (M9 §4.4-2). It stays in the DOM: it is this day's accessible name. */}
      <header
        ref={headerRef}
        data-testid="timeline-day-header"
        className={
          fullWidth
            ? 'sr-only'
            : 'sticky top-0 z-20 flex items-center gap-1 border-b border-line bg-surface/95 px-2 backdrop-blur'
        }
        style={fullWidth ? undefined : { height: HEADER_PX }}
      >
        <div className="min-w-0 flex-1">
          <p data-testid="timeline-day-title" className="truncate text-label font-semibold text-ink">
            {dayTitle(day, index)}
          </p>
          <p className="truncate text-micro font-normal text-ink-muted">
            {daySubtitle(day, index)}
          </p>
        </div>
        {/* On mobile the pager carries the day's money chip instead — one
            `day-spend` per visible day, wherever the day heading lives.
            The slot is reserved either way so headers stay on one rhythm. */}
        {fullWidth ? null : (
          <span className="flex w-14 shrink-0 justify-end">
            <SpendChip totals={spend} currency={currency} testId="day-spend" dayId={day.id} />
          </span>
        )}
        <span
          data-testid="timeline-day-count"
          className="rounded-full bg-sunken px-2 py-px text-micro tabular-nums text-ink-muted"
        >
          {entries.length}
        </span>
        {/* The pager owns the ⋯ on mobile; one menu per visible day, always. */}
        {fullWidth ? null : (
          <>
            <button
              type="button"
              data-testid="day-menu"
              aria-label={`${dayTitle(day, index)} 메뉴`}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
              className="-m-1 grid h-8 w-8 shrink-0 place-items-center rounded-full p-1 text-ink-faint transition-colors duration-[140ms] ease-quick hover:bg-sunken hover:text-ink"
            >
              <Icon name="more" size={16} />
            </button>

            {menuOpen ? (
              <div data-testid="day-menu-panel" className={`${POPOVER_CLASS} right-1 top-full`}>
                <button
                  type="button"
                  data-testid="day-delete"
                  onClick={() => {
                    setMenuOpen(false);
                    onDeleteDay(day);
                  }}
                  className={POPOVER_ROW_DANGER_CLASS}
                >
                  <Icon name="trash" size={16} />
                  삭제
                </button>
              </div>
            ) : null}
          </>
        )}
      </header>

      <div
        ref={gridRef}
        data-testid="timeline-day-grid"
        data-day-id={day.id}
        className={`relative transition-colors duration-[140ms] ease-quick ${
          isOver ? 'bg-sunken ring-2 ring-line-strong ring-inset' : 'bg-surface'
        }`}
        style={{ height: DAY_HEIGHT_PX }}
      >
        {HOURS.map((hour) => (
          <div
            key={hour}
            aria-hidden="true"
            className={
              hour % 6 === 0
                ? 'absolute inset-x-0 border-t border-line-strong/60'
                : 'absolute inset-x-0 border-t border-line/70'
            }
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
              icon={column?.icon ?? '📌'}
              lane={lanes[entry.id] ?? { id: entry.id, lane: 0, lanes: 1 }}
              onOpen={onOpenEntry}
            />
          );
        })}

        {/* 이동 갭: a straight-line fact between two located stops, parked at
            the midpoint of the empty stretch. `pointer-events-none` keeps the
            grid's drop target underneath it intact.

            When there is no empty stretch at all (`gapMin <= 0`, the back-to-back
            case the 시간이 부족해요 chip exists for) the midpoint lands *inside*
            the next entry, on top of the now-line badge. Then the chip hangs off
            the previous entry's end line instead, right-aligned. */}
        {(gaps ?? []).map((gap) => {
          const after = entryById.get(gap.afterEntryId);
          if (!after) return null;
          const endMin = after.startMin + after.durationMin;
          const spaced = gap.gapMin > 0;
          const topMin = spaced ? endMin + gap.gapMin / 2 : endMin;
          const distance = formatDistanceKm(gap.distanceKm);
          if (!distance) return null;

          return (
            <div
              key={`gap-${gap.afterEntryId}`}
              data-testid="gap-chip"
              data-after={gap.afterEntryId}
              data-km={gap.distanceKm.toFixed(2)}
              data-impossible={gap.impossible ? 'true' : 'false'}
              style={{ top: minToY(topMin, PX_PER_MIN) }}
              className={[
                'pointer-events-none absolute z-10',
                spaced ? 'left-1/2 -translate-x-1/2 -translate-y-1/2' : 'right-1 -translate-y-full',
              ].join(' ')}
            >
              <span
                className={[
                  'inline-flex h-6 max-w-[13rem] items-center gap-1 rounded-full px-2 text-micro tabular-nums',
                  gap.impossible
                    ? 'bg-warn-wash text-warn-ink ring-1 ring-warn/40'
                    : 'bg-sunken text-ink-muted',
                ].join(' ')}
              >
                <Icon name="arrow-up-down" size={16} />
                <span className="truncate">
                  직선 {distance}
                  {gap.impossible ? ' · 시간이 부족해요' : ''}
                </span>
              </span>
            </div>
          );
        })}

        {showNow ? (
          <div
            data-testid="now-line"
            data-min={Math.round(nowMin as number)}
            aria-hidden="true"
            style={{ top: minToY(nowMin as number, PX_PER_MIN) }}
            className="pointer-events-none absolute inset-x-0 z-30 flex items-center"
          >
            <span className="rounded-full bg-now px-2 py-px text-micro leading-none text-surface tabular-nums">
              {formatClock(nowMin as number)}
            </span>
            <span className="h-px flex-1 bg-now" />
          </div>
        ) : null}
      </div>
    </section>
  );
}
