import type { BoardColumn, Card, Id, TimelineEntry } from '../../types/models';
import type { NowNext } from '../../timeline/today';
import { formatDuration, formatTimeRange } from '../../utils/time';

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
  onSpend,
  onOpen,
}: LineProps) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="w-7 shrink-0 text-[10px] font-bold text-stone-400">{label}</span>

      {entry ? (
        <>
          <button
            type="button"
            data-testid={`${spendTestId}-entry`}
            data-entry-id={entry.id}
            onClick={() => onOpen(entry)}
            className="flex min-w-0 flex-1 items-baseline gap-1.5 text-left"
          >
            <span aria-hidden="true" className="shrink-0 text-xs">
              {icon}
            </span>
            <span className="min-w-0 truncate text-xs font-semibold text-stone-800">{title}</span>
            <span className="shrink-0 text-[10px] tabular-nums text-stone-400">
              {formatTimeRange(entry.startMin, entry.durationMin)}
            </span>
          </button>
          <button
            type="button"
            data-testid={spendTestId}
            data-card-id={entry.cardId}
            aria-label={`${title} 지출 기록`}
            onClick={() => onSpend(entry)}
            className="shrink-0 rounded-full bg-white px-2 py-1 text-xs shadow-sm transition-colors hover:bg-amber-50"
          >
            💸
          </button>
        </>
      ) : (
        <span className="min-w-0 flex-1 truncate text-xs text-stone-400">{fallback}</span>
      )}
    </div>
  );
}

/**
 * 「지금 / 다음」 — the two lines that answer "what am I doing right now" (M7b).
 *
 * Only mounted on a day that *is* today, above the grid: it is a heads-up
 * display, not a summary, and on any other day the honest answer would be a
 * blank one. Each line that has an entry carries a 💸 so recording money never
 * costs more than two taps.
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
    return (card ? columns[card.columnId]?.icon : undefined) ?? '🗓';
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
      className="mx-4 mb-2 space-y-1 rounded-xl border border-amber-200 bg-amber-50/70 px-2.5 py-2"
    >
      <NowLine
        label="지금"
        entry={current}
        fallback={idleText}
        icon={iconOf(current)}
        title={titleOf(current)}
        spendTestId="now-spend"
        onSpend={onSpend}
        onOpen={onOpen}
      />
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
  );
}
