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
  PointerSensor,
  TouchSensor,
  closestCorners,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { useUndoStore } from '../stores/undoStore';
import { useWorkspaceStore } from '../stores/workspaceStore';
import type { BoardColumn, Id, Trip } from '../types/models';
import { DAY_COLUMN_PX, PX_PER_MIN } from '../timeline/layout';
import { yToMin } from '../utils/time';
import { CardSurface } from '../components/board/CardItem';
import { EntryGhost } from '../components/timeline/EntryBlock';
import { resolveBoardDrop, snapshotBoard } from './boardDnd';
import { parseDayDroppableId, parseEntryDraggableId } from './planDnd';

/* ------------------------------------------------------------------ *
 * Day-grid registry — lets a DayColumn hand its element to the context
 * ------------------------------------------------------------------ */

type Register = (dayId: Id, element: HTMLElement | null) => void;

const DayGridContext = createContext<Register | null>(null);

/**
 * Ref callback a {@link import('../components/timeline/DayColumn')} attaches to
 * its 00:00–24:00 grid element, so a drop can be turned into a start time.
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
 * Day columns win over board columns whenever the pointer is inside one; the
 * board keeps M1's `closestCorners` behaviour everywhere else, so card
 * sorting inside the rail feels exactly like the 보드 tab.
 */
const planCollisionDetection: CollisionDetection = (args) => {
  const hits = pointerWithin(args).filter((hit) => parseDayDroppableId(String(hit.id)) !== null);
  return hits.length > 0 ? hits : closestCorners(args);
};

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
 *    the minute under the pointer (snapped by the store);
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
  const deleteEntry = useWorkspaceStore((s) => s.deleteEntry);
  const offer = useUndoStore((s) => s.offer);

  const [activeId, setActiveId] = useState<string | null>(null);
  const grids = useRef(new Map<Id, HTMLElement | null>());
  /** Latest pointer position, kept because dnd-kit's `delta` is not it. */
  const pointerY = useRef<number | null>(null);
  const grabY = useRef<number | null>(null);

  const register = useCallback<Register>((dayId, element) => {
    if (element) grids.current.set(dayId, element);
    else grids.current.delete(dayId);
  }, []);

  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      pointerY.current = event.clientY;
    };
    const onTouch = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (touch) pointerY.current = touch.clientY;
    };
    window.addEventListener('pointermove', onPointer, true);
    window.addEventListener('touchmove', onTouch, true);
    return () => {
      window.removeEventListener('pointermove', onPointer, true);
      window.removeEventListener('touchmove', onTouch, true);
    };
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  );

  const snapshot = useMemo(() => snapshotBoard(columns), [columns]);

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
    grabY.current = null;

    const entryId = parseEntryDraggableId(active);
    if (entryId) {
      const entry = workspace.entries[entryId];
      const grid = dayId ? grids.current.get(dayId) : undefined;
      if (!entry || !dayId || !grid || clientY == null) return;
      const top = clientY - (grabOffset ?? 0) - grid.getBoundingClientRect().top;
      moveEntry(entryId, dayId, yToMin(top, PX_PER_MIN));
      return;
    }

    if (dayId) {
      const grid = grids.current.get(dayId);
      if (!grid || clientY == null) return;
      const startMin = yToMin(clientY - grid.getBoundingClientRect().top, PX_PER_MIN);
      const created = scheduleCard(active, dayId, startMin);
      if (created) {
        const title = workspace.cards[active]?.title ?? '카드';
        offer(`'${title}' 배치됨`, () => deleteEntry(created));
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
        collisionDetection={planCollisionDetection}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setActiveId(null)}
      >
        {children}

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
