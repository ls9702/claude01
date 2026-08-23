import { useState } from 'react';
import type { Card } from '../../types/models';
import { DURATION_PRESETS, formatDuration } from '../../utils/time';
import Sheet from '../common/Sheet';
import {
  DANGER_TEXT_BUTTON_CLASS,
  INPUT_CLASS,
  LABEL_CLASS,
  PRIMARY_BUTTON_CLASS,
} from '../common/formStyles';

export interface CardFormValues {
  title: string;
  memo?: string;
  url?: string;
  budget?: number;
  defaultDurationMin?: number;
}

interface CardEditSheetProps {
  /** Absent → create mode. */
  card?: Card;
  /** Shown in the header so the user knows which category they are in. */
  columnName: string;
  /** Timeline entries this card already has; shown next to 시간표에 추가. */
  scheduledCount?: number;
  onSubmit: (values: CardFormValues) => void;
  /**
   * Opens the schedule sheet. This is the dependable way onto the timeline on
   * touch devices, where the desktop rail-to-grid drag is not available.
   */
  onSchedule?: () => void;
  onDelete?: () => void;
  onClose: () => void;
}

const numberOrUndefined = (raw: string): number | undefined => {
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;
  const value = Number(trimmed.replace(/,/g, ''));
  return Number.isFinite(value) ? value : undefined;
};

/** Create / edit a board card. Mounted only while open. */
export default function CardEditSheet({
  card,
  columnName,
  scheduledCount = 0,
  onSubmit,
  onSchedule,
  onDelete,
  onClose,
}: CardEditSheetProps) {
  const [title, setTitle] = useState(card?.title ?? '');
  const [memo, setMemo] = useState(card?.memo ?? '');
  const [url, setUrl] = useState(card?.url ?? '');
  const [budget, setBudget] = useState(card?.budget != null ? String(card.budget) : '');
  const [duration, setDuration] = useState<number | undefined>(card?.defaultDurationMin);

  const canSubmit = title.trim().length > 0;

  const submit = () => {
    if (!canSubmit) return;
    onSubmit({
      title: title.trim(),
      memo: memo.trim() || undefined,
      url: url.trim() || undefined,
      budget: numberOrUndefined(budget),
      defaultDurationMin: duration,
    });
  };

  return (
    <Sheet
      title={card ? '카드 수정' : `새 카드 · ${columnName}`}
      onClose={onClose}
      testId="card-form"
      footer={
        <div className="flex items-center gap-2">
          {card && onDelete ? (
            <button
              type="button"
              data-testid="card-delete"
              onClick={onDelete}
              className={DANGER_TEXT_BUTTON_CLASS}
            >
              삭제
            </button>
          ) : null}
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            data-testid="card-submit"
            className={`ml-auto flex-1 ${PRIMARY_BUTTON_CLASS}`}
          >
            {card ? '저장' : '추가'}
          </button>
        </div>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        className="space-y-4"
      >
        <div>
          <label className={LABEL_CLASS} htmlFor="card-title">
            제목
          </label>
          <input
            id="card-title"
            data-testid="card-title-input"
            value={title}
            autoFocus
            onChange={(event) => setTitle(event.target.value)}
            placeholder="예) 츠텐카쿠 전망대"
            className={INPUT_CLASS}
          />
        </div>

        <div>
          <label className={LABEL_CLASS} htmlFor="card-memo">
            메모
          </label>
          <textarea
            id="card-memo"
            data-testid="card-memo-input"
            value={memo}
            rows={3}
            onChange={(event) => setMemo(event.target.value)}
            placeholder="기억해 둘 것"
            className={`${INPUT_CLASS} resize-none`}
          />
        </div>

        <div>
          <label className={LABEL_CLASS} htmlFor="card-url">
            링크
          </label>
          <input
            id="card-url"
            data-testid="card-url-input"
            value={url}
            inputMode="url"
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://"
            className={INPUT_CLASS}
          />
        </div>

        <div>
          <label className={LABEL_CLASS} htmlFor="card-budget">
            예산
          </label>
          <input
            id="card-budget"
            data-testid="card-budget-input"
            value={budget}
            inputMode="numeric"
            onChange={(event) => setBudget(event.target.value)}
            placeholder="예) 15000"
            className={INPUT_CLASS}
          />
        </div>

        <div>
          <span className={LABEL_CLASS}>예상 소요 시간</span>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {DURATION_PRESETS.map((preset) => {
              const active = duration === preset;
              return (
                <button
                  key={preset}
                  type="button"
                  data-testid={`duration-chip-${preset}`}
                  aria-pressed={active}
                  onClick={() => setDuration(active ? undefined : preset)}
                  className={[
                    'rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
                    active
                      ? 'bg-stone-800 text-white'
                      : 'bg-stone-100 text-stone-500 hover:bg-stone-200',
                  ].join(' ')}
                >
                  {formatDuration(preset)}
                </button>
              );
            })}
            <button
              type="button"
              data-testid="duration-clear"
              onClick={() => setDuration(undefined)}
              className="rounded-full px-3 py-1.5 text-xs font-medium text-stone-400 hover:bg-stone-100"
            >
              없음
            </button>
          </div>
          <input
            data-testid="card-duration-custom"
            aria-label="직접 입력 (분)"
            value={duration ?? ''}
            inputMode="numeric"
            onChange={(event) => {
              const value = numberOrUndefined(event.target.value);
              setDuration(value != null && value >= 0 ? Math.round(value) : undefined);
            }}
            placeholder="직접 입력 (분)"
            className={INPUT_CLASS}
          />
        </div>

        {card && onSchedule ? (
          <button
            type="button"
            data-testid="card-schedule"
            onClick={onSchedule}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-stone-100 px-4 py-2.5 text-sm font-medium text-stone-600 transition-colors hover:bg-stone-200"
          >
            🗓 시간표에 추가
            {scheduledCount > 0 ? (
              <span className="rounded-full bg-white px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-stone-500">
                {scheduledCount}
              </span>
            ) : null}
          </button>
        ) : null}

        <p className="rounded-xl bg-stone-50 px-3 py-2.5 text-xs leading-relaxed text-stone-400">
          📍 위치는 지도 탭에서 추가할 수 있어요. (준비 중)
        </p>

        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
      </form>
    </Sheet>
  );
}
