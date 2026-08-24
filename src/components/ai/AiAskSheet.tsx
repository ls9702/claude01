import { useState } from 'react';
import { callAi, type AiCitation } from '../../ai/aiClient';
import { ASK_SYSTEM, buildAskPrompt } from '../../ai/prompts';
import { useUiStore } from '../../stores/uiStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import type { Id } from '../../types/models';
import Icon from '../common/Icon';
import Sheet from '../common/Sheet';
import {
  INPUT_CLASS,
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
  withoutMarginTop,
} from '../common/formStyles';

/** One question and its answer. Lives in state for as long as the sheet does. */
interface Turn {
  question: string;
  answer: string;
  citations: AiCitation[];
}

const errorText = (err: unknown): string =>
  err instanceof Error ? err.message : '알 수 없는 오류예요';

/**
 * 「AI에게 묻기」 — one free question, optionally grounded in a web search (M11).
 *
 * The conversation is an array in this component and nothing more: closing the
 * sheet forgets it. That is a deliberate limit of M11 rather than an oversight
 * — persisting a chat would mean a seventh entity map, and the data model is
 * frozen. Anything worth keeping goes on a card.
 */
export default function AiAskSheet({ tripId, onClose }: { tripId?: Id; onClose: () => void }) {
  const [question, setQuestion] = useState('');
  const [grounding, setGrounding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);

  const ask = async (): Promise<void> => {
    const asked = question.trim();
    if (!asked || busy) return;

    setBusy(true);
    setError(null);
    try {
      const workspace = useWorkspaceStore.getState().workspace;
      const result = await callAi('ask', {
        prompt: buildAskPrompt(asked, workspace, tripId),
        system: ASK_SYSTEM,
        // Only ever one of the two — a `responseSchema` alongside google_search
        // is rejected upstream, and this call wants prose anyway.
        grounding,
      });
      setTurns((current) => [
        ...current,
        { question: asked, answer: result.text, citations: result.citations },
      ]);
      setQuestion('');
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      title="AI에게 묻기"
      testId="ai-ask"
      onClose={onClose}
      footer={
        <div className="flex items-center gap-2">
          <label className="flex shrink-0 items-center gap-2 text-label font-normal text-ink-muted">
            <input
              type="checkbox"
              data-testid="ai-ask-grounding"
              data-on={grounding ? 'true' : 'false'}
              checked={grounding}
              onChange={(event) => setGrounding(event.target.checked)}
              className="h-4 w-4 accent-ink"
            />
            검색 기반
          </label>
          <button
            type="button"
            data-testid="ai-ask-to-suggest"
            onClick={() => {
              // 「오사카성 이벤트로 만들어 줘」 류의 생성 요청은 답변이 아니라
              // 카드가 목적 — 입력을 그대로 AI 추천 흐름에 넘긴다 (M17).
              useUiStore.getState().requestAiSuggest(question.trim());
              onClose();
            }}
            disabled={busy || question.trim() === ''}
            className={`${SECONDARY_BUTTON_CLASS} ml-auto shrink-0`}
            title="입력한 내용으로 카드 제안을 받아 보드에 추가해요"
          >
            카드로 만들기
          </button>
          <button
            type="button"
            data-testid="ai-ask-submit"
            onClick={() => void ask()}
            disabled={busy || question.trim() === ''}
            className={`${PRIMARY_BUTTON_CLASS} ml-auto flex-1 sm:flex-none sm:min-w-28`}
          >
            {busy ? '묻는 중…' : '물어보기'}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <input
          data-testid="ai-ask-input"
          type="text"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void ask();
            }
          }}
          placeholder="예: 오사카에서 비 오는 날 갈 만한 곳은?"
          className={withoutMarginTop(INPUT_CLASS)}
        />

        {error ? (
          <p data-testid="ai-ask-error" className="flex items-center gap-2 text-label text-danger">
            <Icon name="alert" size={16} />
            {error}
          </p>
        ) : null}

        {turns.length === 0 && !busy ? (
          <p className="text-label font-normal text-ink-faint">
            여행 준비 중 궁금한 걸 물어보세요. 「검색 기반」을 켜면 최신 정보를 찾아 출처까지
            보여줘요.
          </p>
        ) : null}

        <ol className="space-y-4">
          {turns.map((turn, index) => (
            <li key={index} data-testid="ai-ask-turn" className="space-y-2">
              <p className="text-label font-semibold text-ink-muted">질문 · {turn.question}</p>
              <p
                data-testid="ai-ask-answer"
                className="whitespace-pre-wrap text-body font-normal text-ink"
              >
                {turn.answer}
              </p>
              {turn.citations.length > 0 ? (
                <ul className="space-y-1">
                  {turn.citations.map((citation) => (
                    <li key={citation.uri}>
                      <a
                        data-testid="ai-ask-citation"
                        href={citation.uri}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex max-w-full items-center gap-1 text-micro text-ink-muted underline decoration-line hover:text-ink"
                      >
                        <Icon name="link" size={16} />
                        <span className="min-w-0 truncate">{citation.title}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ol>

        {busy ? (
          <p data-testid="ai-ask-busy" className="text-label text-ink-faint">
            AI가 답을 찾고 있어요…
          </p>
        ) : null}

        <p className="text-micro font-normal text-ink-faint">AI 제안은 참고용이에요</p>
      </div>
    </Sheet>
  );
}
