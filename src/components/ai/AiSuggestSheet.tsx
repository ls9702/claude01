import { useMemo, useState } from 'react';
import { callAi } from '../../ai/aiClient';
import {
  SUGGEST_SCHEMA,
  SUGGEST_SYSTEM,
  buildSuggestPrompt,
  parseSuggestions,
  type AiSuggestion,
} from '../../ai/prompts';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import type { BoardColumn, Id } from '../../types/models';
import { formatBudget } from '../../utils/money';
import { formatDuration } from '../../utils/time';
import Icon, { EmojiIcon } from '../common/Icon';
import Sheet from '../common/Sheet';
import {
  CARD_SURFACE_CLASS,
  CHIP_NEUTRAL,
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
  TEXTAREA_CLASS,
  LABEL_CLASS,
  withBtnSize,
  BTN_SIZE_SM,
} from '../common/formStyles';

/** The button on a suggestion row, at chip height — a row is not a form. */
const ROW_BUTTON_CLASS = withBtnSize(SECONDARY_BUTTON_CLASS, BTN_SIZE_SM);

const errorText = (err: unknown): string =>
  err instanceof Error ? err.message : '알 수 없는 오류예요';

/**
 * Which column a suggestion lands in.
 *
 * The model was *told* to pick one of the board's own column names and usually
 * does, but "식사 (점심)" and "먹거리" both happen. Exact match first, then a
 * loose contains either way, then the first column — a card in the wrong column
 * is a two-second drag, a card that failed to be added is a dead end.
 */
export function matchColumn(
  columns: BoardColumn[],
  columnName: string,
): BoardColumn | undefined {
  if (columns.length === 0) return undefined;
  const wanted = columnName.trim();
  if (!wanted) return columns[0];

  const exact = columns.find((column) => column.name.trim() === wanted);
  if (exact) return exact;

  const loose = columns.find(
    (column) => column.name.includes(wanted) || wanted.includes(column.name),
  );
  return loose ?? columns[0];
}

/**
 * 「AI 추천」 — a wish in, board cards out (M11).
 *
 * The suggestions live in component state and nowhere else. They are not
 * persisted, not synced and not remembered across an open/close: the data model
 * is frozen at M0's six maps, and a suggestion the user did not press 추가 on
 * is not data — it is a thing the model said once.
 */
export default function AiSuggestSheet({ tripId, onClose }: { tripId: Id; onClose: () => void }) {
  const workspace = useWorkspaceStore((s) => s.workspace);
  const addCard = useWorkspaceStore((s) => s.addCard);

  const [wish, setWish] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<AiSuggestion[] | null>(null);
  /** Indices already pressed. A second press must not make a second card. */
  const [added, setAdded] = useState<Set<number>>(new Set());

  const columns = useMemo(
    () =>
      (workspace.trips[tripId]?.columnOrder ?? [])
        .map((columnId) => workspace.columns[columnId])
        .filter((column): column is BoardColumn => Boolean(column)),
    [workspace.trips, workspace.columns, tripId],
  );

  const run = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const result = await callAi('suggest', {
        prompt: buildSuggestPrompt(workspace, tripId, wish),
        system: SUGGEST_SYSTEM,
        schema: SUGGEST_SCHEMA,
      });
      const rows = parseSuggestions(result.json);
      setSuggestions(rows);
      setAdded(new Set());
      if (rows.length === 0) setError('추천을 받지 못했어요. 다시 시도해 주세요.');
    } catch (err) {
      setSuggestions(null);
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  /** Puts one suggestion on the board. Returns whether it actually landed. */
  const addOne = (suggestion: AiSuggestion, index: number): boolean => {
    if (added.has(index)) return false;
    const column = matchColumn(columns, suggestion.columnName);
    if (!column) {
      setError('보드에 칸이 없어요. 먼저 칸을 만들어 주세요.');
      return false;
    }

    const id = addCard(tripId, column.id, {
      title: suggestion.title,
      memo: suggestion.memo,
      defaultDurationMin: suggestion.durationMin,
      budget: suggestion.budget,
    });
    if (!id) return false;

    setAdded((current) => new Set(current).add(index));
    return true;
  };

  const addAll = (): void => {
    if (!suggestions) return;
    // One pass, one `setAdded` — adding nine cards should not re-render nine
    // times, and `addCard` already batches into one workspace revision each.
    const landed = new Set(added);
    suggestions.forEach((suggestion, index) => {
      if (landed.has(index)) return;
      const column = matchColumn(columns, suggestion.columnName);
      if (!column) return;
      const id = addCard(tripId, column.id, {
        title: suggestion.title,
        memo: suggestion.memo,
        defaultDurationMin: suggestion.durationMin,
        budget: suggestion.budget,
      });
      if (id) landed.add(index);
    });
    setAdded(landed);
  };

  const currency = workspace.trips[tripId]?.currency ?? 'KRW';
  const allAdded = suggestions !== null && suggestions.every((_, index) => added.has(index));

  return (
    <Sheet
      title="AI 추천"
      testId="ai-suggest"
      onClose={onClose}
      footer={
        <div className="flex items-center gap-2">
          {suggestions && suggestions.length > 0 ? (
            <button
              type="button"
              data-testid="ai-suggest-add-all"
              onClick={addAll}
              disabled={allAdded}
              className={SECONDARY_BUTTON_CLASS}
            >
              모두 추가
            </button>
          ) : null}
          <button
            type="button"
            data-testid="ai-suggest-run"
            onClick={() => void run()}
            disabled={busy}
            className={`${PRIMARY_BUTTON_CLASS} ml-auto flex-1 sm:flex-none sm:min-w-28`}
          >
            {busy ? '생각하는 중…' : suggestions ? '다시 추천' : '추천받기'}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div>
          <label className={LABEL_CLASS} htmlFor="ai-suggest-wish">
            어떤 걸 좋아하세요?
          </label>
          <textarea
            id="ai-suggest-wish"
            data-testid="ai-suggest-wish"
            rows={3}
            value={wish}
            onChange={(event) => setWish(event.target.value)}
            placeholder="예: 라멘과 건담을 좋아해요, 아이와 함께"
            className={TEXTAREA_CLASS}
          />
        </div>

        {error ? (
          <p
            data-testid="ai-suggest-error"
            className="flex items-center gap-2 text-label text-danger"
          >
            <Icon name="alert" size={16} />
            {error}
          </p>
        ) : null}

        {busy ? (
          <p data-testid="ai-suggest-busy" className="text-label text-ink-faint">
            AI가 아이디어를 고르고 있어요…
          </p>
        ) : null}

        {suggestions && suggestions.length > 0 ? (
          <ul className="space-y-2">
            {suggestions.map((suggestion, index) => {
              const column = matchColumn(columns, suggestion.columnName);
              const done = added.has(index);
              return (
                <li
                  key={`${suggestion.title}-${index}`}
                  data-testid="ai-suggestion"
                  data-index={index}
                  className={`${CARD_SURFACE_CLASS} p-3`}
                >
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-body font-semibold text-ink">{suggestion.title}</p>
                      {suggestion.memo ? (
                        <p className="mt-1 text-label font-normal text-ink-muted">
                          {suggestion.memo}
                        </p>
                      ) : null}
                      <div className="mt-2 flex flex-wrap items-center gap-1">
                        {column ? (
                          <span data-testid="ai-suggestion-column" className={CHIP_NEUTRAL}>
                            <EmojiIcon emoji={column.icon} />
                            {column.name}
                          </span>
                        ) : null}
                        {suggestion.durationMin ? (
                          <span className={CHIP_NEUTRAL}>
                            <Icon name="clock" size={16} />
                            {formatDuration(suggestion.durationMin)}
                          </span>
                        ) : null}
                        {suggestion.budget ? (
                          <span className={CHIP_NEUTRAL}>
                            <Icon name="wallet" size={16} />
                            {formatBudget(suggestion.budget, currency)}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <button
                      type="button"
                      data-testid="ai-suggestion-add"
                      data-index={index}
                      data-added={done ? 'true' : 'false'}
                      onClick={() => addOne(suggestion, index)}
                      disabled={done}
                      className={ROW_BUTTON_CLASS}
                    >
                      {done ? '추가됨' : '보드에 추가'}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}

        <p className="text-micro font-normal text-ink-faint">
          AI 제안은 참고용이에요. 영업시간과 가격은 직접 확인해 주세요.
        </p>
      </div>
    </Sheet>
  );
}
