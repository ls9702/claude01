import { describe, expect, it } from 'vitest';
import { emptyWorkspace, type DrawPage, type Id, type Workspace } from '../types/models';
import { copyPageTitle, liveElementCount, nextPageTitle, tripPages, visibleElements } from './pages';

const page = (id: Id, over: Partial<DrawPage> = {}): DrawPage => ({
  id,
  tripId: 't1',
  title: id,
  elements: {},
  elementOrder: [],
  createdAt: 1000,
  updatedAt: 1000,
  ...over,
});

const ws = (pages: DrawPage[], order?: Id[]): Workspace => ({
  ...emptyWorkspace(),
  trips: {
    t1: {
      id: 't1',
      title: '오사카',
      currency: 'KRW',
      columnOrder: [],
      sheetOrder: [],
      ...(order ? { drawPageOrder: order } : {}),
      createdAt: 1,
      updatedAt: 1,
    },
  },
  drawPages: Object.fromEntries(pages.map((item) => [item.id, item])),
});

describe('nextPageTitle', () => {
  it('처음은 「페이지 1」', () => {
    expect(nextPageTitle([])).toBe('페이지 1');
  });

  it('개수가 아니라 **가장 큰 번호**를 따라간다', () => {
    // 셋을 만들고 둘째를 지운 뒤 새로 만들면 개수 기준으로는 3이 되어 겹친다.
    expect(nextPageTitle(['페이지 1', '페이지 3'])).toBe('페이지 4');
  });

  it('사람이 붙인 이름은 세지 않는다', () => {
    expect(nextPageTitle(['오사카 지도', '먹거리'])).toBe('페이지 1');
  });
});

describe('copyPageTitle', () => {
  it('시트 복제와 같은 규칙이다', () => {
    expect(copyPageTitle('페이지 1', ['페이지 1'])).toBe('페이지 1 (복사)');
    expect(copyPageTitle('페이지 1', ['페이지 1', '페이지 1 (복사)'])).toBe('페이지 1 (복사 2)');
  });

  it('사본의 사본이 꼬리를 겹치지 않는다', () => {
    expect(copyPageTitle('페이지 1 (복사)', ['페이지 1 (복사)'])).toBe('페이지 1 (복사 2)');
  });
});

describe('tripPages', () => {
  it('순서 배열을 따른다', () => {
    const workspace = ws([page('a'), page('b'), page('c')], ['c', 'a', 'b']);
    expect(tripPages(workspace, 't1').map((item) => item.id)).toEqual(['c', 'a', 'b']);
  });

  it('순서 배열이 모르는 페이지는 오래된 것부터 뒤에 붙는다', () => {
    const workspace = ws(
      [page('a'), page('new1', { createdAt: 3000 }), page('new0', { createdAt: 2000 })],
      ['a'],
    );
    expect(tripPages(workspace, 't1').map((item) => item.id)).toEqual(['a', 'new0', 'new1']);
  });

  it('지운 페이지는 목록에 없다', () => {
    const workspace = ws([page('a'), page('b', { deletedAt: 5000 })], ['a', 'b']);
    expect(tripPages(workspace, 't1').map((item) => item.id)).toEqual(['a']);
  });

  it('다른 여행의 페이지는 섞이지 않는다', () => {
    const workspace = ws([page('a'), page('x', { tripId: 't2' })], ['a', 'x']);
    expect(tripPages(workspace, 't1').map((item) => item.id)).toEqual(['a']);
  });

  it('여행이 없으면 빈 목록', () => {
    expect(tripPages(ws([page('a')]), undefined)).toEqual([]);
  });
});

describe('visibleElements / liveElementCount', () => {
  const withElements = page('a', {
    elements: {
      e1: { id: 'e1', updatedAt: 1, type: 'sticker', x: 0, y: 0, emoji: '📍', size: 48 },
      e2: { id: 'e2', updatedAt: 2, deletedAt: 3, type: 'sticker', x: 0, y: 0, emoji: '⭐', size: 48 },
    },
    elementOrder: ['e1', 'e2'],
  });

  it('지운 요소는 그리지도 세지도 않는다', () => {
    expect(visibleElements(withElements).map((item) => item.id)).toEqual(['e1']);
    expect(liveElementCount(withElements)).toBe(1);
  });

  it('순서 배열에 없는 요소는 그리지 않는다 (그러나 세기는 한다)', () => {
    const orphan = page('a', {
      elements: withElements.elements,
      elementOrder: ['e1'],
    });
    expect(visibleElements(orphan)).toHaveLength(1);
    expect(liveElementCount(orphan)).toBe(1);
  });
});
