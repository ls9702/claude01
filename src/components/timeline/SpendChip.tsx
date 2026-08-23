import { useEffect, useRef, useState } from 'react';
import type { Id } from '../../types/models';
import { formatBudget, formatCompactAmount } from '../../utils/money';
import { hasSpend, type SpendTotals } from '../../utils/spend';
import Icon from '../common/Icon';
import { CHIP_MONEY, CHIP_NEUTRAL, POPOVER_CLASS } from '../common/formStyles';

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
        className={spent ? CHIP_MONEY : CHIP_NEUTRAL}
      >
        <Icon name={spent ? 'receipt' : 'wallet'} size={16} />
        {label}
      </button>

      {open ? (
        <div data-testid={`${testId}-popover`} className={`${POPOVER_CLASS} right-0 top-full`}>
          <p
            data-testid={`${testId}-budget`}
            className="px-3 py-2 text-label font-normal tabular-nums text-ink-muted"
          >
            {budgetLine}
          </p>
          <p
            data-testid={`${testId}-spent`}
            className="px-3 py-2 text-label font-semibold tabular-nums text-ink"
          >
            {spentLine}
          </p>
        </div>
      ) : null}
    </div>
  );
}
