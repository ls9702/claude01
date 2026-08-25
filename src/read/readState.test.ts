import { describe, expect, it } from 'vitest';
import { emptyWorkspace, type Card, type Id, type MemoMessage, type Millis, type Workspace } from '../types/models';
import {
  cardReadKey,
  cardsWithUnreadComments,
  firstUnreadIndex,
  hasUnreadComments,
  latestCommentStamp,
  latestSeenStamp,
  memoReadKey,
  unreadMemos,
} from './readState';

const trip = (id: Id): Workspace['trips'][Id] => ({
  id,
  title: `여행 ${id}`,
  currency: 'KRW',
  columnOrder: [],
  sheetOrder: [],
  createdAt: 1,
  updatedAt: 1,
});

const memo = (
  id: Id,
  tripId: Id,
  createdAt: Millis,
  over: Partial<MemoMessage> = {},
): MemoMessage => ({
  id,
  tripId,
  text: `메시지 ${id}`,
  createdAt,
  updatedAt: createdAt,
  ...over,
});

const card = (id: Id, comments: Card['comments'] = []): Card => ({
  id,
  tripId: 't1',
  columnId: 'c1',
  title: `카드 ${id}`,
  comments,
  createdAt: 1,
  updatedAt: 1,
});

/** A workspace holding one trip and whatever messages / stamps are handed in. */
function workspaceOf(
  memos: MemoMessage[],
  seenBy?: Record<string, Millis>,
  tripIds: Id[] = ['t1'],
): Workspace {
  const ws = emptyWorkspace();
  for (const id of tripIds) ws.trips[id] = trip(id);
  ws.memos = Object.fromEntries(memos.map((m) => [m.id, m]));
  if (seenBy) ws.seenBy = seenBy;
  return ws;
}

describe('memoReadKey / cardReadKey', () => {
  it('이름공간이 붙는다 — M13의 평범한 프로필 키와 절대 겹치지 않는다', () => {
    expect(memoReadKey('t1', 'song')).toBe('memo:t1:song');
    expect(cardReadKey('k1', 'hoyabom')).toBe('card:k1:hoyabom');

    // M13이 쓰는 키는 프로필 id 그 자체다.
    expect(memoReadKey('t1', 'song')).not.toBe('song');
    expect(cardReadKey('k1', 'song')).not.toBe('song');
  });

  it('두 이름공간이 서로를 덮지 않는다 — 같은 id, 같은 사람이어도', () => {
    expect(memoReadKey('x', 'song')).not.toBe(cardReadKey('x', 'song'));
  });

  it('사람이 다르면 키도 다르다 — 읽음은 기기가 아니라 사람의 상태다', () => {
    expect(memoReadKey('t1', 'song')).not.toBe(memoReadKey('t1', 'hoyabom'));
  });
});

describe('unreadMemos', () => {
  it('기록이 없으면 상대의 메시지가 전부 안 읽음이다 (첫 배포의 그 한 번)', () => {
    const ws = workspaceOf([
      memo('m1', 't1', 100, { by: 'song' }),
      memo('m2', 't1', 200, { by: 'song' }),
    ]);

    expect(unreadMemos(ws, 'hoyabom')).toEqual({ byTrip: { t1: 2 }, total: 2 });
  });

  it('읽은 지점보다 나중인 것만 센다', () => {
    const ws = workspaceOf(
      [
        memo('m1', 't1', 100, { by: 'song' }),
        memo('m2', 't1', 200, { by: 'song' }),
        memo('m3', 't1', 300, { by: 'song' }),
      ],
      { [memoReadKey('t1', 'hoyabom')]: 200 },
    );

    // 경계는 배타적이다 — 200을 읽었다면 200은 읽은 것이다.
    expect(unreadMemos(ws, 'hoyabom')).toEqual({ byTrip: { t1: 1 }, total: 1 });
  });

  it('내가 쓴 줄은 절대 세지 않는다', () => {
    const ws = workspaceOf([
      memo('m1', 't1', 100, { by: 'hoyabom' }),
      memo('m2', 't1', 200, { by: 'hoyabom' }),
    ]);

    expect(unreadMemos(ws, 'hoyabom').total).toBe(0);
  });

  it('작성자를 모르는 줄은 상대의 것으로 친다 — 말풍선을 가르는 규칙 그대로', () => {
    const ws = workspaceOf([
      memo('m1', 't1', 100),
      memo('m2', 't1', 200, { by: 'nobody' }),
    ]);

    expect(unreadMemos(ws, 'hoyabom').total).toBe(2);
    expect(unreadMemos(ws, 'song').total).toBe(2);
  });

  it('삭제된 줄은 세지 않는다 — 스텁은 읽을 것이 없다', () => {
    const ws = workspaceOf([
      memo('m1', 't1', 100, { by: 'song', removedAt: 150 }),
      memo('m2', 't1', 200, { by: 'song' }),
    ]);

    expect(unreadMemos(ws, 'hoyabom').total).toBe(1);
  });

  it('여행별로 따로 세고, 합은 그 합이다', () => {
    const ws = workspaceOf(
      [
        memo('m1', 't1', 100, { by: 'song' }),
        memo('m2', 't2', 100, { by: 'song' }),
        memo('m3', 't2', 200, { by: 'song' }),
      ],
      { [memoReadKey('t1', 'hoyabom')]: 100 },
      ['t1', 't2'],
    );

    expect(unreadMemos(ws, 'hoyabom')).toEqual({ byTrip: { t2: 2 }, total: 2 });
  });

  it('지운 여행의 메시지는 세지 않는다 — 끌 방법이 없는 배지는 켜지 않는다', () => {
    const ws = workspaceOf([memo('m1', 'gone', 100, { by: 'song' })], undefined, ['t1']);

    expect(unreadMemos(ws, 'hoyabom')).toEqual({ byTrip: {}, total: 0 });
  });

  it('프로필을 아직 안 고른 기기는 아무것도 세지 않는다', () => {
    const ws = workspaceOf([memo('m1', 't1', 100, { by: 'song' })]);

    expect(unreadMemos(ws, null)).toEqual({ byTrip: {}, total: 0 });
  });

  it('메모가 없는(M21 이전) 워크스페이스도 그냥 0이다', () => {
    expect(unreadMemos(emptyWorkspace(), 'song')).toEqual({ byTrip: {}, total: 0 });
  });

  it('망가진 stamp는 「안 읽음」으로 읽는다 — 조용히 삼키지 않는다', () => {
    const ws = workspaceOf([memo('m1', 't1', 100, { by: 'song' })], {
      [memoReadKey('t1', 'hoyabom')]: Number.NaN,
    });

    expect(unreadMemos(ws, 'hoyabom').total).toBe(1);
  });
});

describe('latestSeenStamp', () => {
  it('빈 스레드는 0이다', () => {
    expect(latestSeenStamp([])).toBe(0);
  });

  it('가장 큰 createdAt이다 — 순서가 흐트러져 있어도', () => {
    expect(
      latestSeenStamp([memo('m1', 't1', 300), memo('m2', 't1', 100), memo('m3', 't1', 200)]),
    ).toBe(300);
  });

  it('내 줄도 삭제된 줄도 함께 센다 — 스레드 전체가 읽힌 것이다', () => {
    expect(
      latestSeenStamp([
        memo('m1', 't1', 100, { by: 'song' }),
        memo('m2', 't1', 400, { by: 'hoyabom', removedAt: 500 }),
      ]),
    ).toBe(400);
  });
});

describe('firstUnreadIndex', () => {
  const thread = [
    memo('m1', 't1', 100, { by: 'song' }),
    memo('m2', 't1', 200, { by: 'hoyabom' }),
    memo('m3', 't1', 300, { by: 'song' }),
    memo('m4', 't1', 400, { by: 'song' }),
  ];

  it('상대의 첫 안 읽은 줄을 가리킨다', () => {
    expect(firstUnreadIndex(thread, 200, 'hoyabom')).toBe(2);
  });

  it('다 읽었으면 -1 — 구분선이 설 자리가 없다', () => {
    expect(firstUnreadIndex(thread, 400, 'hoyabom')).toBe(-1);
  });

  it('아무것도 안 읽었으면 맨 앞이다', () => {
    expect(firstUnreadIndex(thread, 0, 'hoyabom')).toBe(0);
  });

  it('내 줄은 건너뛴다 — 내가 쓴 줄 앞에 「여기까지」는 없다', () => {
    // 나(song) 기준으로 안 읽은 것은 상대의 m2 하나뿐이다.
    expect(firstUnreadIndex(thread, 100, 'song')).toBe(1);
    expect(firstUnreadIndex(thread, 200, 'song')).toBe(-1);
  });

  it('삭제된 줄 위에는 서지 않고 그 다음 줄로 넘어간다', () => {
    const withRemoved = [
      memo('m1', 't1', 100, { by: 'song', removedAt: 150 }),
      memo('m2', 't1', 200, { by: 'song' }),
    ];
    expect(firstUnreadIndex(withRemoved, 0, 'hoyabom')).toBe(1);
  });

  it('빈 스레드와 프로필 없는 기기는 -1이다', () => {
    expect(firstUnreadIndex([], 0, 'hoyabom')).toBe(-1);
    expect(firstUnreadIndex(thread, 0, null)).toBe(-1);
  });
});

describe('latestCommentStamp', () => {
  it('코멘트가 없으면(또는 카드가 없으면) 0이다', () => {
    expect(latestCommentStamp(card('k1'))).toBe(0);
    expect(latestCommentStamp(undefined)).toBe(0);
  });

  it('가장 나중 코멘트의 at이다', () => {
    const withComments = card('k1', [
      { id: 'c1', text: '좋아', at: 100 },
      { id: 'c2', text: '거기 비싸', at: 300 },
      { id: 'c3', text: '음', at: 200 },
    ]);
    expect(latestCommentStamp(withComments)).toBe(300);
  });
});

describe('hasUnreadComments', () => {
  const withComments = card('k1', [
    { id: 'c1', text: '내가 쓴 것', at: 100, by: 'hoyabom' },
    { id: 'c2', text: '상대가 쓴 것', at: 200, by: 'song' },
  ]);

  it('상대의 새 코멘트가 있으면 true', () => {
    expect(hasUnreadComments(withComments, 100, 'hoyabom')).toBe(true);
  });

  it('그 코멘트까지 읽었으면 false', () => {
    expect(hasUnreadComments(withComments, 200, 'hoyabom')).toBe(false);
  });

  it('내 코멘트만 새것이면 false — 내가 쓴 줄로 나를 부르지 않는다', () => {
    const mineOnly = card('k1', [{ id: 'c1', text: '메모', at: 500, by: 'hoyabom' }]);
    expect(hasUnreadComments(mineOnly, 0, 'hoyabom')).toBe(false);
  });

  it('작성자를 모르는 코멘트는 상대의 것으로 친다', () => {
    const unknown = card('k1', [{ id: 'c1', text: '옛날 코멘트', at: 500 }]);
    expect(hasUnreadComments(unknown, 0, 'hoyabom')).toBe(true);
  });

  it('코멘트가 없는 카드와 프로필 없는 기기는 false', () => {
    expect(hasUnreadComments(card('k1'), 0, 'hoyabom')).toBe(false);
    expect(hasUnreadComments(withComments, 0, null)).toBe(false);
  });
});

describe('cardsWithUnreadComments', () => {
  it('카드마다 자기 키의 stamp로 판단한다', () => {
    const read = card('read', [{ id: 'c1', text: '봤음', at: 100, by: 'song' }]);
    const unread = card('unread', [{ id: 'c2', text: '아직', at: 100, by: 'song' }]);
    const quiet = card('quiet');

    const ws = emptyWorkspace();
    ws.seenBy = { [cardReadKey('read', 'hoyabom')]: 100 };

    const flagged = cardsWithUnreadComments([read, unread, quiet], ws, 'hoyabom');
    expect([...flagged]).toEqual(['unread']);
  });

  it('프로필을 안 고른 기기에는 아무것도 없다', () => {
    const unread = card('unread', [{ id: 'c2', text: '아직', at: 100, by: 'song' }]);
    expect(cardsWithUnreadComments([unread], emptyWorkspace(), null).size).toBe(0);
  });
});
