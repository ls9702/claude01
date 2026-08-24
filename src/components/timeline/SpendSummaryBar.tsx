import { useEffect, useRef, useState } from 'react';
import type { BoardColumn, Id } from '../../types/models';
import { colorClasses } from '../../utils/colors';
import { formatCompactAmount } from '../../utils/money';
import { hasSpend, type SpendTotals, type UnplacedSpend } from '../../utils/spend';
import Icon, { EmojiIcon } from '../common/Icon';
import { POPOVER_CLASS } from '../common/formStyles';

/** One category row of the 카테고리별 popover. */
interface CategoryRow {
  column: BoardColumn;
  totals: SpendTotals;
}

interface SpendSummaryBarProps {
  /** 예산/지출 of the whole active sheet. */
  sheetTotals: SpendTotals;
  /** The day the grid is actually showing, if there is exactly one. */
  day?: { id: Id; label: string; totals: SpendTotals };
  /** Every category of the trip that carries money on this sheet. */
  categories: readonly CategoryRow[];
  /** What the sheet total leaves out, so the bar can own up to it. */
  unplaced: UnplacedSpend;
  currency: string;
}

/** `지출 12.3만` / `예산 20만` — one label, one number, always in that order. */
function Fact({
  label,
  amount,
  currency,
  strong = false,
}: {
  label: string;
  amount: number;
  currency: string;
  strong?: boolean;
}) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      <span className="text-micro text-ink-faint">{label}</span>
      <span
        className={`text-micro tabular-nums ${strong ? 'font-semibold text-ink' : 'text-ink-muted'}`}
      >
        {formatCompactAmount(amount, currency)}
      </span>
    </span>
  );
}

/**
 * 일정표 최상단 고정 지출 요약 바 (M16-A).
 *
 * One row, always in the same place, answering the only money question a
 * traveller asks mid-trip: **얼마 썼지?** — for the whole sheet, and for the day
 * in front of them. 지출 leads and 예산 follows, because by the time this bar
 * matters the plan has already become a receipt.
 *
 * Deliberately **one line and `h-10`** (S7): the 일정 tab on a phone already
 * spends its height on a header, the sheet tabs, the pager, the 지금/다음 bar
 * and the tray, and the grid is what the user came for. It is full-bleed with a
 * hairline under it rather than a floating card, so it costs 40px and not a
 * pixel more — no margins, no shadow, no second row.
 *
 * The day figures obey the M16-B window: 「오늘 지출」 counts the 새벽 2시 라멘
 * as last night's, exactly like the column behind it.
 */
export default function SpendSummaryBar({
  sheetTotals,
  day,
  categories,
  unplaced,
  currency,
}: SpendSummaryBarProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [open]);

  return (
    <div
      data-testid="spend-summary"
      // `sticky top-0` for the day the grid becomes the page scroller; as a
      // `shrink-0` flex row it is already pinned in today's layout. Both cost
      // nothing, and neither can slide away.
      className="sticky top-0 z-30 flex h-10 shrink-0 items-center gap-3 border-b border-line bg-surface px-4"
    >
      {/* The half that gives way first (B5).
          At 320px the row cannot hold both figures, and the one the traveller
          is reading mid-trip is 오늘. So the sheet half is the shrinkable one —
          `min-w-0` + `overflow-hidden`, label truncating before anything else —
          and the day half below is `shrink-0`. Losing the tail of 「시트 전체
          지출 …」 costs a number that is one tap away in 카테고리별; losing the
          day figure costs the number the bar exists for. */}
      <span
        data-testid="spend-summary-sheet"
        data-spent={sheetTotals.spent}
        data-budget={sheetTotals.budget}
        className="flex min-w-0 items-center gap-2 overflow-hidden"
      >
        <Icon name="receipt" size={16} className="shrink-0 text-ink-faint" />
        <span className="min-w-0 truncate text-micro text-ink-faint">시트 전체</span>
        <Fact label="지출" amount={sheetTotals.spent} currency={currency} strong />
        {/* Below `sm` the row is out of space and something has to go. The
            budget goes — the same call the day half already makes one line
            down — because a 예산 sliced through the middle of its digits by
            `overflow-hidden` reads as a *different number*, and 카테고리별 is
            one tap away with both figures intact. */}
        <span aria-hidden="true" className="hidden text-micro text-ink-faint sm:inline">
          ·
        </span>
        <span className="hidden sm:inline">
          <Fact label="예산" amount={sheetTotals.budget} currency={currency} />
        </span>
      </span>

      {day ? (
        <>
          <span aria-hidden="true" className="h-4 w-px shrink-0 bg-line" />
          <span
            data-testid="spend-summary-day"
            data-day-id={day.id}
            data-spent={day.totals.spent}
            data-budget={day.totals.budget}
            className="flex shrink-0 items-center gap-2"
          >
            <span className="shrink-0 text-micro text-ink-faint">{day.label}</span>
            <Fact label="지출" amount={day.totals.spent} currency={currency} strong />
            <span aria-hidden="true" className="hidden text-micro text-ink-faint sm:inline">
              ·
            </span>
            <span className="hidden sm:inline">
              <Fact label="예산" amount={day.totals.budget} currency={currency} />
            </span>
          </span>
        </>
      ) : null}

      <div ref={rootRef} className="relative ml-auto shrink-0">
        <button
          type="button"
          data-testid="spend-summary-cats-open"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className="inline-flex h-8 items-center gap-1 rounded-full px-2 text-micro text-ink-muted transition-colors duration-[140ms] ease-quick hover:bg-sunken hover:text-ink"
        >
          카테고리별
          <Icon name={open ? 'chevron-up' : 'chevron-down'} size={16} />
        </button>

        {open ? (
          <div
            data-testid="spend-summary-cats"
            className={`${POPOVER_CLASS} right-0 top-full min-w-[15rem] max-w-[20rem]`}
          >
            {categories.length === 0 ? (
              <p className="px-3 py-2 text-label font-normal text-ink-muted">
                아직 기록된 금액이 없어요
              </p>
            ) : (
              <ul>
                {categories.map(({ column, totals }) => (
                  <li key={column.id}>
                    <span
                      data-testid="spend-cat-row"
                      data-column-id={column.id}
                      data-spent={totals.spent}
                      data-budget={totals.budget}
                      className="flex items-center gap-2 px-3 py-2 text-label text-ink"
                    >
                      <EmojiIcon emoji={column.icon} />
                      <span
                        aria-hidden="true"
                        className={`h-2 w-2 shrink-0 rounded-full ${colorClasses(column.color).dot}`}
                      />
                      <span className="min-w-0 flex-1 truncate font-normal">{column.name}</span>
                      <span className="shrink-0 tabular-nums">
                        <span className="font-semibold">
                          {formatCompactAmount(totals.spent, currency)}
                        </span>
                        <span className="text-ink-faint">
                          {`(${formatCompactAmount(totals.budget, currency)})`}
                        </span>
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {/* Same admission the 결산 makes (B14): the sheet total counts what
                is on the timeline, and the board shows money that is not. */}
            {unplaced.count > 0 ? (
              <p
                data-testid="spend-summary-unplaced"
                data-count={unplaced.count}
                className="border-t border-line px-3 py-2 text-micro font-normal text-ink-faint"
              >
                {`미배치 카드 ${unplaced.count}장의 예산/지출은 제외됐어요`}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The category rows for a sheet, ready to render: biggest 지출 first, then
 * biggest 예산, then board order — and nothing that carries no money at all.
 *
 * A zero row would be one more line to read past on the way to the number that
 * matters, and 「관광 0원(0원)」 is not information the traveller lacked.
 */
export function categoryRows(
  columns: readonly BoardColumn[],
  byColumn: Record<Id, SpendTotals>,
): CategoryRow[] {
  return columns
    .map((column, index) => ({ column, totals: byColumn[column.id], index }))
    .filter(
      (row): row is { column: BoardColumn; totals: SpendTotals; index: number } =>
        Boolean(row.totals) && hasSpend(row.totals as SpendTotals),
    )
    .sort(
      (a, b) =>
        b.totals.spent - a.totals.spent ||
        b.totals.budget - a.totals.budget ||
        a.index - b.index,
    )
    .map(({ column, totals }) => ({ column, totals }));
}
