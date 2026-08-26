import { useMemo, useState } from 'react';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import type { DayRef } from '../../timeline/dayWindow';
import type { Id } from '../../types/models';
import { categoryReport, dayReport } from '../../report/spendReport';
import { dualAmount, formatBudget, type LocalRate } from '../../utils/money';
import Sheet from '../common/Sheet';
import { EmojiIcon } from '../common/Icon';

/** 두 표 중 어느 쪽을 보고 있는가. */
type ReportView = 'cats' | 'days';

interface SpendReportSheetProps {
  sheetId: Id;
  /** 시트 이름 — 제목 아래 한 줄로, 어느 시트의 표인지 말해 준다. */
  sheetName: string;
  /** 이 시트의 일자 축 (날짜 포함) — 05시 창 판정에 쓰인다. */
  dayOrder: readonly DayRef[];
  currency: string;
  rate?: LocalRate;
  onClose: () => void;
}

/**
 * 금액 한 칸.
 *
 * 0은 「0원」이라 쓰지 않고 줄표로 비운다. 표 한 장에 0원이 스무 개면 눈은 그
 * 스무 개를 전부 읽고 나서야 진짜 숫자에 닿는데, 회계 장부가 빈칸에 줄표를 긋는
 * 이유가 정확히 그것이다. 진짜 값은 `data-amount`에 그대로 있다.
 */
function Cell({ value, currency }: { value: number; currency: string }) {
  return (
    <td
      data-amount={value}
      className="w-24 px-2 py-1.5 text-right text-micro tabular-nums text-ink"
    >
      {value > 0 ? (
        formatBudget(value, currency)
      ) : (
        <span aria-hidden="true" className="text-ink-faint">
          —
        </span>
      )}
    </td>
  );
}

/**
 * 합계 칸 — 기준 통화, 그리고 현지 통화가 있으면 그 아래 (M25의 두 통화).
 *
 * 기준 통화는 **정확한 금액**으로 쓴다. 요약 바는 흘깃 보는 줄이라 `₩160만`이
 * 맞지만, 리포트는 숫자를 **읽으러** 여는 표다 — 그 안에서 줄들은 1,600,000원인데
 * 합계만 160만이면 사람은 둘이 같은 숫자인지 다시 세어 봐야 한다. 환산된 현지
 * 통화는 요약 바가 쓰는 그 값(`dualAmount`) 그대로다: 환율은 이 앱에 하나뿐이다.
 */
function TotalCell({
  value,
  currency,
  rate,
  strong = false,
}: {
  value: number;
  currency: string;
  rate?: LocalRate;
  strong?: boolean;
}) {
  const dual = dualAmount(value, currency, rate);
  return (
    <td data-amount={value} className="w-24 px-2 py-1.5 text-right align-top">
      <span
        className={`block text-micro tabular-nums ${
          strong ? 'font-semibold text-ink' : 'font-medium text-ink'
        }`}
      >
        {formatBudget(value, currency)}
      </span>
      {dual.local ? (
        <span className="block text-micro tabular-nums text-ink-faint">{dual.local}</span>
      ) : null}
    </td>
  );
}

/**
 * 총액 칸 — 숫자 두 칸을 통째로 쓴다.
 *
 * 「지출 + 예산」은 지출도 예산도 아니라서 둘 중 어느 칸에 넣어도 그 칸의 뜻과
 * 어긋난다. 그래서 두 칸을 합쳐 오른쪽 끝에 한 번만 선다 — 표의 마지막 줄에서만
 * 허락되는 모양이다.
 */
function TotalCombined({
  value,
  currency,
  rate,
}: {
  value: number;
  currency: string;
  rate?: LocalRate;
}) {
  const dual = dualAmount(value, currency, rate);
  return (
    <td data-amount={value} colSpan={2} className="px-2 py-1.5 text-right align-top">
      <span className="block text-label font-semibold tabular-nums text-ink">
        {formatBudget(value, currency)}
      </span>
      {dual.local ? (
        <span className="block text-micro tabular-nums text-ink-faint">{dual.local}</span>
      ) : null}
    </td>
  );
}

/** 표의 머리 — 두 표가 같은 두 칸을 쓴다. */
function Head() {
  return (
    <thead className="sticky top-0 z-10 bg-surface">
      <tr className="border-b border-line-strong">
        <th className="px-2 py-1.5 text-left text-micro font-medium text-ink-muted">항목</th>
        <th className="w-24 px-2 py-1.5 text-right text-micro font-medium text-ink-muted">지출</th>
        <th className="w-24 px-2 py-1.5 text-right text-micro font-medium text-ink-muted">예산</th>
      </tr>
    </thead>
  );
}

/** 표 하나가 공통으로 쓰는 껍데기 — 가로 폭은 언제나 시트 안에서 끝난다. */
const TABLE_CLASS = 'w-full table-fixed border-collapse';
/** 왼쪽 라벨 칸 — 줄바꿈 대신 잘린다. 잘려도 옆의 숫자는 제자리다. */
const LABEL_CELL = 'min-w-0 px-2 py-1.5 text-left text-label text-ink';

/**
 * 「지출 리포트」 — 이 시트의 돈을 표 두 장으로 (M32).
 *
 * ## 왜 시트 하나에 표 둘인가
 *
 * 요약 바는 「얼마 드나」에 한 줄로 답한다. 그 다음 질문은 **「어디에?」**이고,
 * 그 답은 사람마다 두 가지 모양 중 하나다: 「무엇에 썼나」(카테고리별)와
 * 「언제 쓰나」(일자별). 둘은 같은 돈을 다른 축으로 자른 것이라 표 두 장이 되고,
 * 시트 두 개가 아니라 **슬라이더 하나**로 오간다 — 같은 것을 보는 두 방법이지
 * 두 가지 기능이 아니다.
 *
 * ## 미확정은 없다
 *
 * 두 표 모두 시간표에 올라간 카드만 센다. 보드에 남은 카드는 아이디어이고, 위쪽
 * 요약 바의 총계도 같은 이유로 그것을 빼고 센다 — 표와 바가 다른 모집단을 세면
 * 둘 중 하나는 거짓말이다 (`report/spendReport.ts`).
 *
 * ## 좁은 화면
 *
 * 390px에서도 가로 스크롤은 없다. `table-fixed`로 숫자 두 칸(각 6rem)을 먼저
 * 확보하고 남는 폭을 라벨이 쓰되, 라벨은 줄바꿈 대신 잘린다: 표에서 자리를
 * 양보하는 쪽은 언제나 말이지 숫자가 아니다 (요약 바가 지키는 그 규칙이다).
 */
export default function SpendReportSheet({
  sheetId,
  sheetName,
  dayOrder,
  currency,
  rate,
  onClose,
}: SpendReportSheetProps) {
  const workspace = useWorkspaceStore((s) => s.workspace);
  const [view, setView] = useState<ReportView>('cats');

  const cats = useMemo(() => categoryReport(workspace, sheetId), [workspace, sheetId]);
  const days = useMemo(
    () => dayReport(workspace, sheetId, dayOrder),
    [workspace, sheetId, dayOrder],
  );

  const viewButton = (target: ReportView, text: string) => {
    const active = view === target;
    return (
      <button
        type="button"
        data-testid={`report-view-${target}`}
        aria-pressed={active}
        onClick={() => setView(target)}
        className={`relative z-10 h-9 rounded-full text-label font-medium transition-colors duration-[140ms] ease-quick ${
          active ? 'text-surface' : 'text-ink-muted'
        }`}
      >
        {text}
      </button>
    );
  };

  return (
    <Sheet title="지출 리포트" onClose={onClose} testId="report-sheet">
      <p className="min-w-0 truncate pb-2 text-micro text-ink-muted">{sheetName}</p>

      {/* 미끄러지는 알약 하나. 두 버튼은 그 위에 얹혀 색만 바뀐다 — 눌린 칸이
          어디로 갔는지 눈이 따라갈 수 있어야 「같은 것의 두 모습」으로 읽힌다.
          바탕·알약·글자색 모두 이미 있는 토큰이다 (sunken / inverse / surface). */}
      <div
        data-testid="report-view-toggle"
        data-view={view}
        className="relative mb-3 grid grid-cols-2 rounded-full bg-sunken p-1"
      >
        <span
          aria-hidden="true"
          className={`absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-full bg-inverse shadow-raise transition-transform duration-[140ms] ease-quick ${
            view === 'days' ? 'translate-x-full' : 'translate-x-0'
          }`}
        />
        {viewButton('cats', '카테고리별')}
        {viewButton('days', '일자별')}
      </div>

      {view === 'cats' ? (
        cats.categories.length === 0 ? (
          <p
            data-testid="report-empty"
            className="px-1 py-10 text-center text-label font-normal text-ink-muted"
          >
            아직 금액이 적힌 카드가 시간표에 없어요.
          </p>
        ) : (
          <table data-testid="report-table" className={TABLE_CLASS}>
            <Head />
            {cats.categories.map((group) => (
              <tbody key={group.column.id}>
                {/* 카테고리 이름 줄. 소계는 이 줄이 들고 있고(`data-*`), 줄이
                    둘 이상일 때만 아래에 「소계」로 한 번 더 쓴다 — 카드가 하나뿐인
                    카테고리에서 소계는 바로 윗줄을 그대로 옮겨 적는 일이다. */}
                <tr
                  data-testid="report-cat"
                  data-column-id={group.column.id}
                  data-spent={group.spent}
                  data-budget={group.budget}
                  className="border-t border-line bg-sunken"
                >
                  <th colSpan={3} className="px-2 py-1.5 text-left">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <EmojiIcon emoji={group.column.icon} />
                      <span className="min-w-0 truncate text-micro font-semibold text-ink">
                        {group.column.name}
                      </span>
                    </span>
                  </th>
                </tr>

                {group.rows.map((row) => (
                  <tr
                    key={row.card.id}
                    data-testid="report-row"
                    data-card-id={row.card.id}
                    data-spent={row.spent}
                    data-budget={row.budget}
                    className="border-t border-line odd:bg-surface even:bg-sunken/40"
                  >
                    <td className={LABEL_CELL}>
                      <span className="block truncate">{row.card.title}</span>
                    </td>
                    <Cell value={row.spent} currency={currency} />
                    <Cell value={row.budget} currency={currency} />
                  </tr>
                ))}

                {group.rows.length > 1 ? (
                  <tr
                    data-testid="report-subtotal"
                    data-column-id={group.column.id}
                    data-spent={group.spent}
                    data-budget={group.budget}
                    className="border-t border-line"
                  >
                    <td className={`${LABEL_CELL} text-ink-muted`}>
                      <span className="block truncate text-micro">소계</span>
                    </td>
                    <Cell value={group.spent} currency={currency} />
                    <Cell value={group.budget} currency={currency} />
                  </tr>
                ) : null}
              </tbody>
            ))}

            <tfoot>
              <tr
                data-testid="report-total"
                data-spent={cats.spent}
                data-budget={cats.budget}
                className="border-t-2 border-line-strong"
              >
                <td className={`${LABEL_CELL} font-semibold`}>
                  <span className="block truncate">합계</span>
                </td>
                <TotalCell value={cats.spent} currency={currency} rate={rate} strong />
                <TotalCell value={cats.budget} currency={currency} rate={rate} strong />
              </tr>
            </tfoot>
          </table>
        )
      ) : (
        <table data-testid="report-table" className={TABLE_CLASS}>
          <Head />

          {/* 어느 날에도 속하지 않는 줄들. 숙소비와 항공권은 떠나기 전에 한 번에
              긁히는 돈이라, 1일차에 통째로 얹으면 그 날만 백만 원짜리 날이 되고
              나눠 얹으면 어느 날에도 없던 금액이 넷 생긴다. */}
          {days.pinned.length > 0 ? (
            <tbody>
              <tr className="border-t border-line bg-sunken">
                <th colSpan={3} className="px-2 py-1.5 text-left">
                  <span className="block truncate text-micro font-semibold text-ink">
                    한 번에 내는 돈
                  </span>
                </th>
              </tr>
              {days.pinned.map((row) => (
                <tr
                  key={row.kind}
                  data-testid="report-pinned"
                  data-kind={row.kind}
                  data-count={row.count}
                  data-spent={row.spent}
                  data-budget={row.budget}
                  className="border-t border-line"
                >
                  <td className={LABEL_CELL}>
                    <span className="block truncate">{row.label}</span>
                  </td>
                  <Cell value={row.spent} currency={currency} />
                  <Cell value={row.budget} currency={currency} />
                </tr>
              ))}
            </tbody>
          ) : null}

          <tbody>
            {days.days.length > 0 ? (
              <tr className="border-t border-line bg-sunken">
                <th colSpan={3} className="px-2 py-1.5 text-left">
                  <span className="block truncate text-micro font-semibold text-ink">일자별</span>
                </th>
              </tr>
            ) : null}
            {days.days.map((row) => (
              <tr
                key={row.dayId}
                data-testid="report-day"
                data-day-id={row.dayId}
                data-index={row.index}
                data-spent={row.spent}
                data-budget={row.budget}
                className="border-t border-line odd:bg-surface even:bg-sunken/40"
              >
                <td className={LABEL_CELL}>
                  <span className="block truncate">{row.label}</span>
                </td>
                <Cell value={row.spent} currency={currency} />
                <Cell value={row.budget} currency={currency} />
              </tr>
            ))}
          </tbody>

          <tfoot>
            <tr
              data-testid="report-total"
              data-spent={days.spent}
              data-budget={days.budget}
              className="border-t-2 border-line-strong"
            >
              <td className={`${LABEL_CELL} font-semibold`}>
                <span className="block truncate">합계</span>
              </td>
              <TotalCell value={days.spent} currency={currency} rate={rate} strong />
              <TotalCell value={days.budget} currency={currency} rate={rate} strong />
            </tr>
            {/* 사용자가 따로 물은 숫자: 이미 낸 돈과 앞으로 낼 돈을 더한 것 —
                이 여행 전체가 지갑에서 가져갈 금액이다. */}
            <tr
              data-testid="report-total-combined"
              data-total={days.total}
              className="border-t border-line"
            >
              <td className={`${LABEL_CELL} font-semibold`}>
                <span className="block truncate">총액</span>
                <span className="block truncate text-micro font-normal text-ink-faint">
                  지출 + 예산
                </span>
              </td>
              <TotalCombined value={days.total} currency={currency} rate={rate} />
            </tr>
          </tfoot>
        </table>
      )}
    </Sheet>
  );
}
