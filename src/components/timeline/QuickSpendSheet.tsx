import { useWorkspaceStore } from '../../stores/workspaceStore';
import type { Card } from '../../types/models';
import { formatBudget } from '../../utils/money';
import { cardSpent } from '../../utils/spend';
import { ExpenseInputRow, type LocalMoney } from '../common/CardLedger';
import Sheet from '../common/Sheet';

interface QuickSpendSheetProps extends LocalMoney {
  card: Card;
  /** Trip currency — what the receipt is stored in. */
  currency: string;
  /** The entry's time range, so the user can see what they are paying for. */
  subtitle?: string;
  onClose: () => void;
}

/**
 * 2-tap 지출 기록 from the 「지금 / 다음」 bar (M7b).
 *
 * Deliberately the smallest sheet in the app: the amount row and nothing else.
 * Standing in a shop with a receipt in one hand, the path is 💸 → 금액 → 추가,
 * and the sheet closes itself the moment the store has the number. Anything
 * else (수정, 삭제, 코멘트) lives in the full ledger one tap deeper.
 */
export default function QuickSpendSheet({
  card,
  currency,
  localCurrency,
  fxRate,
  subtitle,
  onClose,
}: QuickSpendSheetProps) {
  const live = useWorkspaceStore((s) => s.workspace.cards[card.id]);
  const total = cardSpent(live);

  return (
    <Sheet title="지출 기록" onClose={onClose} testId="quick-spend-sheet">
      <div className="space-y-1">
        <p data-testid="quick-spend-card" data-card-id={card.id} className="text-sm font-semibold text-stone-800">
          {live?.title ?? card.title}
        </p>
        {subtitle ? <p className="text-xs tabular-nums text-stone-400">{subtitle}</p> : null}
        <p
          data-testid="quick-spend-total"
          data-total={total}
          className="text-xs tabular-nums text-stone-500"
        >
          지금까지 {formatBudget(total, currency)}
        </p>
      </div>

      <ExpenseInputRow
        cardId={card.id}
        currency={currency}
        localCurrency={localCurrency}
        fxRate={fxRate}
        autoFocus
        onAdded={onClose}
      />
    </Sheet>
  );
}
