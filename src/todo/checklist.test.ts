import { describe, expect, it } from 'vitest';
import { emptyWorkspace, type BoardColumn, type Card, type Id, type Workspace } from '../types/models';
import {
  columnsNeedingTodoFlag,
  isCardDone,
  isTodoColumnName,
  sortTodoItems,
  todoColumnsOf,
  todoSummary,
  type TodoItem,
} from './checklist';

const AT = 1_700_000_000_000;

function column(id: Id, name: string, extra: Partial<BoardColumn> = {}): BoardColumn {
  return {
    id,
    tripId: 'trip',
    name,
    color: 'violet',
    icon: '📌',
    cardOrder: [],
    createdAt: AT,
    updatedAt: AT,
    ...extra,
  };
}

function card(id: Id, title: string, columnId: Id, doneAt?: number): Card {
  return {
    id,
    tripId: 'trip',
    columnId,
    title,
    ...(doneAt === undefined ? {} : { doneAt }),
    createdAt: AT,
    updatedAt: AT,
  };
}

/** A trip with the given columns (in order) and cards already filed. */
function workspaceOf(columns: BoardColumn[], cards: Card[] = []): Workspace {
  const ws = emptyWorkspace();
  ws.trips.trip = {
    id: 'trip',
    title: '오사카',
    currency: 'KRW',
    columnOrder: columns.map((entry) => entry.id),
    sheetOrder: [],
    createdAt: AT,
    updatedAt: AT,
  };
  for (const entry of columns) ws.columns[entry.id] = entry;
  for (const entry of cards) {
    ws.cards[entry.id] = entry;
    const owner = ws.columns[entry.columnId];
    if (owner) owner.cardOrder = [...owner.cardOrder, entry.id];
  }
  return ws;
}

describe('isTodoColumnName', () => {
  it('accepts the 할일 spellings, whitespace and case included', () => {
    for (const name of ['할일', '할 일', '  할  일 ', 'todo', 'TODO', 'ToDo', 'to do', ' To Do ']) {
      expect(isTodoColumnName(name)).toBe(true);
    }
  });

  it('rejects names that merely contain one', () => {
    for (const name of ['할일 목록', '준비물', '식사', 'todos', '해야할일', '']) {
      expect(isTodoColumnName(name)).toBe(false);
    }
  });
});

describe('columnsNeedingTodoFlag', () => {
  it('picks only 할일-named columns whose flag is absent', () => {
    const ws = workspaceOf([
      column('a', '할일'),
      column('b', '식사'),
      column('c', 'Todo'),
      column('d', '할 일'),
    ]);
    expect(columnsNeedingTodoFlag(ws)).toEqual(['a', 'c', 'd']);
  });

  it('never touches a column whose flag is already present', () => {
    const ws = workspaceOf([
      column('on', '할일', { todo: true }),
      // 사람이 직접 끈 칸 — 이행이 되살리면 그건 이행이 아니다.
      column('off', '할 일', { todo: false }),
    ]);
    expect(columnsNeedingTodoFlag(ws)).toEqual([]);
  });

  it('is idempotent: flagging what it found empties the next run', () => {
    const ws = workspaceOf([column('a', '할일'), column('b', 'todo'), column('c', '숙소')]);
    const first = columnsNeedingTodoFlag(ws);
    expect(first).toEqual(['a', 'b']);
    for (const id of first) ws.columns[id] = { ...ws.columns[id], todo: true };
    expect(columnsNeedingTodoFlag(ws)).toEqual([]);
  });

  it('finds nothing in an empty workspace', () => {
    expect(columnsNeedingTodoFlag(emptyWorkspace())).toEqual([]);
  });
});

describe('isCardDone', () => {
  it('reads a positive finite stamp as done and everything else as not', () => {
    expect(isCardDone(card('1', 'a', 'x', AT))).toBe(true);
    expect(isCardDone(card('2', 'b', 'x'))).toBe(false);
    expect(isCardDone(card('3', 'c', 'x', 0))).toBe(false);
    expect(isCardDone(card('4', 'd', 'x', Number.NaN))).toBe(false);
  });
});

describe('todoColumnsOf', () => {
  it('returns the trip’s checklist columns in board order', () => {
    const ws = workspaceOf([
      column('a', '이동수단'),
      column('b', '할일', { todo: true }),
      column('c', '준비물', { todo: true }),
      column('d', '식사', { todo: false }),
    ]);
    expect(todoColumnsOf(ws, 'trip').map((entry) => entry.id)).toEqual(['b', 'c']);
  });

  it('is empty for an unknown trip', () => {
    expect(todoColumnsOf(workspaceOf([column('a', '할일', { todo: true })]), 'nope')).toEqual([]);
    expect(todoColumnsOf(emptyWorkspace(), undefined)).toEqual([]);
  });
});

describe('sortTodoItems', () => {
  const item = (id: Id, done: boolean, doneAt?: number): TodoItem => ({
    card: card(id, id, 'x', doneAt),
    done,
    ...(doneAt === undefined ? {} : { doneAt }),
  });

  it('keeps undone items in board order and sinks done ones, newest first', () => {
    const sorted = sortTodoItems([
      item('a', true, AT + 100),
      item('b', false),
      item('c', true, AT + 900),
      item('d', false),
    ]);
    expect(sorted.map((entry) => entry.card.id)).toEqual(['b', 'd', 'c', 'a']);
  });

  it('breaks a same-millisecond tie by id so both devices agree', () => {
    const sorted = sortTodoItems([item('z', true, AT), item('a', true, AT)]);
    expect(sorted.map((entry) => entry.card.id)).toEqual(['a', 'z']);
  });
});

describe('todoSummary', () => {
  const ws = () =>
    workspaceOf(
      [
        column('todo', '할일', { todo: true }),
        column('pack', '준비물', { todo: true }),
        column('food', '식사'),
      ],
      [
        card('c1', '환전', 'todo'),
        card('c2', '유심', 'todo', AT + 5),
        card('c3', '예약하기', 'todo'),
        card('c4', '우산', 'pack', AT + 1),
        card('c5', '이치란', 'food'),
      ],
    );

  it('groups by checklist column and counts 완료', () => {
    const summary = todoSummary(ws(), 'trip');
    expect(summary.hasColumns).toBe(true);
    expect(summary.groups.map((group) => group.column.name)).toEqual(['할일', '준비물']);
    expect(summary.total).toBe(4);
    expect(summary.done).toBe(2);
    expect(summary.remaining).toBe(2);
  });

  it('sinks done cards inside their own group only', () => {
    const [first, second] = todoSummary(ws(), 'trip').groups;
    expect(first.items.map((entry) => entry.card.title)).toEqual(['환전', '예약하기', '유심']);
    expect(first.done).toBe(1);
    expect(first.total).toBe(3);
    expect(second.items.map((entry) => entry.card.title)).toEqual(['우산']);
    expect(second.done).toBe(1);
  });

  it('leaves out cards of non-checklist columns', () => {
    const titles = todoSummary(ws(), 'trip').groups.flatMap((group) =>
      group.items.map((entry) => entry.card.title),
    );
    expect(titles).not.toContain('이치란');
  });

  it('says so when the trip has no checklist column at all', () => {
    const summary = todoSummary(workspaceOf([column('food', '식사')]), 'trip');
    expect(summary.hasColumns).toBe(false);
    expect(summary.groups).toEqual([]);
    expect(summary.total).toBe(0);
    expect(summary.remaining).toBe(0);
  });

  it('is empty for an unknown trip', () => {
    const summary = todoSummary(ws(), undefined);
    expect(summary.hasColumns).toBe(false);
    expect(summary.total).toBe(0);
  });
});
