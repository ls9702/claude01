import { useEffect, useRef, useState } from 'react';
import type { BoardColumn, Id } from '../../types/models';
import { colorClasses } from '../../utils/colors';
import { dualAmount, formatSymbolAmount, type DualAmount, type LocalRate } from '../../utils/money';
import type { UnplacedPlan } from '../../utils/spend';
import Icon, { EmojiIcon } from '../common/Icon';
import { POPOVER_CLASS } from '../common/formStyles';

/** One category row of the 카테고리별 popover. */
interface CategoryRow {
  column: BoardColumn;
  /** 이 카테고리 카드들이 이 시트에서 차지하는 필요 예산. */
  budget: number;
}

interface SpendSummaryBarProps {
  /** 시트에 배치된 것만으로 셈한 필요 예산 (배치 하나 = 카드 예산 한 번). */
  sheetBudget: number;
  /** The day the grid is actually showing, if there is exactly one. */
  day?: { id: Id; label: string; budget: number };
  /** Every category of the trip that needs money on this sheet. */
  categories: readonly CategoryRow[];
  /** What the total leaves out, so the bar can own up to it. */
  unplaced: UnplacedPlan;
  currency: string;
  /** 여행의 현지 통화 쌍 (M7b) — 없으면 기준 통화만 말한다. */
  rate?: LocalRate;
}

/** `₩8.1만 · ¥8,710` — the total, in both currencies the traveller thinks in. */
function DualFact({ amount, testId }: { amount: DualAmount; testId: string }) {
  return (
    <>
      <span
        data-testid={testId}
        className="shrink-0 text-micro font-semibold tabular-nums text-ink"
      >
        {amount.base}
      </span>
      {amount.local ? (
        <>
          <span aria-hidden="true" className="shrink-0 text-micro text-ink-faint">
            ·
          </span>
          <span
            data-testid={`${testId}-local`}
            className="shrink-0 text-micro tabular-nums text-ink-muted"
          >
            {amount.local}
          </span>
        </>
      ) : null}
    </>
  );
}

/**
 * 일정표 최상단 고정 「필요 예산」 바 (M16-A → M25).
 *
 * ## 무엇을 답하는 줄인가 (M25)
 *
 * M16에서 이 줄은 「얼마 썼지?」를 답했다. 지출이 앞에 서고 예산이 뒤따랐다.
 * 그런데 이 화면은 **계획을 짜는 화면**이다: 사용자가 여기서 던지는 질문은
 * 「이 계획대로면 얼마가 필요한가」 하나뿐이고, 이미 쓴 돈은 카드 원장·오늘
 * 모드의 결산·지출 칩이 이미 따로 답하고 있었다. 그래서 이 줄에서 지출을
 * 통째로 걷어내고, 남은 한 숫자를 크게 말한다.
 *
 * ## 배치 단위로 센다
 *
 * 2만원짜리 식사 카드를 네 날에 걸어 두었으면 필요한 돈은 8만원이다. 카드
 * 단위로 접어 세던 M16의 시트 합계는 2만원이라 답했고, 일자 칩들과 대놓고
 * 어긋났다 (M25 버그 1). 이제 시트 합계 = 일자 합계의 합 = 카테고리 합계의 합,
 * 셋이 언제나 같은 규칙(`utils/spend.ts`의 `*Planned*`)으로 나온다.
 *
 * ## 두 통화
 *
 * 현지 통화를 켜 둔 여행이면 `₩8.1만 · ¥8,710`처럼 나란히 말한다. 환율은
 * 지출 입력이 쓰는 그 환율 하나뿐이다 (`1 현지 = fxRate 기준`).
 *
 * 여전히 **한 줄, `h-10`** (S7)이고, 일자 숫자는 05시 창을 따른다 (M16-B).
 */
export default function SpendSummaryBar({
  sheetBudget,
  day,
  categories,
  unplaced,
  currency,
  rate,
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

  const total = dualAmount(sheetBudget, currency, rate);

  return (
    <div
      data-testid="spend-summary"
      // `sticky top-0` for the day the grid becomes the page scroller; as a
      // `shrink-0` flex row it is already pinned in today's layout. Both cost
      // nothing, and neither can slide away.
      className="sticky top-0 z-30 flex h-10 shrink-0 items-center gap-2 border-b border-line bg-surface px-3"
    >
      {/* The half that gives way first (B5).
          320px에 두 통화·일자·버튼이 다 들어가지는 않는다. 줄어드는 쪽은 이
          칸이고, 그 안에서도 **글자가 먼저** 줄어든다: 금액은 전부 `shrink-0`이라
          `overflow-hidden`이 숫자를 반토막 내는 일 — 잘린 예산이 *다른 금액*으로
          읽히던 M16의 사고 — 은 일어나지 않는다.

          그래서 순서는 이렇다. 360px 아래에서는 지갑 아이콘과 「필요 예산」이라는
          말이 통째로 빠지고(그 폭에서 라벨은 어차피 0폭으로 잘려 보이지도 않았다),
          두 통화 금액만 남는다 — 말은 카테고리별 팝오버가 한 탭 거리에서 다시
          해 준다. 그 위 폭에서는 라벨이 필요한 만큼만 줄어든다. 일자 칸은 언제나
          `shrink-0`이다 (B5: 0폭으로 짜부라졌던 그 칸이다). */}
      <span
        data-testid="spend-summary-sheet"
        data-budget={sheetBudget}
        data-local-currency={total.local ? rate?.localCurrency : undefined}
        className="flex min-w-0 items-center gap-1.5 overflow-hidden"
      >
        <Icon name="wallet" size={16} className="shrink-0 text-ink-faint max-[359px]:hidden" />
        <span className="min-w-0 truncate text-micro text-ink-faint max-[359px]:hidden">
          필요 예산
        </span>
        <DualFact amount={total} testId="spend-summary-total" />
      </span>

      {day ? (
        <>
          <span aria-hidden="true" className="h-4 w-px shrink-0 bg-line" />
          <span
            data-testid="spend-summary-day"
            data-day-id={day.id}
            data-budget={day.budget}
            className="flex shrink-0 items-center gap-1.5"
          >
            <span className="shrink-0 text-micro text-ink-faint">{day.label}</span>
            {/* 일자 칸은 기준 통화만 말한다: 한 줄에 통화 넷은 읽는 줄이 아니라
                세는 줄이 되고, 시트 합계가 이미 환산을 보여줬다. */}
            <span
              data-testid="spend-summary-day-amount"
              className="shrink-0 text-micro font-semibold tabular-nums text-ink"
            >
              {formatSymbolAmount(day.budget, currency)}
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
            {/* 좁은 화면에서 바의 「필요 예산」 글자가 잘려도, 총액은 여기서
                통째로 다시 말해진다 — 한 탭 거리다. */}
            <div
              data-testid="spend-summary-cats-total"
              className="flex items-center gap-1.5 border-b border-line px-3 py-2"
            >
              <span className="min-w-0 flex-1 truncate text-micro text-ink-faint">필요 예산</span>
              <DualFact amount={total} testId="spend-summary-cats-amount" />
            </div>

            {categories.length === 0 ? (
              <p className="px-3 py-2 text-label font-normal text-ink-muted">
                아직 잡아 둔 예산이 없어요
              </p>
            ) : (
              // 카테고리가 여덟 개인 여행도 있다: 목록만 스크롤하고 총액·안내
              // 줄은 제자리에 남는다.
              <ul className="max-h-[50vh] overflow-y-auto">
                {categories.map(({ column, budget }) => (
                  <li key={column.id}>
                    <span
                      data-testid="spend-cat-row"
                      data-column-id={column.id}
                      data-budget={budget}
                      className="flex items-center gap-2 px-3 py-2 text-label text-ink"
                    >
                      <EmojiIcon emoji={column.icon} />
                      <span
                        aria-hidden="true"
                        className={`h-2 w-2 shrink-0 rounded-full ${colorClasses(column.color).dot}`}
                      />
                      <span className="min-w-0 flex-1 truncate font-normal">{column.name}</span>
                      <span className="shrink-0 font-semibold tabular-nums">
                        {formatSymbolAmount(budget, currency)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {/* Same admission the 결산 makes (B14): the total counts what is on
                the timeline, and the board holds 예산 that is not. */}
            {unplaced.count > 0 ? (
              <p
                data-testid="spend-summary-unplaced"
                data-count={unplaced.count}
                className="border-t border-line px-3 py-2 text-micro font-normal text-ink-faint"
              >
                {`미배치 카드 ${unplaced.count}장의 예산은 빠져 있어요`}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The category rows for a sheet, ready to render: biggest 예산 first, then
 * board order — and nothing that needs no money at all.
 *
 * A zero row would be one more line to read past on the way to the number that
 * matters, and 「관광 ₩0」 is not information the traveller lacked.
 */
export function categoryRows(
  columns: readonly BoardColumn[],
  byColumn: Record<Id, number>,
): CategoryRow[] {
  return columns
    .map((column, index) => ({ column, budget: byColumn[column.id] ?? 0, index }))
    .filter((row) => row.budget > 0)
    .sort((a, b) => b.budget - a.budget || a.index - b.index)
    .map(({ column, budget }) => ({ column, budget }));
}
