import { useDraggable } from '@dnd-kit/core';
import { DND_ENTRY, entryDraggableId } from '../../dnd/planDnd';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import type { Card, TimelineEntry } from '../../types/models';
import type { VisualPlacement } from '../../timeline/dayWindow';
import { PX_PER_MIN, type LaneBox } from '../../timeline/layout';
import { colorClasses } from '../../utils/colors';
import { FLIGHT_CARD_PREFIX } from '../../utils/flights';
import { MIN_ENTRY_MIN, formatTimeRange, minToY, snapMin, yToMin } from '../../utils/time';
import { EmojiIcon } from '../common/Icon';

interface EntrySurfaceProps {
  title: string;
  icon: string;
  /** Column color token of the card behind the entry. */
  color: string;
  timeRange: string;
  /** Hides the time line when the block is too short to fit two rows. */
  short?: boolean;
  /**
   * First-day 새벽 badge (M16-B): this block is *pinned* to the top of its
   * column because the window it really belongs to — 여행 시작 전날 밤 — is not
   * in this sheet. Its height is a handle, not a duration, and the badge is
   * what says so.
   */
  dawn?: boolean;
}

/**
 * The looks of a scheduled entry, with no drag wiring — shared by the block on
 * the grid and by the `DragOverlay` ghost.
 */
export function EntrySurface({
  title,
  icon,
  color,
  timeRange,
  short,
  dawn,
}: EntrySurfaceProps) {
  const colors = colorClasses(color);
  // The card title already carries ✈️ for a flight; the column's icon beside it
  // would be the second aeroplane on one line (M9 §4.4-1).
  const showIcon = !title.trimStart().startsWith(FLIGHT_CARD_PREFIX);

  return (
    <div
      className={`h-full w-full overflow-hidden rounded-md border-l-[3px] px-2 py-1 ring-1 ring-line ${colors.accent} ${colors.surface}`}
    >
      <p className="flex items-center gap-1 truncate text-micro text-ink">
        {dawn ? (
          <span
            data-testid="entry-dawn-badge"
            className="shrink-0 rounded-full bg-sunken px-1 text-micro leading-none text-ink-muted"
          >
            새벽
          </span>
        ) : null}
        {showIcon ? <EmojiIcon emoji={icon} className="bg-surface/70" /> : null}
        <span className="truncate">{title}</span>
      </p>
      {short ? null : (
        <p className="truncate text-micro font-normal tabular-nums text-ink-muted">{timeRange}</p>
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
      className="rotate-[0.75deg] opacity-90 shadow-float"
      style={{ width, height: Math.max(minToY(entry.durationMin, PX_PER_MIN), 24) }}
    >
      <EntrySurface
        title={card.title}
        icon="📌"
        color={color}
        timeRange={formatTimeRange(entry.startMin, entry.durationMin)}
      />
    </div>
  );
}

interface EntryBlockProps {
  entry: TimelineEntry;
  /**
   * Where this block is drawn inside the column that got it (M16-B). The store
   * still holds clock time; this is the translation of it into window space.
   */
  placement: VisualPlacement;
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
 * Absolutely positioned from its {@link VisualPlacement}, split horizontally
 * when it overlaps its neighbours. Dragging moves it (dnd-kit); the bottom
 * handle resizes it with **raw pointer events** — dnd-kit's sensors are about
 * moving things, and a resize needs the live delta without an activation
 * distance.
 *
 * `data-start-min` stays the **stored clock minute**, not the offset: it is the
 * model's number, several specs read it as such, and the whole point of M16-B
 * is that the model did not move.
 */
export default function EntryBlock({
  entry,
  placement,
  card,
  color,
  icon,
  lane,
  onOpen,
}: EntryBlockProps) {
  const resizeEntry = useWorkspaceStore((s) => s.resizeEntry);

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: entryDraggableId(entry.id),
    data: { type: DND_ENTRY, entryId: entry.id, dayId: entry.dayId },
  });

  const height = minToY(placement.drawMin, PX_PER_MIN);
  /**
   * A block drawn shorter than it really is — clipped at the window's edge, or
   * pinned in the 새벽 zone — has no honest resize handle: the pointer would
   * move minutes the block is not showing. Length is edited in the detail
   * sheet for those two cases, and only those two.
   */
  const resizable = placement.drawMin === entry.durationMin;

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
      data-offset-min={placement.offsetMin}
      data-dawn={placement.dawn ? 'true' : 'false'}
      data-clipped={placement.clipped ? 'true' : 'false'}
      title={`${card?.title ?? ''} ${formatTimeRange(entry.startMin, entry.durationMin)}`}
      style={{
        position: 'absolute',
        top: minToY(placement.offsetMin, PX_PER_MIN),
        height,
        left: `${(lane.lane / lane.lanes) * 100}%`,
        width: `${100 / lane.lanes}%`,
        // Blocks cover most of a busy day; a finger landing on one must still
        // be able to scroll the grid. The 250 ms long-press decides whether
        // this is a scroll or a move, and only a real lift takes the gesture.
        touchAction: isDragging ? 'none' : 'manipulation',
      }}
      className={[
        'group cursor-grab select-none p-px outline-none focus-visible:ring-2 focus-visible:ring-line-strong',
        isDragging ? 'opacity-40' : '',
      ].join(' ')}
    >
      <EntrySurface
        title={card?.title ?? '(삭제된 카드)'}
        icon={icon}
        color={color}
        timeRange={formatTimeRange(entry.startMin, entry.durationMin)}
        short={height < 34}
        dawn={placement.dawn}
      />

      {resizable ? (
      <div
        role="separator"
        aria-label="길이 조절"
        data-testid="entry-resize"
        onPointerDown={startResize}
        // The block's own drag listens for mousedown/touchstart, so the handle
        // has to swallow those too — a resize is not a move.
        onMouseDown={(event) => event.stopPropagation()}
        onTouchStart={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
        // This one *is* a drag handle, and a 12px strip is nobody's scroller.
        style={{ touchAction: 'none' }}
        // The bar only appears on hover/focus: parked permanently it reads as a
        // scrollbar sitting inside the block (M9 §4.4-7).
        className="absolute inset-x-1 bottom-0 grid h-3 cursor-ns-resize place-items-end justify-center rounded-b-md pb-px"
      >
        <span
          aria-hidden="true"
          className="h-1 w-6 rounded-full bg-line-strong opacity-0 transition-opacity duration-[140ms] ease-quick group-hover:opacity-100 group-focus-within:opacity-100"
        />
      </div>
      ) : null}
    </div>
  );
}
