import { useEffect, useState, type KeyboardEvent } from 'react';
import { isProfileId, useProfileStore } from '../../profile/profile';
import { cardReadKey, latestCommentStamp } from '../../read/readState';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import type { Card, Id } from '../../types/models';
import { MAX_AMOUNT, formatBudget, formatLocalAmount, isValidExpenseAmount } from '../../utils/money';
import { cardSpent } from '../../utils/spend';
import { formatStamp } from '../../utils/time';
import Avatar from './Avatar';
import Icon from './Icon';
import {
  CHIP_BUTTON_QUIET,
  CHIP_SELECTED,
  INLINE_INPUT_CLASS,
  PRIMARY_BUTTON_CLASS,
  SECTION_TITLE_CLASS,
} from './formStyles';

/** `"12,000"` → `12000`; blank or garbled → `undefined`. */
export const numberOrUndefined = (raw: string): number | undefined => {
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;
  const value = Number(trimmed.replace(/,/g, ''));
  return Number.isFinite(value) ? value : undefined;
};

/** The trip's 현지 통화 pair, when it has one. */
export interface LocalMoney {
  /** e.g. `JPY`. */
  localCurrency?: string;
  /** 기준통화 per 1 local unit, e.g. `9.3` KRW per JPY. */
  fxRate?: number;
}

/**
 * Who wrote this row (M13) — an 18px avatar in front of the text.
 *
 * In front, not behind: two people splitting a bill scan the *left* edge of the
 * list to see whose receipts these are. A row written before M13 (or by a
 * device that never picked a profile) carries no `by` and gets nothing at all —
 * a placeholder would be a third identity nobody has.
 */
function LedgerAuthor({ by, className = '' }: { by?: string; className?: string }) {
  if (!isProfileId(by)) return null;
  return (
    <span data-testid="ledger-author" data-profile={by} className={`shrink-0 ${className}`}>
      <Avatar id={by} size="sm" />
    </span>
  );
}

/** True when both halves are usable — a rate of 0 is not a rate. */
const hasLocal = (money: LocalMoney): boolean =>
  Boolean(money.localCurrency) && Number.isFinite(money.fxRate) && (money.fxRate as number) > 0;

interface ExpenseInputRowProps extends LocalMoney {
  cardId: Id;
  /** Trip currency — what actually gets stored. */
  currency: string;
  autoFocus?: boolean;
  /** Fired after a receipt was written to the store. */
  onAdded?: (expenseId: Id) => void;
}

/**
 * The one row that records money: 금액 · 내용 · 추가, plus the [현지|기준]
 * toggle when the trip carries a 현지 통화 (M7b).
 *
 * Shared by the card ledger and by the timeline's 2-tap quick sheet, so a
 * receipt is entered exactly the same way wherever it is entered.
 *
 * The conversion happens **once, on the way in**: the stored amount is the
 * trip's own currency and the local figure survives as the label prefix
 * (`¥1,200 라멘`). Nothing is ever recomputed from a rate that changed later.
 */
export function ExpenseInputRow({
  cardId,
  currency,
  localCurrency,
  fxRate,
  autoFocus = false,
  onAdded,
}: ExpenseInputRowProps) {
  const addExpense = useWorkspaceStore((s) => s.addExpense);
  const local = hasLocal({ localCurrency, fxRate });

  const [amount, setAmount] = useState('');
  const [label, setLabel] = useState('');
  const [inLocal, setInLocal] = useState(local);

  const parsed = numberOrUndefined(amount);
  const useLocal = local && inLocal;
  const converted = useLocal && parsed != null ? Math.round(parsed * (fxRate as number)) : null;
  /**
   * `0`, `-8000` and `1e9` all used to sail straight into the ledger (B18).
   * The check runs on what will actually be **stored**, so a 현지 금액 is judged
   * after conversion — that is the number the chips and the 결산 will add up.
   */
  const valid = isValidExpenseAmount(useLocal ? (converted ?? undefined) : parsed);
  /** Say why, but only once the user has typed something to be wrong about. */
  const problem = amount.trim() !== '' && !valid;

  const submit = () => {
    if (parsed == null || !valid) return;
    const trimmed = label.trim();

    let finalAmount = parsed;
    let finalLabel = trimmed;
    if (useLocal) {
      finalAmount = Math.round(parsed * (fxRate as number));
      const prefix = formatLocalAmount(parsed, localCurrency as string);
      finalLabel = trimmed ? `${prefix} ${trimmed}` : prefix;
    }

    const expenseId = addExpense(cardId, finalAmount, finalLabel || undefined);
    setAmount('');
    setLabel('');
    if (expenseId) onAdded?.(expenseId);
  };

  /** These inputs live outside any form, so Enter needs wiring by hand. */
  const onEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    submit();
  };

  const modeButton = (mode: 'local' | 'base', text: string) => {
    const active = mode === 'local' ? inLocal : !inLocal;
    return (
      <button
        type="button"
        data-testid={`expense-mode-${mode}`}
        data-active={active ? 'true' : 'false'}
        aria-pressed={active}
        onClick={() => setInLocal(mode === 'local')}
        className={active ? CHIP_SELECTED : CHIP_BUTTON_QUIET}
      >
        {text}
      </button>
    );
  };

  return (
    <div className="mt-2">
      {local ? (
        <div
          data-testid="expense-mode-toggle"
          data-mode={inLocal ? 'local' : 'base'}
          className="mb-2 inline-flex w-fit items-center gap-1 rounded-full bg-sunken p-1"
        >
          {modeButton('local', `현지 ${localCurrency}`)}
          {modeButton('base', `기준 ${currency}`)}
        </div>
      ) : null}

      <div className="flex items-center gap-2">
        <input
          data-testid="card-expense-amount-input"
          aria-label="금액"
          value={amount}
          autoFocus={autoFocus}
          inputMode="numeric"
          onChange={(event) => setAmount(event.target.value)}
          onKeyDown={onEnter}
          aria-invalid={problem}
          placeholder={useLocal ? `금액 (${localCurrency})` : '금액'}
          className={`${INLINE_INPUT_CLASS} w-28 shrink-0 ${
            problem ? 'border-danger focus:border-danger' : ''
          }`}
        />
        <input
          data-testid="card-expense-label-input"
          aria-label="내용"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          onKeyDown={onEnter}
          placeholder="내용 (선택)"
          className={`${INLINE_INPUT_CLASS} min-w-0 flex-1`}
        />
        <button
          type="button"
          data-testid="card-expense-add"
          onClick={submit}
          disabled={!valid}
          className={`${PRIMARY_BUTTON_CLASS} shrink-0`}
        >
          추가
        </button>
      </div>

      {problem ? (
        <p data-testid="expense-amount-error" className="mt-2 text-micro font-normal text-danger">
          금액은 0보다 크고 {formatBudget(MAX_AMOUNT, currency)} 이하여야 해요.
        </p>
      ) : null}

      {converted != null ? (
        <p
          data-testid="expense-converted"
          data-amount={converted}
          className="mt-2 text-micro font-normal tabular-nums text-ink-faint"
        >
          ≈ {formatBudget(converted, currency)}
        </p>
      ) : null}
    </div>
  );
}

interface CardLedgerProps extends LocalMoney {
  card: Card;
  currency: string;
  /** Hide the 코멘트 half — the ledger is then just the receipts. */
  showComments?: boolean;
}

/**
 * 지출 기록 / 코멘트 of one card (M6, promoted to a shared module in M7b).
 *
 * These two sections are the one part of any sheet that does **not** go through
 * a form: they call the store the moment the user taps 추가, so a receipt
 * jotted down on the spot is saved even if the sheet is dismissed. Because the
 * money lives on the *card*, the very same component can hang off the board's
 * card editor and off a timeline entry's detail sheet and show one truth.
 */
export default function CardLedger({
  card,
  currency,
  localCurrency,
  fxRate,
  showComments = true,
}: CardLedgerProps) {
  const live = useWorkspaceStore((s) => s.workspace.cards[card.id]);
  const removeExpense = useWorkspaceStore((s) => s.removeExpense);
  const addComment = useWorkspaceStore((s) => s.addComment);
  const removeComment = useWorkspaceStore((s) => s.removeComment);
  const markRead = useWorkspaceStore((s) => s.markRead);
  const profileId = useProfileStore((s) => s.profileId);

  const [comment, setComment] = useState('');

  const expenses = live?.expenses ?? [];
  const comments = live?.comments ?? [];

  /**
   * 이 카드의 코멘트를 어디까지 봤는지 남긴다 (M24) — 보드의 NEW 표시를 끄는 쪽.
   *
   * 시트가 열려 있는 동안 이 컴포넌트가 곧 「카드를 보고 있다」이므로, 보드에서
   * 열든 오늘 모드의 엔트리 상세에서 열든 한 자리에서 끝난다. 코멘트가 없는
   * 카드는 찍지 않는다: 읽을 것이 없는 카드의 키는 `seenBy`에 자리만 차지한다.
   */
  useEffect(() => {
    // 코멘트를 감춘 자리(지출만 받는 변종)에서는 읽은 것이 없다.
    if (!showComments || !profileId) return;
    const at = latestCommentStamp(live);
    if (at > 0) markRead(cardReadKey(card.id, profileId), at);
  }, [card.id, live, markRead, profileId, showComments]);
  const total = cardSpent(live);
  const canAddComment = comment.trim().length > 0;

  const submitComment = () => {
    if (!canAddComment) return;
    addComment(card.id, comment);
    setComment('');
  };

  return (
    <div className="mt-6 space-y-6 border-t border-line pt-6">
      <section>
        <div className="flex items-baseline justify-between gap-2">
          <h3 className={SECTION_TITLE_CLASS}>지출 기록</h3>
          <span
            data-testid="card-expense-total"
            data-total={total}
            className="text-label font-semibold tabular-nums text-ink"
          >
            합계 {formatBudget(total, currency)}
          </span>
        </div>

        {expenses.length > 0 ? (
          <ul className="mt-2 space-y-1">
            {expenses.map((expense) => (
              <li
                key={expense.id}
                data-testid="card-expense-row"
                data-expense-id={expense.id}
                data-amount={expense.amount}
                className="flex h-11 items-center gap-2 rounded-md bg-sunken px-3"
              >
                <LedgerAuthor by={expense.by} />
                <span className="min-w-0 flex-1 truncate text-label font-normal text-ink">
                  {expense.label?.trim() || '지출'}
                </span>
                <span className="shrink-0 text-label font-semibold tabular-nums text-ink">
                  {formatBudget(expense.amount, currency)}
                </span>
                <span className="shrink-0 text-micro font-normal tabular-nums text-ink-faint">
                  {formatStamp(expense.at)}
                </span>
                <button
                  type="button"
                  data-testid="card-expense-remove"
                  aria-label="지출 삭제"
                  onClick={() => removeExpense(card.id, expense.id)}
                  className="-m-1 grid h-9 w-9 shrink-0 place-items-center rounded-full p-1 text-ink-faint transition-colors duration-[140ms] ease-quick hover:bg-danger-wash hover:text-danger"
                >
                  <Icon name="close" size={16} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 rounded-md bg-sunken px-3 py-2 text-label font-normal text-ink-faint">
            아직 기록한 지출이 없어요.
          </p>
        )}

        <ExpenseInputRow
          cardId={card.id}
          currency={currency}
          localCurrency={localCurrency}
          fxRate={fxRate}
        />
      </section>

      {showComments ? (
        <section>
          <div className="flex items-baseline justify-between gap-2">
            <h3 className={SECTION_TITLE_CLASS}>코멘트</h3>
            <span
              data-testid="card-comment-count"
              data-count={comments.length}
              className="text-label tabular-nums text-ink-muted"
            >
              {comments.length}개
            </span>
          </div>

          {comments.length > 0 ? (
            <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
              {comments.map((entry) => (
                <li
                  key={entry.id}
                  data-testid="card-comment-row"
                  data-comment-id={entry.id}
                  className="flex items-start gap-2 rounded-md bg-sunken px-3 py-2"
                >
                  {/* `mt-px` puts an 18px circle on the first line's baseline
                      in a row whose text may wrap to three. */}
                  <LedgerAuthor by={entry.by} className="mt-px" />
                  <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-label font-normal text-ink">
                    {entry.text}
                  </span>
                  <span className="shrink-0 text-micro font-normal tabular-nums text-ink-faint">
                    {formatStamp(entry.at)}
                  </span>
                  <button
                    type="button"
                    data-testid="card-comment-remove"
                    aria-label="코멘트 삭제"
                    onClick={() => removeComment(card.id, entry.id)}
                    className="-m-1 grid h-9 w-9 shrink-0 place-items-center rounded-full p-1 text-ink-faint transition-colors duration-[140ms] ease-quick hover:bg-danger-wash hover:text-danger"
                  >
                    <Icon name="close" size={16} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 rounded-md bg-sunken px-3 py-2 text-label font-normal text-ink-faint">
              첫 코멘트를 남겨보세요.
            </p>
          )}

          <div className="mt-2 flex items-center gap-2">
            <input
              data-testid="card-comment-input"
              aria-label="코멘트"
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                submitComment();
              }}
              placeholder="한 줄 남기기"
              className={`${INLINE_INPUT_CLASS} min-w-0 flex-1`}
            />
            <button
              type="button"
              data-testid="card-comment-add"
              onClick={submitComment}
              disabled={!canAddComment}
              className={`${PRIMARY_BUTTON_CLASS} shrink-0`}
            >
              등록
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
