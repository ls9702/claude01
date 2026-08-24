import { WINDOW_HOUR_OFFSETS, windowHourLabel } from '../../timeline/dayWindow';
import { AXIS_PX, DAY_HEIGHT_PX, PX_PER_MIN } from '../../timeline/layout';
import { minToY } from '../../utils/time';

/**
 * One hour line per row of the window, as **offsets** from its top (M16-B):
 * `0, 60, … 1380` — that is 05:00, 06:00, … 04:00.
 *
 * Exported because `DayColumn` draws the very same lines behind the entries and
 * the two must land on identical pixels.
 */
export const HOURS = WINDOW_HOUR_OFFSETS;

/**
 * The 05:00–05:00 hour gutter to the left of the day columns.
 *
 * Still 1440 minutes tall and still `PX_PER_MIN` per minute — the window moved,
 * it did not stretch. Labels are wall-clock times throughout (`04:30` is
 * `04:30`); only midnight is written `24:00`, because at that point in the
 * column it is the end of the evening rather than the start of anything.
 *
 * Labels sit just under their own hour line (rather than centred on it) so the
 * 05:00 label is not clipped by the top of the scroller.
 */
export default function TimeAxis() {
  return (
    <div
      data-testid="time-axis"
      aria-hidden="true"
      className="relative shrink-0 select-none"
      style={{ width: AXIS_PX, height: DAY_HEIGHT_PX }}
    >
      {HOURS.map((offset) => (
        <span
          key={offset}
          className="absolute right-2 text-micro font-normal leading-none tabular-nums text-ink-faint"
          style={{ top: minToY(offset, PX_PER_MIN) + 2 }}
        >
          {windowHourLabel(offset)}
        </span>
      ))}
    </div>
  );
}
