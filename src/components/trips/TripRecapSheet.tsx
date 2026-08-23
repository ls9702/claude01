import { useMemo } from 'react';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import type { BoardColumn, Card, Id, Trip } from '../../types/models';
import { todayIso } from '../../timeline/today';

import {
  FLIGHT_CARD_PREFIX,
  diffDaysIso,
  formatShortDate,
  isIsoDate,
} from '../../utils/flights';
import { formatBudget } from '../../utils/money';
import { cardSpent, tripCardIds, tripSpend } from '../../utils/spend';
import { EmojiIcon } from '../common/Icon';
import Sheet from '../common/Sheet';
import { SECTION_TITLE_CLASS } from '../common/formStyles';

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

  const spentCategories = categories.filter((row) => row.spent);
  const plannedCategories = categories.filter((row) => !row.spent);

  /**
   * One ranking row. The bar's job is length, not hue — the name beside it
   * already says which category this is, so a full-colour bar only added a
   * sixth palette to the screen (M9 §4.6-1).
   */
  const categoryRow = (row: CategoryTotal) => (
    <li
      key={row.column.id}
      data-testid="recap-cat-bar"
      data-column-id={row.column.id}
      data-amount={row.amount}
      data-spent={row.spent ? 'true' : 'false'}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1 truncate text-label font-normal text-ink">
          <EmojiIcon emoji={row.column.icon} className="bg-surface/70" />
          {row.column.name}
        </span>
        <span className="shrink-0 text-label font-semibold tabular-nums text-ink">
          {formatBudget(row.amount, trip.currency)}
        </span>
      </div>
      <div
        className={`mt-1 h-2 overflow-hidden rounded-full ${
          row.spent ? 'bg-sunken' : 'bg-transparent ring-1 ring-line ring-inset'
        }`}
      >
        {row.spent ? (
          <div
            className="h-full rounded-full bg-inverse"
            style={{
              width: `${categoryMax > 0 ? Math.max((row.amount / categoryMax) * 100, 4) : 0}%`,
            }}
          />
        ) : null}
      </div>
    </li>
  );

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
      <div className="space-y-6">
        <p data-testid="recap-trip-title" className="text-title text-ink">
          {trip.title}
          {period ? (
            <span data-testid="recap-period" className="ml-2 text-label text-ink-muted">
              {period.range} · {period.tail}
            </span>
          ) : null}
        </p>

        <section className="rounded-lg bg-sunken px-4 py-4">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-micro text-ink-muted">총지출</p>
              <p
                data-testid="recap-spent"
                data-amount={totals.spent}
                className="text-display tabular-nums text-ink"
              >
                {formatBudget(totals.spent, trip.currency)}
              </p>
            </div>
            <div className="text-right">
              <p className="text-micro text-ink-muted">총예산</p>
              <p
                data-testid="recap-budget"
                data-amount={totals.budget}
                className="text-title tabular-nums text-ink-muted"
              >
                {formatBudget(totals.budget, trip.currency)}
              </p>
            </div>
          </div>

          <p
            data-testid="recap-diff"
            data-amount={diff}
            data-over={overspent ? 'true' : 'false'}
            className={`mt-3 text-label font-semibold tabular-nums ${
              overspent ? 'text-danger' : 'text-ok'
            }`}
          >
            {overspent
              ? `예산보다 ${formatBudget(Math.abs(diff), trip.currency)} 더 썼어요`
              : `예산이 ${formatBudget(diff, trip.currency)} 남았어요`}
          </p>
        </section>

        <section>
          <h3 className={SECTION_TITLE_CLASS}>카테고리별</h3>
          {categories.length === 0 ? (
            <p className="mt-2 rounded-md bg-sunken px-3 py-2 text-label font-normal text-ink-faint">
              아직 예산도 지출도 없어요.
            </p>
          ) : (
            <>
              <ul className="mt-2 space-y-3">{spentCategories.map(categoryRow)}</ul>
              {plannedCategories.length > 0 ? (
                <>
                  {/* Budget and spend are two different questions; ranking them
                      in one list was what forced the "(예산)" hedge (§4.6-2). */}
                  <p className="mt-4 text-micro text-ink-faint">아직 지출 없음</p>
                  <ul className="mt-2 space-y-3">{plannedCategories.map(categoryRow)}</ul>
                </>
              ) : null}
            </>
          )}
        </section>

        <section>
          <h3 className={SECTION_TITLE_CLASS}>지출 Top {TOP_ROWS}</h3>
          {topCards.length === 0 ? (
            <p className="mt-2 rounded-md bg-sunken px-3 py-2 text-label font-normal text-ink-faint">
              아직 기록한 지출이 없어요.
            </p>
          ) : (
            <ul className="mt-2">
              {topCards.map((card, index) => {
                const title = card.title;
                const icon = workspace.columns[card.columnId]?.icon ?? '📌';
                // Rank, name, money: three sizes, so the eye can skim one
                // column at a time instead of reading every row (§4.6-3).
                return (
                  <li key={card.id}>
                    <button
                      type="button"
                      data-testid="recap-top-row"
                      data-card-id={card.id}
                      data-amount={cardSpent(card)}
                      onClick={() => onOpenCard(card.id)}
                      // A ranking is a table of five, not five cards: one
                      // 44px row per line, told apart by a hairline (§4.6-3).
                      className="flex h-11 w-full items-center gap-2 border-b border-line px-3 text-left transition-colors duration-[140ms] ease-quick hover:bg-sunken"
                    >
                      <span className="w-4 shrink-0 text-micro font-normal tabular-nums text-ink-faint">
                        {index + 1}
                      </span>
                      {title.trimStart().startsWith(FLIGHT_CARD_PREFIX) ? null : (
                        <EmojiIcon emoji={icon} className="bg-surface/70" />
                      )}
                      <span className="min-w-0 flex-1 truncate text-label font-normal text-ink">
                        {title}
                      </span>
                      <span className="shrink-0 text-label font-semibold tabular-nums text-ink">
                        {formatBudget(cardSpent(card), trip.currency)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </Sheet>
  );
}
