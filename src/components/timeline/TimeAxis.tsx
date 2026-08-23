import { AXIS_PX, DAY_HEIGHT_PX, PX_PER_MIN } from '../../timeline/layout';
import { formatClock, minToY } from '../../utils/time';

/** `0 … 23` — one label per hour line. */
export const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

/**
 * The 00:00–24:00 hour gutter to the left of the day columns.
 *
 * Labels sit just under their own hour line (rather than centred on it) so the
 * midnight label is not clipped by the top of the scroller.
 */
export default function TimeAxis() {
  return (
    <div
      data-testid="time-axis"
      aria-hidden="true"
      className="relative shrink-0 select-none"
      style={{ width: AXIS_PX, height: DAY_HEIGHT_PX }}
    >
      {HOURS.map((hour) => (
        <span
          key={hour}
          className="absolute right-1.5 text-[10px] leading-none tabular-nums text-stone-400"
          style={{ top: minToY(hour * 60, PX_PER_MIN) + 2 }}
        >
          {formatClock(hour * 60)}
        </span>
      ))}
    </div>
  );
}
