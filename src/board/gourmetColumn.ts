/**
 * 상설 「맛집」 칸 — 이름으로 알아보기, 한 번짜리 이행, 그리고 목적지 고르기 (M49).
 *
 * M29(할일)·M31(숙소)의 이행과 같은 모양이되 **한 걸음이 더 있다**: 그 둘은
 * 이미 있던 칸에 성질을 얹기만 하면 됐지만(모든 여행이 「할일」·「숙소」 칸을
 * 달고 태어났으니까), 「맛집」 칸은 M49 이전에는 존재하지 않았다. 그래서 이
 * 이행은 이름이 맞는 칸이 있으면 플래그만 켜고, **없으면 칸을 하나 만든다**.
 *
 * 판단은 여기(순수), 쓰기는 저 아래 {@link adoptGourmetColumns}. 그래서 「어떤
 * 여행이 칸을 새로 받는가」는 브라우저 없이 시험된다.
 *
 * ## 멱등성과 「명시적 false」
 *
 * 규칙은 여행 단위로 딱 하나다: **그 여행의 어느 칸이든 `gourmet` 플래그를 이미
 * 들고 있으면 손대지 않는다.** `true`면 할 일이 없고, `false`면 사람이 카테고리
 * 편집에서 직접 끈 것이라 되살리는 것은 이행이 아니라 되돌리기다. 그래서 두 번
 * 돌려도 두 번째는 아무 일이 없고, 두 기기가 각자 돌려도 같은 값을 쓴다.
 *
 * 칸을 **지워 버린** 여행은 다음 실행에서 다시 받는다. 상설 칸의 뜻이 그것이고
 * (지워도 돌아온다), 정말로 원하지 않는 사람에게는 토글이라는 정확한 문이 있다
 * — 끄면 `false`가 남고, 그 뒤로는 아무도 손대지 않는다.
 */

import type { BoardColumn, Id, Workspace } from '../types/models';
import { useWorkspaceStore } from '../stores/workspaceStore';

/** 새 칸이 태어날 때 쓰는 이름·아이콘·색. `SEED_COLUMNS`의 그 줄과 같은 값이다. */
export const GOURMET_COLUMN_NAME = '맛집';
export const GOURMET_COLUMN_ICON = '🍚';
export const GOURMET_COLUMN_COLOR = 'orange';

/**
 * 이 칸 이름이 「맛집」인가.
 *
 * 공백은 전부 걷어내고(「맛 집」·「 맛집 」이 같은 이름), 영어는 대소문자를
 * 가리지 않는다(`Gourmet`·`GOURMET`). 그 이상은 일부러 보지 않는다 — 「맛집
 * 후보」처럼 이름 *안에* 든 경우까지 삼키면 사람이 지어준 이름을 앱이 제멋대로
 * 해석하는 쪽에 가까워진다 (`todo/checklist`·`board/budgetOnce`의 같은 결정).
 */
export function isGourmetColumnName(name: string): boolean {
  const squashed = name.replace(/\s+/g, '').toLowerCase();
  return squashed === '맛집' || squashed === 'gourmet';
}

/** 이행이 할 일 — 플래그를 켤 칸들과, 칸을 새로 받을 여행들. */
export interface GourmetAdoptionPlan {
  /** 이름이 「맛집」이라 플래그만 켜면 되는 칸의 id. */
  flag: Id[];
  /** 맛집 칸이 아예 없어 새로 만들어야 하는 여행의 id. */
  create: Id[];
}

/**
 * 이 워크스페이스에 무엇을 해야 하는가 (순수).
 *
 * 여행 단위로 도는 이유는 「없으면 만든다」가 여행을 알아야 하는 결정이기
 * 때문이다. 여행에 속하지 않은 유령 칸은 그냥 두는데, M29가 그것을 고쳐 준 것과
 * 달리 여기서는 그 칸이 어느 보드에 설지 알 수 없다 — 켜 봐야 아무 데도 안 뜬다.
 */
export function planGourmetColumns(workspace: Workspace): GourmetAdoptionPlan {
  const flag: Id[] = [];
  const create: Id[] = [];

  for (const tripId of Object.keys(workspace.trips).sort()) {
    const trip = workspace.trips[tripId];
    const columns = trip.columnOrder
      .map((columnId) => workspace.columns[columnId])
      .filter((column): column is BoardColumn => Boolean(column));

    // 이 여행은 이미 답을 갖고 있다 — 켜져 있든(true) 사람이 껐든(false).
    if (columns.some((column) => column.gourmet !== undefined)) continue;

    const named = columns.find((column) => isGourmetColumnName(column.name));
    if (named) flag.push(named.id);
    else create.push(trip.id);
  }

  return { flag: flag.sort(), create };
}

/**
 * 이행을 한 번 돌리고, 손댄 여행·칸의 수를 돌려준다.
 *
 * 하이드레이션이 **끝난 뒤에** 불러야 한다 (`App`): 빈 워크스페이스를 보고
 * 「고칠 게 없다」고 판단하는 것은 판단이 아니라 사고다 — `adoptTodoColumns`·
 * `adoptStayColumns`가 바로 옆에 같은 이유로 서 있다.
 */
export function adoptGourmetColumns(): number {
  const { workspace, setColumnGourmet, addColumn } = useWorkspaceStore.getState();
  const plan = planGourmetColumns(workspace);

  for (const id of plan.flag) setColumnGourmet(id, true);
  for (const tripId of plan.create) {
    const columnId = addColumn(
      tripId,
      GOURMET_COLUMN_NAME,
      GOURMET_COLUMN_COLOR,
      GOURMET_COLUMN_ICON,
    );
    // 만들자마자 성질을 준다. 두 번의 `run()`이지만 한 번의 사용자 행동이라
    // 실행취소가 얽힐 일은 없다 — 이행은 애초에 실행취소의 대상이 아니다.
    if (columnId) setColumnGourmet(columnId, true);
  }

  return plan.flag.length + plan.create.length;
}

/**
 * 「보드에 카드로 추가」가 겨눌 칸 (M43 → M49).
 *
 * M43은 이름으로 「식사」 칸을 찾았다(`matchColumn`). 그때는 그게 유일한 답이었고
 * 지금도 좋은 대비책이지만, **맛집 칸이 있는 여행에서는 그쪽이 옳다**: 방금
 * 지도에서 고른 집은 우리가 가기로 한 집이고, 그 목록이 사는 자리가 맛집 칸이다.
 *
 * 이 함수는 그 첫 계단 하나만 답한다 — 없으면 `null`을 주고, 부르는 쪽이 M43의
 * `matchColumn(columns, '식사')`로 내려간다. 계단을 여기서 다 세우지 않는 이유는
 * `matchColumn`이 컴포넌트 파일에 살아서고(`components/ai/AiSuggestSheet`), 순수
 * 규칙 파일이 화면 파일을 import하기 시작하면 이 파일은 더 이상 순수하지 않다.
 */
export function pickGourmetColumn(columns: readonly BoardColumn[]): BoardColumn | null {
  return columns.find((column) => column.gourmet === true) ?? null;
}
