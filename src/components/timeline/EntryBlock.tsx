import { useDraggable } from '@dnd-kit/core';
import { DND_ENTRY, entryDraggableId } from '../../dnd/planDnd';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import type { Card, TimelineEntry } from '../../types/models';
import { PX_PER_MIN, type LaneBox } from '../../timeline/layout';
import { colorClasses } from '../../utils/colors';
import { MIN_ENTRY_MIN, formatTimeRange, minToY, snapMin, yToMin } from '../../utils/time';

interface EntrySurfaceProps {
  title: string;
  icon: string;
  /** Column color token of the card behind the entry. */
  color: string;
  timeRange: string;
  /** Hides the time line when the block is too short to fit two rows. */
  short?: boolean;
}

/**
 * The looks of a scheduled entry, with no drag wiring — shared by the block on
 * the grid and by the `DragOverlay` ghost.
 */
export function EntrySurface({ title, icon, color, timeRange, short }: EntrySurfaceProps) {
  const colors = colorClasses(color);
  return (
    <div
      className={`h-full w-full overflow-hidden rounded-lg border border-white/60 border-l-4 px-1.5 py-1 ${colors.accent} ${colors.header}`}
    >
      <p className="flex items-center gap-1 truncate text-[11px] font-semibold leading-tight">
        <span aria-hidden="true">{icon}</span>
        <span className="truncate">{title}</span>
      </p>
      {short ? null : (
        <p className="truncate text-[10px] leading-tight tabular-nums opacity-70">{timeRange}</p>
      )}
    </div>
  );
}

interface EntryGhostProps {
  card: Card;
  color: string;
  entry: TimelineEntry;
  /** Ghost width in px — matches the day column so the drop reads honestly. */
  width: number;
}

/** Drag ghost for an entry: the same surface at its real height. */
export function EntryGhost({ card, color, entry, width }: EntryGhostProps) {
  return (
    <div
      className="rotate-1 opacity-90 shadow-lg"
      style={{ width, height: Math.max(minToY(entry.durationMin, PX_PER_MIN), 24) }}
    >
      <EntrySurface
        title={card.title}
        icon="🗓"
        color={color}
        timeRange={formatTimeRange(entry.startMin, entry.durationMin)}
      />
    </div>
  );
}

interface EntryBlockProps {
  entry: TimelineEntry;
  /** The card behind the entry; a dangling entry falls back to a placeholder. */
  card?: Card;
  color: string;
  icon: string;
  /** Where the entry sits inside its overlap cluster. */
  lane: LaneBox;
  onOpen: (entry: TimelineEntry) => void;
}

/**
 * One scheduled card on the day grid.
 *
 * Absolutely positioned from `startMin`/`durationMin`, split horizontally when
 * it overlaps its neighbours. Dragging moves it (dnd-kit); the bottom handle
 * resizes it with **raw pointer events** — dnd-kit's sensors are about moving
 * things, and a resize needs the live delta without an activation distance.
 */
export default function EntryBlock({ entry, card, color, icon, lane, onOpen }: EntryBlockProps) {
  const resizeEntry = useWorkspaceStore((s) => s.resizeEntry);

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: entryDraggableId(entry.id),
    data: { type: DND_ENTRY, entryId: entry.id, dayId: entry.dayId },
  });

  const height = minToY(entry.durationMin, PX_PER_MIN);

  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    // Keep the drag sensor out of it: this gesture belongs to the handle.
    event.preventDefault();
    event.stopPropagation();

    const handle = event.currentTarget;
    const originY = event.clientY;
    const originDuration = entry.durationMin;
    let applied = originDuration;

    const onMove = (moveEvent: PointerEvent) => {
      const raw = originDuration + yToMin(moveEvent.clientY - originY, PX_PER_MIN);
      const next = Math.max(MIN_ENTRY_MIN, snapMin(raw));
      if (next === applied) return;
      applied = next;
      resizeEntry(entry.id, next);
    };
    const stop = () => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', stop);
      handle.removeEventListener('pointercancel', stop);
      try {
        handle.releasePointerCapture(event.pointerId);
      } catch {
        /* the capture may already be gone */
      }
    };

    handle.setPointerCapture(event.pointerId);
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
  };

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={() => onOpen(entry)}
      data-testid="timeline-entry"
      data-entry-id={entry.id}
      data-day-id={entry.dayId}
      data-card-id={entry.cardId}
      data-start-min={entry.startMin}
      data-duration-min={entry.durationMin}
      title={`${card?.title ?? ''} ${formatTimeRange(entry.startMin, entry.durationMin)}`}
      style={{
        position: 'absolute',
        top: minToY(entry.startMin, PX_PER_MIN),
        height,
        left: `${(lane.lane / lane.lanes) * 100}%`,
        width: `${100 / lane.lanes}%`,
        touchAction: 'none',
      }}
      className={[
        'cursor-grab select-none p-px outline-none focus-visible:ring-2 focus-visible:ring-stone-400',
        isDragging ? 'opacity-40' : '',
      ].join(' ')}
    >
      <EntrySurface
        title={card?.title ?? '(삭제된 카드)'}
        icon={icon}
        color={color}
        timeRange={formatTimeRange(entry.startMin, entry.durationMin)}
        short={height < 34}
      />

      <div
        role="separator"
        aria-label="길이 조절"
        data-testid="entry-resize"
        onPointerDown={startResize}
        onClick={(event) => event.stopPropagation()}
        style={{ touchAction: 'none' }}
        className="absolute inset-x-1 bottom-0 h-2.5 cursor-ns-resize rounded-b-lg after:absolute after:inset-x-[35%] after:bottom-[3px] after:h-[2px] after:rounded-full after:bg-stone-500/40"
      />
    </div>
  );
}
