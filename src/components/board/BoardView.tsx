import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { resolveBoardDrop, snapshotBoard } from '../../dnd/boardDnd';
import { useProfileStore } from '../../profile/profile';
import { cardsWithUnreadComments } from '../../read/readState';
import { useUiStore } from '../../stores/uiStore';
import { deleteWithUndo } from '../../stores/undoDelete';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { summarizeSchedule } from '../../timeline/scheduleSummary';
import type { BoardColumn, Card } from '../../types/models';
import { useAiEnabled } from '../../ai/aiSettings';
import AiAskButton from '../ai/AiAskButton';
import AiSuggestSheet from '../ai/AiSuggestSheet';
import ConfirmDialog from '../common/ConfirmDialog';
import Icon from '../common/Icon';
import PatchNotesButton from '../common/PatchNotesButton';
import SyncStatusChip from '../common/SyncStatusChip';
import {
  BTN_SIZE_SM,
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
  withBtnSize,
} from '../common/formStyles';
import { useIsDesktop } from '../../hooks/useMediaQuery';
import StickyHScrollbar from '../common/StickyHScrollbar';
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
      <h1 className="shrink-0 whitespace-nowrap text-title text-ink">보드</h1>
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
  const setColumnTodo = useWorkspaceStore((s) => s.setColumnTodo);
  const setColumnBudgetOnce = useWorkspaceStore((s) => s.setColumnBudgetOnce);
  const setColumnGourmet = useWorkspaceStore((s) => s.setColumnGourmet);
  const deleteColumn = useWorkspaceStore((s) => s.deleteColumn);
  const moveCard = useWorkspaceStore((s) => s.moveCard);
  const activeTripId = useUiStore((s) => s.activeTripId);
  const focusCardId = useUiStore((s) => s.focusCardId);
  const focusCard = useUiStore((s) => s.focusCard);
  const profileId = useProfileStore((s) => s.profileId);

  const [dialog, setDialog] = useState<Dialog>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const isDesktop = useIsDesktop();

  /** AI 추천 (M11). Hidden entirely unless all three conditions hold. */
  const aiOn = useAiEnabled();
  const [aiSuggestOpen, setAiSuggestOpen] = useState(false);
  // 질문 시트의 「카드로 만들기」 원샷 핸드오프 (M17): 프리필을 집어 들고
  // 즉시 비운 뒤 AI 추천 시트를 연다.
  const aiSuggestPrefill = useUiStore((s) => s.aiSuggestPrefill);
  const [prefill, setPrefill] = useState('');
  useEffect(() => {
    if (!aiSuggestPrefill || !aiOn) return;
    setPrefill(aiSuggestPrefill);
    setAiSuggestOpen(true);
    useUiStore.getState().clearAiSuggestPrefill();
  }, [aiSuggestPrefill, aiOn]);

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

  /**
   * 상대가 코멘트를 남긴 뒤로 내가 한 번도 열지 않은 카드들 (M24).
   *
   * 보드에서만 계산한다: 시간표의 레일도 같은 `CardItem`을 쓰지만, 레일은 카드를
   * *끌어다 놓는* 자리이지 읽는 자리가 아니다.
   */
  const newComments = useMemo(
    () => cardsWithUnreadComments(Object.values(cardsByColumn).flat(), workspace, profileId),
    [cardsByColumn, workspace, profileId],
  );

  /**
   * 마우스는 8px, 손가락은 250ms — 일정 탭과 같은 규칙(`PlanDndContext`).
   *
   * `PointerSensor` 하나로는 터치가 8px 규칙에 먼저 걸려서, 컬럼을 옆으로
   * 넘기려는 스와이프가 카드를 집어 들었다.
   */
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
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
    const { todo, budgetOnce, gourmet, ...patch } = values;
    updateColumn(dialog.column.id, patch);
    // 값이 실제로 바뀔 때만 쓴다 (M29). 이름만 고친 칸에 `todo: false`를 남기면
    // 그 칸은 자동 이행이 영원히 손댈 수 없는 칸이 되는데, 사람은 토글을 건드린
    // 적이 없다. 「명시적으로 껐다」는 사람이 정말 끈 순간에만 참이어야 한다.
    if (todo !== (dialog.column.todo === true)) setColumnTodo(dialog.column.id, todo);
    // 숙소 셈법도 같은 규칙으로 (M31).
    if (budgetOnce !== (dialog.column.budgetOnce === true)) {
      setColumnBudgetOnce(dialog.column.id, budgetOnce);
    }
    // 맛집 칸도 같은 규칙으로 (M49) — 이름만 고친 칸에 `gourmet: false`를 남기면
    // 그 여행은 상설 칸 이행이 영원히 손댈 수 없는 여행이 된다.
    if (gourmet !== (dialog.column.gourmet === true)) {
      setColumnGourmet(dialog.column.id, gourmet);
    }
    setDialog(null);
  };

  const columnNameOf = (columnId: string) => workspace.columns[columnId]?.name ?? '';
  /** 카드 시트의 「위치 확인」 핀이 그 카테고리 색·아이콘을 쓰도록 (M35). */
  const columnOf = (columnId: string) => workspace.columns[columnId];

  return (
    <section data-testid="view-board" aria-labelledby="view-board-title" className="shrink-0">
      {/* M19 — 여행 이름은 둘째 줄인데도 첫 줄의 폭만 쓰고 있었다: 「오사카 봄
          여행 3박4일」이 390px에서 「오사카 봄 여행 3…」로 잘리고, 정작 그 오른쪽
          (AI 버튼들 **아래**)은 비어 있었다. 두 줄을 격자로 세워 이름 줄이 폭 전체를
          쓰게 한다 — 첫 줄의 배치는 그대로다. */}
      <header className="grid grid-cols-[auto_1fr] items-center gap-x-3 px-4 pb-4 pt-6">
        <h1
          id="view-board-title"
          // 제목은 줄바꿈되지 않는다 (M18 §1) — 좁아지면 옆의 버튼이 양보한다.
          className="shrink-0 whitespace-nowrap text-display text-ink"
        >
          보드
        </h1>
        {/* M51 — `shrink-0` 한 줄에서 **줄바꿈되는** 묶음으로 바뀌었다.
            AI를 켠 320px 화면에서 이 네 개가 252px를 차지해 페이지가 7px 가로로
            밀렸고, 그 7px이면 안드로이드 Blink는 레이아웃 뷰포트를 늘려 탭 바를
            화면 밖으로 내보내기에 충분하다(M51의 그 사고 — `AppShell` 참조).

            일정 헤더처럼 버튼을 물러나게 하지 않는 이유: 여기 서 있는 것은
            ✨ 두 개(AI 추천·AI 묻기)라 하나를 아이콘만 남기면 같은 모양 두 개가
            나란히 서서 어느 쪽이 무엇인지 읽히지 않고, 아예 빼면 그 기능의
            **유일한** 문이 닫힌다. 줄이 모자라면 한 줄 더 쓰는 쪽이 정직하다 —
            320px에서만, 36px만. */}
        <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
          {aiOn ? (
            <button
              type="button"
              data-testid="ai-suggest-open"
              onClick={() => setAiSuggestOpen(true)}
              className={withBtnSize(SECONDARY_BUTTON_CLASS, BTN_SIZE_SM)}
            >
              <Icon name="sparkle" size={16} />
              AI 추천
            </button>
          ) : null}
          {/* Desktop wears both of these in the top bar instead. */}
          {isDesktop ? null : <PatchNotesButton />}
          {isDesktop ? null : <AiAskButton />}
          {isDesktop ? null : <SyncStatusChip variant="dot" />}
        </div>
        <p
          data-testid="board-trip-title"
          className="col-span-2 mt-1 min-w-0 truncate text-label text-ink-muted"
        >
          {trip.title}
        </p>
      </header>

      {/* Under the h1, never over it (M9 §3.5). Desktop wears the chip in the
          top bar instead, so only one of the two ever mounts. */}

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
                newCommentCards={newComments}
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

          {/* 보드는 페이지가 세로로 스크롤되는 화면이라 스크롤러의 진짜 가로
              막대는 내용 맨 아래(화면 밖)에 붙는다 — 대리 막대가 뷰포트
              하단에 늘 떠 있는다 (M50-fix). */}
          <StickyHScrollbar targetRef={scrollerRef} testid="board-hscrollbar" />

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
          columnColor={dialog.column.color}
          columnIcon={dialog.column.icon}
          // 맛집 칸이면 장르 픽커 한 줄이 선다 (M49).
          gourmet={dialog.column.gourmet === true}
          tripDestination={trip.destination}
          onSubmit={submitCard}
          onClose={() => setDialog(null)}
        />
      ) : null}

      {dialog?.kind === 'card-edit' ? (
        <CardEditSheet
          card={dialog.card}
          columnName={columnNameOf(dialog.card.columnId)}
          columnColor={columnOf(dialog.card.columnId)?.color}
          columnIcon={columnOf(dialog.card.columnId)?.icon}
          gourmet={columnOf(dialog.card.columnId)?.gourmet === true}
          currency={trip.currency}
          tripDestination={trip.destination}
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

      {aiSuggestOpen && aiOn ? (
        <AiSuggestSheet
          tripId={trip.id}
          initialWish={prefill}
          onClose={() => {
            setAiSuggestOpen(false);
            setPrefill('');
          }}
        />
      ) : null}
    </section>
  );
}
