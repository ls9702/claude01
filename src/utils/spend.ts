/**
 * 예산 / 지출 rollups (M6).
 *
 * Money is recorded **on the card** (`budget` planned, `expenses` spent), never
 * on a timeline entry. A day's total therefore counts *cards*, not placements:
 * a card scheduled twice on the same day — the hotel you pass by at noon and
 * again at night — is one card and one amount. The same rule applies one level
 * up: a card placed on several days of one sheet counts once per sheet.
 *
 * Pure and store-free so the 일정 chips, the 보드 chips and the tests can all
 * share it.
 */

import type { Card, Id, Workspace } from '../types/models';
import { datedAxis, visualPlacement, type DayAxis } from '../timeline/dayWindow';

/** 예산 / 지출 pair, in the trip's currency. */
export interface SpendTotals {
  /** Sum of `card.budget` over the counted cards. */
  budget: number;
  /** Sum of {@link cardSpent} over the counted cards. */
  spent: number;
}

const ZERO: SpendTotals = { budget: 0, spent: 0 };

/** Empty totals — handy for an unknown day/sheet. */
export const emptySpend = (): SpendTotals => ({ ...ZERO });

/** Total actually spent on one card. Missing/garbled amounts count as 0. */
export function cardSpent(card: Card | undefined): number {
  if (!card?.expenses?.length) return 0;
  let total = 0;
  for (const expense of card.expenses) {
    if (Number.isFinite(expense.amount)) total += expense.amount;
  }
  return total;
}

/** How many comments a card carries. */
export function cardCommentCount(card: Card | undefined): number {
  return card?.comments?.length ?? 0;
}

/** Adds up `budget` + `cardSpent` over a set of card ids, skipping unknowns. */
function totalOf(workspace: Workspace, cardIds: Iterable<Id>): SpendTotals {
  let budget = 0;
  let spent = 0;
  for (const cardId of cardIds) {
    const card = workspace.cards[cardId];
    if (!card) continue;
    if (typeof card.budget === 'number' && Number.isFinite(card.budget)) budget += card.budget;
    spent += cardSpent(card);
  }
  return { budget, spent };
}

/** The unique cards that have at least one entry on `dayId`. */
function cardIdsOnDay(workspace: Workspace, dayId: Id): Set<Id> {
  const cardIds = new Set<Id>();
  for (const entry of Object.values(workspace.entries)) {
    if (entry.dayId === dayId) cardIds.add(entry.cardId);
  }
  return cardIds;
}

/**
 * 예산/지출 of one day: over the **unique** cards scheduled on it.
 * An unknown day is `{ budget: 0, spent: 0 }`.
 */
export function daySpend(workspace: Workspace, dayId: Id): SpendTotals {
  return totalOf(workspace, cardIdsOnDay(workspace, dayId));
}

/**
 * 예산/지출 of one **window** day — 05시부터 다음 날 05시까지 (M16-B).
 *
 * Same de-duplication as {@link daySpend}; the only difference is membership.
 * An entry at 02:00 of 4일차 is money spent on the night of 3일차, so it counts
 * there — which is what the user sees on the grid, and the two must not
 * disagree. Every day-level surface (일자 칩, 요약 바) uses this one;
 * {@link daySpend} is kept for callers that really do mean the calendar day.
 *
 * Shifting the window never moves money **across** a sheet — an entry only ever
 * hops to the *previous day of the same sheet* — so {@link sheetSpend} and
 * {@link tripSpend} are untouched by M16 and still balance.
 */
export function daySpendWindowed(
  workspace: Workspace,
  dayId: Id,
  dayOrder: DayAxis,
): SpendTotals {
  const axis = datedAxis(dayOrder, workspace.days);
  const cardIds = new Set<Id>();
  for (const entry of Object.values(workspace.entries)) {
    if (visualPlacement(entry, axis).renderDayId === dayId) cardIds.add(entry.cardId);
  }
  return totalOf(workspace, cardIds);
}

/**
 * 예산/지출 of a whole sheet: over the unique cards scheduled anywhere in it.
 * Summing {@link daySpend} over the sheet's days would double-count a card
 * placed on two of them, so the de-duplication happens across the sheet.
 */
export function sheetSpend(workspace: Workspace, sheetId: Id): SpendTotals {
  const sheet = workspace.sheets[sheetId];
  if (!sheet) return emptySpend();

  const dayIds = new Set<Id>(sheet.dayOrder);
  // Defensive: a day that fell out of `dayOrder` still belongs to the sheet.
  for (const day of Object.values(workspace.days)) {
    if (day.sheetId === sheetId) dayIds.add(day.id);
  }

  const cardIds = new Set<Id>();
  for (const entry of Object.values(workspace.entries)) {
    if (dayIds.has(entry.dayId)) cardIds.add(entry.cardId);
  }
  return totalOf(workspace, cardIds);
}

/**
 * The unique cards {@link sheetSpend} counted, as ids.
 *
 * Exported so the 요약 바's 카테고리별 breakdown splits **exactly** the set the
 * sheet total is made of: a category list that does not add up to the number
 * above it is worse than no list.
 */
export function sheetCardIds(workspace: Workspace, sheetId: Id): Id[] {
  const sheet = workspace.sheets[sheetId];
  if (!sheet) return [];

  const dayIds = new Set<Id>(sheet.dayOrder);
  for (const day of Object.values(workspace.days)) {
    if (day.sheetId === sheetId) dayIds.add(day.id);
  }

  const cardIds = new Set<Id>();
  for (const entry of Object.values(workspace.entries)) {
    if (dayIds.has(entry.dayId) && workspace.cards[entry.cardId]) cardIds.add(entry.cardId);
  }
  return [...cardIds];
}

/**
 * 예산/지출 of one sheet, split by the board column each card sits in (M16-A).
 *
 * Keyed by `columnId`; a column with no counted card is simply absent, so the
 * caller can render "every category that has something" without filtering.
 * Day windows are irrelevant here — the scope is the whole sheet, and no
 * window shift ever moves a card out of it.
 */
export function sheetSpendByColumn(
  workspace: Workspace,
  sheetId: Id,
): Record<Id, SpendTotals> {
  const byColumn: Record<Id, SpendTotals> = {};
  for (const cardId of sheetCardIds(workspace, sheetId)) {
    const card = workspace.cards[cardId];
    if (!card) continue;
    const totals = (byColumn[card.columnId] ??= emptySpend());
    if (typeof card.budget === 'number' && Number.isFinite(card.budget)) {
      totals.budget += card.budget;
    }
    totals.spent += cardSpent(card);
  }
  return byColumn;
}

/**
 * 예산/지출 of a whole trip: over the unique cards scheduled anywhere in it —
 * on any day of any sheet (M7b, 여행 결산).
 *
 * Same de-duplication rule as {@link sheetSpend}, one level up: a card that
 * appears on two sheets (the 플랜 A / 플랜 B of the same hotel) is one card and
 * one amount, so the 결산 is never the sum of the sheet chips.
 */
export function tripSpend(workspace: Workspace, tripId: Id): SpendTotals {
  if (!workspace.trips[tripId]) return emptySpend();

  const dayIds = new Set<Id>();
  for (const day of Object.values(workspace.days)) {
    if (day.tripId === tripId) dayIds.add(day.id);
  }

  const cardIds = new Set<Id>();
  for (const entry of Object.values(workspace.entries)) {
    if (dayIds.has(entry.dayId)) cardIds.add(entry.cardId);
  }
  return totalOf(workspace, cardIds);
}

/** The unique cards {@link tripSpend} counted, as ids — for the 결산 breakdowns. */
export function tripCardIds(workspace: Workspace, tripId: Id): Id[] {
  if (!workspace.trips[tripId]) return [];

  const dayIds = new Set<Id>();
  for (const day of Object.values(workspace.days)) {
    if (day.tripId === tripId) dayIds.add(day.id);
  }

  const cardIds = new Set<Id>();
  for (const entry of Object.values(workspace.entries)) {
    if (dayIds.has(entry.dayId) && workspace.cards[entry.cardId]) cardIds.add(entry.cardId);
  }
  return [...cardIds];
}

/** What {@link tripSpend} deliberately left out, so the 결산 can own up to it. */
export interface UnplacedSpend extends SpendTotals {
  /** How many 미배치 cards carry money — the `N` of the 결산's hint line. */
  count: number;
}

/**
 * 예산/지출 of the trip's cards that are **nowhere** on any timeline (B14).
 *
 * The 결산 counts placed cards only, on purpose: a card sitting in the board's
 * 볼거리 pile is an idea, not a plan. But the board still shows its 예산 chip,
 * so a silent 결산 reads as arithmetic that does not add up. This is the
 * difference, ready to be said out loud.
 *
 * `count` only counts the cards that actually carry money — it is the number
 * the hint claims to have excluded, so it must not include empty ideas.
 */
export function unplacedSpend(workspace: Workspace, tripId: Id): UnplacedSpend {
  if (!workspace.trips[tripId]) return { ...ZERO, count: 0 };

  const placed = new Set<Id>(tripCardIds(workspace, tripId));

  let budget = 0;
  let spent = 0;
  let count = 0;
  for (const card of Object.values(workspace.cards)) {
    if (card.tripId !== tripId || placed.has(card.id)) continue;
    const cardBudget =
      typeof card.budget === 'number' && Number.isFinite(card.budget) ? card.budget : 0;
    const cardTotal = cardSpent(card);
    if (cardBudget === 0 && cardTotal === 0) continue;
    budget += cardBudget;
    spent += cardTotal;
    count += 1;
  }
  return { budget, spent, count };
}

/** True when there is any money to show at all. */
export const hasSpend = (totals: SpendTotals): boolean =>
  totals.spent > 0 || totals.budget > 0;
