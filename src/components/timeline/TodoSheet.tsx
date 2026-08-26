import { useWorkspaceStore } from '../../stores/workspaceStore';
import { todoSummary } from '../../todo/checklist';
import type { Id } from '../../types/models';
import Sheet from '../common/Sheet';
import { EmojiIcon } from '../common/Icon';
import TodoCheck from '../common/TodoCheck';

interface TodoSheetProps {
  tripId: Id;
  onClose: () => void;
}

/**
 * 「할 일」 — 이 여행의 체크리스트 카테고리에 든 카드를 한 자리에 모아 보는 시트
 * (M29).
 *
 * **보는 자리이지 만드는 자리가 아니다.** 카드를 만드는 곳은 보드 하나뿐이고,
 * 여기에 ＋를 하나 더 두면 「할 일은 어디서 만드나」라는 질문이 두 개의 답을
 * 갖게 된다. 이 시트가 하는 일은 정확히 둘이다: 흩어진 칸들을 한 줄 목록으로
 * 펴는 것, 그리고 그 자리에서 켜고 끄는 것.
 *
 * 체크는 보드와 **같은 스토어의 같은 뮤테이션**을 부른다. 그래서 두 화면이
 * 어긋날 방법이 없고, 어긋나지 않게 맞춰 주는 코드도 없다.
 */
export default function TodoSheet({ tripId, onClose }: TodoSheetProps) {
  const workspace = useWorkspaceStore((s) => s.workspace);
  const toggleCardDone = useWorkspaceStore((s) => s.toggleCardDone);
  const summary = todoSummary(workspace, tripId);
  // 빈 칸은 목록에 서지 않는다 — 「준비물 0/0」과 그 아래의 공백은 정보가
  // 아니라 얼룩이다. 채우는 일은 보드에서 한다.
  const groups = summary.groups.filter((group) => group.total > 0);
  /** 칸이 둘 이상일 때만 줄이 어느 칸의 것인지 말해 준다. */
  const showGroups = groups.length > 1;

  return (
    <Sheet title="할 일" onClose={onClose} testId="todo-sheet">
      {summary.total === 0 ? (
        <p
          data-testid="todo-empty"
          className="px-1 py-10 text-center text-label font-normal text-ink-muted"
        >
          {summary.hasColumns
            ? '아직 적어 둔 할 일이 없어요. 보드에서 카드를 추가해 보세요.'
            : '보드에서 카테고리를 체크리스트로 지정하면 여기에 모여요.'}
        </p>
      ) : (
        <>
          {/* 몇 개 중 몇 개인지 — 목록이 답하는 단 하나의 요약. */}
          <div className="flex items-baseline justify-between gap-3 pb-2">
            <span className="text-label font-medium text-ink-muted">완료</span>
            <span
              data-testid="todo-progress"
              data-done={summary.done}
              data-total={summary.total}
              className="text-label font-semibold tabular-nums text-ink"
            >
              {summary.done}/{summary.total}
            </span>
          </div>

          {groups.map((group) => (
            <section
              key={group.column.id}
              data-testid="todo-group"
              data-column-id={group.column.id}
              className="border-t border-line pt-2 first-of-type:border-t-0 first-of-type:pt-0"
            >
              {showGroups ? (
                <h3 className="flex items-center gap-2 py-2 text-micro font-medium text-ink-muted">
                  <EmojiIcon emoji={group.column.icon} />
                  <span className="min-w-0 truncate" data-testid="todo-group-name">
                    {group.column.name}
                  </span>
                  <span className="tabular-nums text-ink-faint">
                    {group.done}/{group.total}
                  </span>
                </h3>
              ) : null}

              <ul>
                {group.items.map((item) => (
                  <li key={item.card.id}>
                    <button
                      type="button"
                      data-testid="todo-row"
                      data-card-id={item.card.id}
                      data-done={item.done ? 'true' : 'false'}
                      role="checkbox"
                      aria-checked={item.done}
                      onClick={() => toggleCardDone(item.card.id)}
                      // 44px — 시트 안의 모든 누를 것이 지키는 바닥 (M9 · M19).
                      className="flex min-h-11 w-full items-center gap-3 rounded-md px-1 py-2 text-left transition-colors duration-[140ms] ease-quick hover:bg-sunken"
                    >
                      <TodoCheck done={item.done} />
                      <span
                        className={[
                          'min-w-0 flex-1 break-words text-label',
                          item.done ? 'text-ink-faint line-through' : 'text-ink',
                        ].join(' ')}
                      >
                        {item.card.title}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </>
      )}
    </Sheet>
  );
}
