import { useEffect, useMemo, useState } from 'react';
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
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { summarizeSchedule } from '../../timeline/scheduleSummary';
import type { BoardColumn, Card } from '../../types/models';
import ConfirmDialog from '../common/ConfirmDialog';
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
      className="mx-auto flex max-w-md flex-col items-center gap-4 px-6 py-16 text-center"
    >
      <span aria-hidden="true" className="text-4xl">
        🗂️
      </span>
      <h1 className="text-xl font-semibold text-stone-800">보드</h1>
      <p className="text-sm leading-relaxed text-stone-400">
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
          data-testid="board-goto-trips"
          onClick={() => setTab('trips')}
          className="rounded-full bg-stone-800 px-5 py-2.5 text-sm font-semibold text-white hover:bg-stone-900"
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
    <section data-testid="view-board" aria-labelledby="view-board-title" className="pb-6">
      <header className="flex items-baseline gap-2 px-4 pb-3 pt-5">
        <h1 id="view-board-title" className="text-2xl font-bold tracking-tight text-stone-800">
          보드
        </h1>
        <p data-testid="board-trip-title" className="min-w-0 truncate text-sm text-stone-400">
          {trip.title}
        </p>
      </header>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setDraggingId(null)}
      >
        <div
          data-testid="board-scroller"
          className="flex snap-x snap-mandatory items-start gap-3 overflow-x-auto px-4 pb-4 lg:snap-none"
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
          scheduledCount={scheduledCounts[dialog.card.id] ?? 0}
          onSubmit={submitCard}
          onSchedule={() => setDialog({ kind: 'card-schedule', card: dialog.card })}
          onDelete={() => {
            deleteCard(dialog.card.id);
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
            deleteColumn(dialog.column.id);
            setDialog(null);
          }}
          onCancel={() => setDialog(null)}
          testId="column-delete-confirm"
        />
      ) : null}
    </section>
  );
}
