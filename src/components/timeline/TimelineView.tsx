import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PlanDndContext from '../../dnd/PlanDndContext';
import { useIsDesktop } from '../../hooks/useMediaQuery';
import { useNowTick } from '../../hooks/useNowTick';
import { deleteWithUndo } from '../../stores/undoDelete';
import { useUndoStore } from '../../stores/undoStore';
import { useUiStore } from '../../stores/uiStore';
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
  clockToOffset,
  effectiveDayId,
  windowedEntriesByDay,
  type WindowedEntry,
} from '../../timeline/dayWindow';
import { dayGapsWindowed, type DayGap } from '../../timeline/gap';
import { summarizeSchedule } from '../../timeline/scheduleSummary';
import { currentAndNextWindowed, nowMin, todayDayId, todayWindowIso } from '../../timeline/today';
import {
  daySpendWindowed,
  emptySpend,
  sheetSpend,
  sheetSpendByColumn,
  unplacedSpend,
  type SpendTotals,
} from '../../utils/spend';
import { formatTimeRange, minToY } from '../../utils/time';
import ConfirmDialog from '../common/ConfirmDialog';
import Icon from '../common/Icon';
import { useAiEnabled } from '../../ai/aiSettings';
import AiAskButton from '../ai/AiAskButton';
import AiReviewSheet from '../ai/AiReviewSheet';
import BackupNudge from '../common/BackupNudge';
import SyncStatusChip from '../common/SyncStatusChip';
import {
  CHIP_BUTTON,
  CHIP_NOW,
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
import SheetRenameDialog from './SheetRenameDialog';
import SheetTabs from './SheetTabs';
import SheetWizard from './SheetWizard';
import SpendSummaryBar, { categoryRows } from './SpendSummaryBar';
import TimeAxis from './TimeAxis';
import UnscheduledTray from './UnscheduledTray';

type Dialog =
  | { kind: 'entry'; entry: TimelineEntry }
  | { kind: 'quick-spend'; entry: TimelineEntry }
  | { kind: 'day-delete'; day: Day; index: number }
  | { kind: 'schedule'; card: Card }
  | { kind: 'sheet-create' }
  | { kind: 'sheet-edit'; sheet: SheetModel }
  | { kind: 'sheet-rename'; sheet: SheetModel }
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
      <h1 className="text-title text-ink">일정</h1>
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
  const addDay = useWorkspaceStore((s) => s.addDay);
  const deleteDay = useWorkspaceStore((s) => s.deleteDay);
  const deleteEntry = useWorkspaceStore((s) => s.deleteEntry);
  const scheduleCard = useWorkspaceStore((s) => s.scheduleCard);
  const updateEntry = useWorkspaceStore((s) => s.updateEntry);

  const activeTripId = useUiStore((s) => s.activeTripId);
  const activeSheetId = useUiStore((s) => s.activeSheetId);
  const setActiveSheet = useUiStore((s) => s.setActiveSheet);
  const setTab = useUiStore((s) => s.setTab);
  const offer = useUndoStore((s) => s.offer);

  const isDesktop = useIsDesktop();
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
  /**
   * The **window** day (M16-B), not the calendar one: at 새벽 2시 the day the
   * user is living in is still yesterday's, and that is the column 오늘 has to
   * point at.
   */
  const today = todayWindowIso(now);
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

  /** The active sheet's day ids — the axis every window mapping turns on. */
  const dayOrder = useMemo<Id[]>(() => sheet?.dayOrder ?? [], [sheet?.dayOrder]);

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
   * dayId → 예산/지출 of that day, and the sheet's own totals (M6).
   *
   * Both count **cards**, not placements — see `utils/spend.ts`; the sheet
   * total is therefore not the sum of its days when one card spans two of them.
   *
   * The day figures are **windowed** (M16-B) so the chip agrees with the column
   * under it; the sheet figure is not, because a window shift never moves money
   * out of a sheet.
   */
  const spendByDay = useMemo<Record<Id, SpendTotals>>(() => {
    const byDay: Record<Id, SpendTotals> = {};
    for (const day of days) byDay[day.id] = daySpendWindowed(workspace, day.id, dayOrder);
    return byDay;
  }, [days, workspace, dayOrder]);

  const sheetTotals = useMemo<SpendTotals>(
    () => (sheet ? sheetSpend(workspace, sheet.id) : emptySpend()),
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
   * dayId → straight-line 이동 갭 between its consecutive located stops (M7b),
   * over the **windowed** sequence of the column (M16-B) — so the last hop of a
   * night is measured from 23:40 to 00:20, not across a calendar boundary.
   */
  const gapsByDay = useMemo<Record<Id, DayGap[]>>(() => {
    const byDay: Record<Id, DayGap[]> = {};
    for (const day of days) byDay[day.id] = dayGapsWindowed(workspace, day.id, dayOrder);
    return byDay;
  }, [days, workspace, dayOrder]);

  /**
   * 오늘 모드 (M7b): the day of the **active sheet** whose date is today, if any.
   * Everything today-flavoured — the chip, the now line, the 지금/다음 bar —
   * hangs off this one id being non-null.
   */
  const todayId = useMemo(
    () => todayDayId(workspace, sheet?.id, today),
    [workspace, sheet?.id, today],
  );

  const nowNext = useMemo(
    () =>
      todayId
        ? currentAndNextWindowed(
            (windowedByDay[todayId] ?? []).map((row) => row.entry),
            workspace.cards,
            dayOrder,
            minuteNow,
          )
        : {},
    [todayId, windowedByDay, workspace.cards, dayOrder, minuteNow],
  );

  /**
   * 카테고리별 breakdown for the summary bar, plus what it leaves out (M16-A).
   *
   * Sheet scope, because that is the scope of the number it hangs under.
   */
  const categories = useMemo(
    () => (sheet ? categoryRows(columns, sheetSpendByColumn(workspace, sheet.id)) : []),
    [sheet, columns, workspace],
  );

  const unplaced = useMemo(
    () => unplacedSpend(workspace, trip?.id ?? ''),
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
  const unscheduledCards = useMemo<Card[]>(() => {
    const placed = new Set<Id>();
    const dayIds = new Set(days.map((day) => day.id));
    for (const entry of Object.values(workspace.entries)) {
      if (dayIds.has(entry.dayId)) placed.add(entry.cardId);
    }
    return columns.flatMap((column) =>
      (cardsByColumn[column.id] ?? []).filter((card) => !placed.has(card.id)),
    );
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
   * `minute` is the wall clock; the scroller wants a window offset, and at
   * 새벽 2시 those two are 1140 minutes apart.
   */
  const jumpToToday = useCallback(
    (dayId: Id, minute: number) => {
      const index = days.findIndex((day) => day.id === dayId);
      if (index >= 0) setPageIndex(index);
      scrollToOffset(clockToOffset(minute) - 60);
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

    if (todayId) jumpToToday(todayId, minuteNow);
    else scrollToOffset(INITIAL_SCROLL_MIN);
  }, [trip?.id, sheet, days.length, todayId, minuteNow, jumpToToday, scrollToOffset]);

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

  /** Deletes an entry and offers to put an identical one back. */
  const removeEntry = (entry: TimelineEntry) => {
    const { cardId, dayId, startMin, durationMin, note } = entry;
    const title = workspace.cards[cardId]?.title ?? '일정';
    deleteEntry(entry.id);
    setDialog(null);
    offer(`'${title}' 삭제됨`, () => {
      const restored = scheduleCard(cardId, dayId, startMin, durationMin);
      if (restored && note) updateEntry(restored, { note });
    });
  };

  return (
    <section
      data-testid="view-timeline"
      aria-labelledby="view-timeline-title"
      // One flex column, top to bottom, filling whatever the app shell hands
      // it. The grid takes what the fixed rows above leave over — no
      // `calc(100dvh - 21rem)` guesses, and no white band under it (§4.4-2).
      className="flex min-h-0 flex-1 flex-col"
    >
      <header className="flex shrink-0 items-center gap-3 px-4 pb-4 pt-6">
        <div className="min-w-0">
          <h1 id="view-timeline-title" className="text-display text-ink">
            일정
          </h1>
          <p
            data-testid="timeline-trip-title"
            className="mt-1 min-w-0 truncate text-label text-ink-muted"
          >
            {trip.title}
          </p>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {isDesktop ? null : <AiAskButton />}
          {isDesktop ? null : <SyncStatusChip variant="dot" />}
          {aiOn && sheet && sheetHasEntries ? (
            <button
              type="button"
              data-testid="ai-review-open"
              onClick={() => setAiReviewOpen(true)}
              className={SECONDARY_BUTTON_CLASS}
            >
              <Icon name="sparkle" size={16} />
              AI 검토
            </button>
          ) : null}
          <button
            type="button"
            data-testid="timeline-add-day"
            onClick={addDayToSheet}
            className={SECONDARY_BUTTON_CLASS}
          >
            <Icon name="plus" size={16} />
            일자 추가
          </button>
        </div>
      </header>

      {/* Under the h1, never over it (M9 §3.5). Desktop wears the chip in the
          top bar instead, so only one of the two ever mounts. */}
      {isDesktop ? null : <BackupNudge variant="banner" className="mx-4 mb-4" />}

      {/* Row 1 is sheets and nothing else; the 오늘 and 지출 chips moved down
          into the pager, which is where the day they describe lives. */}
      <div className="shrink-0 pb-2">
        <SheetTabs
          sheets={sheets}
          activeSheetId={sheet?.id}
          onSelect={setActiveSheet}
          onCreate={() => setDialog({ kind: 'sheet-create' })}
          onRename={(target) => setDialog({ kind: 'sheet-rename', sheet: target })}
          onEditFlights={(target) => setDialog({ kind: 'sheet-edit', sheet: target })}
          onDelete={(target) => setDialog({ kind: 'sheet-delete', sheet: target })}
          // The sheet's 지출 칩 used to ride here. M16-A's summary bar states the
          // same two numbers one row down and never scrolls away, so keeping the
          // chip would have been the same fact twice on adjacent lines.
        />
      </div>

      {/* Desktop's 오늘 칩. The row only exists when there is a 오늘 to jump to;
          an empty 36px strip above the grid is 36px of nothing (S7). */}
      {isDesktop && todayId ? (
        <div className="flex shrink-0 items-center gap-2 px-4 pb-2">
          <button
            type="button"
            data-testid="today-chip"
            data-day-id={todayId}
            data-active={currentDay?.id === todayId ? 'true' : 'false'}
            onClick={() => jumpToToday(todayId, minuteNow)}
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
          {/* M16-A: money at a glance, pinned above everything the grid does.
              Full-bleed and `h-10` so it costs exactly one hairline-bounded row
              — see SpendSummaryBar for why it is not a floating card. */}
          <SpendSummaryBar
            sheetTotals={sheetTotals}
            // Desktop scrolls many columns at once, so "the visible day" is only
            // an honest phrase when 오늘 is one of them; otherwise the bar says
            // nothing rather than guessing which column the eye is on.
            day={
              summaryDay
                ? {
                    id: summaryDay.id,
                    label: dayTitle(summaryDay, days.indexOf(summaryDay)),
                    totals: spendByDay[summaryDay.id] ?? emptySpend(),
                  }
                : undefined
            }
            categories={categories}
            unplaced={unplaced}
            currency={trip.currency}
          />

          {/* Mobile row 2: the pager *is* the day header. Title, date, money,
              오늘, and the ⋯ menu all live here, so the sticky header inside
              the column can fold away to `sr-only` (M9 §4.4-2 / §4.4-4). */}
          {!isDesktop ? (
            <div
              data-testid="day-pager"
              className="mx-4 mb-2 flex h-11 shrink-0 items-center gap-1 rounded-md border border-line bg-surface px-1 shadow-raise"
            >
              <button
                type="button"
                data-testid="day-pager-prev"
                aria-label="이전 일자"
                disabled={safePage === 0}
                onClick={() => setPageIndex((index) => Math.max(index - 1, 0))}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-ink-muted transition-colors duration-[140ms] ease-quick hover:bg-sunken disabled:text-ink-faint/50 disabled:hover:bg-transparent"
              >
                <Icon name="chevron-left" size={20} />
              </button>

              <span className="flex min-w-0 flex-1 items-baseline gap-1 overflow-hidden">
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
                  onClick={() => jumpToToday(todayId, minuteNow)}
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
                    className="grid h-8 w-8 place-items-center rounded-full text-ink-faint transition-colors duration-[140ms] ease-quick hover:bg-sunken hover:text-ink"
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
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-ink-muted transition-colors duration-[140ms] ease-quick hover:bg-sunken disabled:text-ink-faint/50 disabled:hover:bg-transparent"
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
                        gaps={gapsByDay[day.id]}
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
          description={
            (entriesByDay[dialog.day.id]?.length ?? 0) > 0
              ? `이 날에 배치한 일정 ${entriesByDay[dialog.day.id]?.length}개도 함께 사라져요.`
              : '아직 배치한 일정이 없는 날이에요.'
          }
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
    </section>
  );
}
