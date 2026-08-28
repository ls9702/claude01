import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PlanDndContext from '../../dnd/PlanDndContext';
import { useIsDesktop, useMediaQuery } from '../../hooks/useMediaQuery';
import { useNowTick } from '../../hooks/useNowTick';
import { deleteEntryWithUndo } from '../../stores/entryDelete';
import { deleteWithUndo } from '../../stores/undoDelete';
import { useUiStore } from '../../stores/uiStore';
import { useTimelineChromeStore } from '../../stores/timelineChrome';
import { FIRST_SHEET_NAME, useWorkspaceStore } from '../../stores/workspaceStore';
import type {
  BoardColumn,
  Card,
  Day,
  Id,
  Sheet as SheetModel,
  TimelineEntry,
} from '../../types/models';
import { AXIS_PX, HEADER_PX, INITIAL_SCROLL_MIN, PX_PER_MIN } from '../../timeline/layout';
import { dayTitle, daySubtitle } from '../../timeline/dayLabel';
import {
  effectiveDayId,
  windowedEntriesByDay,
  type DayRef,
  type WindowedEntry,
} from '../../timeline/dayWindow';
import { dayRouteWindowed } from '../../timeline/route';
import { summarizeSchedule } from '../../timeline/scheduleSummary';
import { currentAndNextWindowed, nowMin, todayFocus } from '../../timeline/today';
import {
  dayPlannedBudgetWindowed,
  daySpendWindowed,
  emptySpend,
  sheetPlannedBudget,
  sheetPlannedByColumn,
  sheetSpend,
  sheetSpendByColumn,
  unplacedPlan,
  type SpendTotals,
} from '../../utils/spend';
import { formatTimeRange, minToY } from '../../utils/time';
import ConfirmDialog from '../common/ConfirmDialog';
import Icon from '../common/Icon';
import { useAiEnabled } from '../../ai/aiSettings';
import { useGoogleMapsKey } from '../../map/gmapsKey';
import AiAskButton from '../ai/AiAskButton';
import AiReviewSheet from '../ai/AiReviewSheet';
import SyncStatusChip from '../common/SyncStatusChip';
import { todoSummary } from '../../todo/checklist';
import {
  CHIP_BUTTON,
  CHIP_NOW,
  COMPACT_ACTION_BUTTON_CLASS,
  COUNT_BADGE_CLASS,
  GHOST_BUTTON_CLASS,
  POPOVER_CLASS,
  POPOVER_ROW_DANGER_CLASS,
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
} from '../common/formStyles';
import BoardRail from './BoardRail';
import NowBar from './NowBar';
import QuickSpendSheet from './QuickSpendSheet';
import DayColumn from './DayColumn';
import SpendChip from './SpendChip';
import EntryDetailSheet from './EntryDetailSheet';
import ScheduleSheet from './ScheduleSheet';
import SheetDuplicateDialog from './SheetDuplicateDialog';
import SheetRenameDialog from './SheetRenameDialog';
import SheetTabs from './SheetTabs';
import SheetWizard from './SheetWizard';
import SpendReportSheet from './SpendReportSheet';
import SpendSummaryBar, { categoryRows } from './SpendSummaryBar';
import TimeAxis from './TimeAxis';
import TodoSheet from './TodoSheet';
import UnscheduledTray from './UnscheduledTray';

type Dialog =
  | { kind: 'entry'; entry: TimelineEntry }
  | { kind: 'quick-spend'; entry: TimelineEntry }
  | { kind: 'day-delete'; day: Day; index: number }
  | { kind: 'schedule'; card: Card }
  | { kind: 'sheet-create' }
  | { kind: 'sheet-edit'; sheet: SheetModel }
  | { kind: 'sheet-rename'; sheet: SheetModel }
  | { kind: 'sheet-duplicate'; sheet: SheetModel }
  | { kind: 'sheet-delete'; sheet: SheetModel }
  | null;

/** Shown when no trip is active — mirrors the board's picker. */
function TripPrompt() {
  const workspace = useWorkspaceStore((s) => s.workspace);
  const setTab = useUiStore((s) => s.setTab);
  const setActiveTrip = useUiStore((s) => s.setActiveTrip);
  const trips = useMemo(
    () => Object.values(workspace.trips).sort((a, b) => b.createdAt - a.createdAt),
    [workspace.trips],
  );

  return (
    <section
      data-testid="view-timeline"
      className="mx-auto flex w-full max-w-md shrink-0 flex-col items-center gap-4 px-6 pb-16 pt-12 text-center"
    >
      <Icon name="calendar" size={24} className="text-ink-faint" />
      <h1 className="shrink-0 whitespace-nowrap text-title text-ink">일정</h1>
      <p className="text-label font-normal text-ink-muted">
        {trips.length > 0
          ? '어떤 여행의 시간표를 열까요?'
          : '먼저 여행을 만들면 시간표가 열려요.'}
      </p>

      {trips.length > 0 ? (
        <ul data-testid="timeline-trip-picker" className="mt-1 w-full space-y-2">
          {trips.map((trip) => (
            <li key={trip.id}>
              <button
                type="button"
                data-testid="timeline-trip-option"
                data-trip-id={trip.id}
                onClick={() => setActiveTrip(trip.id)}
                className={`${SECONDARY_BUTTON_CLASS} w-full justify-start`}
              >
                {trip.title}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <button
          type="button"
          data-testid="timeline-goto-trips"
          onClick={() => setTab('trips')}
          className={PRIMARY_BUTTON_CLASS}
        >
          여행 만들러 가기
        </button>
      )}
    </section>
  );
}

/**
 * The 일정 tab: a 05:00 → 05:00 grid of day columns fed by the board (M16-B).
 *
 * Desktop (≥1024px) puts a board rail beside the grid inside **one**
 * `PlanDndContext`, so a card can be dragged straight from the rail onto a
 * minute of a day. Below that breakpoint the grid shows one day at a time with
 * a pager, and cards reach the timeline through {@link ScheduleSheet}.
 */
export default function TimelineView() {
  const workspace = useWorkspaceStore((s) => s.workspace);
  const addSheet = useWorkspaceStore((s) => s.addSheet);
  const deleteSheet = useWorkspaceStore((s) => s.deleteSheet);
  const duplicateSheet = useWorkspaceStore((s) => s.duplicateSheet);
  /** 구글 키가 있는 기기에서만 복제가 지도를 묻는다 (M41). */
  const googleKey = useGoogleMapsKey();
  const addDay = useWorkspaceStore((s) => s.addDay);
  const deleteDay = useWorkspaceStore((s) => s.deleteDay);

  const activeTripId = useUiStore((s) => s.activeTripId);
  const activeSheetId = useUiStore((s) => s.activeSheetId);
  const setActiveSheet = useUiStore((s) => s.setActiveSheet);
  const setTab = useUiStore((s) => s.setTab);

  const isDesktop = useIsDesktop();

  /**
   * 상단 크롬 접기 (M18) — **모바일 전용**.
   *
   * `isDesktop`으로 한 번 더 걸러서, ≥lg에서는 저장된 값이 무엇이든 접히지
   * 않는다. 데스크톱은 폭이 남고 레일까지 띄우는 화면이라 접을 이유가 없고,
   * 폰에서 접어 둔 것이 노트북 화면을 바꾸면 그건 기억이 아니라 사고다.
   */
  const chromeCollapsed = useTimelineChromeStore((s) => s.collapsed);
  const toggleChrome = useTimelineChromeStore((s) => s.toggle);
  const expandChrome = useTimelineChromeStore((s) => s.expand);
  const collapsed = !isDesktop && chromeCollapsed;

  const [dialog, setDialog] = useState<Dialog>(null);
  const [pageIndex, setPageIndex] = useState(0);
  /** The pager's own ⋯ menu — mobile only; desktop keeps it on the day header. */
  const [dayMenuOpen, setDayMenuOpen] = useState(false);
  const dayMenuRef = useRef<HTMLDivElement | null>(null);

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  /** `tripId:sheetId` this view has already positioned itself for. */
  const positionedRef = useRef<string | null>(null);
  const seededTripRef = useRef<Id | null>(null);

  /** 오늘 모드's clock: one `Date` per minute, paused while the tab is hidden. */
  const now = useNowTick();
  const minuteNow = nowMin(now);

  const trip = activeTripId ? workspace.trips[activeTripId] : undefined;

  /** First visit to a trip's 일정 tab creates the sheet it will live in. */
  useEffect(() => {
    if (!trip || trip.sheetOrder.length > 0) return;
    if (seededTripRef.current === trip.id) return;
    seededTripRef.current = trip.id;
    addSheet(trip.id, FIRST_SHEET_NAME);
  }, [trip, addSheet]);

  const sheets = useMemo<SheetModel[]>(
    () =>
      (trip?.sheetOrder ?? [])
        .map((id) => workspace.sheets[id])
        .filter((entry): entry is SheetModel => Boolean(entry)),
    [trip?.sheetOrder, workspace.sheets],
  );

  const sheetId =
    activeSheetId && trip?.sheetOrder.includes(activeSheetId)
      ? activeSheetId
      : trip?.sheetOrder[0];
  const sheet = sheetId ? workspace.sheets[sheetId] : undefined;

  /** Keep `uiStore.activeSheetId` pointing at whatever is on screen. */
  useEffect(() => {
    if (sheetId && sheetId !== activeSheetId) setActiveSheet(sheetId);
  }, [sheetId, activeSheetId, setActiveSheet]);

  const days = useMemo<Day[]>(
    () =>
      (sheet?.dayOrder ?? [])
        .map((dayId) => workspace.days[dayId])
        .filter((day): day is Day => Boolean(day)),
    [sheet?.dayOrder, workspace.days],
  );

  const columns = useMemo<BoardColumn[]>(
    () =>
      (trip?.columnOrder ?? [])
        .map((columnId) => workspace.columns[columnId])
        .filter((column): column is BoardColumn => Boolean(column)),
    [trip?.columnOrder, workspace.columns],
  );

  const cardsByColumn = useMemo(() => {
    const map: Record<Id, Card[]> = {};
    for (const column of columns) {
      map[column.id] = column.cardOrder
        .map((cardId) => workspace.cards[cardId])
        .filter((card): card is Card => Boolean(card));
    }
    return map;
  }, [columns, workspace.cards]);

  /**
   * The active sheet's days — the axis every window mapping turns on.
   *
   * Ids **with their dates** (B1): whether a 새벽 일정 folds back into the row
   * above it is a calendar question, and `[5월 1일, 5월 3일]` is a sheet whose
   * two rows are not neighbouring nights.
   */
  const dayOrder = useMemo<DayRef[]>(
    () => (sheet?.dayOrder ?? []).map((id) => ({ id, date: workspace.days[id]?.date })),
    [sheet?.dayOrder, workspace.days],
  );

  /**
   * dayId → the entries **stored on** that calendar day, sorted by start time.
   *
   * Still calendar-keyed on purpose: it answers "what disappears if I delete
   * this day row" (the 일자 삭제 confirm) and "does this sheet hold anything at
   * all" — both of which are questions about the data, not about the grid.
   */
  const entriesByDay = useMemo(() => {
    const byDay: Record<Id, TimelineEntry[]> = {};
    for (const entry of Object.values(workspace.entries)) {
      if (trip && entry.tripId !== trip.id) continue;
      (byDay[entry.dayId] ??= []).push(entry);
    }
    for (const list of Object.values(byDay)) list.sort((a, b) => a.startMin - b.startMin);
    return byDay;
  }, [workspace.entries, trip]);

  /**
   * dayId → the entries that day column **draws**, with their placements
   * (M16-B): its own from 05:00 on, plus the next day's 새벽 hours.
   */
  const windowedByDay = useMemo<Record<Id, WindowedEntry[]>>(() => {
    const tripEntries = Object.values(workspace.entries).filter(
      (entry) => !trip || entry.tripId === trip.id,
    );
    return windowedEntriesByDay(tripEntries, dayOrder);
  }, [workspace.entries, trip, dayOrder]);

  /**
   * dayId → 예산/지출 of that day, for the 일자 지출 칩 (M6).
   *
   * Counts **cards**, not placements — a card scheduled twice is one receipt;
   * see `utils/spend.ts`. **Windowed** (M16-B) so the chip agrees with the
   * column under it.
   */
  const spendByDay = useMemo<Record<Id, SpendTotals>>(() => {
    const byDay: Record<Id, SpendTotals> = {};
    for (const day of days) byDay[day.id] = daySpendWindowed(workspace, day.id, dayOrder);
    return byDay;
  }, [days, workspace, dayOrder]);

  /**
   * dayId → 그 창에 배치된 것들의 **필요 예산** (M25).
   *
   * 지출판(`spendByDay`)과 나란히 사는 계획판이다: 요약 바만 이것을 쓰고, 일자
   * 칩·카드 원장·결산은 예전 그대로 지출을 말한다. 창은 같은 05시 창이다.
   */
  const plannedByDay = useMemo<Record<Id, number>>(() => {
    const byDay: Record<Id, number> = {};
    for (const day of days) byDay[day.id] = dayPlannedBudgetWindowed(workspace, day.id, dayOrder);
    return byDay;
  }, [days, workspace, dayOrder]);

  const sheetPlanned = useMemo(
    () => (sheet ? sheetPlannedBudget(workspace, sheet.id) : 0),
    [sheet, workspace],
  );

  /**
   * 이 시트에 배치된 카드들에 **이미 적힌 지출** (M31).
   *
   * 계획판(`sheetPlanned`)과 달리 카드 단위로 접어 센다 — 4박 호텔 카드를 네
   * 날에 걸어 두어도 영수증은 하나다. 그래서 M6의 `sheetSpend`를 그대로 쓴다:
   * 결산·일자 칩이 답하던 그 숫자와 요약 바가 서로 다른 답을 내면 안 된다.
   */
  const sheetSpent = useMemo(
    () => (sheet ? sheetSpend(workspace, sheet.id).spent : 0),
    [sheet, workspace],
  );

  /**
   * AI 검토 (M11) — offered only when there is a plan to review.
   *
   * An empty sheet would produce a prompt that says "(비어 있음)" six times and
   * an answer about nothing, so the button is not there at all until at least
   * one card has been placed.
   */
  const aiOn = useAiEnabled();
  const [aiReviewOpen, setAiReviewOpen] = useState(false);
  const sheetHasEntries = useMemo(
    () => (sheet ? sheet.dayOrder.some((dayId) => (entriesByDay[dayId]?.length ?? 0) > 0) : false),
    [sheet, entriesByDay],
  );

  /**
   * 할 일 (M29) — 시간표에 놓을 수 없는 일들이 사는 곳.
   *
   * 이 탭에 사는 이유는 그것이 「여행 준비」가 실제로 벌어지는 화면이기 때문이다:
   * 환전·유심·예약은 몇 시에 할 일이 아니라 출발 전에 끝내 둘 일이고, 시간표를
   * 들여다보는 그 순간이 그것들이 떠오르는 순간이다. 남은 개수는 버튼 위에서
   * 조용히만 말한다 — 재촉하는 색은 now-line과 안 읽음의 몫이다.
   */
  const [todoOpen, setTodoOpen] = useState(false);
  const todoRemaining = useMemo(
    () => todoSummary(workspace, trip?.id).remaining,
    [workspace, trip?.id],
  );

  /**
   * 지출 리포트 (M32) — 요약 바의 한 줄을 표로 펼쳐 보는 자리.
   *
   * 바가 답하는 것은 「얼마 드나」 하나뿐이고, 그 다음 질문(「어디에?」)은 한 줄에
   * 들어가지 않는다. 그래서 팝오버를 키우는 대신 시트를 하나 연다 — 카테고리별과
   * 일자별, 같은 돈의 두 모습이다. 여는 자리는 「할 일」 옆이다: 접어도 사라지지
   * 않는 그 묶음이 이 탭의 액션들이 사는 곳이다 (M29).
   */
  const [reportOpen, setReportOpen] = useState(false);
  /**
   * 리포트 버튼이 설 수 있는 최소 폭 — 실측이고, 두 단계다 (M32).
   *
   * 이 헤더 줄은 이미 꽉 차 있다. 브라우저에 대고 잰 내용 폭은 이렇다:
   *
   * | 이 줄에 선 것 | 내용 폭 | 리포트를 얹으면 |
   * |---|---|---|
   * | 제목 + 프로필·동기화 + 버튼 셋 | 287px | 335px |
   * | 거기에 AI 두 개(물어보기·검토)까지 | 375px | 423px |
   *
   * 넘치면 밀려나는 것은 버튼이 아니라 **페이지 전체**다: 헤더가 뷰포트보다
   * 넓어지고 그리드까지 따라 밀린다 (M25·M31의 요약 바 스펙이 320px에서 잡아내는
   * 그 사고다). 그래서 자리가 없으면 리포트가 물러선다 — 밀려날 수 있는 것 중
   * 가장 늦게 아쉬운 것이기 때문이다. 할 일·일자 추가는 계획을 **바꾸는**
   * 손잡이지만, 리포트는 이미 적어 둔 것을 **읽는** 자리다.
   *
   * 두 단계인 이유는 M31의 `WORDS_YIELD`와 같다: 같은 줄이라도 무엇이 서 있느냐에
   * 따라 필요한 폭이 다르고, 하나의 기준선으로 뭉뚱그리면 둘 중 한쪽이 틀린다.
   *
   * ⚠️ 알려진 제한: AI를 켠 기기에서는 423px가 필요해서 390px 폰에서는 이 버튼이
   * 서지 못한다. 그 폭에서 AI 두 개가 붙은 줄은 **M32 이전에도 이미** 360px에서
   * 넘치고 있었다(375px) — 이 줄을 근본적으로 고치려면 기존 버튼들의 크기·간격을
   * 손봐야 한다. 그래서 좁은 폭의 진입점은 예산 바 팝오버 맨 아래의 「전체
   * 리포트 보기」다: 버튼이 물러나는 모든 폭에서 리포트는 여전히 두 탭 거리다.
   */
  const REPORT_NEEDS_PX = { plain: 360, crowded: 424 } as const;
  const roomForReport = useMediaQuery(
    `(min-width: ${aiOn ? REPORT_NEEDS_PX.crowded : REPORT_NEEDS_PX.plain}px)`,
  );

  /**
   * 오늘 모드 (M7b): which column the user is living in, and where its now line
   * goes (M16-B / B6). Everything today-flavoured — the chip, the now line, the
   * 지금/다음 bar — hangs off this one object being non-null.
   */
  const focus = useMemo(() => todayFocus(workspace, sheet?.id, now), [workspace, sheet?.id, now]);
  const todayId = focus?.dayId ?? null;

  const nowNext = useMemo(
    () =>
      focus
        ? currentAndNextWindowed(
            (windowedByDay[focus.dayId] ?? []).map((row) => row.entry),
            workspace.cards,
            dayOrder,
            minuteNow,
            focus.nowRawOffsetMin,
          )
        : {},
    [focus, windowedByDay, workspace.cards, dayOrder, minuteNow],
  );

  /**
   * 카테고리별 breakdown for the summary bar, plus what it leaves out (M16-A).
   *
   * Sheet scope, because that is the scope of the number it hangs under.
   */
  const categories = useMemo(
    () =>
      sheet
        ? categoryRows(
            columns,
            sheetPlannedByColumn(workspace, sheet.id),
            sheetSpendByColumn(workspace, sheet.id),
          )
        : [],
    [sheet, columns, workspace],
  );

  const unplaced = useMemo(
    () => unplacedPlan(workspace, trip?.id ?? ''),
    [workspace, trip?.id],
  );

  /** cardId → total entries (badge) and their per-sheet split (popover). */
  const { counts: scheduledCounts, bySheet: scheduleBreakdowns } = useMemo(
    () => summarizeSchedule(workspace, trip?.id),
    [workspace, trip?.id],
  );

  /**
   * 미배치 = no entry on the **active** sheet. A card placed on another sheet
   * is still up for grabs here, which is the whole point of several sheets.
   */
  const { unscheduledCards, scheduledTrayCards } = useMemo(() => {
    const placedCount = new Map<Id, number>();
    const dayIds = new Set(days.map((day) => day.id));
    for (const entry of Object.values(workspace.entries)) {
      if (dayIds.has(entry.dayId)) {
        placedCount.set(entry.cardId, (placedCount.get(entry.cardId) ?? 0) + 1);
      }
    }
    const all = columns.flatMap((column) => cardsByColumn[column.id] ?? []);
    return {
      unscheduledCards: all.filter((card) => !placedCount.has(card.id)),
      // 배치된 카드도 트레이에 남는다 (M33): 모바일에서는 트레이가 유일한 드래그
      // 소스라, 여기서 사라지는 순간 「한 번 놓은 카드는 다시 놓을 수 없다」가
      // 되어 버린다 — 사용자가 같은 이름의 카드를 또 만들던 바로 그 버그다.
      scheduledTrayCards: all
        .filter((card) => placedCount.has(card.id))
        .map((card) => ({ card, count: placedCount.get(card.id) ?? 0 })),
    };
  }, [columns, cardsByColumn, days, workspace.entries]);

  // The pager index must survive a day being deleted.
  const safePage = days.length === 0 ? 0 : Math.min(pageIndex, days.length - 1);
  useEffect(() => {
    if (safePage !== pageIndex) setPageIndex(safePage);
  }, [safePage, pageIndex]);

  useEffect(() => {
    if (!dayMenuOpen) return;
    const onDown = (event: PointerEvent) => {
      if (!dayMenuRef.current?.contains(event.target as Node)) setDayMenuOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [dayMenuOpen]);

  /**
   * Scrolls the grid to `offsetMin` — minutes from the **top of the window**
   * (05:00), not a wall-clock minute (M16-B). Never above the window's start.
   */
  const scrollToOffset = useCallback((offsetMin: number) => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    scroller.scrollTop = minToY(Math.max(offsetMin, 0), PX_PER_MIN);
  }, []);

  /** Desktop: brings one day column into the horizontally scrolling grid. */
  const revealDay = useCallback((dayId: Id) => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const column = scroller.querySelector<HTMLElement>(
      `[data-testid="timeline-day"][data-day-id="${dayId}"]`,
    );
    if (column) scroller.scrollLeft = Math.max(column.offsetLeft - AXIS_PX, 0);
  }, []);

  /**
   * Selects today's day and parks the grid an hour before the current minute.
   *
   * `offsetMin` is a **window** offset, not a wall clock: at 새벽 2시 those two
   * are 1140 minutes apart, and in the 첫날 새벽 the honest place to park is the
   * top of the column (B6).
   */
  const jumpToToday = useCallback(
    (dayId: Id, offsetMin: number) => {
      const index = days.findIndex((day) => day.id === dayId);
      if (index >= 0) setPageIndex(index);
      scrollToOffset(offsetMin - 60);
      revealDay(dayId);
    },
    [days, scrollToOffset, revealDay],
  );

  /**
   * First paint of a trip+sheet: open on **today** when the sheet holds it,
   * otherwise on {@link INITIAL_SCROLL_MIN} (08:00) — nobody plans from 05시.
   *
   * Guarded by `positionedRef` so it lands exactly once per sheet: after that
   * the grid belongs to the user, and a minute tick must never yank it back.
   */
  useEffect(() => {
    if (!sheet || days.length === 0 || !scrollerRef.current) return;
    const key = `${trip?.id ?? ''}:${sheet.id}`;
    if (positionedRef.current === key) return;
    positionedRef.current = key;

    if (focus) jumpToToday(focus.dayId, focus.nowOffsetMin);
    else scrollToOffset(INITIAL_SCROLL_MIN);
  }, [trip?.id, sheet, days.length, focus, jumpToToday, scrollToOffset]);

  if (!trip) return <TripPrompt />;

  const visibleDays = isDesktop ? days : days.slice(safePage, safePage + 1);
  const currentDay = days[safePage];
  /**
   * The day the 요약 바's second half describes (M16-A): the pager's day on
   * mobile, and on desktop only 오늘 — where many columns are on screen at once,
   * "현재 보이는 일자" has no single answer worth asserting.
   */
  const summaryDay = isDesktop
    ? (todayId ? days.find((day) => day.id === todayId) : undefined)
    : currentDay;
  const nothingPlaced = Object.values(entriesByDay).every((list) => list.length === 0);
  const dialogEntry = dialog?.kind === 'entry' ? workspace.entries[dialog.entry.id] : undefined;
  const quickSpendCard =
    dialog?.kind === 'quick-spend' ? workspace.cards[dialog.entry.cardId] : undefined;

  /**
   * 일자 추가 — and, when the trip has no sheet left to add it to, the sheet
   * first (B16).
   *
   * Deleting the last sheet used to leave both CTAs disabled with nothing said,
   * and the auto-seed above never fires twice for one trip. So the button makes
   * what it needs instead of standing there greyed out.
   */
  const addDayToSheet = () => {
    const targetId = sheet?.id ?? addSheet(trip.id, FIRST_SHEET_NAME);
    if (!targetId) return;
    if (targetId !== sheet?.id) setActiveSheet(targetId);
    const created = addDay(targetId);
    if (created) setPageIndex(days.length);
  };

  /**
   * The sheet a 새 시트 wizard should **fill** rather than sit next to (B17):
   * the active one, when it is a bare shell with no days and no flights. That
   * shell is almost always the auto-seeded 일정 1, and leaving it behind as a
   * sibling is how a trip ends up with a stray empty tab.
   */
  const fillableSheet =
    sheet && sheet.dayOrder.length === 0 && !sheet.outboundFlight && !sheet.inboundFlight
      ? sheet
      : undefined;

  /**
   * Deletes an entry and offers to put an identical one back.
   *
   * The doing of it moved to `stores/entryDelete` in M34, because the 휴지통 a
   * drag summons has to delete the *same* way this sheet does — same sentence,
   * same undo, same untouched card.
   */
  const removeEntry = (entry: TimelineEntry) => {
    deleteEntryWithUndo(entry);
    setDialog(null);
  };

  /**
   * 헤더 오른쪽 액션 묶음 — 펼침/접힘 두 줄이 **같은 버튼들**을 쓴다.
   *
   * 접었다고 해서 할 수 있는 일이 줄어들면 그건 접기가 아니라 숨기기다.
   */
  const headerActions = (
    <div className="ml-auto flex shrink-0 items-center gap-1 lg:gap-2">
      {isDesktop ? null : <AiAskButton />}
      {isDesktop ? null : <SyncStatusChip variant="dot" />}
      {/* 접힘 줄과 펼침 줄이 **같은** 묶음을 쓰므로 (위 주석), 이 버튼은 상단
          메뉴를 접어도 사라지지 않는다 — 접기는 숨기기가 아니다. */}
      <button
        type="button"
        data-testid="todo-open"
        data-remaining={todoRemaining}
        onClick={() => setTodoOpen(true)}
        aria-label="할 일"
        title="할 일"
        className={COMPACT_ACTION_BUTTON_CLASS}
      >
        <Icon name="check" size={16} />
        <span className="hidden sm:inline">할 일</span>
        {todoRemaining > 0 ? (
          <span data-testid="todo-open-count" className={COUNT_BADGE_CLASS}>
            {todoRemaining}
          </span>
        ) : null}
      </button>
      {/* 「할 일」과 같은 묶음, 같은 레시피 — 접어도 남는다 (M29의 그 자리다).
          시트가 있어야 볼 표가 있으므로, 시트가 없으면 버튼도 없다.

          좁은 줄에서 물러나는 이유와 그 실측 기준선은 `roomForReport` 옆에
          적어 두었다. */}
      {sheet && roomForReport ? (
        <button
          type="button"
          data-testid="report-open"
          onClick={() => setReportOpen(true)}
          aria-label="지출 리포트"
          title="지출 리포트"
          className={COMPACT_ACTION_BUTTON_CLASS}
        >
          <Icon name="chart" size={16} />
          <span className="hidden sm:inline">리포트</span>
        </button>
      ) : null}
      {aiOn && sheet && sheetHasEntries ? (
        <button
          type="button"
          data-testid="ai-review-open"
          onClick={() => setAiReviewOpen(true)}
          // 아이콘만 남는 폭에서도 이름이 있는 버튼이어야 한다.
          aria-label="AI 검토"
          title="AI 검토"
          className={COMPACT_ACTION_BUTTON_CLASS}
        >
          <Icon name="sparkle" size={16} />
          <span className="hidden sm:inline">AI 검토</span>
        </button>
      ) : null}
      <button
        type="button"
        data-testid="timeline-add-day"
        onClick={addDayToSheet}
        aria-label="일자 추가"
        title="일자 추가"
        className={COMPACT_ACTION_BUTTON_CLASS}
      >
        <Icon name="plus" size={16} />
        <span className="hidden sm:inline">일자 추가</span>
      </button>
      {/* 접기 토글은 모바일에만 존재한다 — 데스크톱에는 접을 것이 없다. */}
      {isDesktop ? null : (
        <button
          type="button"
          data-testid="timeline-chrome-toggle"
          data-collapsed={collapsed ? 'true' : 'false'}
          aria-expanded={!collapsed}
          aria-label={collapsed ? '상단 메뉴 펼치기' : '상단 메뉴 접기'}
          title={collapsed ? '상단 메뉴 펼치기' : '상단 메뉴 접기'}
          onClick={toggleChrome}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-ink-muted transition-colors duration-[140ms] ease-quick hover:bg-sunken hover:text-ink"
        >
          <Icon name={collapsed ? 'chevron-down' : 'chevron-up'} size={20} />
        </button>
      )}
    </div>
  );

  return (
    <section
      data-testid="view-timeline"
      aria-labelledby="view-timeline-title"
      // One flex column, top to bottom, filling whatever the app shell hands
      // it. The grid takes what the fixed rows above leave over — no
      // `calc(100dvh - 21rem)` guesses, and no white band under it (§4.4-2).
      className="flex min-h-0 flex-1 flex-col"
    >
      {/*
        M18 — 폰에서 그리드에 닿기까지 다섯 줄이 서 있었다. 이 헤더는 그중 첫
        줄이고, 두 가지를 고친다.

        1. **제목은 줄바꿈되지 않는다.** 「일정」이 「일 / 정」으로 쪼개진 것은
           h1이 옆의 버튼 두 개에 밀려 글자 하나 폭으로 짜부라졌기 때문이다.
           `shrink-0 whitespace-nowrap`으로 h1을 양보 대상에서 빼고, 대신
           버튼이 `sm` 아래에서 아이콘으로 줄어든다.
        2. **모바일은 한 줄이다.** 제목 아래 두 번째 줄에 있던 여행 이름이
           같은 줄로 올라온다(`items-center` 한 줄 정렬). 데스크톱은 폭이
           남으므로 M18 이전의 두 줄 블록 그대로다.
      */}
      <header
        data-testid="timeline-header"
        data-collapsed={collapsed ? 'true' : 'false'}
        className={
          isDesktop
            ? 'flex shrink-0 items-center gap-3 px-4 pb-4 pt-6'
            : // M19 — gap-2 → gap-1: 접힘 줄에서 시트 이름이 가져갈 수 있는
              // 폭을 4px라도 더 남긴다. 오른쪽 액션 묶음은 이미 gap-1이다.
              'flex shrink-0 items-center gap-1 px-4 pb-1 pt-2'
        }
      >
        {isDesktop ? (
          <div className="min-w-0">
            <h1
              id="view-timeline-title"
              className="shrink-0 whitespace-nowrap text-display text-ink"
            >
              일정
            </h1>
            <p
              data-testid="timeline-trip-title"
              className="mt-1 min-w-0 truncate text-label text-ink-muted"
            >
              {trip.title}
            </p>
          </div>
        ) : collapsed ? (
          <>
            {/* 접힌 줄에서 「일정」은 화면 아래 탭 바가 이미 말하고 있다. 이
                줄이 답해야 하는 질문은 「지금 어느 시트인가」 하나뿐이라,
                제목은 이름만 남기고 자리를 내준다. */}
            <h1 id="view-timeline-title" className="sr-only">
              일정
            </h1>
            {sheet ? (
              <button
                type="button"
                data-testid="timeline-chrome-sheet"
                onClick={expandChrome}
                // 접혀 있어도 시트 전환은 두 탭 안이어야 한다: 이름을 누르면
                // 탭 줄이 그대로 돌아온다.
                aria-label={`${sheet.name} — 상단 메뉴 펼치기`}
                /* M19 — 이 줄의 폭 예산은 빠듯하다. 360px에서 오른쪽 액션 여섯
                   개가 260px를 가져가고 남는 60px 안에 아이콘(16)+간격(4)+좌우
                   패딩(16)이 먼저 앉으면 이름 몫은 24px, 즉 「본 일정」이 「본.」
                   이 된다 — 접힘 줄이 답해야 할 단 하나의 질문에 답하지 못한다.
                   그래서 달력 아이콘을 뺀다: 이 줄에서 이름 옆의 아이콘은 이름을
                   설명하지 않고 자리만 먹었다. 아래 탭 바의 「일정」이 이미 어느
                   화면인지 말하고 있다. */
                className="flex h-11 min-w-0 items-center rounded-full px-1 text-title text-ink transition-colors duration-[140ms] ease-quick hover:bg-sunken"
              >
                <span data-testid="timeline-sheet-name" className="min-w-0 truncate">
                  {sheet.name}
                </span>
              </button>
            ) : (
              <span className="text-title text-ink">일정</span>
            )}
          </>
        ) : (
          <>
            <h1
              id="view-timeline-title"
              className="shrink-0 whitespace-nowrap text-display text-ink"
            >
              일정
            </h1>
            {/* 여행 이름은 `sm` 아래에서 물러난다.
                390px에서 이 자리에 남는 폭은 25px 남짓이고, 「오사카 여행」이
                「오…」로 잘리면 그건 정보가 아니라 얼룩이다. 어느 여행인지는
                방금 연 여행 탭과 보드 탭이 둘 다 이름으로 말하고 있고, 이 화면이
                답해야 할 질문은 「오늘 몇 시에 뭘 하나」다 (M9 §3.3 · M18 §4). */}
            <p
              data-testid="timeline-trip-title"
              className="hidden min-w-0 flex-1 truncate text-label text-ink-muted sm:block"
            >
              {trip.title}
            </p>
          </>
        )}
        {headerActions}
      </header>

      {/* Under the h1, never over it (M9 §3.5). Desktop wears the chip in the
          top bar instead, so only one of the two ever mounts. */}

      {/* Row 1 is sheets and nothing else; the 오늘 and 지출 chips moved down
          into the pager, which is where the day they describe lives.

          M18: this is the first of the two rows 접기 takes away. The active
          sheet's name survives in the slim header row above, so nothing is
          lost — only the ability to *switch* is, and that is one tap back. */}
      {collapsed ? null : (
        <div className="shrink-0 pb-1 lg:pb-2">
          <SheetTabs
            sheets={sheets}
            activeSheetId={sheet?.id}
            onSelect={setActiveSheet}
            onCreate={() => setDialog({ kind: 'sheet-create' })}
            onRename={(target) => setDialog({ kind: 'sheet-rename', sheet: target })}
            onEditFlights={(target) => setDialog({ kind: 'sheet-edit', sheet: target })}
            // 사본으로 곧장 넘어간다 (M40) — 복제를 눌러 놓고 원본 위에 남아
            // 있으면, 방금 만든 것을 손보려고 한 번 더 탭해야 한다.
            //
            // M41: 구글 키가 있는 기기에서만 한 번 묻는다 — 사본을 어느 지도로
            // 볼 것인가. 키가 없으면 물을 것이 없으므로 M40 그대로 한 번에 끝난다.
            onDuplicate={(target) => {
              if (googleKey) {
                setDialog({ kind: 'sheet-duplicate', sheet: target });
                return;
              }
              const copyId = duplicateSheet(target.id);
              if (copyId) setActiveSheet(copyId);
            }}
            onDelete={(target) => setDialog({ kind: 'sheet-delete', sheet: target })}
            // The sheet's 지출 칩 used to ride here. M16-A's summary bar states the
            // same two numbers one row down and never scrolls away, so keeping the
            // chip would have been the same fact twice on adjacent lines.
          />
        </div>
      )}

      {/* Desktop's 오늘 칩. The row only exists when there is a 오늘 to jump to;
          an empty 36px strip above the grid is 36px of nothing (S7). */}
      {isDesktop && todayId ? (
        <div className="flex shrink-0 items-center gap-2 px-4 pb-2">
          <button
            type="button"
            data-testid="today-chip"
            data-day-id={todayId}
            data-active={currentDay?.id === todayId ? 'true' : 'false'}
            onClick={() => jumpToToday(todayId, focus?.nowOffsetMin ?? 0)}
            className={currentDay?.id === todayId ? CHIP_NOW : CHIP_BUTTON}
          >
            오늘
          </button>
        </div>
      ) : null}

      {days.length === 0 ? (
        <div
          data-testid="timeline-empty"
          className="mx-4 mt-6 flex flex-col items-center gap-3 rounded-lg bg-surface px-6 py-12 text-center shadow-raise"
        >
          <Icon name="calendar" size={24} className="text-ink-faint" />
          <p className="text-title text-ink">첫 일자를 추가해보세요</p>
          <p className="mx-auto max-w-[22rem] text-label font-normal text-ink-muted">
            일자를 만들면 05시부터 다음 날 05시까지의 시간표가 열리고, 보드의 카드를 끌어다
            놓을 수 있어요.
          </p>
          {/* Two honest ways forward, plus a way to throw the shell away when
              the trip already has a real sheet next to this one (M9 §4.4-5). */}
          <div className="mt-2 flex w-full max-w-[22rem] flex-col gap-2">
            <button
              type="button"
              data-testid="timeline-add-day-empty"
              onClick={addDayToSheet}
              className={PRIMARY_BUTTON_CLASS}
            >
              <Icon name="plus" size={16} />
              일자 추가
            </button>
            <button
              type="button"
              data-testid="timeline-empty-flight"
              onClick={() => setDialog({ kind: 'sheet-create' })}
              className={SECONDARY_BUTTON_CLASS}
            >
              항공편으로 만들기
            </button>
            {sheets.length > 1 && sheet ? (
              <button
                type="button"
                data-testid="timeline-empty-delete"
                onClick={() => setDialog({ kind: 'sheet-delete', sheet })}
                className={GHOST_BUTTON_CLASS}
              >
                이 빈 시트 삭제
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <>
          {/* M16-A → M25 → M31: 「이 계획대로면 얼마가 드나, 그중 얼마는 이미
              냈나」 한 줄, 그리드 위에 고정. Full-bleed and `h-10` so it costs
              exactly one hairline-bounded row — see SpendSummaryBar for why it
              is not a floating card, and why 지출은 뒤에 작게만 선다. */}
          {/* M18: the second of the two rows 접기 takes away. The number is
              a *glance*, not navigation — and it is one tap away in 카테고리별
              (일자별 지출은 페이저의 지출 칩이 계속 말한다). */}
          {collapsed ? null : (
          <SpendSummaryBar
            sheetBudget={sheetPlanned}
            sheetSpent={sheetSpent}
            // Desktop scrolls many columns at once, so "the visible day" is only
            // an honest phrase when 오늘 is one of them; otherwise the bar says
            // nothing rather than guessing which column the eye is on.
            day={
              summaryDay
                ? {
                    id: summaryDay.id,
                    label: dayTitle(summaryDay, days.indexOf(summaryDay)),
                    budget: plannedByDay[summaryDay.id] ?? 0,
                  }
                : undefined
            }
            categories={categories}
            unplaced={unplaced}
            currency={trip.currency}
            rate={{ localCurrency: trip.localCurrency, fxRate: trip.fxRate }}
            // 헤더 버튼이 물러난 폭에서도 리포트가 닿도록 (M32) — 팝오버 맨
            // 아래 줄이 두 번째 진입점이다.
            onOpenReport={sheet ? () => setReportOpen(true) : undefined}
          />
          )}

          {/* Mobile row 2: the pager *is* the day header. Title, date, money,
              오늘, and the ⋯ menu all live here, so the sticky header inside
              the column can fold away to `sr-only` (M9 §4.4-2 / §4.4-4). */}
          {!isDesktop ? (
            <div
              data-testid="day-pager"
              // M18 §3 — 40px. 요약 바와 같은 한 줄 예산이다: 안에 든 것은
              // 32px 원형 타깃과 24px 칩뿐이라 44px 껍데기는 순전히 여백이었고,
              // 그 4px는 그리드가 쓰는 편이 낫다.
              className="mx-4 mb-1 flex h-10 shrink-0 items-center gap-1 rounded-md border border-line bg-surface px-1 shadow-raise"
            >
              <button
                type="button"
                data-testid="day-pager-prev"
                aria-label="이전 일자"
                disabled={safePage === 0}
                onClick={() => setPageIndex((index) => Math.max(index - 1, 0))}
                // M19 — 일자를 넘기는 유일한 손잡이다. 32×32는 이 화면에서 가장
                // 자주 눌리는 버튼치고 작았다: 줄 높이(38px 안쪽)가 허락하는
                // 만큼 키우고, 폭은 손가락이 흔들리는 방향인 좌우로 44px 준다.
                className="grid h-9 w-11 shrink-0 place-items-center rounded-full text-ink-muted transition-colors duration-[140ms] ease-quick hover:bg-sunken disabled:text-ink-faint/50 disabled:hover:bg-transparent"
              >
                <Icon name="chevron-left" size={20} />
              </button>

              {/* M18 §4 — `items-baseline`이던 자리다. 13px 제목과 11px 날짜를
                  베이스라인에 맞추면 그 둘이 이룬 상자가 줄 높이보다 커져서,
                  줄 안에서 2px 위로 뜬 채 좌우의 32px 원형 버튼들과 어긋났다.
                  같은 줄에 선 것들은 같은 중심선을 쓴다. */}
              <span className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
                <span
                  data-testid="day-pager-label"
                  className="min-w-0 truncate text-label font-semibold text-ink"
                >
                  {currentDay ? dayTitle(currentDay, safePage) : ''}
                </span>
                {/* Empty when it would only repeat the label beside it (B12). */}
                {currentDay && daySubtitle(currentDay, safePage) ? (
                  <span className="min-w-0 truncate text-micro font-normal text-ink-muted">
                    {daySubtitle(currentDay, safePage)}
                  </span>
                ) : null}
              </span>

              {currentDay ? (
                <SpendChip
                  totals={spendByDay[currentDay.id] ?? emptySpend()}
                  currency={trip.currency}
                  testId="day-spend"
                  dayId={currentDay.id}
                />
              ) : null}

              {todayId ? (
                <button
                  type="button"
                  data-testid="today-chip"
                  data-day-id={todayId}
                  data-active={currentDay?.id === todayId ? 'true' : 'false'}
                  onClick={() => jumpToToday(todayId, focus?.nowOffsetMin ?? 0)}
                  className={currentDay?.id === todayId ? CHIP_NOW : CHIP_BUTTON}
                >
                  오늘
                </button>
              ) : null}

              {currentDay ? (
                <div ref={dayMenuRef} className="relative shrink-0">
                  <button
                    type="button"
                    data-testid="day-menu"
                    aria-label={`${dayTitle(currentDay, safePage)} 메뉴`}
                    aria-expanded={dayMenuOpen}
                    onClick={() => setDayMenuOpen((open) => !open)}
                    // M19 — M9의 아이콘 버튼 표준(36px)까지. 옆의 ›와 4px밖에
                    // 떨어져 있지 않아 44px까지 키우면 서로의 영역을 먹는다.
                    className="grid h-9 w-9 place-items-center rounded-full text-ink-faint transition-colors duration-[140ms] ease-quick hover:bg-sunken hover:text-ink"
                  >
                    <Icon name="more" size={16} />
                  </button>
                  {dayMenuOpen ? (
                    <div data-testid="day-menu-panel" className={`${POPOVER_CLASS} right-0 top-full`}>
                      <button
                        type="button"
                        data-testid="day-delete"
                        onClick={() => {
                          setDayMenuOpen(false);
                          setDialog({ kind: 'day-delete', day: currentDay, index: safePage });
                        }}
                        className={POPOVER_ROW_DANGER_CLASS}
                      >
                        <Icon name="trash" size={16} />
                        삭제
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}

              <button
                type="button"
                data-testid="day-pager-next"
                aria-label="다음 일자"
                disabled={safePage >= days.length - 1}
                onClick={() => setPageIndex((index) => Math.min(index + 1, days.length - 1))}
                className="grid h-9 w-11 shrink-0 place-items-center rounded-full text-ink-muted transition-colors duration-[140ms] ease-quick hover:bg-sunken disabled:text-ink-faint/50 disabled:hover:bg-transparent"
              >
                <Icon name="chevron-right" size={20} />
              </button>
            </div>
          ) : null}

          {todayId ? (
            <NowBar
              current={nowNext.current}
              next={nowNext.next}
              gapMin={nowNext.gapMin}
              cards={workspace.cards}
              columns={workspace.columns}
              onSpend={(entry) => setDialog({ kind: 'quick-spend', entry })}
              onOpen={(entry) => setDialog({ kind: 'entry', entry })}
            />
          ) : null}

          <PlanDndContext trip={trip} columns={columns}>
            <div className="flex min-h-0 flex-1 items-stretch border-y border-line bg-surface">
              {/* Mounted on desktop only: the rail and the tray draw the same
                  cards, and one dnd id may exist exactly once per context. */}
              {isDesktop ? (
                <BoardRail
                  columns={columns}
                  cardsByColumn={cardsByColumn}
                  currency={trip.currency}
                  scheduledCounts={scheduledCounts}
                  scheduleBreakdowns={scheduleBreakdowns}
                  onOpenCard={(card) => setDialog({ kind: 'schedule', card })}
                  showHint={nothingPlaced && unscheduledCards.length > 0}
                />
              ) : null}

              <div
                ref={scrollerRef}
                data-testid="timeline-scroller"
                // No `h-full`: as a stretched flex child the scroller already
                // has the row's exact height, and a percentage would not.
                className="relative min-w-0 flex-1 overflow-auto"
              >
                <div className={isDesktop ? 'flex min-w-max' : 'flex w-full'}>
                  <div
                    className="sticky left-0 z-30 shrink-0 bg-surface/95 backdrop-blur"
                    style={{ width: AXIS_PX }}
                  >
                    {/* Matches the day header's height on desktop; below `lg`
                        the header is `sr-only` and this spacer goes with it. */}
                    {isDesktop ? (
                      <div
                        className="sticky top-0 z-30 border-b border-line bg-surface"
                        style={{ height: HEADER_PX }}
                      />
                    ) : null}
                    <TimeAxis />
                  </div>

                  {visibleDays.map((day) => {
                    const index = days.indexOf(day);
                    return (
                      <DayColumn
                        key={day.id}
                        day={day}
                        index={index}
                        entries={windowedByDay[day.id] ?? []}
                        cards={workspace.cards}
                        columns={workspace.columns}
                        spend={spendByDay[day.id] ?? emptySpend()}
                        currency={trip.currency}
                        fullWidth={!isDesktop}
                        nowMin={day.id === todayId ? minuteNow : undefined}
                        // The line's pixel, when it is not simply the clock's:
                        // 첫날 새벽 pins it to the top edge (B6).
                        nowOffsetMin={day.id === todayId ? focus?.nowOffsetMin : undefined}
                        onOpenEntry={(entry) => setDialog({ kind: 'entry', entry })}
                        onDeleteDay={(target) =>
                          setDialog({ kind: 'day-delete', day: target, index })
                        }
                      />
                    );
                  })}
                </div>
              </div>
            </div>

            {!isDesktop ? (
              <UnscheduledTray
                cards={unscheduledCards}
                scheduled={scheduledTrayCards}
                columns={columns}
                currency={trip.currency}
                onOpenCard={(card) => setDialog({ kind: 'schedule', card })}
              />
            ) : null}
          </PlanDndContext>
        </>
      )}

      {dialogEntry ? (
        <EntryDetailSheet
          entry={dialogEntry}
          card={workspace.cards[dialogEntry.cardId]}
          currency={trip.currency}
          localCurrency={trip.localCurrency}
          fxRate={trip.fxRate}
          // The day the entry is *shown* on (M16-B): a 02:00 entry is 「1일차
          // 새벽 2시」 to the user, even though its row is the 2nd date.
          dayTitle={(() => {
            const shownId = effectiveDayId(dialogEntry, dayOrder);
            const index = days.findIndex((day) => day.id === shownId);
            return index >= 0 ? dayTitle(days[index], index) : '';
          })()}
          // 「길찾기」의 출발지 (M42): 05시 창의 그 날 동선에서 이 카드 **앞**에
          // 오는 장소. 지도 탭의 팝업이 쓰는 것과 같은 규칙이고, 같은 계산
          // (`dayRouteWindowed`)에서 나온다.
          directionsOrigin={(() => {
            const shownId = effectiveDayId(dialogEntry, dayOrder);
            const stops = dayRouteWindowed(workspace, shownId, dayOrder).stops;
            const index = stops.findIndex((stop) => stop.cardId === dialogEntry.cardId);
            if (index <= 0) return null;
            return { lat: stops[index - 1].lat, lng: stops[index - 1].lng };
          })()}
          onClose={() => setDialog(null)}
          onDelete={removeEntry}
          onOpenBoard={() => {
            setDialog(null);
            setTab('board');
          }}
        />
      ) : null}

      {quickSpendCard ? (
        <QuickSpendSheet
          card={quickSpendCard}
          currency={trip.currency}
          localCurrency={trip.localCurrency}
          fxRate={trip.fxRate}
          subtitle={
            dialog?.kind === 'quick-spend'
              ? formatTimeRange(dialog.entry.startMin, dialog.entry.durationMin)
              : undefined
          }
          onClose={() => setDialog(null)}
        />
      ) : null}

      {dialog?.kind === 'day-delete' ? (
        <ConfirmDialog
          title={`'${dayTitle(dialog.day, dialog.index)}'을(를) 삭제할까요?`}
          /**
           * Two counts, and they are allowed to differ (B7).
           *
           * Deleting a day row deletes the entries **stored on** it — the
           * calendar count. The header badge over the column counts what the
           * column *draws*, which includes the next day's 새벽 hours. Saying
           * only the first number next to a badge showing the second reads as
           * an off-by-N; saying only the second would be a lie about what is
           * about to be deleted. So: the true number, then the difference,
           * named.
           */
          description={(() => {
            const stored = entriesByDay[dialog.day.id]?.length ?? 0;
            const borrowed = (windowedByDay[dialog.day.id] ?? []).filter(
              (row) => row.entry.dayId !== dialog.day.id,
            ).length;
            return (
              <>
                <span className="block">
                  {stored > 0
                    ? `이 날에 배치한 일정 ${stored}개도 함께 사라져요.`
                    : '아직 배치한 일정이 없는 날이에요.'}
                </span>
                {borrowed > 0 ? (
                  <span data-testid="day-delete-dawn-note" data-count={borrowed} className="mt-1 block">
                    {`이 칸에 보이는 새벽 일정 ${borrowed}개는 다음 일자 소속이라 남아요.`}
                  </span>
                ) : null}
              </>
            );
          })()}
          onConfirm={() => {
            deleteWithUndo('day', dayTitle(dialog.day, dialog.index), () =>
              deleteDay(dialog.day.id),
            );
            setDialog(null);
          }}
          onCancel={() => setDialog(null)}
          testId="day-delete-confirm"
        />
      ) : null}

      {dialog?.kind === 'schedule' ? (
        <ScheduleSheet card={dialog.card} onClose={() => setDialog(null)} />
      ) : null}

      {dialog?.kind === 'sheet-create' ? (
        <SheetWizard
          tripId={trip.id}
          fillSheet={fillableSheet}
          suggestedName={fillableSheet?.name ?? `일정 ${sheets.length + 1}`}
          onClose={() => setDialog(null)}
          onDone={setActiveSheet}
        />
      ) : null}

      {dialog?.kind === 'sheet-edit' ? (
        <SheetWizard
          tripId={trip.id}
          sheet={dialog.sheet}
          onClose={() => setDialog(null)}
          onDone={setActiveSheet}
        />
      ) : null}

      {dialog?.kind === 'sheet-duplicate' ? (
        <SheetDuplicateDialog
          sheet={dialog.sheet}
          onConfirm={(engine) => {
            const copyId = duplicateSheet(dialog.sheet.id, engine);
            setDialog(null);
            if (copyId) setActiveSheet(copyId);
          }}
          onCancel={() => setDialog(null)}
        />
      ) : null}

      {dialog?.kind === 'sheet-rename' ? (
        <SheetRenameDialog sheet={dialog.sheet} onClose={() => setDialog(null)} />
      ) : null}

      {dialog?.kind === 'sheet-delete' ? (
        <ConfirmDialog
          title={`'${dialog.sheet.name}' 시트를 삭제할까요?`}
          description={(() => {
            const dayCount = dialog.sheet.dayOrder.length;
            const entryCount = dialog.sheet.dayOrder.reduce(
              (total, dayId) => total + (entriesByDay[dayId]?.length ?? 0),
              0,
            );
            return dayCount === 0
              ? '아직 일자가 없는 시트예요.'
              : `일자 ${dayCount}개와 배치한 일정 ${entryCount}개가 함께 사라져요. 카드 자체는 보드에 남아요.`;
          })()}
          onConfirm={() => {
            deleteWithUndo('sheet', dialog.sheet.name, () => deleteSheet(dialog.sheet.id));
            setDialog(null);
          }}
          onCancel={() => setDialog(null)}
          testId="sheet-delete-confirm"
        />
      ) : null}

      {aiReviewOpen && aiOn && sheet ? (
        <AiReviewSheet sheetId={sheet.id} onClose={() => setAiReviewOpen(false)} />
      ) : null}

      {todoOpen ? <TodoSheet tripId={trip.id} onClose={() => setTodoOpen(false)} /> : null}

      {reportOpen && sheet ? (
        <SpendReportSheet
          sheetId={sheet.id}
          sheetName={sheet.name}
          // 그리드가 쓰는 그 축 그대로 — 05시 창 판정이 화면과 어긋나지 않게.
          dayOrder={dayOrder}
          currency={trip.currency}
          rate={{ localCurrency: trip.localCurrency, fxRate: trip.fxRate }}
          onClose={() => setReportOpen(false)}
        />
      ) : null}
    </section>
  );
}
