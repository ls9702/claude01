import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  closestCorners,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { requestPlaceFix } from '../stores/placeFixQueue';
import { deleteEntryWithUndo } from '../stores/entryDelete';
import { useUndoStore } from '../stores/undoStore';
import { useWorkspaceStore } from '../stores/workspaceStore';
import type { BoardColumn, Id, Trip, Workspace } from '../types/models';
import { dropTarget, type DropTarget } from '../timeline/dayWindow';
import { snapDropMin } from '../timeline/dropSnap';
import { DAY_COLUMN_PX, PX_PER_MIN } from '../timeline/layout';
import { yToMin } from '../utils/time';
import {
  AUTO_SCROLL_ACCELERATION,
  AUTO_SCROLL_INTERVAL_MS,
  nearScrollEdge,
} from './autoScroll';
import { CardSurface } from '../components/board/CardItem';
import { EntryGhost } from '../components/timeline/EntryBlock';
import EntryTrash from '../components/timeline/EntryTrash';
import { resolveBoardDrop, snapshotBoard } from './boardDnd';
import {
  parseDayDroppableId,
  parseEntryDraggableId,
  planPointerPriority,
  resolveEntryDrop,
} from './planDnd';

/* ------------------------------------------------------------------ *
 * Day-grid registry — lets a DayColumn hand its element to the context
 * ------------------------------------------------------------------ */

type Register = (dayId: Id, element: HTMLElement | null) => void;

const DayGridContext = createContext<Register | null>(null);

/**
 * Ref callback a {@link import('../components/timeline/DayColumn')} attaches to
 * its 05:00–05:00 grid element, so a drop can be turned into a start time.
 */
export function useRegisterDayGrid(dayId: Id): (element: HTMLElement | null) => void {
  const register = useContext(DayGridContext);
  return useCallback((element: HTMLElement | null) => register?.(dayId, element), [register, dayId]);
}

/* ------------------------------------------------------------------ *
 * Pointer geometry
 * ------------------------------------------------------------------ */

/**
 * `clientY` of a dnd-kit activator event (mouse/pen or touch).
 *
 * Deliberately *not* `event.delta`: dnd-kit folds a scroll adjustment into
 * that vector so the ghost tracks a scrolling container, which makes it wrong
 * for "which minute is under the cursor". The raw pointer is the truth here.
 */
function activatorClientY(activatorEvent: Event | null): number | null {
  const event = activatorEvent as (PointerEvent & { touches?: TouchList }) | null;
  if (!event) return null;
  if (typeof event.clientY === 'number' && Number.isFinite(event.clientY)) return event.clientY;
  const touch = event.touches?.[0];
  return touch ? touch.clientY : null;
}

/**
 * 휴지통 wins over day columns, and day columns win over board columns,
 * whenever the pointer is inside one; the board keeps M1's `closestCorners`
 * behaviour everywhere else, so card sorting inside the rail feels exactly like
 * the 보드 tab.
 *
 * The ranking itself lives in {@link planPointerPriority} — see there for why
 * 휴지통 has to be named first rather than left to the hit-test order.
 */
const planCollisionDetection: CollisionDetection = (args) => {
  const hits = planPointerPriority(pointerWithin(args), (hit) => String(hit.id));
  return hits.length > 0 ? hits : closestCorners(args);
};

/**
 * Which minute of which **calendar** day the pointer is over (M16-B).
 *
 * A column draws 05:00 → next-day 05:00, so a Y below its 24:00 line is a time
 * on the day after `visualDayId`. {@link dropTarget} owns that arithmetic; this
 * only has to find the sheet whose `dayOrder` says which day comes next, which
 * is the day row's own sheet.
 *
 * `null` means the pointer was in the last column's 새벽 zone — minutes of a
 * date the sheet does not have. The caller refuses the drop instead of quietly
 * parking the entry somewhere else.
 *
 * M45 — 자석이 여기 붙는다: `yMin`은 손가락이 가리킨 **오프셋**이고, 그 값이
 * `dropTarget`에 들어가기 전에 :00 / :30으로 반올림된다. 창의 시작이 05:00이라
 * 오프셋 격자와 시계 격자가 같은 선 위에 있으므로(자세한 것은 `dropSnap.ts`),
 * 05시 경계 산술은 지금까지처럼 `dayWindow.ts` 한 곳에만 남는다.
 *
 * 두 드롭(레일 카드 배치 · 블록 이동)이 **둘 다** 이 함수를 지나므로, 자석은
 * 한 줄로 두 길을 덮는다.
 */
function resolveDrop(
  workspace: Workspace,
  visualDayId: Id,
  yMin: number,
): DropTarget | null {
  const day = workspace.days[visualDayId];
  const dayOrder = day ? (workspace.sheets[day.sheetId]?.dayOrder ?? [visualDayId]) : [visualDayId];
  return dropTarget(visualDayId, snapDropMin(yMin), dayOrder);
}

/** Said when a drop lands past the last day's midnight and has nowhere to go. */
const NO_NEXT_DAY = '다음 일자가 없어요';

/* ------------------------------------------------------------------ *
 * Context
 * ------------------------------------------------------------------ */

interface PlanDndContextProps {
  trip: Trip;
  /** Board columns of the trip, in board order — the rail and the resolver. */
  columns: readonly BoardColumn[];
  children: ReactNode;
}

/**
 * The single `DndContext` that spans the board rail and the day grid.
 *
 * Three drops are possible:
 * 1. a rail card onto `day:<id>` → {@link useWorkspaceStore.scheduleCard} at
 *    the minute under the pointer, pulled onto the nearest :00 / :30 (M45);
 * 2. an entry onto `day:<id>` → `moveEntry`, shifting its start by the drag
 *    delta so the block keeps the grab offset;
 * 3. anything else → `resolveBoardDrop`, unchanged from M1.
 *
 * The 보드 tab keeps its own context; this one is mounted by the 일정 tab.
 */
export default function PlanDndContext({ trip, columns, children }: PlanDndContextProps) {
  const workspace = useWorkspaceStore((s) => s.workspace);
  const moveCard = useWorkspaceStore((s) => s.moveCard);
  const scheduleCard = useWorkspaceStore((s) => s.scheduleCard);
  const moveEntry = useWorkspaceStore((s) => s.moveEntry);
  const resizeEntry = useWorkspaceStore((s) => s.resizeEntry);
  const deleteEntry = useWorkspaceStore((s) => s.deleteEntry);
  const offer = useUndoStore((s) => s.offer);
  const notify = useUndoStore((s) => s.notify);

  const [activeId, setActiveId] = useState<string | null>(null);
  const grids = useRef(new Map<Id, HTMLElement | null>());
  /** Latest pointer position, kept because dnd-kit's `delta` is not it. */
  const pointerY = useRef<number | null>(null);
  /** Only the auto-scroll gate reads this one — drops are a vertical question. */
  const pointerX = useRef<number | null>(null);
  const grabY = useRef<number | null>(null);

  const register = useCallback<Register>((dayId, element) => {
    if (element) grids.current.set(dayId, element);
    else grids.current.delete(dayId);
  }, []);

  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      pointerY.current = event.clientY;
      pointerX.current = event.clientX;
    };
    const onTouch = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (touch) {
        pointerY.current = touch.clientY;
        pointerX.current = touch.clientX;
      }
    };
    window.addEventListener('pointermove', onPointer, true);
    window.addEventListener('touchmove', onTouch, true);
    return () => {
      window.removeEventListener('pointermove', onPointer, true);
      window.removeEventListener('touchmove', onTouch, true);
    };
  }, []);

  /**
   * 마우스는 8px, 손가락은 250ms.
   *
   * `PointerSensor`로는 이 둘을 나눌 수 없다: 터치도 포인터 이벤트를 내므로
   * 손가락이 8px만 움직여도 곧바로 드래그가 시작되고, 스크롤하려던 스와이프가
   * 일정 블록을 끌고 가버린다(TouchSensor의 지연은 시작될 기회조차 없다).
   * 입력 장치마다 센서를 따로 두면 각자의 규칙이 실제로 적용된다.
   */
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  );

  const snapshot = useMemo(() => snapshotBoard(columns), [columns]);

  /**
   * 자동 스크롤을 손가락 기준·절대 픽셀로 다시 묶는다 (M50).
   *
   * `canScroll`은 스크롤 후보가 된 조상마다 한 번씩 불린다. 손가락이 그 상자의
   * 어느 가장자리에서도 {@link AUTO_SCROLL_EDGE_PX}보다 멀면 그 상자는 이번
   * 프레임에 스크롤될 자격이 없다. 가로 레일(보드 칸)도 같은 규칙으로 좌우
   * 가장자리에서만 흐른다.
   *
   * 포인터를 모르는 상황(측정 전, 키보드 센서)에서는 막지 않는다 — 판단할
   * 근거가 없을 때 기능을 꺼 버리는 쪽이 더 나쁜 실패다.
   */
  const autoScroll = useMemo(
    () => ({
      acceleration: AUTO_SCROLL_ACCELERATION,
      interval: AUTO_SCROLL_INTERVAL_MS,
      canScroll: (element: Element) => {
        const y = pointerY.current;
        const x = pointerX.current;
        if (y == null || x == null) return true;
        const box =
          element === document.scrollingElement
            ? { top: 0, bottom: window.innerHeight, left: 0, right: window.innerWidth }
            : element.getBoundingClientRect();
        return nearScrollEdge(x, y, box);
      },
    }),
    [],
  );

  const onDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id));
    const start = activatorClientY(event.activatorEvent);
    pointerY.current = start;
    // How far down the dragged thing the user grabbed it — an entry keeps that
    // offset so the block does not jump its top edge onto the cursor.
    const initial = event.active.rect.current.initial;
    grabY.current = start != null && initial ? start - initial.top : null;
  };

  const onDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    const active = String(event.active.id);
    const over = event.over ? String(event.over.id) : null;
    const dayId = parseDayDroppableId(over);
    const clientY = pointerY.current;
    const grabOffset = grabY.current;
    pointerY.current = null;
    pointerX.current = null;
    grabY.current = null;

    const entryId = parseEntryDraggableId(active);
    if (entryId) {
      const entry = workspace.entries[entryId];
      const drop = resolveEntryDrop(over);

      // 휴지통 (M34) — before any geometry: this drop is not a placement, so
      // the minute under the pointer is nothing to it. The card stays on the
      // board; only this placement goes, and 실행 취소 puts an identical one
      // back (see `deleteEntryWithUndo`).
      if (drop.kind === 'trash') {
        if (entry) deleteEntryWithUndo(entry);
        return;
      }

      const grid = dayId ? grids.current.get(dayId) : undefined;
      if (!entry || !dayId || !grid || clientY == null) return;
      const top = clientY - (grabOffset ?? 0) - grid.getBoundingClientRect().top;
      const target = resolveDrop(workspace, dayId, yToMin(top, PX_PER_MIN));
      // Past the last day's midnight there is no day to move it to; say so and
      // leave the entry where it was rather than inventing a placement.
      if (!target) {
        notify(NO_NEXT_DAY);
        return;
      }
      // Where it was, before the drop — the drag itself is the only record of
      // it, and a finger that slipped deserves the same way back as a tap.
      //
      // `durationMin`이 함께 실린다 (M50, 헌터A #2): 예전 `from`은 일자와
      // 시작만 들고 있었으므로, 되돌리기가 블록을 제자리에 갖다 놓고도 길이는
      // 드롭이 남긴 값 그대로 두었다. 「실행 취소」는 드래그 **전체**를 물리는
      // 것이지 절반만 물리는 것이 아니다.
      const from = {
        dayId: entry.dayId,
        startMin: entry.startMin,
        durationMin: entry.durationMin,
      };
      moveEntry(entryId, target.dayId, target.startMin);

      // `moveEntry` treats "dropped where it started" as nothing at all; only
      // an actual change is worth a toast.
      const moved = useWorkspaceStore.getState().workspace.entries[entryId];
      if (
        moved &&
        (moved.dayId !== from.dayId ||
          moved.startMin !== from.startMin ||
          moved.durationMin !== from.durationMin)
      ) {
        // 순서가 중요하다: **먼저 옮기고 그 다음 늘린다**. `moveEntry`는 이제
        // 소요를 보존하므로 블록은 `from.startMin`에 그대로 서고, 이어지는
        // `resizeEntry`의 `clampEntry(from.startMin, from.durationMin)`는
        // 정확히 원래 길이를 돌려준다 — `from`은 방금 전까지 실제로 있던
        // 배치이니 그 합이 자정을 넘을 수 없기 때문이다. 반대로 늘리고 옮기면
        // 늦은 시각에서 길이를 되찾으려다 클램프에 잘린다.
        offer('일정 이동됨', () => {
          moveEntry(entryId, from.dayId, from.startMin);
          resizeEntry(entryId, from.durationMin);
        });
      }
      return;
    }

    if (dayId) {
      const grid = grids.current.get(dayId);
      if (!grid || clientY == null) return;
      const target = resolveDrop(
        workspace,
        dayId,
        yToMin(clientY - grid.getBoundingClientRect().top, PX_PER_MIN),
      );
      if (!target) {
        notify(NO_NEXT_DAY);
        return;
      }
      const created = scheduleCard(active, target.dayId, target.startMin);
      if (created) {
        const title = workspace.cards[active]?.title ?? '카드';
        offer(`'${title}' 배치됨`, () => deleteEntry(created));
        // 배치는 이미 끝났다 (M41). 구글 시트에 놓은 것이라면 그 **뒤에** 구글
        // 에게 이 장소가 어디인지 한 번 물어본다 — 배치를 막는 일은 없다.
        requestPlaceFix(workspace, active, target.dayId);
      }
      return;
    }

    const move = resolveBoardDrop(active, over, snapshot);
    if (move) moveCard(move.cardId, move.toColumnId, move.toIndex);
  };

  const draggingEntry = activeId ? workspace.entries[parseEntryDraggableId(activeId) ?? ''] : undefined;
  const draggingCard = activeId ? workspace.cards[activeId] : undefined;
  const ghostCard = draggingCard ?? (draggingEntry ? workspace.cards[draggingEntry.cardId] : undefined);
  const ghostColor = ghostCard ? (workspace.columns[ghostCard.columnId]?.color ?? 'slate') : 'slate';

  return (
    <DayGridContext.Provider value={register}>
      <DndContext
        sensors={sensors}
        autoScroll={autoScroll}
        collisionDetection={planCollisionDetection}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setActiveId(null)}
      >
        {children}

        {/* Only while an **entry** is in the air (M34): a card being placed for
            the first time has nothing to take off the schedule yet, so the bar
            would be an offer with nothing behind it. Mounted here, at the top
            of the context, so it floats over the grid instead of moving it. */}
        {draggingEntry ? <EntryTrash /> : null}

        <DragOverlay dropAnimation={null}>
          {draggingEntry && ghostCard ? (
            <EntryGhost
              card={ghostCard}
              color={ghostColor}
              entry={draggingEntry}
              width={DAY_COLUMN_PX}
            />
          ) : draggingCard ? (
            <CardSurface card={draggingCard} currency={trip.currency} color={ghostColor} lifted />
          ) : null}
        </DragOverlay>
      </DndContext>
    </DayGridContext.Provider>
  );
}
