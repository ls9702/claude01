import { useState } from 'react';
import type { Trip } from '../../types/models';
import { CURRENCIES } from '../../utils/money';
import Sheet from '../common/Sheet';
import {
  GHOST_BUTTON_CLASS,
  INPUT_CLASS,
  LABEL_CLASS,
  PRIMARY_BUTTON_CLASS,
} from '../common/formStyles';

export interface TripFormValues {
  title: string;
  currency: string;
}

interface TripFormDialogProps {
  /** Absent → create mode. */
  trip?: Trip;
  onSubmit: (values: TripFormValues) => void;
  onClose: () => void;
}

/** Create / rename a trip. Mounted only while open. */
export default function TripFormDialog({ trip, onSubmit, onClose }: TripFormDialogProps) {
  const [title, setTitle] = useState(trip?.title ?? '');
  const [currency, setCurrency] = useState(trip?.currency ?? 'KRW');
  const canSubmit = title.trim().length > 0;

  const submit = () => {
    if (!canSubmit) return;
    onSubmit({ title: title.trim(), currency });
  };

  return (
    <Sheet
      title={trip ? '여행 수정' : '새 여행'}
      onClose={onClose}
      testId="trip-form"
      footer={
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className={`flex-1 ${GHOST_BUTTON_CLASS}`}>
            취소
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            data-testid="trip-submit"
            className={`flex-1 ${PRIMARY_BUTTON_CLASS}`}
          >
            {trip ? '저장' : '만들기'}
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
          <label className={LABEL_CLASS} htmlFor="trip-title">
            여행 이름
          </label>
          <input
            id="trip-title"
            data-testid="trip-title-input"
            value={title}
            autoFocus
            onChange={(event) => setTitle(event.target.value)}
            placeholder="예) 3월 오사카"
            className={INPUT_CLASS}
          />
        </div>

        <div>
          <label className={LABEL_CLASS} htmlFor="trip-currency">
            예산 통화
          </label>
          <select
            id="trip-currency"
            data-testid="trip-currency-select"
            value={currency}
            onChange={(event) => setCurrency(event.target.value)}
            className={INPUT_CLASS}
          >
            {CURRENCIES.map((option) => (
              <option key={option.code} value={option.code}>
                {option.label}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-xs text-stone-400">카드 예산을 이 통화로 표시해요.</p>
        </div>

        {/* Lets Enter submit without showing a second button. */}
        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
      </form>
    </Sheet>
  );
}
