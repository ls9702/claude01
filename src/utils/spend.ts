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

/** True when there is any money to show at all. */
export const hasSpend = (totals: SpendTotals): boolean =>
  totals.spent > 0 || totals.budget > 0;
