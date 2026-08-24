import { useCallback, useEffect, useState } from 'react';
import { callAi } from '../../ai/aiClient';
import { REVIEW_SYSTEM, buildReviewPrompt } from '../../ai/prompts';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import type { Id } from '../../types/models';
import Icon from '../common/Icon';
import Sheet from '../common/Sheet';
import { PRIMARY_BUTTON_CLASS } from '../common/formStyles';

const errorText = (err: unknown): string =>
  err instanceof Error ? err.message : '알 수 없는 오류예요';

/**
 * Splits the model's plain-text answer into bullets.
 *
 * The prompt asks for `- ` lines and the system instruction repeats it, so this
 * is mostly bookkeeping — but a model that answers in a paragraph should still
 * be readable, so a line without a marker becomes a bullet of its own rather
 * than being dropped.
 */
export function toBullets(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim().replace(/^[-•*]\s*/, '').trim())
    .filter((line) => line !== '' && !/^```/.test(line));
}

/**
 * 「AI 검토」 — the active sheet read back with its problems named (M11).
 *
 * Runs on open rather than behind a button: there is exactly one thing this
 * sheet can do, and making the user press 검토 inside a sheet they opened by
 * pressing 검토 is a button asking permission to be a button.
 */
export default function AiReviewSheet({ sheetId, onClose }: { sheetId: Id; onClose: () => void }) {
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bullets, setBullets] = useState<string[]>([]);

  const run = useCallback(async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      // Read the workspace at call time, not through a subscription: a review
      // is a snapshot of the plan as it was when you asked.
      const prompt = buildReviewPrompt(useWorkspaceStore.getState().workspace, sheetId);
      if (!prompt) {
        setError('검토할 일정이 없어요.');
        return;
      }
      const result = await callAi('review', { prompt, system: REVIEW_SYSTEM });
      const lines = toBullets(result.text);
      setBullets(lines);
      if (lines.length === 0) setError('검토 결과를 받지 못했어요. 다시 시도해 주세요.');
    } catch (err) {
      setBullets([]);
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }, [sheetId]);

  useEffect(() => {
    void run();
  }, [run]);

  return (
    <Sheet
      title="AI 검토"
      testId="ai-review"
      onClose={onClose}
      footer={
        <button
          type="button"
          data-testid="ai-review-retry"
          onClick={() => void run()}
          disabled={busy}
          className={`${PRIMARY_BUTTON_CLASS} w-full`}
        >
          {busy ? '읽는 중…' : '다시 검토'}
        </button>
      }
    >
      <div className="space-y-4">
        {busy ? (
          <p data-testid="ai-review-busy" className="text-label text-ink-faint">
            AI가 일정을 읽고 있어요…
          </p>
        ) : null}

        {error ? (
          <p
            data-testid="ai-review-error"
            className="flex items-center gap-2 text-label text-danger"
          >
            <Icon name="alert" size={16} />
            {error}
          </p>
        ) : null}

        {bullets.length > 0 ? (
          <ul data-testid="ai-review-result" className="space-y-2">
            {bullets.map((bullet, index) => (
              <li key={index} className="flex gap-2 text-body font-normal text-ink">
                <span aria-hidden="true" className="mt-2 h-1 w-1 shrink-0 rounded-full bg-ink-faint" />
                <span className="min-w-0">{bullet}</span>
              </li>
            ))}
          </ul>
        ) : null}

        <p className="text-micro font-normal text-ink-faint">AI 제안은 참고용이에요</p>
      </div>
    </Sheet>
  );
}
