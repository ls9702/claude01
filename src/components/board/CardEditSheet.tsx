import { useState, type KeyboardEvent } from 'react';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import type { Card, GeoPoint } from '../../types/models';
import { formatLatLng } from '../../utils/geo';
import { formatBudget } from '../../utils/money';
import { cardSpent } from '../../utils/spend';
import { DURATION_PRESETS, formatDuration, formatStamp } from '../../utils/time';
import PinPicker from '../map/PinPicker';
import PlaceSearch from '../map/PlaceSearch';
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
  /** `undefined` takes the card off the map — the store clears the field. */
  location?: GeoPoint;
  budget?: number;
  defaultDurationMin?: number;
}

/** Which location picker is open on top of the sheet, if any. */
type Picker = 'search' | 'pin' | null;

interface CardEditSheetProps {
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

const numberOrUndefined = (raw: string): number | undefined => {
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;
  const value = Number(trimmed.replace(/,/g, ''));
  return Number.isFinite(value) ? value : undefined;
};

/**
 * 지출 기록 / 코멘트 (M6).
 *
 * These two sections are the one part of the sheet that does **not** go through
 * the form: they call the store the moment the user taps 추가, so a receipt
 * jotted down on the spot is saved even if the sheet is dismissed without 저장.
 * That is also why they only exist in edit mode — there is no card to hang them
 * on until the first 추가 has happened.
 */
function CardLedger({ card, currency }: { card: Card; currency: string }) {
  const live = useWorkspaceStore((s) => s.workspace.cards[card.id]);
  const addExpense = useWorkspaceStore((s) => s.addExpense);
  const removeExpense = useWorkspaceStore((s) => s.removeExpense);
  const addComment = useWorkspaceStore((s) => s.addComment);
  const removeComment = useWorkspaceStore((s) => s.removeComment);

  const [amount, setAmount] = useState('');
  const [label, setLabel] = useState('');
  const [comment, setComment] = useState('');

  const expenses = live?.expenses ?? [];
  const comments = live?.comments ?? [];
  const total = cardSpent(live);
  const parsedAmount = numberOrUndefined(amount);
  const canAddExpense = parsedAmount != null;
  const canAddComment = comment.trim().length > 0;

  const submitExpense = () => {
    if (parsedAmount == null) return;
    addExpense(card.id, parsedAmount, label);
    setAmount('');
    setLabel('');
  };

  const submitComment = () => {
    if (!canAddComment) return;
    addComment(card.id, comment);
    setComment('');
  };

  /** These inputs live outside the card form, so Enter needs wiring by hand. */
  const onEnter = (run: () => void) => (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    run();
  };

  return (
    <div className="mt-5 space-y-5 border-t border-stone-100 pt-4">
      <section>
        <div className="flex items-baseline justify-between gap-2">
          <span className={LABEL_CLASS}>지출 기록</span>
          <span
            data-testid="card-expense-total"
            data-total={total}
            className="text-xs font-semibold tabular-nums text-stone-600"
          >
            합계 {formatBudget(total, currency)}
          </span>
        </div>

        {expenses.length > 0 ? (
          <ul className="mt-1.5 space-y-1">
            {expenses.map((expense) => (
              <li
                key={expense.id}
                data-testid="card-expense-row"
                data-expense-id={expense.id}
                data-amount={expense.amount}
                className="flex items-center gap-2 rounded-xl bg-stone-50 px-3 py-2"
              >
                <span className="min-w-0 flex-1 truncate text-xs text-stone-600">
                  {expense.label?.trim() || '지출'}
                </span>
                <span className="shrink-0 text-xs font-semibold tabular-nums text-stone-700">
                  {formatBudget(expense.amount, currency)}
                </span>
                <span className="shrink-0 text-[10px] tabular-nums text-stone-400">
                  {formatStamp(expense.at)}
                </span>
                <button
                  type="button"
                  data-testid="card-expense-remove"
                  aria-label="지출 삭제"
                  onClick={() => removeExpense(card.id, expense.id)}
                  className="-mr-1 shrink-0 rounded-full px-1.5 py-0.5 text-xs text-stone-300 hover:bg-rose-50 hover:text-rose-500"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1.5 rounded-xl bg-stone-50 px-3 py-2.5 text-xs text-stone-400">
            아직 기록한 지출이 없어요.
          </p>
        )}

        <div className="mt-1.5 flex items-center gap-1.5">
          <input
            data-testid="card-expense-amount-input"
            aria-label="금액"
            value={amount}
            inputMode="numeric"
            onChange={(event) => setAmount(event.target.value)}
            onKeyDown={onEnter(submitExpense)}
            placeholder="금액"
            className={`${INPUT_CLASS} mt-0 w-24 shrink-0`}
          />
          <input
            data-testid="card-expense-label-input"
            aria-label="내용"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            onKeyDown={onEnter(submitExpense)}
            placeholder="내용 (선택)"
            className={`${INPUT_CLASS} mt-0 min-w-0 flex-1`}
          />
          <button
            type="button"
            data-testid="card-expense-add"
            onClick={submitExpense}
            disabled={!canAddExpense}
            className="shrink-0 rounded-xl bg-stone-800 px-3 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-stone-900 disabled:bg-stone-200 disabled:text-stone-400"
          >
            추가
          </button>
        </div>
      </section>

      <section>
        <div className="flex items-baseline justify-between gap-2">
          <span className={LABEL_CLASS}>코멘트</span>
          <span
            data-testid="card-comment-count"
            data-count={comments.length}
            className="text-xs tabular-nums text-stone-400"
          >
            {comments.length}개
          </span>
        </div>

        {comments.length > 0 ? (
          <ul className="mt-1.5 max-h-48 space-y-1 overflow-y-auto">
            {comments.map((entry) => (
              <li
                key={entry.id}
                data-testid="card-comment-row"
                data-comment-id={entry.id}
                className="flex items-start gap-2 rounded-xl bg-stone-50 px-3 py-2"
              >
                <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-xs leading-relaxed text-stone-600">
                  {entry.text}
                </span>
                <span className="shrink-0 pt-0.5 text-[10px] tabular-nums text-stone-400">
                  {formatStamp(entry.at)}
                </span>
                <button
                  type="button"
                  data-testid="card-comment-remove"
                  aria-label="코멘트 삭제"
                  onClick={() => removeComment(card.id, entry.id)}
                  className="-mr-1 shrink-0 rounded-full px-1.5 py-0.5 text-xs text-stone-300 hover:bg-rose-50 hover:text-rose-500"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1.5 rounded-xl bg-stone-50 px-3 py-2.5 text-xs text-stone-400">
            첫 코멘트를 남겨보세요.
          </p>
        )}

        <div className="mt-1.5 flex items-center gap-1.5">
          <input
            data-testid="card-comment-input"
            aria-label="코멘트"
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            onKeyDown={onEnter(submitComment)}
            placeholder="한 줄 남기기"
            className={`${INPUT_CLASS} mt-0 min-w-0 flex-1`}
          />
          <button
            type="button"
            data-testid="card-comment-add"
            onClick={submitComment}
            disabled={!canAddComment}
            className="shrink-0 rounded-xl bg-stone-800 px-3 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-stone-900 disabled:bg-stone-200 disabled:text-stone-400"
          >
            등록
          </button>
        </div>
      </section>
    </div>
  );
}

/** Create / edit a board card. Mounted only while open. */
export default function CardEditSheet({
  card,
  columnName,
  currency = 'KRW',
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

  const canSubmit = title.trim().length > 0;

  const submit = () => {
    if (!canSubmit) return;
    onSubmit({
      title: title.trim(),
      memo: memo.trim() || undefined,
      url: url.trim() || undefined,
      location,
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

        <div>
          <span className={LABEL_CLASS}>위치</span>
          <p
            data-testid="card-location-address"
            data-has-location={Boolean(location)}
            data-lat={location?.lat}
            data-lng={location?.lng}
            className={`mt-1.5 break-words rounded-xl bg-stone-50 px-3 py-2.5 text-xs leading-relaxed ${
              location ? 'text-stone-600' : 'text-stone-400'
            }`}
          >
            {location
              ? (location.address ?? formatLatLng(location.lat, location.lng))
              : '없음'}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <button
              type="button"
              data-testid="card-location-search"
              onClick={() => setPicker('search')}
              className="rounded-full bg-stone-100 px-3 py-1.5 text-xs font-medium text-stone-600 transition-colors hover:bg-stone-200"
            >
              🔍 검색
            </button>
            <button
              type="button"
              data-testid="card-location-pin"
              onClick={() => setPicker('pin')}
              className="rounded-full bg-stone-100 px-3 py-1.5 text-xs font-medium text-stone-600 transition-colors hover:bg-stone-200"
            >
              📍 지도에서 선택
            </button>
            {location ? (
              <button
                type="button"
                data-testid="card-location-clear"
                onClick={() => setLocation(undefined)}
                className="rounded-full px-3 py-1.5 text-xs font-medium text-rose-500 transition-colors hover:bg-rose-50"
              >
                ✕ 제거
              </button>
            ) : null}
          </div>
        </div>

        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
      </form>

      {card ? (
        <CardLedger card={card} currency={currency} />
      ) : (
        <p
          data-testid="card-ledger-hint"
          className="mt-5 border-t border-stone-100 pt-4 text-xs text-stone-400"
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
