/**
 * 할 일 체크리스트의 규칙 (M29) — 보드의 체크박스와 일정 탭의 「할 일」 시트가
 * 함께 쓰는 단 하나의 근거.
 *
 * 두 가지 일을 한다.
 *
 * 1. **자동 이행** ({@link columnsNeedingTodoFlag}) — 기존 여행의 「할일」 칸을
 *    한 번만, 더해주기만 하는 방식으로 체크리스트로 올린다.
 * 2. **목록 만들기** ({@link todoSummary}) — 체크리스트 칸들의 카드를 칸별로
 *    묶고, 끝낸 것을 아래로 가라앉히고, 몇 개 중 몇 개인지 센다.
 *
 * 순수 함수뿐이고 React도 스토어도 모른다. 「할 일 3」이 언제 3인지, 이름이
 * 「할 일」인 칸이 언제 체크리스트가 되는지는 브라우저 없이 증명할 수 있어야
 * 하는 종류의 규칙이기 때문이다 (`memo/thread`·`read/readState`와 같은 이유).
 */

import type { BoardColumn, Card, Id, Millis, Workspace } from '../types/models';

/* ------------------------------------------------------------------ *
 * 1. 이름으로 알아보기 + 자동 이행
 * ------------------------------------------------------------------ */

/**
 * 이 칸 이름이 「할 일」인가.
 *
 * 공백은 전부 걷어내고(「할 일」·「할  일」·「 할일 」이 모두 같은 이름),
 * 영어는 대소문자를 가리지 않는다(`Todo`·`TODO`·`to do`). 그 이상은 일부러
 * 보지 않는다: 「할일 목록」처럼 이름 *안에* 든 경우까지 삼키면, 사람이 지어준
 * 이름을 앱이 제멋대로 해석하는 쪽에 가까워진다. 애매한 이름은 카테고리 편집의
 * 토글이 한 번에 해결한다.
 */
export function isTodoColumnName(name: string): boolean {
  const squashed = name.replace(/\s+/g, '').toLowerCase();
  return squashed === '할일' || squashed === 'todo';
}

/**
 * 이 워크스페이스에서 체크리스트 플래그를 **새로 달아야 할** 칸들의 id.
 *
 * 규칙은 딱 하나: 이름이 할 일이고 `todo` 플래그가 **아예 없을 때만**. 이미
 * `true`면 할 일이 없고, 명시적 `false`면 사람이 직접 끈 것이라 되살리면 안
 * 된다 ({@link BoardColumn.todo}).
 *
 * 그래서 이 함수는 저절로 멱등이다: 한 번 실행해 플래그가 붙고 나면 같은 칸이
 * 다시 뽑히지 않는다. 두 기기가 각자 실행해도 결과가 같으므로 LWW 병합에서
 * 수렴한다 — 양쪽이 같은 값(`true`)을 쓰기 때문이다.
 *
 * 여행에 속하지 않은 유령 칸도 그냥 고친다: 병합이 어차피 정리할 대상이고,
 * 여기서 굳이 가려내면 「이름이 맞는데 왜 안 켜지지」라는 두 번째 규칙이 생긴다.
 */
export function columnsNeedingTodoFlag(workspace: Workspace): Id[] {
  return Object.values(workspace.columns)
    .filter((column) => column.todo === undefined && isTodoColumnName(column.name))
    .map((column) => column.id)
    .sort();
}

/* ------------------------------------------------------------------ *
 * 2. 목록 만들기
 * ------------------------------------------------------------------ */

/** 카드가 체크되어 있는가 — `doneAt`이 쓸 만한 시각일 때만 참. */
export function isCardDone(card: Card): boolean {
  return typeof card.doneAt === 'number' && Number.isFinite(card.doneAt) && card.doneAt > 0;
}

/** 할 일 한 줄. */
export interface TodoItem {
  card: Card;
  done: boolean;
  /** 체크한 시각. 안 했으면 없다. */
  doneAt?: Millis;
}

/** 체크리스트 칸 하나와 그 줄들. */
export interface TodoGroup {
  column: BoardColumn;
  /** 안 끝낸 것이 보드 순서대로 먼저, 끝낸 것이 최근 순으로 아래에. */
  items: TodoItem[];
  /** 이 칸에서 끝난 개수. */
  done: number;
  /** 이 칸의 전체 개수. */
  total: number;
}

/** 시트 하나가 그려야 할 전부. */
export interface TodoSummary {
  groups: TodoGroup[];
  done: number;
  total: number;
  /** 아직 남은 개수 — 일정 탭 버튼이 다는 수가 이것이다. */
  remaining: number;
  /** 체크리스트로 지정된 칸이 하나라도 있는가 (빈 상태의 문구를 가른다). */
  hasColumns: boolean;
}

/** 이 여행의 체크리스트 칸들, 보드 순서대로. */
export function todoColumnsOf(
  workspace: Workspace,
  tripId: Id | undefined,
): BoardColumn[] {
  const trip = tripId ? workspace.trips[tripId] : undefined;
  if (!trip) return [];
  return trip.columnOrder
    .map((columnId) => workspace.columns[columnId])
    .filter((column): column is BoardColumn => Boolean(column) && column.todo === true);
}

/**
 * 한 칸의 줄 순서: 안 끝낸 것이 `cardOrder` 그대로 먼저, 끝낸 것이 **최근에
 * 끝낸 순**으로 뒤에.
 *
 * 끝낸 것을 최근 순으로 두는 것이 `doneAt`을 불리언 대신 시각으로 잡은 이유다:
 * 방금 체크한 줄이 가라앉더라도 어디로 갔는지 눈으로 좇을 수 있는 자리 —
 * 끝난 것들의 맨 위 — 에 놓인다. 같은 밀리초는 id로 갈라, 두 기기가 같은
 * 목록을 다르게 그리는 일이 없게 한다.
 */
export function sortTodoItems(items: readonly TodoItem[]): TodoItem[] {
  return items.map((item, index) => ({ item, index })).sort((a, b) => {
    if (a.item.done !== b.item.done) return a.item.done ? 1 : -1;
    if (!a.item.done) return a.index - b.index;
    const at = a.item.doneAt ?? 0;
    const bt = b.item.doneAt ?? 0;
    if (at !== bt) return bt - at;
    return a.item.card.id < b.item.card.id ? -1 : a.item.card.id > b.item.card.id ? 1 : 0;
  }).map(({ item }) => item);
}

/** 「할 일」 시트가 그리는 전부 — 칸별 묶음과 완료 수. */
export function todoSummary(workspace: Workspace, tripId: Id | undefined): TodoSummary {
  const columns = todoColumnsOf(workspace, tripId);
  const groups: TodoGroup[] = [];
  let done = 0;
  let total = 0;

  for (const column of columns) {
    const items = sortTodoItems(
      column.cardOrder
        .map((cardId) => workspace.cards[cardId])
        .filter((card): card is Card => Boolean(card))
        .map((card) => {
          const isDone = isCardDone(card);
          return { card, done: isDone, ...(isDone ? { doneAt: card.doneAt } : {}) };
        }),
    );
    const groupDone = items.filter((item) => item.done).length;
    done += groupDone;
    total += items.length;
    groups.push({ column, items, done: groupDone, total: items.length });
  }

  return {
    groups,
    done,
    total,
    remaining: total - done,
    hasColumns: columns.length > 0,
  };
}
