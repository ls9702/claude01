import { useCallback, useEffect, useRef, useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { useRegisterDayGrid } from '../../dnd/PlanDndContext';
import { DND_DAY, dayDroppableId } from '../../dnd/planDnd';
import type { BoardColumn, Card, Day, Id, TimelineEntry } from '../../types/models';
import type { DayGap } from '../../timeline/gap';
import { dayTitle, daySubtitle } from '../../timeline/dayLabel';
import { clockToOffset, type WindowedEntry } from '../../timeline/dayWindow';
import { formatDistanceKm } from '../../timeline/route';
import {
  DAY_COLUMN_PX,
  DAY_HEIGHT_PX,
  HEADER_PX,
  PX_PER_MIN,
  laneMap,
} from '../../timeline/layout';
import type { SpendTotals } from '../../utils/spend';
import { DAY_START_MIN, formatClock, minToY } from '../../utils/time';
import Icon from '../common/Icon';
import { POPOVER_CLASS, POPOVER_ROW_DANGER_CLASS } from '../common/formStyles';
import EntryBlock from './EntryBlock';
import SpendChip from './SpendChip';
import { HOURS } from './TimeAxis';

interface DayColumnProps {
  day: Day;
  /** Position inside the sheet's `dayOrder`, for the `N일차` fallback. */
  index: number;
  /**
   * The entries this column **draws** — the ones whose effective 05시 day is
   * this one, each with the placement that says where (M16-B). Not the same set
   * as "entries whose `dayId` is this day": 새벽 entries of the next day are in
   * here, and this day's own 새벽 entries are usually in the previous column.
   */
  entries: readonly WindowedEntry[];
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
  /**
   * Where that line is **drawn**, when it is not simply `clockToOffset(nowMin)`.
   *
   * The one case is the 새벽 before the sheet's first day (B6): 04:00 is 19
   * hours down this column by the clock, and one hour *above* its top edge by
   * the calendar. The caller has already resolved which — see
   * {@link import('../../timeline/today').todayFocus}.
   */
  nowOffsetMin?: number;
  /** Straight-line gaps between consecutive located stops (M7b). */
  gaps?: readonly DayGap[];
}

/**
 * Highest a 이동 갭 chip may be parked, in window minutes.
 *
 * The chip is `h-6` and centred on its minute (`-translate-y-1/2`), so half of
 * it — 12px — hangs above `top`; two more pixels keep it off the hairline. That
 * many minutes down, and the whole chip is inside the column instead of over
 * the day header above it.
 */
const GAP_CHIP_MIN_MIN = Math.ceil(14 / PX_PER_MIN);

/**
 * One day of the sheet: a sticky header plus the 05:00 → 05:00 grid (M16-B).
 *
 * The **grid is a single droppable** — entries inside it are draggable but not
 * droppable, so a drop always resolves to this *visual* day and the exact
 * minute comes from the pointer's Y offset inside this element. Below the
 * 24:00 line that offset resolves to the **next** calendar day; `dropTarget`
 * in `PlanDndContext` owns that translation, not this component.
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
  nowOffsetMin,
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

  // Lanes are packed over the **drawn** spans, not the stored ones: two 새벽
  // entries pinned to the same top edge overlap on screen even though their
  // clock times do not, and they have to end up side by side to stay tappable.
  const lanes = laneMap(
    entries.map((row) => ({
      id: row.entry.id,
      startMin: row.placement.offsetMin,
      durationMin: row.placement.drawMin,
    })),
  );
  const rowById = new Map(entries.map((row) => [row.entry.id, row]));
  const showNow = nowMin !== undefined && Number.isFinite(nowMin);
  /** The red line lives in window space too — 02:00 is near the bottom. */
  const nowOffset = !showNow
    ? 0
    : Number.isFinite(nowOffsetMin)
      ? (nowOffsetMin as number)
      : clockToOffset(nowMin as number);

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
          {/* Nothing at all when the date is missing and the title is already
              `N일차` — an empty second line is still a line (B12). */}
          {daySubtitle(day, index) ? (
            <p className="truncate text-micro font-normal text-ink-muted">
              {daySubtitle(day, index)}
            </p>
          ) : null}
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
        {/* Hour lines, in window offsets. The heavier rule falls on 06/12/18
            and on **24:00** — the midnight boundary is the one line in this
            column that changes which calendar day you are looking at. */}
        {HOURS.map((offset) => (
          <div
            key={offset}
            aria-hidden="true"
            className={
              (DAY_START_MIN + offset) % 360 === 0
                ? 'absolute inset-x-0 border-t border-line-strong/60'
                : 'absolute inset-x-0 border-t border-line/70'
            }
            style={{ top: minToY(offset, PX_PER_MIN) }}
          />
        ))}

        {entries.map(({ entry, placement }) => {
          const card = cards[entry.cardId];
          const column = card ? columns[card.columnId] : undefined;
          return (
            <EntryBlock
              key={entry.id}
              entry={entry}
              placement={placement}
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
            the next entry. Then the chip straddles the boundary line the two
            entries share — centred **on** it (`-translate-y-1/2`), not hung
            above it, where it covered the previous block's time. `right-6`
            keeps it clear of the screen edge and of the now-line's clock. */}
        {(gaps ?? []).map((gap) => {
          const after = rowById.get(gap.afterEntryId);
          if (!after) return null;
          // Window offsets, like everything else drawn here: an end that spills
          // past the 24:00 line still hangs its chip where the block ends.
          const endMin = after.placement.rawOffsetMin + after.entry.durationMin;
          const spaced = gap.gapMin > 0;
          /**
           * …but never above the column's own top edge (B9).
           *
           * A first-day 새벽 stop has a **negative** `rawOffsetMin` — 02:00 is
           * 3시간 전이다 — so its chip's honest midpoint is off the top of the
           * grid, where it is either invisible or hidden under the sticky day
           * header. The block itself is pinned to offset 0 by the same rule
           * ({@link VisualPlacement.dawn}); the chip follows it down.
           */
          const topMin = Math.max(spaced ? endMin + gap.gapMin / 2 : endMin, GAP_CHIP_MIN_MIN);
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
                'pointer-events-none absolute z-10 -translate-y-1/2',
                spaced ? 'left-1/2 -translate-x-1/2' : 'right-6',
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
            data-offset-min={Math.round(nowOffset)}
            aria-hidden="true"
            style={{ top: minToY(nowOffset, PX_PER_MIN) }}
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
