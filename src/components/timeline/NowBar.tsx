import type { BoardColumn, Card, Id, TimelineEntry } from '../../types/models';
import type { NowNext } from '../../timeline/today';
import { FLIGHT_CARD_PREFIX } from '../../utils/flights';
import { formatDuration, formatTimeRange } from '../../utils/time';
import Icon, { EmojiIcon } from '../common/Icon';

interface NowBarProps extends NowNext {
  cards: Record<Id, Card>;
  columns: Record<Id, BoardColumn>;
  /** Opens the 2-tap 지출 sheet for that entry's card. */
  onSpend: (entry: TimelineEntry) => void;
  /** Opens the entry's detail sheet. */
  onOpen: (entry: TimelineEntry) => void;
}

interface LineProps {
  /** 지금 / 다음. */
  label: string;
  entry?: TimelineEntry;
  /** Shown instead of an entry — 지금은 빈 시간 / 오늘 남은 일정 없음. */
  fallback: string;
  icon: string;
  title: string;
  spendTestId: string;
  /** 지금 is the protagonist; 다음 is context clipped to the right. */
  lead?: boolean;
  onSpend: (entry: TimelineEntry) => void;
  onOpen: (entry: TimelineEntry) => void;
}

function NowLine({
  label,
  entry,
  fallback,
  icon,
  title,
  spendTestId,
  lead = false,
  onSpend,
  onOpen,
}: LineProps) {
  // A card whose title already starts with ✈️ does not also need the column's
  // emoji: two icons on one line say nothing twice (M9 §4.4-1).
  const showIcon = !title.trimStart().startsWith(FLIGHT_CARD_PREFIX);

  return (
    // 지금 takes the whole bar on a phone: 40% of 390px left the 다음 title
    // clipped to three characters, which names nothing. Below `sm` the 다음
    // block is not shrunk, it is gone — the grid right below already has it.
    <div
      className={`min-w-0 items-center gap-2 ${
        lead ? 'flex flex-1' : 'hidden max-w-[40%] sm:flex'
      }`}
    >
      <span
        className={`shrink-0 text-micro ${lead ? 'text-now' : 'text-ink-faint'}`}
      >
        {label}
      </span>

      {entry ? (
        <>
          <button
            type="button"
            data-testid={`${spendTestId}-entry`}
            data-entry-id={entry.id}
            onClick={() => onOpen(entry)}
            className="flex min-w-0 flex-1 items-center gap-1 text-left"
          >
            {showIcon ? <EmojiIcon emoji={icon} /> : null}
            {/* Shrinks but never grows, so the time stays welded to the name
                instead of drifting to the far end of a wide bar. */}
            <span
              className={`min-w-0 shrink truncate text-micro ${
                lead ? 'text-ink' : 'text-ink-muted'
              }`}
            >
              {title}
            </span>
            {/* On a phone the block on the grid right below already states the
                time; the name of the thing you are doing matters more. From
                `sm` up there is room for both — on 다음 too, where "when" is
                half the answer (M9 §4.4-3). */}
            <span className="hidden shrink-0 text-micro font-normal tabular-nums text-ink-muted sm:inline">
              {formatTimeRange(entry.startMin, entry.durationMin)}
            </span>
          </button>
          <button
            type="button"
            data-testid={spendTestId}
            data-card-id={entry.cardId}
            aria-label={`${title} 지출 기록`}
            onClick={() => onSpend(entry)}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-line bg-surface text-ink-muted transition-colors duration-[140ms] ease-quick hover:border-line-strong hover:bg-sunken hover:text-ink"
          >
            <Icon name="receipt" size={16} />
          </button>
        </>
      ) : (
        <span className="min-w-0 flex-1 truncate text-micro font-normal text-ink-faint">
          {fallback}
        </span>
      )}
    </div>
  );
}

/**
 * 「지금 / 다음」 — the two answers to "what am I doing right now" (M7b).
 *
 * A heads-up display, not a warning (M9 §4.4-3): white surface, one hairline,
 * and a single coral rule down its left edge — the same coral as the now line
 * on the grid and nothing else on the screen. The amber it used to wear is
 * reserved for things the user has to go and fix.
 *
 * Only mounted on a day that *is* today; on any other day the honest answer
 * would be a blank one.
 */
export default function NowBar({
  current,
  next,
  gapMin,
  cards,
  columns,
  onSpend,
  onOpen,
}: NowBarProps) {
  const iconOf = (entry?: TimelineEntry): string => {
    const card = entry ? cards[entry.cardId] : undefined;
    return (card ? columns[card.columnId]?.icon : undefined) ?? '📌';
  };
  const titleOf = (entry?: TimelineEntry): string =>
    (entry ? cards[entry.cardId]?.title : undefined) ?? '일정';

  const idleText =
    next && gapMin !== undefined
      ? `지금은 빈 시간 · 다음까지 ${formatDuration(gapMin)}`
      : '지금은 빈 시간';

  return (
    <div
      data-testid="now-bar"
      data-has-current={current ? 'true' : 'false'}
      data-has-next={next ? 'true' : 'false'}
      className="mx-4 mb-2 flex h-11 shrink-0 items-center overflow-hidden rounded-md border border-line bg-surface shadow-raise"
    >
      <span aria-hidden="true" className="h-full w-[3px] shrink-0 bg-now" />

      {/* One reading measure, not one monitor: on a 1920px screen an unbounded
          row parked 지금 and 다음 900px apart and the pair stopped being a
          pair (M9 §4.4-3). */}
      <div className="flex min-w-0 max-w-3xl flex-1 items-center gap-2 px-2">
        <NowLine
          label="지금"
          entry={current}
          fallback={idleText}
          icon={iconOf(current)}
          title={titleOf(current)}
          spendTestId="now-spend"
          lead
          onSpend={onSpend}
          onOpen={onOpen}
        />

        <span aria-hidden="true" className="hidden h-5 w-px shrink-0 bg-line sm:block" />

        <NowLine
          label="다음"
          entry={next}
          fallback="오늘 남은 일정 없음"
          icon={iconOf(next)}
          title={titleOf(next)}
          spendTestId="next-spend"
          onSpend={onSpend}
          onOpen={onOpen}
        />
      </div>
    </div>
  );
}
