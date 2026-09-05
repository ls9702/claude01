import { describe, expect, it } from 'vitest';
import type {
  BoardColumn,
  Card,
  Day,
  DrawElement,
  DrawPage,
  DrawSticker,
  Id,
  MemoMessage,
  Millis,
  Sheet,
  TimelineEntry,
  Tombstone,
  Trip,
  Workspace,
} from '../types/models';
import { TOMBSTONE_TTL_MS, merge, workspaceEquals } from './merge';

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

/** Readable clock: `T(0)` is the epoch of every fixture, `T(n)` is n seconds on. */
const T = (seconds: number): Millis => 1_760_000_000_000 + seconds * 1_000;

const byId = <T extends { id: Id }>(items: T[]): Record<Id, T> =>
  Object.fromEntries(items.map((item) => [item.id, item]));

interface Parts {
  trips?: Trip[];
  sheets?: Sheet[];
  columns?: BoardColumn[];
  cards?: Card[];
  days?: Day[];
  entries?: TimelineEntry[];
  tombstones?: Tombstone[];
}

const ws = (parts: Parts = {}): Workspace => ({
  schemaVersion: 1,
  trips: byId(parts.trips ?? []),
  sheets: byId(parts.sheets ?? []),
  columns: byId(parts.columns ?? []),
  cards: byId(parts.cards ?? []),
  days: byId(parts.days ?? []),
  entries: byId(parts.entries ?? []),
  tombstones: parts.tombstones ?? [],
});

const trip = (id: Id, at: Millis, over: Partial<Trip> = {}): Trip => ({
  id,
  title: `여행 ${id}`,
  currency: 'KRW',
  columnOrder: [],
  sheetOrder: [],
  createdAt: at,
  updatedAt: at,
  ...over,
});

const column = (id: Id, tripId: Id, at: Millis, over: Partial<BoardColumn> = {}): BoardColumn => ({
  id,
  tripId,
  name: `칸 ${id}`,
  color: 'sky',
  icon: '📌',
  cardOrder: [],
  createdAt: at,
  updatedAt: at,
  ...over,
});

const card = (id: Id, tripId: Id, columnId: Id, at: Millis, over: Partial<Card> = {}): Card => ({
  id,
  tripId,
  columnId,
  title: `카드 ${id}`,
  createdAt: at,
  updatedAt: at,
  ...over,
});

const sheet = (id: Id, tripId: Id, at: Millis, over: Partial<Sheet> = {}): Sheet => ({
  id,
  tripId,
  name: `일정 ${id}`,
  dayOrder: [],
  createdAt: at,
  updatedAt: at,
  ...over,
});

const day = (id: Id, tripId: Id, sheetId: Id, at: Millis, over: Partial<Day> = {}): Day => ({
  id,
  tripId,
  sheetId,
  label: `${id}일차`,
  createdAt: at,
  updatedAt: at,
  ...over,
});

const entry = (
  id: Id,
  tripId: Id,
  cardId: Id,
  dayId: Id,
  at: Millis,
  over: Partial<TimelineEntry> = {},
): TimelineEntry => ({
  id,
  tripId,
  cardId,
  dayId,
  startMin: 540,
  durationMin: 60,
  createdAt: at,
  updatedAt: at,
  ...over,
});

const memo = (id: Id, tripId: Id, at: Millis, over: Partial<MemoMessage> = {}): MemoMessage => ({
  id,
  tripId,
  text: `메모 ${id}`,
  createdAt: at,
  updatedAt: at,
  ...over,
});

const tomb = (entity: Tombstone['entity'], id: Id, at: Millis): Tombstone => ({
  id,
  entity,
  deletedAt: at,
});

/** Ids of the tombstones for one entity kind, sorted for stable assertions. */
const tombIds = (result: Workspace, entity: Tombstone['entity']): Id[] =>
  result.tombstones
    .filter((t) => t.entity === entity)
    .map((t) => t.id)
    .sort();

/* ------------------------------------------------------------------ *
 * Table
 * ------------------------------------------------------------------ */

interface Case {
  name: string;
  local: Workspace;
  remote: Workspace;
  now: Millis;
  check: (merged: Workspace) => void;
}

const NOW = T(100);

const cases: Case[] = [
  /* --- last-writer-wins on entities ---------------------------------- */
  {
    name: '동시 수정: 로컬이 더 최신이면 로컬이 이긴다',
    local: ws({ trips: [trip('t1', T(1), { title: '로컬 제목', updatedAt: T(20) })] }),
    remote: ws({ trips: [trip('t1', T(1), { title: '리모트 제목', updatedAt: T(10) })] }),
    now: NOW,
    check: (m) => {
      expect(m.trips.t1.title).toBe('로컬 제목');
      expect(m.trips.t1.updatedAt).toBe(T(20));
    },
  },
  {
    name: '동시 수정: 리모트가 더 최신이면 리모트가 이긴다',
    local: ws({ trips: [trip('t1', T(1), { title: '로컬 제목', updatedAt: T(10) })] }),
    remote: ws({ trips: [trip('t1', T(1), { title: '리모트 제목', updatedAt: T(20) })] }),
    now: NOW,
    check: (m) => expect(m.trips.t1.title).toBe('리모트 제목'),
  },
  {
    name: '동시 수정: updatedAt이 같으면 리모트가 이긴다',
    local: ws({ trips: [trip('t1', T(1), { title: '로컬 제목', updatedAt: T(20) })] }),
    remote: ws({ trips: [trip('t1', T(1), { title: '리모트 제목', updatedAt: T(20) })] }),
    now: NOW,
    check: (m) => expect(m.trips.t1.title).toBe('리모트 제목'),
  },
  {
    name: '한쪽에만 있는 엔티티는 양방향 모두 살아남는다',
    local: ws({ trips: [trip('onlyLocal', T(5))] }),
    remote: ws({ trips: [trip('onlyRemote', T(6))] }),
    now: NOW,
    check: (m) => expect(Object.keys(m.trips).sort()).toEqual(['onlyLocal', 'onlyRemote']),
  },
  {
    name: '엔티티별로 각각 최신본이 뽑힌다 (양쪽이 서로 다른 카드를 수정)',
    local: ws({
      trips: [trip('t1', T(1), { columnOrder: ['c1'] })],
      columns: [column('c1', 't1', T(1), { cardOrder: ['k1', 'k2'] })],
      cards: [
        card('k1', 't1', 'c1', T(1), { title: '로컬이 고친 카드', updatedAt: T(30) }),
        card('k2', 't1', 'c1', T(1), { title: '오래된 k2', updatedAt: T(1) }),
      ],
    }),
    remote: ws({
      trips: [trip('t1', T(1), { columnOrder: ['c1'] })],
      columns: [column('c1', 't1', T(1), { cardOrder: ['k1', 'k2'] })],
      cards: [
        card('k1', 't1', 'c1', T(1), { title: '오래된 k1', updatedAt: T(1) }),
        card('k2', 't1', 'c1', T(1), { title: '리모트가 고친 카드', updatedAt: T(30) }),
      ],
    }),
    now: NOW,
    check: (m) => {
      expect(m.cards.k1.title).toBe('로컬이 고친 카드');
      expect(m.cards.k2.title).toBe('리모트가 고친 카드');
    },
  },

  /* --- delete vs edit ------------------------------------------------ */
  {
    name: '삭제 vs 수정: 로컬 삭제가 리모트의 오래된 카드를 죽인다',
    local: ws({
      trips: [trip('t1', T(1), { columnOrder: ['c1'] })],
      columns: [column('c1', 't1', T(1))],
      tombstones: [tomb('card', 'k1', T(20))],
    }),
    remote: ws({
      trips: [trip('t1', T(1), { columnOrder: ['c1'] })],
      columns: [column('c1', 't1', T(1), { cardOrder: ['k1'] })],
      cards: [card('k1', 't1', 'c1', T(1), { updatedAt: T(10) })],
    }),
    now: NOW,
    check: (m) => {
      expect(m.cards.k1).toBeUndefined();
      // The tombstone is kept: another peer may still be carrying k1.
      expect(tombIds(m, 'card')).toEqual(['k1']);
      expect(m.columns.c1.cardOrder).toEqual([]);
    },
  },
  {
    name: '삭제 vs 수정: 삭제 이후의 리모트 수정은 카드를 되살린다',
    local: ws({
      trips: [trip('t1', T(1), { columnOrder: ['c1'] })],
      columns: [column('c1', 't1', T(1))],
      tombstones: [tomb('card', 'k1', T(20))],
    }),
    remote: ws({
      trips: [trip('t1', T(1), { columnOrder: ['c1'] })],
      columns: [column('c1', 't1', T(1), { cardOrder: ['k1'] })],
      cards: [card('k1', 't1', 'c1', T(1), { title: '삭제 후 수정', updatedAt: T(30) })],
    }),
    now: NOW,
    check: (m) => {
      expect(m.cards.k1?.title).toBe('삭제 후 수정');
      // Still kept — the next merge has to judge it against a peer's copy too.
      expect(tombIds(m, 'card')).toEqual(['k1']);
      expect(m.columns.c1.cardOrder).toEqual(['k1']);
    },
  },
  {
    name: '삭제 vs 수정 (반대 방향): 리모트 삭제가 로컬의 오래된 카드를 죽인다',
    local: ws({
      trips: [trip('t1', T(1), { columnOrder: ['c1'] })],
      columns: [column('c1', 't1', T(1), { cardOrder: ['k1'] })],
      cards: [card('k1', 't1', 'c1', T(1), { updatedAt: T(10) })],
    }),
    remote: ws({
      trips: [trip('t1', T(1), { columnOrder: ['c1'] })],
      columns: [column('c1', 't1', T(1))],
      tombstones: [tomb('card', 'k1', T(20))],
    }),
    now: NOW,
    check: (m) => {
      expect(m.cards.k1).toBeUndefined();
      expect(m.columns.c1.cardOrder).toEqual([]);
    },
  },
  {
    name: '삭제 vs 수정 (반대 방향): 삭제 이후의 로컬 수정은 카드를 지킨다',
    local: ws({
      trips: [trip('t1', T(1), { columnOrder: ['c1'] })],
      columns: [column('c1', 't1', T(1), { cardOrder: ['k1'] })],
      cards: [card('k1', 't1', 'c1', T(1), { title: '로컬이 지킨 카드', updatedAt: T(30) })],
    }),
    remote: ws({
      trips: [trip('t1', T(1), { columnOrder: ['c1'] })],
      columns: [column('c1', 't1', T(1))],
      tombstones: [tomb('card', 'k1', T(20))],
    }),
    now: NOW,
    check: (m) => expect(m.cards.k1?.title).toBe('로컬이 지킨 카드'),
  },
  {
    name: '같은 엔티티의 툼스톤 두 개는 늦은 쪽으로 합쳐진다',
    local: ws({
      trips: [trip('t1', T(1), { columnOrder: ['c1'] })],
      columns: [column('c1', 't1', T(1), { cardOrder: ['k1'] })],
      cards: [card('k1', 't1', 'c1', T(1), { updatedAt: T(25) })],
      tombstones: [tomb('card', 'k1', T(20))],
    }),
    remote: ws({ tombstones: [tomb('card', 'k1', T(40))] }),
    now: NOW,
    check: (m) => {
      // Late delete (T40) beats the T25 edit that survived the T20 delete.
      expect(m.cards.k1).toBeUndefined();
      expect(m.tombstones.find((t) => t.id === 'k1')?.deletedAt).toBe(T(40));
    },
  },

  /* --- tombstone TTL -------------------------------------------------- */
  {
    name: '30일보다 오래된 툼스톤은 정리된다',
    local: ws({
      tombstones: [
        tomb('card', 'tooOld', NOW - TOMBSTONE_TTL_MS - 1),
        tomb('card', 'exactlyTtl', NOW - TOMBSTONE_TTL_MS),
      ],
    }),
    remote: ws({ tombstones: [tomb('day', 'fresh', NOW - 1_000)] }),
    now: NOW,
    check: (m) => {
      expect(tombIds(m, 'card')).toEqual(['exactlyTtl']);
      expect(tombIds(m, 'day')).toEqual(['fresh']);
    },
  },
  {
    name: '툼스톤 병합은 정리 전에 일어난다 (늦은 사본이 있으면 살아남는다)',
    local: ws({ tombstones: [tomb('card', 'k1', NOW - TOMBSTONE_TTL_MS - 5_000)] }),
    remote: ws({ tombstones: [tomb('card', 'k1', NOW - 1_000)] }),
    now: NOW,
    check: (m) => expect(m.tombstones).toEqual([{ id: 'k1', entity: 'card', deletedAt: NOW - 1_000 }]),
  },

  /* --- ordering arrays ------------------------------------------------ */
  {
    name: '순서 배열: 이긴 쪽의 순서를 지키고 빠진 id를 createdAt 순으로 덧붙인다',
    local: ws({
      // Local reordered its columns most recently, so its array wins…
      trips: [trip('t1', T(1), { columnOrder: ['c3', 'c1', 'c2'], updatedAt: T(50) })],
      columns: [column('c1', 't1', T(1)), column('c2', 't1', T(2)), column('c3', 't1', T(3))],
    }),
    remote: ws({
      // …but remote's two new columns still have to land somewhere.
      trips: [trip('t1', T(1), { columnOrder: ['c1', 'c2', 'c3', 'c5', 'c4'], updatedAt: T(20) })],
      columns: [
        column('c1', 't1', T(1)),
        column('c2', 't1', T(2)),
        column('c3', 't1', T(3)),
        column('c4', 't1', T(20)),
        column('c5', 't1', T(15)),
      ],
    }),
    now: NOW,
    check: (m) => {
      // Appended oldest-first regardless of how remote had them ordered.
      expect(m.trips.t1.columnOrder).toEqual(['c3', 'c1', 'c2', 'c5', 'c4']);
    },
  },
  {
    name: '순서 배열: 죽은 id는 cardOrder에서 빠진다',
    local: ws({
      trips: [trip('t1', T(1), { columnOrder: ['c1'] })],
      columns: [column('c1', 't1', T(1), { cardOrder: ['k1', 'k2', 'k3'] })],
      cards: [
        card('k1', 't1', 'c1', T(1)),
        card('k2', 't1', 'c1', T(2)),
        card('k3', 't1', 'c1', T(3)),
      ],
    }),
    remote: ws({ tombstones: [tomb('card', 'k2', T(30))] }),
    now: NOW,
    check: (m) => {
      expect(m.columns.c1.cardOrder).toEqual(['k1', 'k3']);
      expect(Object.keys(m.cards).sort()).toEqual(['k1', 'k3']);
    },
  },
  {
    name: '순서 배열: 중복 id와 유령 id가 함께 정리된다',
    local: ws({
      trips: [trip('t1', T(1), { columnOrder: ['c1', 'c1', 'ghost'] })],
      columns: [column('c1', 't1', T(1))],
    }),
    remote: ws({ trips: [trip('t1', T(1), { columnOrder: ['c1'] })] }),
    now: NOW,
    check: (m) => expect(m.trips.t1.columnOrder).toEqual(['c1']),
  },
  {
    name: '순서 배열: sheetOrder와 dayOrder도 함께 조정된다',
    local: ws({
      trips: [trip('t1', T(1), { sheetOrder: ['s1'], updatedAt: T(50) })],
      sheets: [sheet('s1', 't1', T(1), { dayOrder: ['d1'], updatedAt: T(50) })],
      days: [day('d1', 't1', 's1', T(1))],
    }),
    remote: ws({
      trips: [trip('t1', T(1), { sheetOrder: ['s1', 's2'], updatedAt: T(10) })],
      sheets: [
        sheet('s1', 't1', T(1), { dayOrder: ['d1', 'd2'], updatedAt: T(10) }),
        sheet('s2', 't1', T(9), { dayOrder: [] }),
      ],
      days: [day('d1', 't1', 's1', T(1)), day('d2', 't1', 's1', T(9))],
    }),
    now: NOW,
    check: (m) => {
      expect(m.trips.t1.sheetOrder).toEqual(['s1', 's2']);
      expect(m.sheets.s1.dayOrder).toEqual(['d1', 'd2']);
    },
  },

  /* --- referential integrity ------------------------------------------ */
  {
    name: '고아 정리: 카드가 사라진 엔트리는 삭제되고 툼스톤이 남는다',
    local: ws({
      trips: [trip('t1', T(1), { columnOrder: ['c1'], sheetOrder: ['s1'] })],
      columns: [column('c1', 't1', T(1), { cardOrder: ['k1'] })],
      cards: [card('k1', 't1', 'c1', T(1), { updatedAt: T(10) })],
      sheets: [sheet('s1', 't1', T(1), { dayOrder: ['d1'] })],
      days: [day('d1', 't1', 's1', T(1))],
      entries: [entry('e1', 't1', 'k1', 'd1', T(1))],
    }),
    remote: ws({ tombstones: [tomb('card', 'k1', T(30))] }),
    now: NOW,
    check: (m) => {
      expect(m.cards).toEqual({});
      expect(m.entries).toEqual({});
      expect(tombIds(m, 'entry')).toEqual(['e1']);
      expect(m.tombstones.find((t) => t.id === 'e1')?.deletedAt).toBe(NOW);
    },
  },
  {
    name: '고아 정리: 날짜가 사라진 엔트리도 삭제된다',
    local: ws({
      trips: [trip('t1', T(1), { columnOrder: ['c1'], sheetOrder: ['s1'] })],
      columns: [column('c1', 't1', T(1), { cardOrder: ['k1'] })],
      cards: [card('k1', 't1', 'c1', T(1))],
      sheets: [sheet('s1', 't1', T(1), { dayOrder: ['d1'] })],
      days: [day('d1', 't1', 's1', T(1), { updatedAt: T(10) })],
      entries: [entry('e1', 't1', 'k1', 'd1', T(1))],
    }),
    remote: ws({ tombstones: [tomb('day', 'd1', T(30))] }),
    now: NOW,
    check: (m) => {
      expect(m.days).toEqual({});
      expect(m.entries).toEqual({});
      expect(m.sheets.s1.dayOrder).toEqual([]);
      // The card itself is untouched — it just goes back to 미배치.
      expect(m.cards.k1).toBeDefined();
      expect(tombIds(m, 'entry')).toEqual(['e1']);
    },
  },
  {
    name: '고아 정리: 시트가 사라지면 그 날짜와 엔트리가 함께 사라진다',
    local: ws({
      trips: [trip('t1', T(1), { columnOrder: ['c1'], sheetOrder: ['s1'] })],
      columns: [column('c1', 't1', T(1), { cardOrder: ['k1'] })],
      cards: [card('k1', 't1', 'c1', T(1))],
      sheets: [sheet('s1', 't1', T(1), { dayOrder: ['d1'], updatedAt: T(10) })],
      days: [day('d1', 't1', 's1', T(1))],
      entries: [entry('e1', 't1', 'k1', 'd1', T(1))],
    }),
    remote: ws({ tombstones: [tomb('sheet', 's1', T(30))] }),
    now: NOW,
    check: (m) => {
      expect(m.sheets).toEqual({});
      expect(m.days).toEqual({});
      expect(m.entries).toEqual({});
      expect(m.trips.t1.sheetOrder).toEqual([]);
      expect(tombIds(m, 'day')).toEqual(['d1']);
      expect(tombIds(m, 'entry')).toEqual(['e1']);
    },
  },
  {
    name: '고아 정리: 칸이 사라진 카드는 그 여행의 첫 칸으로 옮겨진다',
    local: ws({
      trips: [trip('t1', T(1), { columnOrder: ['c1', 'c2'] })],
      columns: [
        column('c1', 't1', T(1), { cardOrder: [] }),
        column('c2', 't1', T(2), { cardOrder: ['k1'], updatedAt: T(10) }),
      ],
      cards: [card('k1', 't1', 'c2', T(5))],
    }),
    remote: ws({ tombstones: [tomb('column', 'c2', T(30))] }),
    now: NOW,
    check: (m) => {
      expect(m.columns.c2).toBeUndefined();
      expect(m.cards.k1?.columnId).toBe('c1');
      expect(m.columns.c1.cardOrder).toEqual(['k1']);
      expect(m.trips.t1.columnOrder).toEqual(['c1']);
      // The card was re-homed, not deleted.
      expect(tombIds(m, 'card')).toEqual([]);
    },
  },
  {
    name: '고아 정리: 남은 칸이 없으면 카드도 삭제된다',
    local: ws({
      trips: [trip('t1', T(1), { columnOrder: ['c1'] })],
      columns: [column('c1', 't1', T(1), { cardOrder: ['k1'], updatedAt: T(10) })],
      cards: [card('k1', 't1', 'c1', T(5))],
    }),
    remote: ws({ tombstones: [tomb('column', 'c1', T(30))] }),
    now: NOW,
    check: (m) => {
      expect(m.cards).toEqual({});
      expect(tombIds(m, 'card')).toEqual(['k1']);
      expect(m.trips.t1.columnOrder).toEqual([]);
    },
  },
  {
    name: '고아 정리: 여행이 사라지면 그 아래가 모두 사라진다',
    local: ws({
      trips: [trip('t1', T(1), { columnOrder: ['c1'], sheetOrder: ['s1'], updatedAt: T(10) })],
      columns: [column('c1', 't1', T(1), { cardOrder: ['k1'] })],
      cards: [card('k1', 't1', 'c1', T(1))],
      sheets: [sheet('s1', 't1', T(1), { dayOrder: ['d1'] })],
      days: [day('d1', 't1', 's1', T(1))],
      entries: [entry('e1', 't1', 'k1', 'd1', T(1))],
    }),
    remote: ws({ tombstones: [tomb('trip', 't1', T(30))] }),
    now: NOW,
    check: (m) => {
      expect(m).toMatchObject({
        trips: {},
        sheets: {},
        columns: {},
        cards: {},
        days: {},
        entries: {},
      });
      expect(tombIds(m, 'column')).toEqual(['c1']);
      expect(tombIds(m, 'card')).toEqual(['k1']);
      expect(tombIds(m, 'sheet')).toEqual(['s1']);
      expect(tombIds(m, 'day')).toEqual(['d1']);
      expect(tombIds(m, 'entry')).toEqual(['e1']);
    },
  },
  {
    name: '리모트에만 있던 트리는 통째로 살아 들어온다',
    local: ws(),
    remote: ws({
      trips: [trip('t1', T(1), { columnOrder: ['c1'], sheetOrder: ['s1'] })],
      columns: [column('c1', 't1', T(1), { cardOrder: ['k1'] })],
      cards: [card('k1', 't1', 'c1', T(1))],
      sheets: [sheet('s1', 't1', T(1), { dayOrder: ['d1'] })],
      days: [day('d1', 't1', 's1', T(1))],
      entries: [entry('e1', 't1', 'k1', 'd1', T(1))],
    }),
    now: NOW,
    check: (m) => {
      expect(Object.keys(m.entries)).toEqual(['e1']);
      expect(m.tombstones).toEqual([]);
      expect(m.columns.c1.cardOrder).toEqual(['k1']);
    },
  },

  /* --- M6: 지출 / 코멘트 ride along on the card ---------------------- */
  {
    // These are card *subfields*, and the merge is entity-level LWW: the
    // newer card wins its whole ledger. Two devices each adding one expense
    // therefore keep one list, not the union — the accepted trade for a
    // sync model with no operation log.
    name: '카드 지출/코멘트는 카드 단위 LWW로 최신본이 통째로 이긴다',
    local: ws({
      trips: [trip('t1', T(1), { columnOrder: ['c1'] })],
      columns: [column('c1', 't1', T(1), { cardOrder: ['k1'] })],
      cards: [
        card('k1', 't1', 'c1', T(1), {
          updatedAt: T(30),
          expenses: [
            { id: 'x1', amount: 12_000, label: '점심', at: T(20) },
            { id: 'x2', amount: 3_000, at: T(30) },
          ],
          comments: [{ id: 'm1', text: '줄 서야 함', at: T(30) }],
        }),
      ],
    }),
    remote: ws({
      trips: [trip('t1', T(1), { columnOrder: ['c1'] })],
      columns: [column('c1', 't1', T(1), { cardOrder: ['k1'] })],
      cards: [
        card('k1', 't1', 'c1', T(1), {
          updatedAt: T(10),
          expenses: [{ id: 'x1', amount: 12_000, label: '점심', at: T(20) }],
        }),
      ],
    }),
    now: NOW,
    check: (m) => {
      expect(m.cards.k1.expenses?.map((item) => item.id)).toEqual(['x1', 'x2']);
      expect(m.cards.k1.comments?.map((item) => item.text)).toEqual(['줄 서야 함']);
    },
  },
  {
    name: 'M6 필드가 없는 예전 카드도 그대로 살아남는다 (하위 호환)',
    local: ws({
      trips: [trip('t1', T(1), { columnOrder: ['c1'] })],
      columns: [column('c1', 't1', T(1), { cardOrder: ['k1', 'k2'] })],
      cards: [
        card('k1', 't1', 'c1', T(1), { updatedAt: T(5) }),
        card('k2', 't1', 'c1', T(2), {
          updatedAt: T(40),
          expenses: [{ id: 'x9', amount: 500, at: T(40) }],
          comments: [{ id: 'm9', text: '현금만', at: T(40) }],
        }),
      ],
    }),
    remote: ws({
      trips: [trip('t1', T(1), { columnOrder: ['c1'] })],
      columns: [column('c1', 't1', T(1), { cardOrder: ['k1', 'k2'] })],
      cards: [
        card('k1', 't1', 'c1', T(1), { updatedAt: T(5) }),
        card('k2', 't1', 'c1', T(2), { updatedAt: T(2) }),
      ],
    }),
    now: NOW,
    check: (m) => {
      expect(m.schemaVersion).toBe(1);
      expect(m.cards.k1.expenses).toBeUndefined();
      expect(m.cards.k1.comments).toBeUndefined();
      expect(m.cards.k2.expenses).toHaveLength(1);
      expect(m.cards.k2.comments).toHaveLength(1);
    },
  },
  {
    // M10: 사진도 카드에 얹혀 카드 통째 LWW를 탄다. 병합 규칙을 새로 만들지
    // 않은 이유이자, 그래서 확인해 둬야 하는 것 — 사진 없는 예전 카드는 그대로
    // 살아남고, 사진이 붙은 카드는 메타데이터가 한 장도 상하지 않고 건너간다.
    name: 'M10 사진 메타데이터가 카드 LWW로 왕복한다',
    local: ws({
      trips: [trip('t1', T(1), { columnOrder: ['c1'] })],
      columns: [column('c1', 't1', T(1), { cardOrder: ['k1', 'k2'] })],
      cards: [
        card('k1', 't1', 'c1', T(1), { updatedAt: T(5) }),
        card('k2', 't1', 'c1', T(2), {
          updatedAt: T(60),
          photos: [
            { id: 'ph1', w: 1_600, h: 1_200, bytes: 240_000, createdAt: T(50) },
            { id: 'ph2', w: 900, h: 1_600, bytes: 180_000, createdAt: T(60) },
          ],
        }),
      ],
    }),
    remote: ws({
      trips: [trip('t1', T(1), { columnOrder: ['c1'] })],
      columns: [column('c1', 't1', T(1), { cardOrder: ['k1', 'k2'] })],
      cards: [
        card('k1', 't1', 'c1', T(1), { updatedAt: T(5) }),
        // The server's copy predates both photos — the newer card wins whole.
        card('k2', 't1', 'c1', T(2), { updatedAt: T(2) }),
      ],
    }),
    now: NOW,
    check: (m) => {
      expect(m.schemaVersion).toBe(1);
      expect(m.cards.k1.photos).toBeUndefined();
      expect(m.cards.k2.photos?.map((item) => item.id)).toEqual(['ph1', 'ph2']);
      expect(m.cards.k2.photos?.[0]).toEqual({
        id: 'ph1',
        w: 1_600,
        h: 1_200,
        bytes: 240_000,
        createdAt: T(50),
      });
    },
  },
];

/* ------------------------------------------------------------------ *
 * Suites
 * ------------------------------------------------------------------ */

describe('merge', () => {
  it.each(cases.map((c) => [c.name, c] as const))('%s', (_name, testCase) => {
    testCase.check(merge(testCase.local, testCase.remote, testCase.now));
  });

  it('빈 워크스페이스끼리 병합해도 schemaVersion 1을 유지한다', () => {
    const merged = merge(ws(), ws(), NOW);
    expect(merged.schemaVersion).toBe(1);
    expect(merged).toEqual(ws());
  });

  it('입력을 변형하지 않는다', () => {
    const local = ws({
      trips: [trip('t1', T(1), { columnOrder: ['c1', 'gone'] })],
      columns: [column('c1', 't1', T(1), { cardOrder: ['k1'] })],
      cards: [card('k1', 't1', 'c1', T(1))],
    });
    const remote = ws({ tombstones: [tomb('card', 'k1', T(30))] });
    const localSnapshot = structuredClone(local);
    const remoteSnapshot = structuredClone(remote);

    merge(local, remote, NOW);

    expect(local).toEqual(localSnapshot);
    expect(remote).toEqual(remoteSnapshot);
  });

  it('TOMBSTONE_TTL_MS는 30일이다', () => {
    expect(TOMBSTONE_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });
});

describe('merge — 멱등성', () => {
  it.each(cases.map((c) => [c.name, c] as const))(
    'merge(a, merge(a, b)) === merge(a, b) — %s',
    (_name, testCase) => {
      const once = merge(testCase.local, testCase.remote, testCase.now);
      const twice = merge(testCase.local, once, testCase.now);
      expect(twice).toEqual(once);
    },
  );

  it('세 번 접어도 더 이상 변하지 않는다', () => {
    const local = cases[cases.length - 2].local;
    const remote = cases[cases.length - 2].remote;
    const once = merge(local, remote, NOW);
    const twice = merge(local, once, NOW);
    const thrice = merge(local, twice, NOW);
    expect(thrice).toEqual(twice);
  });

  it('병합 결과를 리모트에 되먹여도 안정적이다 (양방향)', () => {
    const local = ws({
      trips: [trip('t1', T(1), { columnOrder: ['c1', 'c2'], updatedAt: T(50) })],
      columns: [column('c1', 't1', T(1)), column('c2', 't1', T(2))],
      cards: [card('k1', 't1', 'c1', T(3))],
    });
    const remote = ws({
      trips: [trip('t1', T(1), { columnOrder: ['c2', 'c1'], updatedAt: T(20) })],
      columns: [column('c1', 't1', T(1)), column('c2', 't1', T(2))],
      cards: [card('k2', 't1', 'c2', T(4))],
    });

    const merged = merge(local, remote, NOW);
    expect(merge(merged, merged, NOW)).toEqual(merged);
    expect(merge(remote, merged, NOW)).toEqual(merged);
  });
});

/* ------------------------------------------------------------------ *
 * seenBy — 누가 봤는지 (M13)
 * ------------------------------------------------------------------ */

describe('merge — seenBy', () => {
  it('양쪽 다 없으면 필드를 만들지 않는다', () => {
    const merged = merge(ws(), ws(), NOW);
    expect(merged.seenBy).toBeUndefined();
    // 없던 필드가 `{}`로 생기면 그것만으로 "달라졌다"가 되어 무의미한 푸시를
    // 부른다.
    expect(workspaceEquals(merged, ws())).toBe(true);
  });

  it('두 기기의 키가 모두 살아남고, 같은 키는 큰 쪽(최신)이 이긴다', () => {
    const local: Workspace = { ...ws(), seenBy: { song: T(100), hoyabom: T(10) } };
    const remote: Workspace = { ...ws(), seenBy: { hoyabom: T(50), ghost: T(7) } };

    const merged = merge(local, remote, NOW);
    expect(merged.seenBy).toEqual({ song: T(100), hoyabom: T(50), ghost: T(7) });

    // 엔티티 LWW의 타이브레이크와 달리 순수한 max다 — 인자 순서와 무관하다.
    expect(merge(remote, local, NOW).seenBy).toEqual(merged.seenBy);
  });

  it('한쪽에만 있으면 그대로 넘어온다 (양방향)', () => {
    const seen = { song: T(3) };
    expect(merge({ ...ws(), seenBy: seen }, ws(), NOW).seenBy).toEqual(seen);
    expect(merge(ws(), { ...ws(), seenBy: seen }, NOW).seenBy).toEqual(seen);
  });

  it('숫자가 아닌 값은 버린다 (손상된 백업/구버전 방어)', () => {
    const local = {
      ...ws(),
      seenBy: { song: 'yesterday', hoyabom: T(4) },
    } as unknown as Workspace;

    expect(merge(local, ws(), NOW).seenBy).toEqual({ hoyabom: T(4) });
  });

  it('멱등이다', () => {
    const local: Workspace = { ...ws(), seenBy: { song: T(100) } };
    const remote: Workspace = { ...ws(), seenBy: { hoyabom: T(50) } };
    const once = merge(local, remote, NOW);
    expect(merge(local, once, NOW)).toEqual(once);
    expect(merge(once, once, NOW)).toEqual(once);
  });

  it('workspaceEquals가 seenBy 차이를 본다', () => {
    const a: Workspace = { ...ws(), seenBy: { song: T(1) } };
    const b: Workspace = { ...ws(), seenBy: { song: T(2) } };
    expect(workspaceEquals(a, a)).toBe(true);
    expect(workspaceEquals(a, b)).toBe(false);
    expect(workspaceEquals(a, ws())).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * memos — 메모 스레드 (M21)
 * ------------------------------------------------------------------ */

describe('merge — memos', () => {
  /** A workspace with one trip and whatever memos the case needs. */
  const withMemos = (memos: MemoMessage[], parts: Parts = {}): Workspace => ({
    ...ws({ trips: [trip('t1', T(1))], ...parts }),
    memos: byId(memos),
  });

  it('양쪽 다 없으면 필드를 만들지 않는다 — M21 이전 워크스페이스는 그대로다', () => {
    const before = ws({ trips: [trip('t1', T(1))] });
    const merged = merge(before, before, NOW);
    expect(merged.memos).toBeUndefined();
    expect(workspaceEquals(merged, before)).toBe(true);
  });

  it('메시지도 엔티티 LWW다 — 늦게 고친 쪽이 이긴다', () => {
    const local = withMemos([memo('m1', 't1', T(5), { text: '로컬', updatedAt: T(20) })]);
    const remote = withMemos([memo('m1', 't1', T(5), { text: '리모트', updatedAt: T(10) })]);

    expect(merge(local, remote, NOW).memos?.m1.text).toBe('로컬');
    // 무승부는 다른 엔티티와 똑같이 리모트가 가져간다.
    const tie = withMemos([memo('m1', 't1', T(5), { text: '리모트', updatedAt: T(20) })]);
    expect(merge(local, tie, NOW).memos?.m1.text).toBe('리모트');
  });

  it('각 기기가 따로 쓴 메시지는 둘 다 살아남는다', () => {
    const local = withMemos([memo('m1', 't1', T(5), { by: 'song' })]);
    const remote = withMemos([memo('m2', 't1', T(6), { by: 'hoyabom' })]);

    const merged = merge(local, remote, NOW);
    expect(Object.keys(merged.memos ?? {}).sort()).toEqual(['m1', 'm2']);
  });

  it('소프트 삭제는 그냥 최신 수정이라 병합을 그대로 통과한다', () => {
    const removed = memo('m1', 't1', T(5), {
      text: undefined,
      photos: undefined,
      removedAt: T(30),
      updatedAt: T(30),
    });
    const local = withMemos([removed]);
    const remote = withMemos([memo('m1', 't1', T(5), { text: '아직 살아있는 사본' })]);

    const merged = merge(local, remote, NOW);
    expect(merged.memos?.m1.removedAt).toBe(T(30));
    expect(merged.memos?.m1.text).toBeUndefined();
    // 톰스톤은 하나도 생기지 않는다 — 그게 이 설계의 핵심이다.
    expect(merged.tombstones).toEqual([]);
  });

  it('여행이 사라진 메모는 조용히 버려진다 (톰스톤 없이, 양쪽이 같은 답을 낸다)', () => {
    const orphan: Workspace = { ...ws(), memos: byId([memo('m1', 'gone', T(5))]) };
    const merged = merge(orphan, ws(), NOW);

    expect(merged.memos).toBeUndefined();
    expect(merged.tombstones).toEqual([]);
    // 결정이 순수하니 인자 순서와 무관하고, 다시 병합해도 흔들리지 않는다.
    expect(merge(ws(), orphan, NOW).memos).toBeUndefined();
    expect(merge(merged, merged, NOW)).toEqual(merged);
  });

  it('여행 톰스톤이 이기면 그 스레드도 함께 사라진다', () => {
    const local = withMemos([memo('m1', 't1', T(5))]);
    const remote: Workspace = { ...ws({ tombstones: [tomb('trip', 't1', T(50))] }) };

    const merged = merge(local, remote, NOW);
    expect(merged.trips.t1).toBeUndefined();
    expect(merged.memos).toBeUndefined();
  });

  it('빈 결과는 `{}`가 아니라 undefined다 — 무의미한 푸시를 부르지 않는다', () => {
    const empty: Workspace = { ...ws({ trips: [trip('t1', T(1))] }), memos: {} };
    expect(merge(empty, empty, NOW).memos).toBeUndefined();
  });

  it('멱등이다', () => {
    const local = withMemos([memo('m1', 't1', T(5))]);
    const remote = withMemos([memo('m2', 't1', T(6))]);
    const once = merge(local, remote, NOW);
    expect(merge(local, once, NOW)).toEqual(once);
    expect(merge(once, once, NOW)).toEqual(once);
  });

  it('workspaceEquals가 메모 차이를 본다', () => {
    const a = withMemos([memo('m1', 't1', T(5), { text: '하나' })]);
    const b = withMemos([memo('m1', 't1', T(5), { text: '둘' })]);
    expect(workspaceEquals(a, a)).toBe(true);
    expect(workspaceEquals(a, b)).toBe(false);
    expect(workspaceEquals(a, ws({ trips: [trip('t1', T(1))] }))).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * drawPages — 드로우 (M52a)
 *
 * 여기서 지키는 것은 하나다: **두 사람이 같은 페이지에 동시에 그리면 두 그림이
 * 다 남는다.** 페이지를 통째로 LWW하면 늦게 저장한 쪽이 상대의 획을 지우는데,
 * 그건 병합이 아니라 덮어쓰기다.
 * ------------------------------------------------------------------ */

describe('merge — drawPages', () => {
  const sticker = (id: Id, at: Millis, over: Partial<DrawSticker> = {}): DrawElement => ({
    id,
    updatedAt: at,
    type: 'sticker',
    x: 100,
    y: 100,
    emoji: '📍',
    size: 48,
    ...over,
  });

  const page = (id: Id, at: Millis, over: Partial<DrawPage> = {}): DrawPage => ({
    id,
    tripId: 't1',
    title: `페이지 ${id}`,
    elements: {},
    elementOrder: [],
    createdAt: at,
    updatedAt: at,
    ...over,
  });

  /** 요소 목록을 든 페이지 — 순서 배열은 준 순서 그대로. */
  const withElements = (id: Id, at: Millis, elements: DrawElement[], over: Partial<DrawPage> = {}) =>
    page(id, at, {
      elements: byId(elements),
      elementOrder: elements.map((element) => element.id),
      ...over,
    });

  const wsPages = (pages: DrawPage[], order?: Id[]): Workspace => ({
    ...ws({ trips: [trip('t1', T(1), order ? { drawPageOrder: order } : {})] }),
    drawPages: byId(pages),
  });

  it('양쪽 다 없으면 필드를 만들지 않는다 — M52a 이전 워크스페이스는 그대로다', () => {
    const before = ws({ trips: [trip('t1', T(1))] });
    const merged = merge(before, before, NOW);
    expect(merged.drawPages).toBeUndefined();
    expect(merged.trips.t1.drawPageOrder).toBeUndefined();
    expect(workspaceEquals(merged, before)).toBe(true);
  });

  it('동시에 그린 두 획이 **둘 다** 남는다', () => {
    const local = wsPages([withElements('p1', T(5), [sticker('a', T(10))])], ['p1']);
    const remote = wsPages([withElements('p1', T(6), [sticker('b', T(11))])], ['p1']);

    const merged = merge(local, remote, NOW);
    const page1 = merged.drawPages!.p1;
    expect(Object.keys(page1.elements).sort()).toEqual(['a', 'b']);
    // 그리고 순서 배열이 둘 다 안다 — 그리지 않는 요소가 남아 있으면 안 된다.
    expect([...page1.elementOrder].sort()).toEqual(['a', 'b']);
  });

  it('같은 요소를 둘이 고치면 늦게 고친 쪽이 이긴다 (요소 단위 LWW)', () => {
    const local = wsPages([withElements('p1', T(5), [sticker('a', T(20), { x: 10 })])], ['p1']);
    const remote = wsPages([withElements('p1', T(5), [sticker('a', T(10), { x: 90 })])], ['p1']);

    const merged = merge(local, remote, NOW);
    expect((merged.drawPages!.p1.elements.a as DrawSticker).x).toBe(10);
  });

  it('한쪽이 지운 요소는 상대가 손대지 않았으면 지워진 채로 간다', () => {
    const local = wsPages([withElements('p1', T(5), [sticker('a', T(9))])], ['p1']);
    const remote = wsPages(
      [withElements('p1', T(6), [sticker('a', T(20), { deletedAt: T(20) })])],
      ['p1'],
    );

    const merged = merge(local, remote, NOW);
    expect(merged.drawPages!.p1.elements.a.deletedAt).toBe(T(20));
    // 도장은 남아 있다 — 그것이 상대에게 「지웠다」고 말하는 유일한 방법이다.
    expect(merged.drawPages!.p1.elementOrder).toContain('a');
  });

  it('지운 뒤에 상대가 옮겼으면 살아난다 — 톰스톤과 같은 판정이다', () => {
    const local = wsPages([withElements('p1', T(5), [sticker('a', T(30), { x: 55 })])], ['p1']);
    const remote = wsPages(
      [withElements('p1', T(6), [sticker('a', T(20), { deletedAt: T(20) })])],
      ['p1'],
    );

    const merged = merge(local, remote, NOW);
    expect(merged.drawPages!.p1.elements.a.deletedAt).toBeUndefined();
    expect((merged.drawPages!.p1.elements.a as DrawSticker).x).toBe(55);
  });

  it('페이지 껍데기(제목)는 평범한 엔티티 LWW다', () => {
    const local = wsPages([page('p1', T(5), { title: '로컬', updatedAt: T(30) })], ['p1']);
    const remote = wsPages([page('p1', T(5), { title: '리모트', updatedAt: T(10) })], ['p1']);
    expect(merge(local, remote, NOW).drawPages!.p1.title).toBe('로컬');
  });

  it('제목을 고친 쪽이 이겨도 상대의 획은 남는다 — 껍데기와 내용은 따로 간다', () => {
    const local = wsPages(
      [withElements('p1', T(30), [sticker('a', T(10))], { title: '새 이름' })],
      ['p1'],
    );
    const remote = wsPages([withElements('p1', T(6), [sticker('b', T(11))])], ['p1']);

    const merged = merge(local, remote, NOW);
    expect(merged.drawPages!.p1.title).toBe('새 이름');
    expect(Object.keys(merged.drawPages!.p1.elements).sort()).toEqual(['a', 'b']);
  });

  it('오래 지나간 삭제 도장은 걷힌다 (톰스톤 GC와 같은 시계)', () => {
    const old = T(5) - TOMBSTONE_TTL_MS;
    const local = wsPages(
      [
        withElements('p1', T(5), [
          sticker('a', old, { deletedAt: old }),
          sticker('b', T(5)),
        ]),
      ],
      ['p1'],
    );

    const merged = merge(local, local, NOW);
    expect(merged.drawPages!.p1.elements.a).toBeUndefined();
    expect(merged.drawPages!.p1.elementOrder).toEqual(['b']);
  });

  it('오래 지나간 페이지 삭제도 걷힌다', () => {
    const old = T(5) - TOMBSTONE_TTL_MS;
    const local = wsPages([page('p1', old, { deletedAt: old })], ['p1']);
    const merged = merge(local, local, NOW);
    expect(merged.drawPages).toBeUndefined();
    expect(merged.trips.t1.drawPageOrder).toEqual([]);
  });

  it('여행이 사라지면 그 스케치북도 사라진다 (톰스톤 없이)', () => {
    const local = wsPages([withElements('p1', T(5), [sticker('a', T(10))])], ['p1']);
    const remote: Workspace = { ...ws({ tombstones: [tomb('trip', 't1', T(50))] }) };

    const merged = merge(local, remote, NOW);
    expect(merged.trips.t1).toBeUndefined();
    expect(merged.drawPages).toBeUndefined();
  });

  it('drawPageOrder는 살아남은 페이지에 맞춰 재조정된다', () => {
    const local = wsPages([page('p1', T(5)), page('p2', T(6))], ['ghost', 'p2', 'p2']);
    const merged = merge(local, local, NOW);
    // 없는 id와 중복은 빠지고, 배열이 모르던 페이지는 오래된 것부터 뒤에 붙는다.
    expect(merged.trips.t1.drawPageOrder).toEqual(['p2', 'p1']);
  });

  it('멱등이다', () => {
    const local = wsPages([withElements('p1', T(5), [sticker('a', T(10))])], ['p1']);
    const remote = wsPages([withElements('p1', T(6), [sticker('b', T(11))])], ['p1']);
    const once = merge(local, remote, NOW);
    expect(merge(local, once, NOW)).toEqual(once);
    expect(merge(once, once, NOW)).toEqual(once);
  });

  /* ---------------------------------------------------------------- *
   * M52a-fix — 「이름 변경이 상대의 획 하나에 덮인다」와 그 이웃들
   * ---------------------------------------------------------------- */

  it('이름 변경(먼저) vs 획 추가(나중) — 이름이 살아남는다 (C5)', () => {
    // A는 이름을 바꿨다: 껍데기의 시각이 앞으로 간다.
    const a = wsPages([page('p1', T(5), { title: '난바 밤', updatedAt: T(30) })], ['p1']);
    // B는 **나중에** 획 하나를 그렸다 — 그래도 껍데기 시각은 그대로다
    // (`putPageBody`, M52a-fix ①). 그것이 이 판정의 전부다.
    const b = wsPages([withElements('p1', T(5), [sticker('x', T(60))])], ['p1']);

    for (const merged of [merge(a, b, NOW), merge(b, a, NOW)]) {
      expect(merged.drawPages!.p1.title).toBe('난바 밤');
      expect(Object.keys(merged.drawPages!.p1.elements)).toEqual(['x']);
    }
  });

  it('획 추가(먼저) vs 이름 변경(나중) — 이름이 이기고 획도 남는다 (C5b)', () => {
    const a = wsPages([withElements('p1', T(5), [sticker('x', T(10))])], ['p1']);
    const b = wsPages([page('p1', T(5), { title: '난바 밤', updatedAt: T(30) })], ['p1']);

    for (const merged of [merge(a, b, NOW), merge(b, a, NOW)]) {
      expect(merged.drawPages!.p1.title).toBe('난바 밤');
      expect(Object.keys(merged.drawPages!.p1.elements)).toEqual(['x']);
    }
  });

  it('둘이 동시에 그린 요소는 **순서 배열에서도** 둘 다 제자리를 지킨다', () => {
    // 공통 앞부분 [a] 위에 각자 하나씩 얹었다.
    const local = wsPages(
      [withElements('p1', T(5), [sticker('a', T(10)), sticker('mine', T(20))])],
      ['p1'],
    );
    const remote = wsPages(
      [withElements('p1', T(5), [sticker('a', T(10)), sticker('yours', T(21))])],
      ['p1'],
    );

    // 어느 쪽에서 합치든 **셋 다** 순서 배열에 있고 공통 앞부분은 그대로다.
    // (동점은 `mergeMap`과 같은 이유로 remote가 이기므로, 두 새 요소의 앞뒤는
    // 합치는 방향에 따라 갈린다 — 층이 하나 뒤바뀌는 것과 요소가 사라지는 것은
    // 다른 크기의 일이다.)
    for (const merged of [merge(local, remote, NOW), merge(remote, local, NOW)]) {
      const order = merged.drawPages!.p1.elementOrder;
      expect(order[0]).toBe('a');
      expect([...order].sort()).toEqual(['a', 'mine', 'yours']);
    }
  });

  it('페이지 순서 변경이 상대의 페이지 추가에 덮이지 않는다 (C8)', () => {
    const pages = [page('p1', T(1)), page('p2', T(2)), page('p3', T(3))];
    // A: 순서를 손으로 바꿨다 — 여행의 도장이 그때 찍힌다.
    const a: Workspace = {
      ...wsPages(pages, ['p1', 'p3', 'p2']),
      trips: byId([trip('t1', T(1), { drawPageOrder: ['p1', 'p3', 'p2'], updatedAt: T(50) })]),
    };
    // B: **나중에** 페이지를 하나 더했다 — 그것은 여행의 도장을 찍지 않는다
    // (`addDrawPage`, M52a-fix ③). 그래서 A의 순서가 이긴다.
    const b: Workspace = {
      ...wsPages([...pages, page('p4', T(9))], ['p1', 'p2', 'p3', 'p4']),
      trips: byId([trip('t1', T(1), { drawPageOrder: ['p1', 'p2', 'p3', 'p4'] })]),
    };

    for (const merged of [merge(a, b, NOW), merge(b, a, NOW)]) {
      // 새 페이지는 사라지지 않고, 사람이 만든 순서는 지켜진다.
      expect(merged.drawPages!.p4).toBeDefined();
      expect(merged.trips.t1.drawPageOrder).toEqual(['p1', 'p3', 'p2', 'p4']);
    }
  });

  it('지운 뒤에 상대가 그렸으면 페이지가 살아난다 (C7)', () => {
    // A가 T(30)에 지웠다. B는 그것을 모른 채 T(60)에 획 하나를 그렸다.
    const a = wsPages([page('p1', T(5), { deletedAt: T(30), updatedAt: T(30) })], ['p1']);
    const b = wsPages([withElements('p1', T(5), [sticker('x', T(60))])], ['p1']);

    for (const merged of [merge(a, b, NOW), merge(b, a, NOW)]) {
      expect(merged.drawPages!.p1.deletedAt).toBeUndefined();
      expect(Object.keys(merged.drawPages!.p1.elements)).toEqual(['x']);
    }
  });

  it('지우기 전에 그린 획은 페이지를 되살리지 못한다', () => {
    const a = wsPages([page('p1', T(5), { deletedAt: T(30), updatedAt: T(30) })], ['p1']);
    const b = wsPages([withElements('p1', T(5), [sticker('x', T(10))])], ['p1']);

    for (const merged of [merge(a, b, NOW), merge(b, a, NOW)]) {
      expect(merged.drawPages!.p1.deletedAt).toBe(T(30));
    }
  });

  it('배경 사진도 껍데기라 LWW로 갈린다 (M52b)', () => {
    const a = wsPages(
      [page('p1', T(5), { background: { photoId: 'ph-a', opacity: 1 }, updatedAt: T(30) })],
      ['p1'],
    );
    const b = wsPages(
      [withElements('p1', T(5), [sticker('x', T(60))], { background: { photoId: 'ph-b' } })],
      ['p1'],
    );

    const merged = merge(a, b, NOW);
    expect(merged.drawPages!.p1.background).toEqual({ photoId: 'ph-a', opacity: 1 });
    expect(Object.keys(merged.drawPages!.p1.elements)).toEqual(['x']);
  });

  it('workspaceEquals가 획 하나의 차이를 본다', () => {
    const a = wsPages([withElements('p1', T(5), [sticker('a', T(10), { x: 10 })])], ['p1']);
    const b = wsPages([withElements('p1', T(5), [sticker('a', T(10), { x: 11 })])], ['p1']);
    expect(workspaceEquals(a, a)).toBe(true);
    expect(workspaceEquals(a, b)).toBe(false);
  });
});
