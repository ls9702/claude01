import { useEffect, useMemo, useRef, useState } from 'react';
import PlanDndContext from '../../dnd/PlanDndContext';
import { useIsDesktop } from '../../hooks/useMediaQuery';
import { useUndoStore } from '../../stores/undoStore';
import { useUiStore } from '../../stores/uiStore';
import { FIRST_SHEET_NAME, useWorkspaceStore } from '../../stores/workspaceStore';
import type { BoardColumn, Card, Day, Id, TimelineEntry } from '../../types/models';
import { AXIS_PX, HEADER_PX, INITIAL_SCROLL_MIN, PX_PER_MIN } from '../../timeline/layout';
import { minToY } from '../../utils/time';
import ConfirmDialog from '../common/ConfirmDialog';
import BoardRail from './BoardRail';
import DayColumn, { dayTitle } from './DayColumn';
import EntryDetailSheet from './EntryDetailSheet';
import ScheduleSheet from './ScheduleSheet';
import TimeAxis from './TimeAxis';

type Dialog =
  | { kind: 'entry'; entry: TimelineEntry }
  | { kind: 'day-delete'; day: Day; index: number }
  | { kind: 'schedule'; card: Card }
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
      className="mx-auto flex max-w-md flex-col items-center gap-4 px-6 py-16 text-center"
    >
      <span aria-hidden="true" className="text-4xl">
        🗓️
      </span>
      <h1 className="text-xl font-semibold text-stone-800">일정</h1>
      <p className="text-sm leading-relaxed text-stone-400">
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
                className="w-full rounded-xl border border-stone-200 bg-white px-4 py-3 text-left text-sm font-medium text-stone-700 shadow-sm hover:shadow-md"
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
          className="rounded-full bg-stone-800 px-5 py-2.5 text-sm font-semibold text-white hover:bg-stone-900"
        >
          여행 만들러 가기
        </button>
      )}
    </section>
  );
}

/**
 * The 일정 tab: a 00:00–24:00 grid of day columns fed by the board.
 *
 * Desktop (≥1024px) puts a board rail beside the grid inside **one**
 * `PlanDndContext`, so a card can be dragged straight from the rail onto a
 * minute of a day. Below that breakpoint the grid shows one day at a time with
 * a pager, and cards reach the timeline through {@link ScheduleSheet}.
 */
export default function TimelineView() {
  const workspace = useWorkspaceStore((s) => s.workspace);
  const addSheet = useWorkspaceStore((s) => s.addSheet);
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

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const scrolledRef = useRef(false);
  const seededTripRef = useRef<Id | null>(null);

  const trip = activeTripId ? workspace.trips[activeTripId] : undefined;

  /** First visit to a trip's 일정 tab creates the sheet it will live in. */
  useEffect(() => {
    if (!trip || trip.sheetOrder.length > 0) return;
    if (seededTripRef.current === trip.id) return;
    seededTripRef.current = trip.id;
    addSheet(trip.id, FIRST_SHEET_NAME);
  }, [trip, addSheet]);

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

  /** dayId → its entries, and cardId → how many entries it has anywhere. */
  const { entriesByDay, scheduledCounts } = useMemo(() => {
    const byDay: Record<Id, TimelineEntry[]> = {};
    const counts: Record<Id, number> = {};
    for (const entry of Object.values(workspace.entries)) {
      if (trip && entry.tripId !== trip.id) continue;
      (byDay[entry.dayId] ??= []).push(entry);
      counts[entry.cardId] = (counts[entry.cardId] ?? 0) + 1;
    }
    for (const list of Object.values(byDay)) list.sort((a, b) => a.startMin - b.startMin);
    return { entriesByDay: byDay, scheduledCounts: counts };
  }, [workspace.entries, trip]);

  // The pager index must survive a day being deleted.
  const safePage = days.length === 0 ? 0 : Math.min(pageIndex, days.length - 1);
  useEffect(() => {
    if (safePage !== pageIndex) setPageIndex(safePage);
  }, [safePage, pageIndex]);

  /** Open on 06:00 rather than midnight — nobody plans from 00:00. */
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || scrolledRef.current || days.length === 0) return;
    scroller.scrollTop = minToY(INITIAL_SCROLL_MIN, PX_PER_MIN);
    scrolledRef.current = true;
  }, [days.length]);

  if (!trip) return <TripPrompt />;

  const gridHeight = isDesktop ? 'calc(100dvh - 12rem)' : 'calc(100dvh - 16rem)';
  const visibleDays = isDesktop ? days : days.slice(safePage, safePage + 1);
  const dialogEntry = dialog?.kind === 'entry' ? workspace.entries[dialog.entry.id] : undefined;

  const addDayToSheet = () => {
    if (!sheet) return;
    const created = addDay(sheet.id);
    if (created) setPageIndex(days.length);
  };

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
    <section data-testid="view-timeline" aria-labelledby="view-timeline-title" className="pb-2">
      <header className="flex flex-wrap items-baseline gap-x-2 gap-y-1 px-4 pb-2 pt-5">
        <h1 id="view-timeline-title" className="text-2xl font-bold tracking-tight text-stone-800">
          일정
        </h1>
        <p data-testid="timeline-trip-title" className="min-w-0 truncate text-sm text-stone-400">
          {trip.title}
        </p>
        {sheet ? (
          <span
            data-testid="timeline-sheet-name"
            className="rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-medium text-stone-500"
          >
            {sheet.name}
          </span>
        ) : null}
        <button
          type="button"
          data-testid="timeline-add-day"
          onClick={addDayToSheet}
          disabled={!sheet}
          className="ml-auto rounded-full bg-stone-800 px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-stone-900 disabled:bg-stone-200 disabled:text-stone-400"
        >
          ＋ 일자 추가
        </button>
      </header>

      {days.length === 0 ? (
        <div
          data-testid="timeline-empty"
          className="mx-4 mt-6 flex flex-col items-center gap-3 rounded-2xl border border-dashed border-stone-200 bg-white/60 px-6 py-14 text-center"
        >
          <span aria-hidden="true" className="text-4xl">
            🗓️
          </span>
          <p className="text-base font-semibold text-stone-700">첫 일자를 추가해보세요</p>
          <p className="max-w-xs text-sm leading-relaxed text-stone-400">
            일자를 만들면 00시부터 24시까지의 시간표가 열리고, 보드의 카드를 끌어다 놓을 수
            있어요.
          </p>
          <button
            type="button"
            data-testid="timeline-add-day-empty"
            onClick={addDayToSheet}
            disabled={!sheet}
            className="mt-2 rounded-full bg-stone-800 px-5 py-2.5 text-sm font-semibold text-white hover:bg-stone-900 disabled:bg-stone-200 disabled:text-stone-400"
          >
            ＋ 일자 추가
          </button>
        </div>
      ) : (
        <>
          {!isDesktop ? (
            <div
              data-testid="day-pager"
              className="mx-4 mb-2 flex items-center justify-between rounded-xl bg-white px-2 py-1.5 shadow-sm"
            >
              <button
                type="button"
                data-testid="day-pager-prev"
                aria-label="이전 일자"
                disabled={safePage === 0}
                onClick={() => setPageIndex((index) => Math.max(index - 1, 0))}
                className="rounded-lg px-3 py-1.5 text-lg leading-none text-stone-500 disabled:text-stone-200"
              >
                ‹
              </button>
              <span
                data-testid="day-pager-label"
                className="truncate text-sm font-semibold text-stone-700"
              >
                {days[safePage] ? dayTitle(days[safePage], safePage) : ''}
              </span>
              <button
                type="button"
                data-testid="day-pager-next"
                aria-label="다음 일자"
                disabled={safePage >= days.length - 1}
                onClick={() => setPageIndex((index) => Math.min(index + 1, days.length - 1))}
                className="rounded-lg px-3 py-1.5 text-lg leading-none text-stone-500 disabled:text-stone-200"
              >
                ›
              </button>
            </div>
          ) : null}

          <PlanDndContext trip={trip} columns={columns}>
            <div className="flex items-start border-y border-stone-200 bg-white">
              <BoardRail
                columns={columns}
                cardsByColumn={cardsByColumn}
                currency={trip.currency}
                scheduledCounts={scheduledCounts}
                onOpenCard={(card) => setDialog({ kind: 'schedule', card })}
                height={gridHeight}
              />

              <div
                ref={scrollerRef}
                data-testid="timeline-scroller"
                className="relative min-w-0 flex-1 overflow-auto"
                style={{ height: gridHeight }}
              >
                <div className={isDesktop ? 'flex min-w-max' : 'flex w-full'}>
                  <div
                    className="sticky left-0 z-30 shrink-0 bg-white/95 backdrop-blur"
                    style={{ width: AXIS_PX }}
                  >
                    <div
                      className="sticky top-0 z-30 border-b border-stone-200 bg-white"
                      style={{ height: HEADER_PX }}
                    />
                    <TimeAxis />
                  </div>

                  {visibleDays.map((day) => {
                    const index = days.indexOf(day);
                    return (
                      <DayColumn
                        key={day.id}
                        day={day}
                        index={index}
                        entries={entriesByDay[day.id] ?? []}
                        cards={workspace.cards}
                        columns={workspace.columns}
                        fullWidth={!isDesktop}
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
          </PlanDndContext>
        </>
      )}

      {dialogEntry ? (
        <EntryDetailSheet
          entry={dialogEntry}
          card={workspace.cards[dialogEntry.cardId]}
          dayTitle={(() => {
            const index = days.findIndex((day) => day.id === dialogEntry.dayId);
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

      {dialog?.kind === 'day-delete' ? (
        <ConfirmDialog
          title={`'${dayTitle(dialog.day, dialog.index)}'을(를) 삭제할까요?`}
          description={
            (entriesByDay[dialog.day.id]?.length ?? 0) > 0
              ? `이 날에 배치한 일정 ${entriesByDay[dialog.day.id]?.length}개도 함께 사라져요.`
              : '아직 배치한 일정이 없는 날이에요.'
          }
          onConfirm={() => {
            deleteDay(dialog.day.id);
            setDialog(null);
          }}
          onCancel={() => setDialog(null)}
          testId="day-delete-confirm"
        />
      ) : null}

      {dialog?.kind === 'schedule' ? (
        <ScheduleSheet card={dialog.card} onClose={() => setDialog(null)} />
      ) : null}
    </section>
  );
}
