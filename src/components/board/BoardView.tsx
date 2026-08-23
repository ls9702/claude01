import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { resolveBoardDrop, snapshotBoard } from '../../dnd/boardDnd';
import { useUiStore } from '../../stores/uiStore';
import { deleteWithUndo } from '../../stores/undoDelete';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { summarizeSchedule } from '../../timeline/scheduleSummary';
import type { BoardColumn, Card } from '../../types/models';
import BackupNudge from '../common/BackupNudge';
import ConfirmDialog from '../common/ConfirmDialog';
import Icon from '../common/Icon';
import SyncStatusChip from '../common/SyncStatusChip';
import { PRIMARY_BUTTON_CLASS, SECONDARY_BUTTON_CLASS } from '../common/formStyles';
import { useIsDesktop } from '../../hooks/useMediaQuery';
import ScheduleSheet from '../timeline/ScheduleSheet';
import AddColumnPanel from './AddColumnPanel';
import BoardColumnView from './BoardColumnView';
import CardEditSheet, { type CardFormValues } from './CardEditSheet';
import { CardSurface } from './CardItem';
import ColumnEditSheet, { type ColumnFormValues } from './ColumnEditSheet';

type Dialog =
  | { kind: 'card-create'; column: BoardColumn }
  | { kind: 'card-edit'; card: Card }
  | { kind: 'card-schedule'; card: Card }
  | { kind: 'column-edit'; column: BoardColumn }
  | { kind: 'column-delete'; column: BoardColumn }
  | null;

/** Shown when no trip is selected yet — doubles as a quick trip picker. */
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
      data-testid="view-board"
      className="mx-auto flex w-full max-w-md shrink-0 flex-col items-center gap-4 px-6 pb-16 pt-12 text-center"
    >
      <Icon name="board" size={24} className="text-ink-faint" />
      <h1 className="text-title text-ink">보드</h1>
      <p className="text-label font-normal text-ink-muted">
        {trips.length > 0
          ? '어떤 여행의 보드를 열까요?'
          : '먼저 여행을 만들면 보드가 열려요.'}
      </p>

      {trips.length > 0 ? (
        <ul data-testid="board-trip-picker" className="mt-1 w-full space-y-2">
          {trips.map((trip) => (
            <li key={trip.id}>
              <button
                type="button"
                data-testid="board-trip-option"
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
          data-testid="board-goto-trips"
          onClick={() => setTab('trips')}
          className={PRIMARY_BUTTON_CLASS}
        >
          여행 만들러 가기
        </button>
      )}
    </section>
  );
}

/** The 보드 tab: a horizontally scrolling kanban of the active trip. */
export default function BoardView() {
  const workspace = useWorkspaceStore((s) => s.workspace);
  const addCard = useWorkspaceStore((s) => s.addCard);
  const updateCard = useWorkspaceStore((s) => s.updateCard);
  const deleteCard = useWorkspaceStore((s) => s.deleteCard);
  const addColumn = useWorkspaceStore((s) => s.addColumn);
  const updateColumn = useWorkspaceStore((s) => s.updateColumn);
  const deleteColumn = useWorkspaceStore((s) => s.deleteColumn);
  const moveCard = useWorkspaceStore((s) => s.moveCard);
  const activeTripId = useUiStore((s) => s.activeTripId);
  const focusCardId = useUiStore((s) => s.focusCardId);
  const focusCard = useUiStore((s) => s.focusCard);

  const [dialog, setDialog] = useState<Dialog>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const isDesktop = useIsDesktop();

  /** The horizontal scroller, and which way it still has room to go. */
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [reach, setReach] = useState({ before: false, after: false });
  /**
   * Where the arrows sit, in px from the scroller's top.
   *
   * The columns stretch to a viewport-tall minimum so the empty space below
   * the last card stays a drop zone — which means `top-1/2` centred the arrows
   * against that emptiness, level with nothing at all. They centre against the
   * tallest column's *content* instead (M9 §4.2-4).
   */
  const [armTop, setArmTop] = useState<number | null>(null);

  const measure = useCallback(() => {
    const node = scrollerRef.current;
    if (!node) return;
    const before = node.scrollLeft > 8;
    const after = node.scrollWidth - node.clientWidth - node.scrollLeft > 8;
    setReach((current) =>
      current.before === before && current.after === after ? current : { before, after },
    );

    const top = node.getBoundingClientRect().top;
    let bottom = 0;
    node.querySelectorAll<HTMLElement>('[data-column-body]').forEach((body) => {
      const last = body.lastElementChild as HTMLElement | null;
      const end = (last ?? body).getBoundingClientRect().bottom - top;
      if (end > bottom) bottom = end;
    });
    const next = bottom > 0 ? Math.round(bottom / 2) : null;
    setArmTop((current) => (current === next ? current : next));
  }, []);

  useLayoutEffect(() => {
    measure();
    const node = scrollerRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  });

  /** One column-plus-gap of horizontal travel. */
  const nudge = (direction: -1 | 1) =>
    scrollerRef.current?.scrollBy({ left: direction * 288, behavior: 'smooth' });

  const trip = activeTripId ? workspace.trips[activeTripId] : undefined;

  const columns = useMemo(
    () =>
      (trip?.columnOrder ?? [])
        .map((columnId) => workspace.columns[columnId])
        .filter((column): column is BoardColumn => Boolean(column)),
    [trip?.columnOrder, workspace.columns],
  );

  const cardsByColumn = useMemo(() => {
    const map: Record<string, Card[]> = {};
    for (const column of columns) {
      map[column.id] = column.cardOrder
        .map((cardId) => workspace.cards[cardId])
        .filter((card): card is Card => Boolean(card));
    }
    return map;
  }, [columns, workspace.cards]);

  /** cardId → timeline entries (total + per sheet), for the 🗓 badge. */
  const { counts: scheduledCounts, bySheet: scheduleBreakdowns } = useMemo(
    () => summarizeSchedule(workspace, trip?.id),
    [workspace, trip?.id],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  );

  /**
   * 지도's 「보드에서 편집」 switches to this tab and leaves the card id behind;
   * pick it up once and open the edit sheet for it.
   */
  useEffect(() => {
    if (!focusCardId) return;
    const card = workspace.cards[focusCardId];
    focusCard(undefined);
    if (card) setDialog({ kind: 'card-edit', card });
  }, [focusCardId, workspace.cards, focusCard]);

  if (!trip) return <TripPrompt />;

  const draggingCard = draggingId ? workspace.cards[draggingId] : undefined;
  const draggingColumn = draggingCard ? workspace.columns[draggingCard.columnId] : undefined;

  const onDragStart = (event: DragStartEvent) => setDraggingId(String(event.active.id));

  const onDragEnd = (event: DragEndEvent) => {
    setDraggingId(null);
    const move = resolveBoardDrop(
      String(event.active.id),
      event.over ? String(event.over.id) : null,
      snapshotBoard(columns),
    );
    if (move) moveCard(move.cardId, move.toColumnId, move.toIndex);
  };

  const submitCard = (values: CardFormValues) => {
    if (dialog?.kind === 'card-create') {
      addCard(trip.id, dialog.column.id, values);
    } else if (dialog?.kind === 'card-edit') {
      updateCard(dialog.card.id, values);
    }
    setDialog(null);
  };

  const submitColumn = (values: ColumnFormValues) => {
    if (dialog?.kind !== 'column-edit') return;
    updateColumn(dialog.column.id, values);
    setDialog(null);
  };

  const columnNameOf = (columnId: string) => workspace.columns[columnId]?.name ?? '';

  return (
    <section data-testid="view-board" aria-labelledby="view-board-title" className="shrink-0">
      <header className="flex items-center gap-3 px-4 pb-4 pt-6">
        <div className="min-w-0">
          <h1 id="view-board-title" className="text-display text-ink">
            보드
          </h1>
          <p data-testid="board-trip-title" className="mt-1 min-w-0 truncate text-label text-ink-muted">
            {trip.title}
          </p>
        </div>
        {isDesktop ? null : (
          <span className="ml-auto">
            <SyncStatusChip variant="dot" />
          </span>
        )}
      </header>

      {/* Under the h1, never over it (M9 §3.5). Desktop wears the chip in the
          top bar instead, so only one of the two ever mounts. */}
      {isDesktop ? null : <BackupNudge variant="banner" className="mx-4 mb-4" />}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setDraggingId(null)}
      >
        <div className="relative">
          {/* The scroller keeps its own affordances: a fade on the right while
              anything is still off-screen, and a pair of desktop arrows. A
              board that runs past the viewport must say so. */}
          <div
            ref={scrollerRef}
            onScroll={measure}
            data-testid="board-scroller"
            data-overflow={reach.after ? 'true' : 'false'}
            className="flex snap-x snap-mandatory items-stretch gap-4 overflow-x-auto px-4 pb-4 min-h-[calc(100dvh-13rem)] lg:min-h-[calc(100dvh-11rem)] lg:snap-none"
          >
            {columns.map((column) => (
              <BoardColumnView
                key={column.id}
                column={column}
                cards={cardsByColumn[column.id] ?? []}
                currency={trip.currency}
                scheduledCounts={scheduledCounts}
                scheduleBreakdowns={scheduleBreakdowns}
                onAddCard={(target) => setDialog({ kind: 'card-create', column: target })}
                onOpenCard={(card) => setDialog({ kind: 'card-edit', card })}
                onEditColumn={(target) => setDialog({ kind: 'column-edit', column: target })}
              />
            ))}

            <AddColumnPanel
              usedColors={columns.map((column) => column.color)}
              onAdd={(name, color, icon) => addColumn(trip.id, name, color, icon)}
            />
          </div>

          {/* The fade is the honest half of the pair: it says "there is more"
              on touch, where there are no arrows to press. Same condition as
              the 다음 arrow, so the two can never disagree. */}
          {reach.after ? (
            <span
              data-testid="board-scroll-fade"
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-canvas via-canvas/70 to-transparent"
            />
          ) : null}

          {/* Each arrow exists only while it has somewhere to go. */}
          {reach.before ? (
            <button
              type="button"
              data-testid="board-scroll-prev"
              aria-label="이전 카테고리"
              onClick={() => nudge(-1)}
              style={armTop === null ? undefined : { top: armTop }}
              className={`absolute left-1 hidden h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-surface text-ink shadow-float transition-colors duration-[140ms] ease-quick hover:bg-sunken lg:grid ${
                armTop === null ? 'top-1/2' : ''
              }`}
            >
              <Icon name="chevron-left" size={20} />
            </button>
          ) : null}
          {reach.after ? (
            <button
              type="button"
              data-testid="board-scroll-next"
              aria-label="다음 카테고리"
              onClick={() => nudge(1)}
              style={armTop === null ? undefined : { top: armTop }}
              className={`absolute right-1 hidden h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-surface text-ink shadow-float transition-colors duration-[140ms] ease-quick hover:bg-sunken lg:grid ${
                armTop === null ? 'top-1/2' : ''
              }`}
            >
              <Icon name="chevron-right" size={20} />
            </button>
          ) : null}
        </div>

        <DragOverlay dropAnimation={null}>
          {draggingCard ? (
            <CardSurface
              card={draggingCard}
              currency={trip.currency}
              color={draggingColumn?.color ?? 'slate'}
              lifted
            />
          ) : null}
        </DragOverlay>
      </DndContext>

      {dialog?.kind === 'card-create' ? (
        <CardEditSheet
          columnName={dialog.column.name}
          onSubmit={submitCard}
          onClose={() => setDialog(null)}
        />
      ) : null}

      {dialog?.kind === 'card-edit' ? (
        <CardEditSheet
          card={dialog.card}
          columnName={columnNameOf(dialog.card.columnId)}
          currency={trip.currency}
          localCurrency={trip.localCurrency}
          fxRate={trip.fxRate}
          scheduledCount={scheduledCounts[dialog.card.id] ?? 0}
          onSubmit={submitCard}
          onSchedule={() => setDialog({ kind: 'card-schedule', card: dialog.card })}
          onDelete={() => {
            deleteWithUndo('card', dialog.card.title, () => deleteCard(dialog.card.id));
            setDialog(null);
          }}
          onClose={() => setDialog(null)}
        />
      ) : null}

      {dialog?.kind === 'card-schedule' ? (
        <ScheduleSheet card={dialog.card} onClose={() => setDialog(null)} />
      ) : null}

      {dialog?.kind === 'column-edit' ? (
        <ColumnEditSheet
          column={dialog.column}
          canDelete={columns.length > 1}
          onSubmit={submitColumn}
          onDelete={() => setDialog({ kind: 'column-delete', column: dialog.column })}
          onClose={() => setDialog(null)}
        />
      ) : null}

      {dialog?.kind === 'column-delete' ? (
        <ConfirmDialog
          title={`'${dialog.column.name}' 카테고리를 삭제할까요?`}
          description={
            (cardsByColumn[dialog.column.id]?.length ?? 0) > 0
              ? `이 카테고리의 카드 ${cardsByColumn[dialog.column.id]?.length}개는 '${
                  columns.find((column) => column.id !== dialog.column.id)?.name ?? ''
                }'(으)로 옮겨져요.`
              : '카드가 없는 카테고리예요.'
          }
          onConfirm={() => {
            deleteWithUndo('column', dialog.column.name, () => deleteColumn(dialog.column.id));
            setDialog(null);
          }}
          onCancel={() => setDialog(null)}
          testId="column-delete-confirm"
        />
      ) : null}
    </section>
  );
}
