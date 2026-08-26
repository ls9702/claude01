import { useState } from 'react';
import type { GeoPoint, Trip } from '../../types/models';
import { formatLatLng, shortPlace } from '../../utils/geo';
import { CURRENCIES } from '../../utils/money';
import PlaceSearch from '../map/PlaceSearch';
import Sheet from '../common/Sheet';
import Icon from '../common/Icon';
import {
  CHIP_BUTTON,
  CHIP_BUTTON_DANGER,
  INPUT_CLASS,
  LABEL_CLASS,
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
  withoutMarginTop,
} from '../common/formStyles';

export interface TripFormValues {
  title: string;
  currency: string;
  /** 현지 통화 (선택) — absent clears the pair. */
  localCurrency?: string;
  /** 기준통화 per 1 local unit. Absent (or ≤ 0) clears the pair. */
  fxRate?: number;
  /** 목적지 (선택) — absent takes the trip off the map's default view (M12). */
  destination?: GeoPoint;
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
  const [localCurrency, setLocalCurrency] = useState(trip?.localCurrency ?? '');
  const [rate, setRate] = useState(trip?.fxRate != null ? String(trip.fxRate) : '');
  // Opens itself for a trip that already uses the pair, stays folded otherwise.
  const [localOpen, setLocalOpen] = useState(Boolean(trip?.localCurrency));
  const [destination, setDestination] = useState<GeoPoint | undefined>(trip?.destination);
  /** True while 장소 검색 is stacked on top of this sheet. */
  const [searching, setSearching] = useState(false);

  const canSubmit = title.trim().length > 0;
  const parsedRate = Number(rate.trim().replace(/,/g, ''));
  const usableRate = Number.isFinite(parsedRate) && parsedRate > 0 ? parsedRate : undefined;
  /** Both halves or neither — half a conversion is worse than none. */
  const pairIsSet = Boolean(localCurrency) && usableRate !== undefined;
  /**
   * `0`, `-5`, `abc`: typed, and unusable. The example line used to answer with
   * the placeholder `9.3` as though the input had been accepted, while 저장
   * quietly threw the pair away (B19).
   */
  const rateProblem = rate.trim() !== '' && usableRate === undefined;

  const submit = () => {
    if (!canSubmit) return;
    onSubmit({
      title: title.trim(),
      currency,
      localCurrency: pairIsSet ? localCurrency : undefined,
      fxRate: pairIsSet ? usableRate : undefined,
      destination,
    });
  };

  return (
    <Sheet
      title={trip ? '여행 수정' : '새 여행'}
      onClose={onClose}
      testId="trip-form"
      footer={
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className={`flex-1 ${SECONDARY_BUTTON_CLASS}`}>
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
        className="space-y-6"
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
          <span className={LABEL_CLASS}>목적지 (선택)</span>
          <p
            data-testid="trip-destination"
            data-has={Boolean(destination)}
            data-lat={destination?.lat}
            data-lng={destination?.lng}
            title={destination?.address ?? ''}
            className={`mt-2 break-words rounded-md bg-sunken px-3 py-2 text-label font-normal ${
              destination ? 'text-ink' : 'text-ink-faint'
            }`}
          >
            {destination
              ? shortPlace(destination.address ?? formatLatLng(destination.lat, destination.lng))
              : '없음'}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              data-testid="trip-destination-search"
              onClick={() => setSearching(true)}
              className={CHIP_BUTTON}
            >
              <Icon name="search" size={16} />
              검색
            </button>
            {destination ? (
              <button
                type="button"
                data-testid="trip-destination-clear"
                onClick={() => setDestination(undefined)}
                className={CHIP_BUTTON_DANGER}
              >
                <Icon name="close" size={16} />
                제거
              </button>
            ) : null}
          </div>
          <p className="mt-2 text-micro font-normal text-ink-faint">
            지도를 열면 이 근처를 먼저 보여줘요.
          </p>
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
          <p className="mt-2 text-micro font-normal text-ink-faint">
            카드 예산을 이 통화로 표시해요.
          </p>
        </div>

        <div className="rounded-md border border-line">
          <button
            type="button"
            data-testid="trip-local-toggle"
            aria-expanded={localOpen}
            data-open={localOpen ? 'true' : 'false'}
            onClick={() => setLocalOpen((open) => !open)}
            className="flex h-11 w-full items-center justify-between gap-2 px-3 text-left"
          >
            <span className="text-label font-semibold text-ink">현지 통화 (선택)</span>
            <span className="flex items-center gap-1 text-label font-normal text-ink-muted">
              {pairIsSet ? `${localCurrency} · ${usableRate}` : '없음'}
              <Icon name={localOpen ? 'chevron-up' : 'chevron-down'} size={16} />
            </span>
          </button>

          {localOpen ? (
            <div className="space-y-2 border-t border-line px-3 pb-3 pt-2">
              <select
                data-testid="trip-local-currency-select"
                aria-label="현지 통화"
                value={localCurrency}
                onChange={(event) => setLocalCurrency(event.target.value)}
                className={withoutMarginTop(INPUT_CLASS)}
              >
                <option value="">사용 안 함</option>
                {CURRENCIES.filter((option) => option.code !== currency).map((option) => (
                  <option key={option.code} value={option.code}>
                    {option.label}
                  </option>
                ))}
              </select>

              <input
                data-testid="trip-local-rate-input"
                aria-label="환율"
                value={rate}
                inputMode="decimal"
                aria-invalid={rateProblem}
                onChange={(event) => setRate(event.target.value)}
                placeholder="예) 9.3"
                className={`${withoutMarginTop(INPUT_CLASS)} ${
                  rateProblem ? 'border-danger focus:border-danger' : ''
                }`}
              />

              <p
                data-testid="trip-local-example"
                data-invalid={rateProblem ? 'true' : 'false'}
                className={`text-micro font-normal ${
                  rateProblem ? 'text-danger' : 'text-ink-faint'
                }`}
              >
                {rateProblem ? (
                  '환율을 확인해 주세요'
                ) : (
                  <>
                    1 {localCurrency || 'JPY'} = {usableRate ?? 9.3} {currency}
                  </>
                )}
                <br />
                지출을 현지 금액으로 적으면 이 환율로 환산해서 저장해요. 이미 적어둔 지출은
                그대로 남아요.
              </p>
            </div>
          ) : null}
        </div>

        {/* Lets Enter submit without showing a second button. */}
        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
      </form>

      {/* The same modal the card sheet uses — a 목적지 is just a GeoPoint. */}
      {searching ? (
        <PlaceSearch
          initialQuery={title.trim()}
          // 이미 목적지가 있다면(고치는 중) 그게 곧 문맥이고, 없으면 문맥도
          // 없다 — 여기서 찾는 것이 바로 그 목적지다 (M28).
          destination={destination?.address}
          onPick={setDestination}
          onClose={() => setSearching(false)}
        />
      ) : null}
    </Sheet>
  );
}
