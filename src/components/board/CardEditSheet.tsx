import { useState } from 'react';
import type { Card, GeoPoint } from '../../types/models';
import { formatLatLng } from '../../utils/geo';
import { MAX_AMOUNT, formatBudget, isValidBudget } from '../../utils/money';
import { DURATION_PRESETS, formatDuration } from '../../utils/time';
import { normalizeUrl } from '../../utils/url';
import PinPicker from '../map/PinPicker';
import PlaceSearch from '../map/PlaceSearch';
import CardLedger, { numberOrUndefined, type LocalMoney } from '../common/CardLedger';
import Icon from '../common/Icon';
import Sheet from '../common/Sheet';
import {
  CHIP_BUTTON,
  CHIP_BUTTON_DANGER,
  CHIP_SELECTED,
  DANGER_TEXT_BUTTON_CLASS,
  INPUT_CLASS,
  LABEL_CLASS,
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
  SECTION_TITLE_CLASS,
  TEXTAREA_CLASS,
} from '../common/formStyles';

export interface CardFormValues {
  title: string;
  memo?: string;
  url?: string;
  /** `undefined` takes the card off the map — the store clears the field. */
  location?: GeoPoint;
  budget?: number;
  defaultDurationMin?: number;
}

/** Which location picker is open on top of the sheet, if any. */
type Picker = 'search' | 'pin' | null;

interface CardEditSheetProps extends LocalMoney {
  /** Absent → create mode. */
  card?: Card;
  /** Shown in the header so the user knows which category they are in. */
  columnName: string;
  /** Trip currency, used by the 지출 기록 section. Defaults to `KRW`. */
  currency?: string;
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

/**
 * Create / edit a board card. Mounted only while open.
 *
 * The form is three blocks rather than eight equally-spaced fields (M9 §4.3):
 * 기본 (what it is) · 계획 (what it will cost you) · 기록 (what it did). The
 * 소요 시간 control is **one** chip row: a preset, 직접 입력, or 없음 — never a
 * chip and a number field showing the same value twice.
 */
export default function CardEditSheet({
  card,
  columnName,
  currency = 'KRW',
  localCurrency,
  fxRate,
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
  const [location, setLocation] = useState<GeoPoint | undefined>(card?.location);
  const [picker, setPicker] = useState<Picker>(null);
  /** 직접 입력 is open when the stored value is not one of the presets. */
  const [customOpen, setCustomOpen] = useState(
    () => duration !== undefined && !DURATION_PRESETS.includes(duration),
  );

  const parsedBudget = numberOrUndefined(budget);
  /** A 예산 may be 0 but never negative, and never a slipped extra digit (B18). */
  const budgetOk = isValidBudget(parsedBudget);
  const budgetProblem = budget.trim() !== '' && !budgetOk;
  const canSubmit = title.trim().length > 0 && budgetOk;
  const presetActive = duration !== undefined && DURATION_PRESETS.includes(duration);

  const submit = () => {
    if (!canSubmit) return;
    onSubmit({
      title: title.trim(),
      memo: memo.trim() || undefined,
      // `tabelog.com/tokyo` becomes an absolute link here, once, on the way in
      // — never at render time, where every reader would have to repeat it.
      url: normalizeUrl(url),
      location,
      budget: parsedBudget,
      defaultDurationMin: duration,
    });
  };

  return (
    <Sheet
      title={card ? '카드 수정' : `새 카드 · ${columnName}`}
      onClose={onClose}
      testId="card-form"
      footer={
        <div className="flex items-center justify-between gap-2">
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
            className={`flex-1 ${PRIMARY_BUTTON_CLASS}`}
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
        className="space-y-6"
      >
        <section className="space-y-4">
          <h3 className={SECTION_TITLE_CLASS}>기본</h3>

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
              className={TEXTAREA_CLASS}
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
        </section>

        <section className="space-y-4">
          <h3 className={SECTION_TITLE_CLASS}>계획</h3>

          <div>
            <label className={LABEL_CLASS} htmlFor="card-budget">
              예산
            </label>
            <input
              id="card-budget"
              data-testid="card-budget-input"
              value={budget}
              inputMode="numeric"
              aria-invalid={budgetProblem}
              onChange={(event) => setBudget(event.target.value)}
              placeholder="예) 15000"
              className={`${INPUT_CLASS} ${
                budgetProblem ? 'border-danger focus:border-danger' : ''
              }`}
            />
            {budgetProblem ? (
              <p
                data-testid="card-budget-error"
                className="mt-2 text-micro font-normal text-danger"
              >
                예산은 0 이상 {formatBudget(MAX_AMOUNT, currency)} 이하여야 해요.
              </p>
            ) : null}
          </div>

          <div>
            <span className={LABEL_CLASS}>예상 소요 시간</span>
            <div className="mt-2 flex flex-wrap gap-2">
              {/* 「없음」 leads the row: it is the value the field starts at and
                  the one way back to it, so it reads as the zero of the scale
                  rather than as a sixth preset (M9 §4.3-2). */}
              <button
                type="button"
                data-testid="duration-clear"
                onClick={() => {
                  setCustomOpen(false);
                  setDuration(undefined);
                }}
                className={CHIP_BUTTON}
              >
                <Icon name="close" size={16} />
                없음
              </button>
              {DURATION_PRESETS.map((preset) => {
                const active = duration === preset;
                return (
                  <button
                    key={preset}
                    type="button"
                    data-testid={`duration-chip-${preset}`}
                    aria-pressed={active}
                    onClick={() => {
                      setCustomOpen(false);
                      setDuration(active ? undefined : preset);
                    }}
                    className={active ? CHIP_SELECTED : CHIP_BUTTON}
                  >
                    {formatDuration(preset)}
                  </button>
                );
              })}
              <button
                type="button"
                data-testid="duration-custom-toggle"
                aria-expanded={customOpen}
                onClick={() => setCustomOpen((open) => !open)}
                className={customOpen ? CHIP_SELECTED : CHIP_BUTTON}
              >
                직접 입력
              </button>
            </div>

            {/* Folded away while a preset is doing the talking — one value must
                never be on screen twice (M9 §4.3-1). */}
            {customOpen && !presetActive ? (
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
            ) : null}
          </div>

          <div>
            <span className={LABEL_CLASS}>위치</span>
            <p
              data-testid="card-location-address"
              data-has-location={Boolean(location)}
              data-lat={location?.lat}
              data-lng={location?.lng}
              className={`mt-2 break-words rounded-md bg-sunken px-3 py-2 text-label font-normal ${
                location ? 'text-ink' : 'text-ink-faint'
              }`}
            >
              {location ? (location.address ?? formatLatLng(location.lat, location.lng)) : '없음'}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                data-testid="card-location-search"
                onClick={() => setPicker('search')}
                className={CHIP_BUTTON}
              >
                <Icon name="search" size={16} />
                검색
              </button>
              <button
                type="button"
                data-testid="card-location-pin"
                onClick={() => setPicker('pin')}
                className={CHIP_BUTTON}
              >
                <Icon name="pin" size={16} />
                지도에서 선택
              </button>
              {location ? (
                <button
                  type="button"
                  data-testid="card-location-clear"
                  onClick={() => setLocation(undefined)}
                  className={CHIP_BUTTON_DANGER}
                >
                  <Icon name="close" size={16} />
                  제거
                </button>
              ) : null}
            </div>
          </div>

          {/* An action, not a field — so it looks like one. */}
          {card && onSchedule ? (
            <div className="pt-2">
              <button
                type="button"
                data-testid="card-schedule"
                onClick={onSchedule}
                className={`${SECONDARY_BUTTON_CLASS} w-full`}
              >
                <Icon name="calendar" size={16} />
                시간표에 추가
                {scheduledCount > 0 ? (
                  <span className="rounded-full bg-sunken px-2 text-micro tabular-nums text-ink-muted">
                    {scheduledCount}
                  </span>
                ) : null}
              </button>
            </div>
          ) : null}
        </section>

        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
      </form>

      {card ? (
        <CardLedger
          card={card}
          currency={currency}
          localCurrency={localCurrency}
          fxRate={fxRate}
        />
      ) : (
        <p
          data-testid="card-ledger-hint"
          className="mt-6 border-t border-line pt-6 text-label font-normal text-ink-faint"
        >
          지출과 코멘트는 저장 후 기록할 수 있어요.
        </p>
      )}

      {picker === 'search' ? (
        <PlaceSearch
          initialQuery={title.trim()}
          onPick={setLocation}
          onClose={() => setPicker(null)}
        />
      ) : null}

      {picker === 'pin' ? (
        <PinPicker
          initial={location}
          onPick={(point) => {
            setLocation(point);
            setPicker(null);
          }}
          onClose={() => setPicker(null)}
        />
      ) : null}
    </Sheet>
  );
}
