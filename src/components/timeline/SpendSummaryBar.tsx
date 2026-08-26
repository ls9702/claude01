import { useEffect, useRef, useState } from 'react';
import type { BoardColumn, Id } from '../../types/models';
import { colorClasses } from '../../utils/colors';
import { dualAmount, formatSymbolAmount, type DualAmount, type LocalRate } from '../../utils/money';
import type { SpendTotals, UnplacedPlan } from '../../utils/spend';
import Icon, { EmojiIcon } from '../common/Icon';
import { POPOVER_CLASS } from '../common/formStyles';

/**
 * 「필요 예산」이라는 **말**이 자리를 내주는 폭 — 금액은 절대 내주지 않는다.
 *
 * `plain`은 M25가 실측으로 잡은 선(360px)이고, `crowded`는 지출까지 세 숫자가
 * 늘어설 때의 선(420px)이다. Tailwind가 클래스 이름을 통째로 훑기 때문에
 * 문자열을 조립하지 않고 이렇게 통째로 적어 둔다.
 */
const WORDS_YIELD = {
  plain: 'max-[359px]:hidden',
  crowded: 'max-[419px]:hidden',
} as const;

/** One category row of the 카테고리별 popover. */
interface CategoryRow {
  column: BoardColumn;
  /** 이 카테고리 카드들이 이 시트에서 차지하는 필요 예산 (배치 단위). */
  budget: number;
  /** 이미 결제한 금액 (카드 단위, M31) — 없으면 0. */
  spent: number;
}

interface SpendSummaryBarProps {
  /** 시트에 배치된 것만으로 셈한 필요 예산 (배치 하나 = 카드 예산 한 번). */
  sheetBudget: number;
  /**
   * 이 시트의 카드들에 이미 적힌 지출 합계 (M31).
   *
   * 배치 단위가 아니라 **카드 단위**다: 4박 호텔 카드를 네 날에 걸어 두어도
   * 40만원짜리 영수증은 하나다. 0이면 이 줄에 아무것도 그리지 않는다.
   */
  sheetSpent: number;
  /** The day the grid is actually showing, if there is exactly one. */
  day?: { id: Id; label: string; budget: number };
  /** Every category of the trip that needs money on this sheet. */
  categories: readonly CategoryRow[];
  /** What the total leaves out, so the bar can own up to it. */
  unplaced: UnplacedPlan;
  currency: string;
  /** 여행의 현지 통화 쌍 (M7b) — 없으면 기준 통화만 말한다. */
  rate?: LocalRate;
  /**
   * 팝오버 맨 아래 「전체 리포트」가 여는 것 (M32).
   *
   * 헤더의 리포트 버튼은 좁은 줄에서 물러난다(`roomForReport`) — AI를 켠 390px
   * 폰이 바로 그 경우다. 돈을 보러 이 팝오버를 연 손가락이 리포트까지 한 탭에
   * 닿아야 하므로, 진입점은 폭과 무관하게 여기에도 산다. 없으면 줄도 없다.
   */
  onOpenReport?: () => void;
}

/**
 * `₩8.1만 · ¥8,710` — the total, in both currencies the traveller thinks in.
 *
 * `muted` is the 지출 half of M31: the same shape, one step back in weight and
 * colour, so 「이 계획에 얼마 드나」가 언제나 먼저 읽힌다.
 */
function DualFact({
  amount,
  testId,
  muted = false,
}: {
  amount: DualAmount;
  testId: string;
  muted?: boolean;
}) {
  return (
    <>
      <span
        data-testid={testId}
        className={`shrink-0 text-micro tabular-nums ${
          muted ? 'font-normal text-ink-muted' : 'font-semibold text-ink'
        }`}
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
            className={`shrink-0 text-micro tabular-nums ${
              muted ? 'text-ink-faint' : 'text-ink-muted'
            }`}
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
 * ## 이미 낸 돈도 한 번은 말해야 한다 (M31)
 *
 * 그런데 계획의 절반은 **이미 결제된 것**이다: 숙소와 비행기표는 떠나기 전에
 * 카드로 긁혀 있고, 그 지출은 카드 원장에 이미 적혀 있다. M25가 이 줄에서
 * 지출을 통째로 걷어내자 「다 결제해 둔 여행」의 요약 바는 ₩0을 말했다 — 계획이
 * 없어서가 아니라 예산 칸을 안 채웠기 때문이었다. 그래서 지출이 돌아왔다.
 * 단, **뒤에, 작게, 0이면 아예 없이**: 앞자리는 여전히 필요 예산의 것이다.
 *
 * 두 숫자는 세는 규칙이 서로 다르고, 그게 맞다. 필요 예산은 배치 단위(4박이면
 * 네 번), 지출은 카드 단위(영수증은 하나). 같은 규칙으로 셌다면 둘 중 하나는
 * 거짓말이 된다.
 *
 * 일자 칸은 여전히 필요 예산만 말한다 — 일자별 지출은 일자 헤더의 지출 칩이
 * 이미 제 자리에서 답하고 있어서, 여기서 또 말하면 같은 숫자가 두 번 있는
 * 화면이 된다.
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
  sheetSpent,
  day,
  categories,
  unplaced,
  currency,
  rate,
  onOpenReport,
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
  const spentTotal = dualAmount(sheetSpent, currency, rate);
  const hasSpent = sheetSpent > 0;

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
        {/* 지출이 붙는 순간 이 말이 물러나는 폭은 한 단계 넓어진다 (M31): 금액
            셋이 서면 390px에서도 아이콘과 라벨까지 들어갈 자리는 없고, 밀려나야
            하는 것은 언제나 말이지 숫자가 아니다. 실측 기준선이라 두 클래스가
            나란히 붙어 있다 — `max-[419px]`가 지출이 있을 때, `max-[359px]`가
            없을 때. */}
        <Icon
          name="wallet"
          size={16}
          className={`shrink-0 text-ink-faint ${WORDS_YIELD[hasSpent ? 'crowded' : 'plain']}`}
        />
        <span
          className={`min-w-0 truncate text-micro text-ink-faint ${
            WORDS_YIELD[hasSpent ? 'crowded' : 'plain']
          }`}
        >
          필요 예산
        </span>
        <DualFact amount={total} testId="spend-summary-total" />
      </span>

      {/* 이미 낸 돈 (M31). 뒤따라 붙고, 계획보다 한 단계 여린 색이고, 0이면
          아예 없다 — 아무것도 결제하지 않은 오늘의 바는 M25 그대로다.

          390px 아래에서는 이 칸이 통째로 빠진다. 실측이 그렇게 말한다: 360px에
          두 통화 총액(₩60만 · ¥6.5만)·일자 칸·카테고리별 버튼이 이미 다 차서,
          세 번째 금액을 밀어 넣으면 밀려나는 것이 첫 번째 금액이다 — 잘린 예산이
          *다른 금액*으로 읽히는 M16의 사고가 바로 그것이었다. 대신 카테고리별
          팝오버가 총계와 카테고리별 내역을 폭과 상관없이 언제나 들고 있다 —
          한 탭 거리다. */}
      {hasSpent ? (
        <span
          data-testid="spend-summary-spent"
          data-spent={sheetSpent}
          className="flex shrink-0 items-center gap-1 max-[389px]:hidden"
        >
          <span className="shrink-0 text-micro text-ink-faint">지출</span>
          <span
            data-testid="spend-summary-spent-amount"
            className="shrink-0 text-micro font-normal tabular-nums text-ink-muted"
          >
            {spentTotal.base}
          </span>
        </span>
      ) : null}

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
            <div className="border-b border-line">
              <div
                data-testid="spend-summary-cats-total"
                className={`flex items-center gap-1.5 px-3 pt-2 ${hasSpent ? 'pb-1' : 'pb-2'}`}
              >
                <span className="min-w-0 flex-1 truncate text-micro text-ink-faint">필요 예산</span>
                <DualFact amount={total} testId="spend-summary-cats-amount" />
              </div>
              {/* 바에서 잘려 나갈 수 있는 유일한 숫자라서, 여기서는 폭과
                  상관없이 언제나 — 그리고 두 통화로 — 말한다 (M31). */}
              {hasSpent ? (
                <div
                  data-testid="spend-summary-cats-spent"
                  data-spent={sheetSpent}
                  className="flex items-center gap-1.5 px-3 pb-2"
                >
                  <span className="min-w-0 flex-1 truncate text-micro text-ink-faint">지출</span>
                  <DualFact amount={spentTotal} testId="spend-summary-cats-spent-amount" muted />
                </div>
              ) : null}
            </div>

            {categories.length === 0 ? (
              <p className="px-3 py-2 text-label font-normal text-ink-muted">
                아직 잡아 둔 예산이 없어요
              </p>
            ) : (
              // 카테고리가 여덟 개인 여행도 있다: 목록만 스크롤하고 총액·안내
              // 줄은 제자리에 남는다.
              <ul className="max-h-[50vh] overflow-y-auto">
                {categories.map(({ column, budget, spent }) => (
                  <li key={column.id}>
                    <span
                      data-testid="spend-cat-row"
                      data-column-id={column.id}
                      data-budget={budget}
                      data-spent={spent}
                      className="flex items-center gap-2 px-3 py-2 text-label text-ink"
                    >
                      <EmojiIcon emoji={column.icon} />
                      <span
                        aria-hidden="true"
                        className={`h-2 w-2 shrink-0 rounded-full ${colorClasses(column.color).dot}`}
                      />
                      <span className="min-w-0 flex-1 truncate font-normal">{column.name}</span>
                      {/* 예산이 위, 이미 낸 돈이 그 아래 (M31). 예산 칸을 비워 둔
                          선결제 카드는 ₩0으로 남되 여린 색이라, 눈은 바로 아래
                          줄의 진짜 숫자로 간다. */}
                      <span className="flex shrink-0 flex-col items-end leading-tight">
                        <span
                          className={`tabular-nums ${
                            budget > 0 ? 'font-semibold' : 'font-normal text-ink-faint'
                          }`}
                        >
                          {formatSymbolAmount(budget, currency)}
                        </span>
                        {spent > 0 ? (
                          <span
                            data-testid="spend-cat-spent"
                            className="text-micro font-normal tabular-nums text-ink-muted"
                          >
                            {`지출 ${formatSymbolAmount(spent, currency)}`}
                          </span>
                        ) : null}
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

            {onOpenReport ? (
              <button
                type="button"
                data-testid="report-open-popover"
                onClick={() => {
                  setOpen(false);
                  onOpenReport();
                }}
                className="flex h-11 w-full items-center justify-center gap-1.5 border-t border-line text-label text-ink-muted transition-colors duration-[140ms] ease-quick hover:bg-sunken hover:text-ink"
              >
                <Icon name="chart" size={16} />
                전체 리포트 보기
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The category rows for a sheet, ready to render: biggest 예산 first, then
 * board order — and nothing that costs nothing either way.
 *
 * A zero row would be one more line to read past on the way to the number that
 * matters, and 「관광 ₩0」 is not information the traveller lacked. But **either**
 * number earns the row (M31): 숙소 카드에 예산을 안 적고 40만원 결제만 적어 둔
 * 여행이 흔하고, 그 줄이 없으면 팝오버가 「이 여행엔 숙소가 없다」고 말하는 셈이
 * 된다.
 *
 * Sorting stays the 예산 sort — the popover hangs under 필요 예산 and must read
 * in that order — with 지출 only breaking ties between equal budgets (the ₩0
 * rows among themselves, in practice).
 */
export function categoryRows(
  columns: readonly BoardColumn[],
  byColumn: Record<Id, number>,
  spentByColumn: Record<Id, SpendTotals> = {},
): CategoryRow[] {
  return columns
    .map((column, index) => ({
      column,
      budget: byColumn[column.id] ?? 0,
      spent: spentByColumn[column.id]?.spent ?? 0,
      index,
    }))
    .filter((row) => row.budget > 0 || row.spent > 0)
    .sort((a, b) => b.budget - a.budget || b.spent - a.spent || a.index - b.index)
    .map(({ column, budget, spent }) => ({ column, budget, spent }));
}
