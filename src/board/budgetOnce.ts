/**
 * 「숙소 예산은 시트마다 한 번」의 규칙과 그 한 번짜리 이행 (M31).
 *
 * 두 가지 일을 한다.
 *
 * 1. **이름으로 알아보기** ({@link isStayColumnName}) — 숙소/호텔/hotel.
 * 2. **자동 이행** ({@link columnsNeedingBudgetOnceFlag} → {@link adoptStayColumns})
 *    — 기존 여행의 숙소 칸에 플래그를 한 번만, 더해주기만 하는 방식으로 단다.
 *
 * M29의 「할일」 이행(`todo/`)과 같은 모양이고, 같은 이유로 그렇다: 이 앱을 이미
 * 쓰고 있는 여행에도 숙소 칸이 있고(모든 여행의 기본 카테고리다), 거기 걸어 둔
 * 4박 예약이 오늘부터 160만원이 아니라 40만원으로 읽히려면 사람이 여행마다
 * 카테고리 편집을 열어야 하는데, 그건 앱이 대신 해줄 수 있는 일이다.
 *
 * 판단은 여기, 쓰기는 저 아래 — 그래서 「어떤 이름이 숙소인가」는 브라우저 없이
 * 시험된다.
 */

import type { Id, Workspace } from '../types/models';
import { useWorkspaceStore } from '../stores/workspaceStore';

/**
 * 이 칸 이름이 숙소인가.
 *
 * 공백은 전부 걷어내고(「숙 소」·「 숙소 」가 같은 이름), 영어는 대소문자를
 * 가리지 않는다(`Hotel`·`HOTEL`). 그 이상은 일부러 보지 않는다 — 「숙소 후보」
 * 처럼 이름 *안에* 든 경우까지 삼키면 사람이 지어준 이름을 앱이 제멋대로
 * 해석하는 쪽에 가까워진다 (`todo/checklist.ts`의 같은 결정). 애매한 이름은
 * 카테고리 편집의 토글이 한 번에 해결한다.
 */
export function isStayColumnName(name: string): boolean {
  const squashed = name.replace(/\s+/g, '').toLowerCase();
  return squashed === '숙소' || squashed === '호텔' || squashed === 'hotel';
}

/**
 * 이 워크스페이스에서 `budgetOnce`를 **새로 달아야 할** 칸들의 id.
 *
 * 규칙은 딱 하나: 이름이 숙소이고 플래그가 **아예 없을 때만**. 이미 `true`면
 * 할 일이 없고, 명시적 `false`면 사람이 직접 끈 것이라 되살리면 안 된다
 * (`BoardColumn.budgetOnce`).
 *
 * 그래서 저절로 멱등이고, 두 기기가 각자 실행해도 같은 값(`true`)을 쓰므로 LWW
 * 병합에서 수렴한다.
 */
export function columnsNeedingBudgetOnceFlag(workspace: Workspace): Id[] {
  return Object.values(workspace.columns)
    .filter((column) => column.budgetOnce === undefined && isStayColumnName(column.name))
    .map((column) => column.id)
    .sort();
}

/**
 * 이행을 한 번 돌리고, 손댄 칸 수를 돌려준다.
 *
 * 하이드레이션이 **끝난 뒤에** 불러야 한다 (`App`): 빈 워크스페이스를 보고
 * 「고칠 게 없다」고 판단하는 것은 판단이 아니라 사고다 — `adoptTodoColumns`가
 * 바로 옆에 같은 이유로 서 있다.
 */
export function adoptStayColumns(): number {
  const { workspace, setColumnBudgetOnce } = useWorkspaceStore.getState();
  const ids = columnsNeedingBudgetOnceFlag(workspace);
  // 각각 `run()`을 지나므로 `updatedAt`이 찍히고, 다음 밀어내기에 실려 상대
  // 기기에도 그대로 도착한다.
  for (const id of ids) setColumnBudgetOnce(id, true);
  return ids.length;
}
