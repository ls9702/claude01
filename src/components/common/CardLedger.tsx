import { useState, type KeyboardEvent } from 'react';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import type { Card, Id } from '../../types/models';
import { formatBudget, formatLocalAmount } from '../../utils/money';
import { cardSpent } from '../../utils/spend';
import { formatStamp } from '../../utils/time';
import { INPUT_CLASS, LABEL_CLASS } from './formStyles';

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

  const submit = () => {
    if (parsed == null) return;
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
        className={[
          'rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors',
          active ? 'bg-stone-800 text-white' : 'text-stone-500 hover:bg-stone-200',
        ].join(' ')}
      >
        {text}
      </button>
    );
  };

  return (
    <div className="mt-1.5">
      {local ? (
        <div
          data-testid="expense-mode-toggle"
          data-mode={inLocal ? 'local' : 'base'}
          className="mb-1.5 flex w-fit items-center gap-0.5 rounded-full bg-stone-100 p-0.5"
        >
          {modeButton('local', `현지 ${localCurrency}`)}
          {modeButton('base', `기준 ${currency}`)}
        </div>
      ) : null}

      <div className="flex items-center gap-1.5">
        <input
          data-testid="card-expense-amount-input"
          aria-label="금액"
          value={amount}
          autoFocus={autoFocus}
          inputMode="numeric"
          onChange={(event) => setAmount(event.target.value)}
          onKeyDown={onEnter}
          placeholder={useLocal ? `금액 (${localCurrency})` : '금액'}
          className={`${INPUT_CLASS} mt-0 w-28 shrink-0`}
        />
        <input
          data-testid="card-expense-label-input"
          aria-label="내용"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          onKeyDown={onEnter}
          placeholder="내용 (선택)"
          className={`${INPUT_CLASS} mt-0 min-w-0 flex-1`}
        />
        <button
          type="button"
          data-testid="card-expense-add"
          onClick={submit}
          disabled={parsed == null}
          className="shrink-0 rounded-xl bg-stone-800 px-3 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-stone-900 disabled:bg-stone-200 disabled:text-stone-400"
        >
          추가
        </button>
      </div>

      {converted != null ? (
        <p
          data-testid="expense-converted"
          data-amount={converted}
          className="mt-1 text-[11px] tabular-nums text-stone-400"
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

  const [comment, setComment] = useState('');

  const expenses = live?.expenses ?? [];
  const comments = live?.comments ?? [];
  const total = cardSpent(live);
  const canAddComment = comment.trim().length > 0;

  const submitComment = () => {
    if (!canAddComment) return;
    addComment(card.id, comment);
    setComment('');
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
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                submitComment();
              }}
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
      ) : null}
    </div>
  );
}
