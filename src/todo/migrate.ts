/**
 * 기존 여행의 「할일」 칸을 체크리스트로 올리는 한 번짜리 이행 (M29).
 *
 * M29 이전에 만들어진 여행에도 이미 「할일」 칸이 있다 — 모든 여행의 기본
 * 카테고리 중 하나였으니까. 그 칸에 쌓아 둔 환전·유심·예약이 새 기능을 만나려면
 * 사람이 여행마다 카테고리 편집을 열어 토글을 켜야 하는데, 그건 앱이 대신
 * 해줄 수 있는 일이다.
 *
 * 규칙은 {@link columnsNeedingTodoFlag}가 전부 갖고 있고 (이름이 할 일 + 플래그
 * 없음), 여기서는 그 결과를 스토어에 밀어 넣기만 한다. 그래서 이 파일에는
 * *판단*이 없고, 판단은 브라우저 없이 시험된다.
 *
 * **더하기만 하고, 한 번만 한다.** 이미 켜진 칸도 사람이 직접 끈 칸도 건드리지
 * 않으므로 두 번 돌려도 두 번째는 아무 일이 없고, 두 기기가 각자 돌려도 같은
 * 값을 쓰므로 LWW 병합에서 갈라지지 않는다.
 */

import { useWorkspaceStore } from '../stores/workspaceStore';
import { columnsNeedingTodoFlag } from './checklist';

/**
 * 이행을 한 번 돌리고, 손댄 칸 수를 돌려준다.
 *
 * 하이드레이션이 **끝난 뒤에** 불러야 한다 (`App`): 빈 워크스페이스를 보고
 * 「고칠 게 없다」고 판단하는 것은 판단이 아니라 사고다 — `pruneActiveIds`·
 * `schedulePhotoGc`가 같은 자리에 같은 이유로 서 있다.
 */
export function adoptTodoColumns(): number {
  const { workspace, setColumnTodo } = useWorkspaceStore.getState();
  const ids = columnsNeedingTodoFlag(workspace);
  // 각각 `run()`을 지나므로 `updatedAt`이 찍히고 워크스페이스가 dirty가 된다 —
  // 즉 다음 밀어내기에 실려 상대 기기에도 그대로 도착한다.
  for (const id of ids) setColumnTodo(id, true);
  return ids.length;
}
