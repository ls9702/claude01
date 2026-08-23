import { useMemo } from 'react';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import type { BoardColumn, Card, Id, Trip } from '../../types/models';
import { todayIso } from '../../timeline/today';
import { colorClasses, colorHex } from '../../utils/colors';
import { diffDaysIso, formatShortDate, isIsoDate } from '../../utils/flights';
import { formatBudget } from '../../utils/money';
import { cardSpent, tripCardIds, tripSpend } from '../../utils/spend';
import Sheet from '../common/Sheet';

interface TripRecapSheetProps {
  trip: Trip;
  /** Hands a card to the 보드 tab, which opens its edit sheet. */
  onOpenCard: (cardId: Id) => void;
  onClose: () => void;
}

/** How many rows the 지출 Top list shows. */
const TOP_ROWS = 5;

interface CategoryTotal {
  column: BoardColumn;
  /** 지출 when there is any, else the 예산 that is still just a plan. */
  amount: number;
  spent: boolean;
}

/**
 * 여행 결산 (M7b): where the money went, in one screen.
 *
 * Counts exactly what {@link tripSpend} counts — the unique cards actually
 * placed somewhere in the trip — so the big number, the category bars and the
 * Top 5 can never contradict each other or the 일정 tab's chips. Deliberately
 * **not** here: a per-day bar chart and a 텍스트 복사 button; both were cut in
 * the design debate as noise on a phone screen.
 */
export default function TripRecapSheet({ trip, onOpenCard, onClose }: TripRecapSheetProps) {
  const workspace = useWorkspaceStore((s) => s.workspace);

  const totals = useMemo(() => tripSpend(workspace, trip.id), [workspace, trip.id]);

  /** The counted cards, as records. */
  const cards = useMemo<Card[]>(
    () =>
      tripCardIds(workspace, trip.id)
        .map((cardId) => workspace.cards[cardId])
        .filter((card): card is Card => Boolean(card)),
    [workspace, trip.id],
  );

  const categories = useMemo<CategoryTotal[]>(() => {
    const byColumn = new Map<Id, { budget: number; spent: number }>();
    for (const card of cards) {
      const acc = byColumn.get(card.columnId) ?? { budget: 0, spent: 0 };
      if (typeof card.budget === 'number' && Number.isFinite(card.budget)) acc.budget += card.budget;
      acc.spent += cardSpent(card);
      byColumn.set(card.columnId, acc);
    }

    return trip.columnOrder
      .map((columnId) => {
        const column = workspace.columns[columnId];
        const acc = byColumn.get(columnId);
        if (!column || !acc) return null;
        const spent = acc.spent > 0;
        return { column, amount: spent ? acc.spent : acc.budget, spent } satisfies CategoryTotal;
      })
      .filter((row): row is CategoryTotal => Boolean(row) && (row as CategoryTotal).amount > 0)
      .sort((a, b) => b.amount - a.amount);
  }, [cards, trip.columnOrder, workspace.columns]);

  const categoryMax = categories.reduce((max, row) => Math.max(max, row.amount), 0);

  const topCards = useMemo<Card[]>(
    () =>
      cards
        .filter((card) => cardSpent(card) > 0)
        .sort((a, b) => cardSpent(b) - cardSpent(a) || (a.id < b.id ? -1 : 1))
        .slice(0, TOP_ROWS),
    [cards],
  );

  /** 기간 / D-day, from the dates the trip's days actually carry. */
  const period = useMemo(() => {
    const dates: string[] = [];
    for (const day of Object.values(workspace.days)) {
      if (day.tripId === trip.id && isIsoDate(day.date)) dates.push(day.date);
    }
    if (dates.length === 0) return null;

    dates.sort();
    const start = dates[0];
    const end = dates[dates.length - 1];
    const days = diffDaysIso(start, end) + 1;
    const today = todayIso(new Date());
    const untilStart = diffDaysIso(today, start);

    const range =
      start === end ? formatShortDate(start) : `${formatShortDate(start)} ~ ${formatShortDate(end)}`;
    return { range, tail: untilStart > 0 ? `D-${untilStart}` : `${days}일간` };
  }, [workspace.days, trip.id]);

  const diff = totals.budget - totals.spent;
  const overspent = diff < 0;

  return (
    <Sheet title="결산" onClose={onClose} testId="recap-sheet">
      <div className="space-y-5">
        <p data-testid="recap-trip-title" className="text-sm font-semibold text-stone-700">
          {trip.title}
          {period ? (
            <span data-testid="recap-period" className="ml-1.5 text-xs font-normal text-stone-400">
              {period.range} · {period.tail}
            </span>
          ) : null}
        </p>

        <section className="rounded-2xl bg-stone-50 px-4 py-3.5">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold text-stone-400">총지출</p>
              <p
                data-testid="recap-spent"
                data-amount={totals.spent}
                className="text-2xl font-bold tabular-nums text-stone-800"
              >
                {formatBudget(totals.spent, trip.currency)}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[11px] font-semibold text-stone-400">총예산</p>
              <p
                data-testid="recap-budget"
                data-amount={totals.budget}
                className="text-base font-semibold tabular-nums text-stone-500"
              >
                {formatBudget(totals.budget, trip.currency)}
              </p>
            </div>
          </div>

          <p
            data-testid="recap-diff"
            data-amount={diff}
            data-over={overspent ? 'true' : 'false'}
            className={`mt-2 text-xs font-semibold tabular-nums ${
              overspent ? 'text-rose-600' : 'text-emerald-600'
            }`}
          >
            {overspent
              ? `예산보다 ${formatBudget(Math.abs(diff), trip.currency)} 더 썼어요`
              : `예산이 ${formatBudget(diff, trip.currency)} 남았어요`}
          </p>
        </section>

        <section>
          <p className="text-xs font-semibold text-stone-500">카테고리별</p>
          {categories.length === 0 ? (
            <p className="mt-1.5 rounded-xl bg-stone-50 px-3 py-2.5 text-xs text-stone-400">
              아직 예산도 지출도 없어요.
            </p>
          ) : (
            <ul className="mt-1.5 space-y-2">
              {categories.map((row) => (
                <li
                  key={row.column.id}
                  data-testid="recap-cat-bar"
                  data-column-id={row.column.id}
                  data-amount={row.amount}
                  data-spent={row.spent ? 'true' : 'false'}
                >
                  <div className="flex items-baseline justify-between gap-2 text-xs">
                    <span className="min-w-0 truncate text-stone-600">
                      <span aria-hidden="true">{row.column.icon}</span> {row.column.name}
                    </span>
                    <span className="shrink-0 font-semibold tabular-nums text-stone-700">
                      {formatBudget(row.amount, trip.currency)}
                      {row.spent ? '' : ' (예산)'}
                    </span>
                  </div>
                  <div className={`mt-1 h-2 overflow-hidden rounded-full ${colorClasses(row.column.color).surface}`}>
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${categoryMax > 0 ? Math.max((row.amount / categoryMax) * 100, 4) : 0}%`,
                        backgroundColor: colorHex(row.column.color),
                      }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <p className="text-xs font-semibold text-stone-500">지출 Top {TOP_ROWS}</p>
          {topCards.length === 0 ? (
            <p className="mt-1.5 rounded-xl bg-stone-50 px-3 py-2.5 text-xs text-stone-400">
              아직 기록한 지출이 없어요.
            </p>
          ) : (
            <ul className="mt-1.5 space-y-1">
              {topCards.map((card, index) => (
                <li key={card.id}>
                  <button
                    type="button"
                    data-testid="recap-top-row"
                    data-card-id={card.id}
                    data-amount={cardSpent(card)}
                    onClick={() => onOpenCard(card.id)}
                    className="flex w-full items-center gap-2 rounded-xl bg-stone-50 px-3 py-2 text-left transition-colors hover:bg-stone-100"
                  >
                    <span className="w-3 shrink-0 text-[11px] font-bold tabular-nums text-stone-400">
                      {index + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-xs text-stone-700">
                      <span aria-hidden="true">
                        {workspace.columns[card.columnId]?.icon ?? '🗓'}
                      </span>{' '}
                      {card.title}
                    </span>
                    <span className="shrink-0 text-xs font-semibold tabular-nums text-stone-800">
                      {formatBudget(cardSpent(card), trip.currency)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Sheet>
  );
}
