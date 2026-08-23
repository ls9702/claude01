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
import Sheet from '../common/Sheet';
import {
  DANGER_TEXT_BUTTON_CLASS,
  INPUT_CLASS,
  LABEL_CLASS,
  PRIMARY_BUTTON_CLASS,
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
      <div className="mt-1.5 flex items-center gap-2">
        <button
          type="button"
          data-testid={`${testId}-minus`}
          aria-label={`${label} 15분 줄이기`}
          onClick={() => onStep(-SNAP_MIN)}
          className="h-10 w-11 rounded-xl bg-stone-100 text-lg font-semibold text-stone-600 hover:bg-stone-200"
        >
          −
        </button>
        <output
          data-testid={`${testId}-value`}
          className="flex-1 rounded-xl bg-stone-50 py-2.5 text-center text-sm font-semibold tabular-nums text-stone-800"
        >
          {value}
        </output>
        <button
          type="button"
          data-testid={`${testId}-plus`}
          aria-label={`${label} 15분 늘리기`}
          onClick={() => onStep(SNAP_MIN)}
          className="h-10 w-11 rounded-xl bg-stone-100 text-lg font-semibold text-stone-600 hover:bg-stone-200"
        >
          ＋
        </button>
      </div>
    </div>
  );
}

interface EntryDetailSheetProps {
  entry: TimelineEntry;
  card?: Card;
  /** Day heading shown in the sheet subtitle. */
  dayTitle: string;
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
        <div className="flex items-center gap-2">
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
            className={`ml-auto flex-1 ${PRIMARY_BUTTON_CLASS}`}
          >
            저장
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-xs text-stone-400">
          {dayTitle} ·{' '}
          <span data-testid="entry-range" className="font-semibold tabular-nums text-stone-600">
            {formatTimeRange(entry.startMin, entry.durationMin)}
          </span>{' '}
          · {formatDuration(entry.durationMin)}
        </p>

        {card?.memo ? (
          <p className="rounded-xl bg-stone-50 px-3 py-2.5 text-xs leading-relaxed text-stone-500">
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
            className={`${INPUT_CLASS} resize-none`}
          />
        </div>

        {onOpenBoard ? (
          <button
            type="button"
            data-testid="entry-open-board"
            onClick={onOpenBoard}
            className="w-full rounded-xl bg-stone-100 px-4 py-2.5 text-sm font-medium text-stone-600 hover:bg-stone-200"
          >
            🗂️ 보드에서 열기
          </button>
        ) : null}
      </div>
    </Sheet>
  );
}
