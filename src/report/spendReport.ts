/**
 * 지출 리포트 — 시트 하나를 표 두 장으로 (M32).
 *
 * 요약 바는 한 줄로 「이 계획대로면 얼마가 들고, 그중 얼마를 이미 냈나」를
 * 답한다. 사람이 그 다음에 던지는 질문은 언제나 **「어디에?」**이고, 그 답은
 * 숫자 하나가 아니라 표다. 그래서 이 파일은 같은 돈을 두 방향으로 쪼갠다:
 *
 * 1. {@link categoryReport} — **카테고리별**. 보드의 칸 순서대로, 칸마다 카드
 *    한 줄씩, 칸마다 소계, 맨 아래 총계.
 * 2. {@link dayReport} — **일자별**. 맨 위에 여행 전에 이미 결제가 끝난 두
 *    가지(숙소비·항공권)를 **딱 한 번** 못 박고, 그 아래로 1일차·2일차…가
 *    이어지고, 맨 아래에 지출 합계·예산 합계, 그리고 둘을 더한 총액.
 *
 * ## 미확정은 어디에도 없다
 *
 * 두 표 모두 **시트에 배치된 카드만** 센다. 보드에 남아 있는 카드는 아이디어이지
 * 일정이 아니고, 요약 바의 총계도 같은 이유로 그것들을 빼고 센다 (M25). 표와 바가
 * 서로 다른 모집단을 세면 둘 중 하나는 거짓말이 된다.
 *
 * ## 합계는 바의 것과 **같은 숫자**여야 한다
 *
 * 셈법은 한 벌뿐이다: 카드 단위 지출·배치 단위 예산·숙소는 시트마다 한 번,
 * 전부 `utils/spend.ts`가 이미 들고 있는 규칙이고 여기서는 그것을 줄로 펼치기만
 * 한다 ({@link sheetCardMoney}·{@link sheetCardFirstDay}). 총계는 아예 바가
 * 부르는 함수(`sheetSpend`/`sheetPlannedBudget`)를 그대로 부른다 — 표가 제
 * 줄들을 더해서 총계를 만들면 언젠가 반올림 하나로 어긋난다.
 *
 * 순수 함수뿐이라 브라우저 없이 시험된다.
 */

import { dayTitle } from '../timeline/dayLabel';
import { datedAxis, type DayAxis } from '../timeline/dayWindow';
import type { BoardColumn, Card, Day, Id, Workspace } from '../types/models';
import { FLIGHT_CARD_PREFIX } from '../utils/flights';
import {
  cardBudget,
  isBudgetOnceColumn,
  sheetCardFirstDay,
  sheetCardMoney,
  sheetPlacements,
  sheetPlannedBudget,
  sheetSpend,
  type SheetCardMoney,
} from '../utils/spend';

/**
 * 항공편 마법사가 만든 카드인가 (M32).
 *
 * 이름 매칭이 아니라 **마법사가 찍어 둔 표식**을 본다: `flightCardTitle`이 모든
 * 항공권 카드 제목 앞에 붙이는 `✈️`다 ({@link FLIGHT_CARD_PREFIX}). 모델에 새
 * 필드를 더할 필요가 없는 이유이자, 이미 이 앱의 세 군데(`clearFlightPlacements`
 * 가 어느 카드를 지울지 고를 때, `EntryBlock`·`NowBar`가 카테고리 아이콘을 접을
 * 때)가 쓰고 있는 바로 그 규칙이다. 새 판단 기준을 하나 더 들이는 대신 있는 것을
 * 쓴다 — 두 기준이 서로 다른 답을 내는 날이 오지 않게.
 *
 * 사람이 손으로 만든 「✈️ 오사카행」도 항공권으로 읽힌다. 그건 오류가 아니라
 * 이 표식의 뜻 그대로다: 화면의 다른 세 곳이 이미 그 카드를 항공편으로 대접하고
 * 있다.
 */
export const isFlightCard = (card: Card | undefined): boolean =>
  card?.title.trimStart().startsWith(FLIGHT_CARD_PREFIX) === true;

/* ------------------------------------------------------------------ *
 * 1. 카테고리별 지출 내역
 * ------------------------------------------------------------------ */

/** 표의 한 줄 — 카드 하나. */
export interface ReportCardRow {
  card: Card;
  /** 이미 낸 돈 (카드 단위). */
  spent: number;
  /** 이 시트가 이 카드에 필요로 하는 예산 (배치 단위, 숙소는 한 번). */
  budget: number;
}

/** 한 카테고리 묶음 — 줄들과 그 소계. */
export interface ReportCategory {
  column: BoardColumn;
  rows: ReportCardRow[];
  spent: number;
  budget: number;
}

/** 카테고리별 표 한 장. */
export interface CategoryReport {
  categories: ReportCategory[];
  /** 시트 지출 총계 — `sheetSpend(...).spent`와 **같은 숫자**. */
  spent: number;
  /** 시트 필요 예산 총계 — `sheetPlannedBudget(...)`과 **같은 숫자**. */
  budget: number;
}

/** 돈이 한 푼도 안 걸린 줄인가 — 표에 설 자격의 유일한 기준. */
const hasMoney = (row: { spent: number; budget: number }): boolean =>
  row.spent > 0 || row.budget > 0;

/**
 * 카테고리별 지출 내역 (M32, 리포트 1번 표).
 *
 * 칸 순서는 보드가 정한 순서(`trip.columnOrder`) 그대로다 — 금액순으로 다시
 * 세우면 표를 열 때마다 줄이 춤을 추고, 사람은 자기 보드에서 숙소가 몇 번째
 * 칸인지 이미 알고 있다. 칸 안에서는 그 칸의 `cardOrder` 순서다.
 *
 * **0원짜리 줄은 없다.** 「관광 0원」은 사람이 몰랐던 사실이 아니라 총계로 가는
 * 길에 놓인 읽을거리 하나일 뿐이고, 그런 줄이 열 개면 표는 표가 아니라 목록이
 * 된다. 같은 이유로 아무것도 안 남은 카테고리는 통째로 빠진다.
 */
export function categoryReport(workspace: Workspace, sheetId: Id): CategoryReport {
  const sheet = workspace.sheets[sheetId];
  const trip = sheet ? workspace.trips[sheet.tripId] : undefined;

  const byCard = new Map<Id, SheetCardMoney>();
  for (const item of sheetCardMoney(workspace, sheetId)) byCard.set(item.card.id, item);

  /** 보드가 정한 칸 순서 + 거기서 떨어져 나온 칸(있다면 뒤에). */
  const columnIds: Id[] = [...(trip?.columnOrder ?? [])];
  const known = new Set(columnIds);
  for (const item of byCard.values()) {
    if (!known.has(item.card.columnId)) {
      known.add(item.card.columnId);
      columnIds.push(item.card.columnId);
    }
  }

  const categories: ReportCategory[] = [];
  for (const columnId of columnIds) {
    const column = workspace.columns[columnId];
    if (!column) continue;

    const items = [...byCard.values()].filter((item) => item.card.columnId === columnId);
    // 칸이 아는 순서를 먼저, 칸이 모르는 카드는 그 뒤에 — 어느 쪽이든 표를 다시
    // 열었을 때 같은 줄이 같은 자리에 있다.
    const rank = new Map<Id, number>(column.cardOrder.map((cardId, index) => [cardId, index]));
    items.sort(
      (a, b) =>
        (rank.get(a.card.id) ?? Number.MAX_SAFE_INTEGER) -
          (rank.get(b.card.id) ?? Number.MAX_SAFE_INTEGER) ||
        a.card.title.localeCompare(b.card.title, 'ko-KR'),
    );

    const rows: ReportCardRow[] = items
      .map((item) => ({ card: item.card, spent: item.spent, budget: item.budget }))
      .filter(hasMoney);
    if (rows.length === 0) continue;

    categories.push({
      column,
      rows,
      spent: rows.reduce((sum, row) => sum + row.spent, 0),
      budget: rows.reduce((sum, row) => sum + row.budget, 0),
    });
  }

  return {
    categories,
    spent: sheetSpend(workspace, sheetId).spent,
    budget: sheetPlannedBudget(workspace, sheetId),
  };
}

/* ------------------------------------------------------------------ *
 * 2. 일자별 리포트
 * ------------------------------------------------------------------ */

/** 어느 날에도 속하지 않는 두 줄. */
export type PinnedKind = 'stay' | 'flight';

/** 맨 위에 못 박히는 줄 — 여행 전에 이미 한 번에 결제되는 것들. */
export interface ReportPinnedRow {
  kind: PinnedKind;
  /** `숙소비` / `항공권`. */
  label: string;
  spent: number;
  budget: number;
  /** 이 줄이 접고 있는 카드 수. */
  count: number;
}

/** 하루치 한 줄. */
export interface ReportDayRow {
  dayId: Id;
  /** 0부터 — `1일차`의 0. */
  index: number;
  /** `1일차`, 또는 사람이 지어준 이름. */
  label: string;
  spent: number;
  budget: number;
}

/** 일자별 표 한 장. */
export interface DayReport {
  /** 숙소비·항공권 — 있는 것만, 순서는 언제나 숙소 → 항공권. */
  pinned: ReportPinnedRow[];
  days: ReportDayRow[];
  /** 시트 지출 총계 — `sheetSpend(...).spent`. */
  spent: number;
  /** 시트 필요 예산 총계 — `sheetPlannedBudget(...)`. */
  budget: number;
  /** 사용자가 따로 물은 숫자: 지출 + 예산. */
  total: number;
}

const PINNED_LABEL: Record<PinnedKind, string> = {
  stay: '숙소비',
  flight: '항공권',
};

/**
 * 이 카드는 어느 날에도 속하지 않는가 — 속한다면 어느 줄인가 (M32).
 *
 * - **숙소**: 카드가 앉은 칸이 `budgetOnce`인 것 (M31의 그 칸이다). 4박 예약은
 *   나흘에 걸쳐 있을 뿐 나흘에 나눠 내는 돈이 아니다.
 * - **항공권**: 항공편 마법사가 표식을 찍어 둔 카드 ({@link isFlightCard}).
 *   심야편은 배치가 둘이지만 표는 그것도 한 번만 말한다.
 *
 * 둘 다인 카드는 숙소로 친다 — 칸은 사람이 직접 정한 자리이고, 제목의 표식보다
 * 그쪽이 더 분명한 의사표시다. 어느 쪽이든 **한 줄에만** 서므로 총계가 두 번
 * 세어지는 일은 없다.
 */
function pinnedKindOf(workspace: Workspace, card: Card): PinnedKind | null {
  if (isBudgetOnceColumn(workspace.columns[card.columnId])) return 'stay';
  if (isFlightCard(card)) return 'flight';
  return null;
}

/**
 * 일자별 리포트 (M32, 리포트 2번 표).
 *
 * ## 왜 위쪽 두 줄은 날에서 빠지나
 *
 * 숙소비와 항공권은 **여행 전에 이미 한 번에 나간 돈**이다. 이것을 1일차에
 * 통째로 얹으면 1일차만 백만 원짜리 날이 되고, 나흘로 쪼개면 어느 날에도
 * 해당하지 않는 금액 넷이 생긴다. 둘 다 「이 날 얼마 썼나」라는 질문에 대한
 * 답으로는 틀렸다. 그래서 아예 날 밖으로 꺼내 맨 위에 못 박는다.
 *
 * ## 하루치를 세는 두 가지 규칙
 *
 * - **예산**은 배치 단위다: 그 창에 그려지는 배치마다 카드의 예산을 한 번씩.
 *   못 박힌 카드는 여기서 빠지므로 숙소의 「시트마다 한 번」 규칙은 이 표에
 *   등장할 일이 없다 (숙소는 언제나 위쪽 줄이다).
 * - **지출**은 카드 단위다: 영수증은 하나뿐이라 나눌 수 없고, 그래서 **가장
 *   이른 배치**가 그려지는 날에 통째로 얹는다 ({@link sheetCardFirstDay}).
 *
 * ## 불변식
 *
 * `못 박힌 줄 + Σ 일자 = 총계` — 지출도 예산도. 이게 깨지면 표 아래 합계는
 * 표가 보여준 것과 다른 숫자가 되고, 그 순간 표는 못 믿을 것이 된다.
 */
export function dayReport(
  workspace: Workspace,
  sheetId: Id,
  dayOrder: DayAxis,
): DayReport {
  const spent = sheetSpend(workspace, sheetId).spent;
  const budget = sheetPlannedBudget(workspace, sheetId);

  const axis = datedAxis(dayOrder, workspace.days);
  const rowByDay = new Map<Id, ReportDayRow>();
  const days: ReportDayRow[] = axis.map((ref, index) => {
    const day: Day | undefined = workspace.days[ref.id];
    const row: ReportDayRow = {
      dayId: ref.id,
      index,
      label: day ? dayTitle(day, index) : `${index + 1}일차`,
      spent: 0,
      budget: 0,
    };
    rowByDay.set(ref.id, row);
    return row;
  });

  const pinnedTotals = new Map<PinnedKind, ReportPinnedRow>();
  /** 못 박힌 카드들 — 일자 줄이 건너뛸 명단. */
  const pinnedCards = new Set<Id>();

  for (const item of sheetCardMoney(workspace, sheetId)) {
    const kind = pinnedKindOf(workspace, item.card);
    if (!kind) continue;
    pinnedCards.add(item.card.id);
    const row =
      pinnedTotals.get(kind) ??
      ({ kind, label: PINNED_LABEL[kind], spent: 0, budget: 0, count: 0 } as ReportPinnedRow);
    row.spent += item.spent;
    row.budget += item.budget;
    row.count += 1;
    pinnedTotals.set(kind, row);
  }

  // 예산: 배치마다 한 번. 못 박힌 카드는 위에서 이미 셌다.
  for (const placement of sheetPlacements(workspace, sheetId, dayOrder)) {
    if (pinnedCards.has(placement.cardId)) continue;
    const row = rowByDay.get(placement.dayId);
    if (row) row.budget += cardBudget(workspace.cards[placement.cardId]);
  }

  // 지출: 카드마다 한 번, 가장 이른 배치가 그려지는 날에.
  const firstDay = sheetCardFirstDay(workspace, sheetId, dayOrder);
  for (const item of sheetCardMoney(workspace, sheetId)) {
    if (pinnedCards.has(item.card.id) || item.spent === 0) continue;
    const row = rowByDay.get(firstDay[item.card.id] ?? '');
    if (row) row.spent += item.spent;
  }

  return {
    // 숙소 → 항공권. 돈이 한 푼도 안 걸린 줄은 세우지 않는다(빠져도 합계는
    // 그대로다) — 카테고리별 표가 0원 줄을 빼는 것과 같은 이유다.
    pinned: (['stay', 'flight'] as PinnedKind[])
      .map((kind) => pinnedTotals.get(kind))
      .filter((row): row is ReportPinnedRow => Boolean(row) && hasMoney(row as ReportPinnedRow)),
    days,
    spent,
    budget,
    total: spent + budget,
  };
}
