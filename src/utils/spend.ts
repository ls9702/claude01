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

import type { BoardColumn, Card, Id, Workspace } from '../types/models';
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

/** The day ids that belong to a sheet — `dayOrder`, plus any stray day. */
function sheetDayIds(workspace: Workspace, sheetId: Id): Set<Id> | null {
  const sheet = workspace.sheets[sheetId];
  if (!sheet) return null;
  const dayIds = new Set<Id>(sheet.dayOrder);
  // Defensive: a day that fell out of `dayOrder` still belongs to the sheet.
  for (const day of Object.values(workspace.days)) {
    if (day.sheetId === sheetId) dayIds.add(day.id);
  }
  return dayIds;
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
  const dayIds = sheetDayIds(workspace, sheetId);
  if (!dayIds) return emptySpend();

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
  const dayIds = sheetDayIds(workspace, sheetId);
  if (!dayIds) return [];

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

/* ------------------------------------------------------------------ *
 * 필요 예산 — 배치 단위 계획 합계 (M25)
 * ------------------------------------------------------------------ */

/**
 * ## Why a second set of sums
 *
 * Everything above answers **"얼마 썼지?"** and therefore counts *cards*: one
 * card is one receipt no matter how many times it appears on the grid, so
 * 지출 must be de-duplicated or the 결산 would invent money that was never
 * spent.
 *
 * The 필요 예산 바 asks the opposite question — **"이 계획대로면 얼마가 드나?"**
 * — and there the same de-duplication is simply wrong. 2만원짜리 식사 카드를 네
 * 날에 걸어 두었으면 밥은 네 번 먹고 돈은 네 번 나간다. So these functions count
 * **placements**: every entry contributes its card's 예산 once, which is also
 * the only rule under which the bar's own numbers agree — 시트 합계 = 일자 합계의
 * 합, always.
 *
 * 예외는 하나, 숙소다 (M31): 4박 예약은 「하루치 × 4」가 아니라 한 건의 결제라
 * 시트마다 한 번만 세고, 그 한 번은 가장 이른 밤에 붙는다. 예외인지 아닌지는
 * 카드가 앉은 **칸**이 들고 있다 ({@link isBudgetOnceColumn}) — 규칙이 카드마다
 * 흩어지지 않게.
 *
 * 지출은 여기 없다: a plan is not a receipt. 이미 낸 돈은 위쪽의 카드 단위
 * 함수들({@link sheetSpend}·{@link sheetSpendByColumn})이 답하고, 요약 바는 그
 * 둘을 나란히 세워 놓을 뿐이다 (M31).
 */

/** One card's 예산; missing/garbled reads as 0. */
export function cardBudget(card: Card | undefined): number {
  const budget = card?.budget;
  return typeof budget === 'number' && Number.isFinite(budget) ? budget : 0;
}

/**
 * 이 칸의 예산은 배치마다가 아니라 **시트마다 한 번**인가 (M31).
 *
 * 배치 단위 셈법(위 주석)의 딱 하나짜리 예외다. 숙소가 그 예외인 이유는 4박
 * 예약이 「하루치 숙박 × 4」가 아니라 **한 건의 결제**이기 때문이다: 네 칸에
 * 걸어 두는 것은 그 예약이 나흘에 걸쳐 있다는 표시이지 네 번 산다는 뜻이 아니고,
 * 40만원을 160만원이라 말하는 바는 그냥 틀린 바다. 식사·이동수단은 예외가
 * 아니다 — 거기서는 네 번 걸면 네 번 낸다.
 *
 * 판단은 카드가 아니라 **칸**이 갖는다: 사람이 「숙소」라고 이름 붙인 자리에
 * 넣는 순간 그 성질이 따라오고, 아니라고 생각하면 카테고리 편집에서 한 번에
 * 끈다 (M29의 체크리스트 토글과 같은 자리, 같은 삼항 규칙).
 */
export const isBudgetOnceColumn = (column: BoardColumn | undefined): boolean =>
  column?.budgetOnce === true;

/** 이 카드의 예산이 시트마다 한 번만 세어지는가 — 카드가 앉은 칸이 정한다. */
function countsOnce(workspace: Workspace, card: Card | undefined): boolean {
  return card ? isBudgetOnceColumn(workspace.columns[card.columnId]) : false;
}

/**
 * 시트에 배치된 것만으로 셈한 필요 예산 (M25).
 *
 * Sum of `card.budget` over **every entry** of the sheet — a card on four days
 * counts four times, unless it sits in a {@link isBudgetOnceColumn} 칸 (숙소),
 * where the whole booking counts once per sheet (M31). Cards nobody placed are
 * not in it, on purpose; see {@link unplacedPlan} for the number the bar owns
 * up to.
 */
export function sheetPlannedBudget(workspace: Workspace, sheetId: Id): number {
  const dayIds = sheetDayIds(workspace, sheetId);
  if (!dayIds) return 0;

  const counted = new Set<Id>();
  let budget = 0;
  for (const entry of Object.values(workspace.entries)) {
    if (!dayIds.has(entry.dayId)) continue;
    const card = workspace.cards[entry.cardId];
    if (countsOnce(workspace, card)) {
      if (counted.has(entry.cardId)) continue;
      counted.add(entry.cardId);
    }
    budget += cardBudget(card);
  }
  return budget;
}

/** 「가장 이른 배치」의 순서 키: 날 순서 → 창 안에서의 위치 → entry id. */
type Rank = [number, number, string];

/**
 * `a`가 `b`보다 이른가 — 자리마다 따로 비교한다.
 *
 * 배열끼리 `<`로 견주면 자바스크립트가 문자열로 바꿔 `"0,100,e1" < "0,90,e2"`
 * 를 참이라 답한다. 100분이 90분보다 이르다는 뜻이 되므로, 비교는 손으로 쓴다.
 */
function earlier(a: Rank, b: Rank): boolean {
  if (a[0] !== b[0]) return a[0] < b[0];
  if (a[1] !== b[1]) return a[1] < b[1];
  return a[2] < b[2];
}

/**
 * 한 **창**(05시~다음 05시)의 필요 예산 — the day half of the bar (M16-B).
 *
 * Membership is the windowed one, like every other day-scoped figure: 새벽 2시
 * 라멘은 전날 밤의 예산이다. Placement-counted like {@link sheetPlannedBudget},
 * so summing this over a sheet's days gives exactly the sheet total.
 *
 * ## 숙소는 어느 날에 붙는가 (M31)
 *
 * 시트마다 한 번만 세는 카드({@link isBudgetOnceColumn})는 그 한 번을 **가장
 * 이른 배치가 그려지는 창**에 붙인다 — 체크인하는 날이다. 네 날에 4분의 1씩
 * 쪼개는 대신 첫날에 통째로 얹는 이유는 그것이 실제로 카드가 긁히는 날이기도
 * 하고, 쪼갠 숫자는 어느 날의 바에서도 본 적 없는 금액이 되기 때문이다.
 *
 * 어느 쪽이든 불변식은 그대로다: 일자 합계를 시트의 날들에 대해 더하면 정확히
 * {@link sheetPlannedBudget}이 된다. 「가장 이르다」는 창 기준(날 순서 → 창
 * 안에서의 위치 → entry id)이라 두 기기가 같은 답을 낸다.
 */
export function dayPlannedBudgetWindowed(
  workspace: Workspace,
  dayId: Id,
  dayOrder: DayAxis,
): number {
  const axis = datedAxis(dayOrder, workspace.days);
  const dayIndex = new Map<Id, number>(axis.map((day, index) => [day.id, index]));

  /** cardId → 이 축에서 가장 이른 배치의 (날, 창 안 위치, entry id). */
  const firstOf = new Map<Id, { day: Id; rank: Rank }>();
  let budget = 0;

  for (const entry of Object.values(workspace.entries)) {
    const placement = visualPlacement(entry, axis);
    const card = workspace.cards[entry.cardId];

    if (!countsOnce(workspace, card)) {
      if (placement.renderDayId === dayId) budget += cardBudget(card);
      continue;
    }
    // 시트마다 한 번인 카드: 이 축 밖의 배치(다른 시트)는 이 시트의 숙박이
    // 아니므로 아예 후보가 아니다.
    const index = dayIndex.get(placement.renderDayId);
    if (index === undefined) continue;
    const rank: Rank = [index, placement.rawOffsetMin, entry.id];
    const current = firstOf.get(entry.cardId);
    if (!current || earlier(rank, current.rank)) {
      firstOf.set(entry.cardId, { day: placement.renderDayId, rank });
    }
  }

  for (const [cardId, first] of firstOf) {
    if (first.day === dayId) budget += cardBudget(workspace.cards[cardId]);
  }
  return budget;
}

/**
 * 시트의 필요 예산을 보드 칼럼별로 나눈 것 — the 카테고리별 popover (M25).
 *
 * Keyed by `columnId`, and the values add up to {@link sheetPlannedBudget}
 * exactly: a breakdown that does not match the number above it is worse than
 * no breakdown. A column with nothing placed is simply absent.
 */
export function sheetPlannedByColumn(
  workspace: Workspace,
  sheetId: Id,
): Record<Id, number> {
  const dayIds = sheetDayIds(workspace, sheetId);
  const byColumn: Record<Id, number> = {};
  if (!dayIds) return byColumn;

  const counted = new Set<Id>();
  for (const entry of Object.values(workspace.entries)) {
    if (!dayIds.has(entry.dayId)) continue;
    const card = workspace.cards[entry.cardId];
    if (!card) continue;
    // 시트마다 한 번인 카드(숙소)는 여기서도 한 번만 — 아니면 카테고리 합계가
    // 그 위의 총계와 어긋난다 (M31).
    if (countsOnce(workspace, card)) {
      if (counted.has(card.id)) continue;
      counted.add(card.id);
    }
    byColumn[card.columnId] = (byColumn[card.columnId] ?? 0) + cardBudget(card);
  }
  return byColumn;
}

/** What the 필요 예산 총계 leaves out: the 미배치 cards that carry a 예산. */
export interface UnplacedPlan {
  /** Their 예산 sum — money the plan would need if they were placed. */
  budget: number;
  /** How many of them there are — the `N` of the bar's hint line. */
  count: number;
}

/**
 * 여행의 어느 타임라인에도 없는 카드들의 예산 (M25, B14의 계획판).
 *
 * {@link unplacedSpend} counts a card that only ever had a 지출; this one is
 * about the plan, so a card with no 예산 is not a missing 예산 — it is an idea
 * with no price on it yet, and the hint must not claim to have excluded it.
 */
export function unplacedPlan(workspace: Workspace, tripId: Id): UnplacedPlan {
  if (!workspace.trips[tripId]) return { budget: 0, count: 0 };

  const placed = new Set<Id>(tripCardIds(workspace, tripId));

  let budget = 0;
  let count = 0;
  for (const card of Object.values(workspace.cards)) {
    if (card.tripId !== tripId || placed.has(card.id)) continue;
    const cardsBudget = cardBudget(card);
    if (cardsBudget <= 0) continue;
    budget += cardsBudget;
    count += 1;
  }
  return { budget, count };
}

/* ------------------------------------------------------------------ *
 * 줄 단위 내역 — 리포트가 표로 펼칠 재료 (M32)
 * ------------------------------------------------------------------ */

/**
 * ## 왜 여기에 있나
 *
 * 지출 리포트(M32)는 요약 바가 말하는 두 숫자를 **줄로 쪼개** 보여준다. 쪼개는
 * 일이 리포트 안에서 벌어지면 같은 셈법이 두 벌 생기고, 그 둘은 반드시 언젠가
 * 어긋난다 — 그리고 어긋난 순간 표는 「합계가 안 맞는 표」가 되어 위쪽 바까지
 * 같이 못 믿게 만든다. 그래서 쪼개기도 여기, 합치기와 같은 파일에서 한다.
 *
 * 불변식은 두 줄이다:
 *
 * - `Σ sheetCardMoney(...).spent === sheetSpend(...).spent`
 * - `Σ sheetCardMoney(...).budget === sheetPlannedBudget(...)`
 *
 * 두 줄이 다른 규칙으로 셈해지는 이유는 위쪽 주석 그대로다 — 영수증은 카드마다
 * 하나, 계획은 배치마다 하나(숙소만 시트마다 하나).
 */

/** 한 카드가 이 시트에서 차지하는 돈 — 지출 한 칸, 예산 한 칸. */
export interface SheetCardMoney {
  card: Card;
  /** 이미 낸 돈. **카드 단위**라 배치를 몇 번 했든 영수증은 하나다 (M6). */
  spent: number;
  /**
   * 이 시트가 이 카드에 필요로 하는 예산.
   *
   * **배치 단위**다 (M25): 2만원짜리 식사를 네 날에 걸었으면 8만원. 단
   * {@link isBudgetOnceColumn} 칸(숙소)에 앉은 카드는 시트마다 한 번이라
   * `cardBudget` 그대로다 (M31).
   */
  budget: number;
  /** 이 시트 안에서 이 카드가 놓인 횟수. */
  placements: number;
  /** 예산이 시트마다 한 번만 세어지는 카드인가 — 숙소류. */
  countsOnce: boolean;
}

/**
 * 이 시트에 배치된 카드들을, 카드마다 한 줄씩 (M32).
 *
 * 순서는 엔트리를 훑다가 **처음 만난 순**이라 안정적이지도 의미 있지도 않다 —
 * 줄 세우기는 표를 그리는 쪽의 일이다. 여기가 보장하는 것은 오직 합계다
 * (위 불변식 두 줄).
 */
export function sheetCardMoney(workspace: Workspace, sheetId: Id): SheetCardMoney[] {
  const dayIds = sheetDayIds(workspace, sheetId);
  if (!dayIds) return [];

  const placements = new Map<Id, number>();
  const order: Id[] = [];
  for (const entry of Object.values(workspace.entries)) {
    if (!dayIds.has(entry.dayId) || !workspace.cards[entry.cardId]) continue;
    if (!placements.has(entry.cardId)) order.push(entry.cardId);
    placements.set(entry.cardId, (placements.get(entry.cardId) ?? 0) + 1);
  }

  return order.map((cardId) => {
    const card = workspace.cards[cardId] as Card;
    const count = placements.get(cardId) ?? 0;
    const once = countsOnce(workspace, card);
    return {
      card,
      spent: cardSpent(card),
      budget: cardBudget(card) * (once ? 1 : count),
      placements: count,
      countsOnce: once,
    };
  });
}

/** 배치 하나 = 한 줄. 어느 **창**에 그려지는지까지 풀어 둔 것. */
export interface SheetPlacement {
  entryId: Id;
  cardId: Id;
  /** 이 배치를 실제로 그리는 창의 일자 — 05시 경계를 지난 뒤의 답 (M16-B). */
  dayId: Id;
  /** 그 창 안에서의 위치. 음수면 창이 열리기 전(첫날 새벽)이다. */
  offsetMin: number;
}

/**
 * 시트의 모든 배치를, 창 기준 일자와 함께 (M32).
 *
 * `dayPlannedBudgetWindowed`가 하루치를 셀 때 쓰는 그 변환({@link
 * visualPlacement})을 시트 전체에 한 번 돌려 놓은 것이다 — 리포트는 날마다
 * 다시 훑는 대신 이 목록을 한 번 받아 제 표를 채운다.
 */
export function sheetPlacements(
  workspace: Workspace,
  sheetId: Id,
  dayOrder: DayAxis,
): SheetPlacement[] {
  const dayIds = sheetDayIds(workspace, sheetId);
  if (!dayIds) return [];
  const axis = datedAxis(dayOrder, workspace.days);

  const rows: SheetPlacement[] = [];
  for (const entry of Object.values(workspace.entries)) {
    if (!dayIds.has(entry.dayId) || !workspace.cards[entry.cardId]) continue;
    const placement = visualPlacement(entry, axis);
    rows.push({
      entryId: entry.id,
      cardId: entry.cardId,
      dayId: placement.renderDayId,
      offsetMin: placement.rawOffsetMin,
    });
  }
  return rows;
}

/**
 * cardId → 이 시트에서 **가장 이른** 배치가 그려지는 창의 일자 (M32).
 *
 * 「가장 이르다」의 뜻은 숙소 예산이 체크인 날에 붙을 때와 정확히 같다: 날 순서
 * → 창 안에서의 위치 → entry id ({@link earlier}). 리포트의 일자별 표가 **카드
 * 단위**인 지출을 어느 날에 얹을지 정할 때 쓴다 — 네 날에 걸린 호텔의 40만원을
 * 네 번 세면 일자 합계가 시트 합계를 넘어 버리고, 넷으로 쪼개면 어느 날에서도
 * 본 적 없는 금액이 된다. 그래서 첫 날에 통째로 얹는다.
 */
export function sheetCardFirstDay(
  workspace: Workspace,
  sheetId: Id,
  dayOrder: DayAxis,
): Record<Id, Id> {
  const axis = datedAxis(dayOrder, workspace.days);
  const dayIndex = new Map<Id, number>(axis.map((day, index) => [day.id, index]));

  const best = new Map<Id, Rank>();
  const firstDay: Record<Id, Id> = {};
  for (const placement of sheetPlacements(workspace, sheetId, dayOrder)) {
    // 축 밖의 날(주문에서 떨어져 나온 잔여 행)은 맨 뒤로 — 있어도 첫 배치가
    // 되지는 않는다.
    const index = dayIndex.get(placement.dayId) ?? Number.MAX_SAFE_INTEGER;
    const rank: Rank = [index, placement.offsetMin, placement.entryId];
    const current = best.get(placement.cardId);
    if (current && !earlier(rank, current)) continue;
    best.set(placement.cardId, rank);
    firstDay[placement.cardId] = placement.dayId;
  }
  return firstDay;
}
