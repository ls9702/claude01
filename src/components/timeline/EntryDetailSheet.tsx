import { useState } from 'react';
import type { Card, TimelineEntry } from '../../types/models';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import {
  DAY_MIN,
  MIN_ENTRY_MIN,
  SNAP_MIN,
  formatDuration,
  formatTimeRange,
} from '../../utils/time';
import CardLedger, { type LocalMoney } from '../common/CardLedger';
import CardPhotoStrip from '../common/CardPhotoStrip';
import Sheet from '../common/Sheet';
import Icon from '../common/Icon';
import {
  DANGER_TEXT_BUTTON_CLASS,
  LABEL_CLASS,
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
  SQUARE_BUTTON_CLASS,
  TEXTAREA_CLASS,
} from '../common/formStyles';

interface StepperProps {
  label: string;
  value: string;
  testId: string;
  onStep: (delta: number) => void;
}

/** ±15분 pair around a read-only value — the reliable mobile time editor. */
function Stepper({ label, value, testId, onStep }: StepperProps) {
  return (
    <div>
      <span className={LABEL_CLASS}>{label}</span>
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          data-testid={`${testId}-minus`}
          aria-label={`${label} 15분 줄이기`}
          onClick={() => onStep(-SNAP_MIN)}
          className={SQUARE_BUTTON_CLASS}
        >
          <Icon name="minus" size={16} />
        </button>
        <output
          data-testid={`${testId}-value`}
          className="h-11 flex-1 rounded-md bg-sunken py-3 text-center text-body font-semibold tabular-nums text-ink lg:h-9 lg:py-2"
        >
          {value}
        </output>
        <button
          type="button"
          data-testid={`${testId}-plus`}
          aria-label={`${label} 15분 늘리기`}
          onClick={() => onStep(SNAP_MIN)}
          className={SQUARE_BUTTON_CLASS}
        >
          <Icon name="plus" size={16} />
        </button>
      </div>
    </div>
  );
}

interface EntryDetailSheetProps extends LocalMoney {
  entry: TimelineEntry;
  card?: Card;
  /** Day heading shown in the sheet subtitle. */
  dayTitle: string;
  /** Trip currency, for the 지출 기록 section. Defaults to `KRW`. */
  currency?: string;
  onClose: () => void;
  /** Deletes with an 실행 취소 offer — owned by the view. */
  onDelete: (entry: TimelineEntry) => void;
  /** Jumps to the 보드 tab with this card's trip active. */
  onOpenBoard?: () => void;
}

/**
 * Tap-an-entry detail sheet: card info, note, ±15분 time editors, delete.
 *
 * These steppers are the dependable path on touch devices — dragging a block
 * works, but nudging a start time by a quarter hour with a thumb does not.
 */
export default function EntryDetailSheet({
  entry,
  card,
  dayTitle,
  currency = 'KRW',
  localCurrency,
  fxRate,
  onClose,
  onDelete,
  onOpenBoard,
}: EntryDetailSheetProps) {
  const moveEntry = useWorkspaceStore((s) => s.moveEntry);
  const resizeEntry = useWorkspaceStore((s) => s.resizeEntry);
  const updateEntry = useWorkspaceStore((s) => s.updateEntry);
  const [note, setNote] = useState(entry.note ?? '');

  const stepStart = (delta: number) => {
    const next = Math.min(Math.max(entry.startMin + delta, 0), DAY_MIN - MIN_ENTRY_MIN);
    moveEntry(entry.id, entry.dayId, next);
  };

  const stepDuration = (delta: number) => {
    resizeEntry(entry.id, entry.durationMin + delta);
  };

  const save = () => {
    updateEntry(entry.id, { note: note.trim() || undefined });
    onClose();
  };

  return (
    <Sheet
      title={card?.title ?? '일정'}
      onClose={onClose}
      testId="entry-sheet"
      footer={
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            data-testid="entry-delete"
            onClick={() => onDelete(entry)}
            className={DANGER_TEXT_BUTTON_CLASS}
          >
            삭제
          </button>
          <button
            type="button"
            data-testid="entry-save"
            onClick={save}
            className={`flex-1 ${PRIMARY_BUTTON_CLASS}`}
          >
            저장
          </button>
        </div>
      }
    >
      <div className="space-y-6">
        <p className="text-label font-normal text-ink-muted">
          {dayTitle} ·{' '}
          <span data-testid="entry-range" className="font-semibold tabular-nums text-ink">
            {formatTimeRange(entry.startMin, entry.durationMin)}
          </span>{' '}
          · {formatDuration(entry.durationMin)}
        </p>

        {card?.memo ? (
          <p className="rounded-md bg-sunken px-3 py-2 text-label font-normal text-ink-muted">
            {card.memo}
          </p>
        ) : null}

        <Stepper
          label="시작 시각"
          testId="entry-start"
          value={formatTimeRange(entry.startMin, entry.durationMin).split('–')[0]}
          onStep={stepStart}
        />

        <Stepper
          label="소요 시간"
          testId="entry-duration"
          value={formatDuration(entry.durationMin)}
          onStep={stepDuration}
        />

        <div>
          <label className={LABEL_CLASS} htmlFor="entry-note">
            메모
          </label>
          <textarea
            id="entry-note"
            data-testid="entry-note-input"
            value={note}
            rows={3}
            onChange={(event) => setNote(event.target.value)}
            placeholder="이 시간에 기억해 둘 것"
            className={TEXTAREA_CLASS}
          />
        </div>

        {/* The card owns its money, its thread and its photos, so these are
            the *same* ones the board shows — not a copy. Recording a receipt,
            or a shot of what you are looking at, from the day you are standing
            in is the whole point of 오늘 모드. */}
        {card ? (
          <div className="border-t border-line pt-6">
            <CardPhotoStrip cardId={card.id} />
          </div>
        ) : null}

        {card ? (
          <CardLedger
            card={card}
            currency={currency}
            localCurrency={localCurrency}
            fxRate={fxRate}
          />
        ) : null}

        {onOpenBoard ? (
          <button
            type="button"
            data-testid="entry-open-board"
            onClick={onOpenBoard}
            className={`${SECONDARY_BUTTON_CLASS} w-full`}
          >
            <Icon name="board" size={16} />
            보드에서 열기
          </button>
        ) : null}
      </div>
    </Sheet>
  );
}
