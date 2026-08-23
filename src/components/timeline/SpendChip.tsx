import { useEffect, useRef, useState } from 'react';
import type { Id } from '../../types/models';
import { formatBudget, formatCompactAmount } from '../../utils/money';
import { hasSpend, type SpendTotals } from '../../utils/spend';

interface SpendChipProps {
  totals: SpendTotals;
  /** Trip currency — drives both the compact label and the popover. */
  currency: string;
  /** `day-spend` or `sheet-spend`. */
  testId: string;
  /** Written out as `data-day-id` when present. */
  dayId?: Id;
  /** Extra positioning classes from the caller. */
  className?: string;
}

/**
 * The 💸/💰 money chip of a day (or of a whole sheet).
 *
 * It shows **one** number so it fits a 224px day header — 지출 when anything
 * has been spent, otherwise the 예산 that is still just a plan — and hands over
 * the full pair on tap. The `title` carries the same two lines, so hovering on
 * a desktop and reading it out of the DOM both work without opening anything.
 *
 * Renders nothing at all when the day has neither budget nor spend.
 */
export default function SpendChip({
  totals,
  currency,
  testId,
  dayId,
  className = '',
}: SpendChipProps) {
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

  if (!hasSpend(totals)) return null;

  const spent = totals.spent > 0;
  const label = formatCompactAmount(spent ? totals.spent : totals.budget, currency);
  const budgetLine = `예산 ${formatBudget(totals.budget, currency)}`;
  const spentLine = `지출 ${formatBudget(totals.spent, currency)}`;

  return (
    <div ref={rootRef} className={`relative shrink-0 ${className}`}>
      <button
        type="button"
        data-testid={testId}
        data-day-id={dayId}
        data-budget={totals.budget}
        data-spent={totals.spent}
        aria-expanded={open}
        title={`${budgetLine} / ${spentLine}`}
        onClick={() => setOpen((value) => !value)}
        className={[
          'rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums transition-colors',
          spent ? 'bg-amber-100 text-amber-700' : 'bg-stone-100 text-stone-500',
        ].join(' ')}
      >
        {spent ? '💸' : '💰'} {label}
      </button>

      {open ? (
        <div
          data-testid={`${testId}-popover`}
          className="absolute right-0 top-full z-40 mt-1 w-32 overflow-hidden rounded-xl border border-stone-200 bg-white py-1 shadow-lg"
        >
          <p
            data-testid={`${testId}-budget`}
            className="px-2.5 py-1 text-[11px] tabular-nums text-stone-500"
          >
            {budgetLine}
          </p>
          <p
            data-testid={`${testId}-spent`}
            className="px-2.5 py-1 text-[11px] font-semibold tabular-nums text-stone-700"
          >
            {spentLine}
          </p>
        </div>
      ) : null}
    </div>
  );
}
