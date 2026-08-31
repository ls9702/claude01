import { describe, expect, it } from 'vitest';
import type { BoardColumn, Card, Trip, Workspace } from '../types/models';
import { emptyWorkspace } from '../types/models';
import {
  DEFAULT_USER_GOURMET_FILTER,
  emptyUserGourmetHint,
  missingLocationLine,
  passesUserFilter,
  userGenreCounts,
  userGourmetColumns,
  userGourmetSpots,
  visibleUserSpots,
} from './userSpots';

/* ------------------------------------------------------------------ *
 * 손으로 짓는 작은 워크스페이스 — 스토어를 부르지 않는다(순수 규칙이므로).
 * ------------------------------------------------------------------ */

const column = (id: string, patch: Partial<BoardColumn> = {}): BoardColumn => ({
  id,
  tripId: 'trip',
  name: id,
  color: 'amber',
  icon: '🍚',
  cardOrder: [],
  createdAt: 1,
  updatedAt: 1,
  ...patch,
});

const card = (id: string, patch: Partial<Card> = {}): Card => ({
  id,
  tripId: 'trip',
  columnId: 'gourmet',
  title: id,
  createdAt: 1,
  updatedAt: 1,
  ...patch,
});

const trip = (columnOrder: string[]): Trip => ({
  id: 'trip',
  title: '오사카',
  currency: 'KRW',
  columnOrder,
  sheetOrder: [],
  createdAt: 1,
  updatedAt: 1,
});

/** 맛집 칸 하나 + 평범한 칸 하나가 있는 여행. */
function build(cards: Card[], gourmetFlag: boolean | 'none' = true): Workspace {
  const ws = emptyWorkspace();
  ws.trips.trip = trip(['gourmet', 'other']);
  ws.columns.gourmet = column('gourmet', {
    name: '맛집',
    cardOrder: cards.filter((c) => c.columnId === 'gourmet').map((c) => c.id),
    ...(gourmetFlag === 'none' ? {} : { gourmet: gourmetFlag }),
  });
  ws.columns.other = column('other', {
    name: '볼거리',
    cardOrder: cards.filter((c) => c.columnId === 'other').map((c) => c.id),
  });
  for (const item of cards) ws.cards[item.id] = item;
  return ws;
}

const at = (lat: number, lng: number, address?: string) => ({
  lat,
  lng,
  ...(address ? { address } : {}),
});

describe('userGourmetColumns', () => {
  it('picks only the flagged columns, in board order', () => {
    const ws = build([]);
    expect(userGourmetColumns(ws, 'trip').map((c) => c.id)).toEqual(['gourmet']);
  });

  it('ignores a column whose flag is off or missing', () => {
    expect(userGourmetColumns(build([], false), 'trip')).toEqual([]);
    expect(userGourmetColumns(build([], 'none'), 'trip')).toEqual([]);
  });

  it('answers empty for an unknown trip', () => {
    expect(userGourmetColumns(build([]), undefined)).toEqual([]);
    expect(userGourmetColumns(build([]), 'nope')).toEqual([]);
  });
});

describe('userGourmetSpots', () => {
  it('takes every located card of the 맛집 column — placed or not', () => {
    const ws = build([
      card('a', { title: '이치란', gourmetGenre: 'ramen', location: at(34.6, 135.5, '난바') }),
      card('b', { title: '스시로', gourmetGenre: 'sushi', location: at(34.7, 135.4) }),
    ]);
    // 배치(타임라인 엔트리)는 하나도 없다 — 그래도 둘 다 선다.
    expect(ws.entries).toEqual({});

    const { spots, missing } = userGourmetSpots(ws, 'trip');
    expect(spots.map((spot) => spot.title)).toEqual(['이치란', '스시로']);
    expect(spots[0]).toMatchObject({ genre: 'ramen', emoji: '🍜', address: '난바' });
    expect(spots[1].address).toBeUndefined();
    expect(missing).toBe(0);
  });

  it('counts a located-less card instead of dropping it silently', () => {
    const ws = build([
      card('a', { location: at(34.6, 135.5) }),
      card('b'),
      card('c', { location: { lat: Number.NaN, lng: 135.5 } }),
    ]);
    const { spots, missing } = userGourmetSpots(ws, 'trip');
    expect(spots).toHaveLength(1);
    expect(missing).toBe(2);
  });

  it('never reads a card of a column that is not a 맛집 column', () => {
    const ws = build([
      card('a', { location: at(34.6, 135.5) }),
      card('b', { columnId: 'other', location: at(34.6, 135.5) }),
    ]);
    expect(userGourmetSpots(ws, 'trip').spots.map((spot) => spot.cardId)).toEqual(['a']);
  });

  it('folds an unknown genre into 「없음」 and wears the 🍽️', () => {
    const ws = build([card('a', { gourmetGenre: 'yakiniku', location: at(1, 2) })]);
    const [spot] = userGourmetSpots(ws, 'trip').spots;
    expect(spot.genre).toBeNull();
    expect(spot.emoji).toBe('🍽️');
  });

  it('carries the memo when there is one', () => {
    const ws = build([card('a', { memo: '줄 서기 필수', location: at(1, 2) })]);
    expect(userGourmetSpots(ws, 'trip').spots[0].memo).toBe('줄 서기 필수');
    const bare = build([card('a', { location: at(1, 2) })]);
    expect(userGourmetSpots(bare, 'trip').spots[0].memo).toBeUndefined();
  });
});

describe('passesUserFilter / visibleUserSpots', () => {
  const spots = [
    { genre: 'ramen' as const },
    { genre: 'cafe' as const },
    { genre: null },
  ];

  it('shows everything when no chip is picked', () => {
    expect(visibleUserSpots(spots, DEFAULT_USER_GOURMET_FILTER)).toHaveLength(3);
  });

  it('narrows to the picked genres, keeping the un-genred when asked', () => {
    const filter = { genres: ['ramen' as const], includeNone: true };
    expect(visibleUserSpots(spots, filter).map((s) => s.genre)).toEqual(['ramen', null]);
  });

  it('drops the un-genred when 「장르 없음」 is off', () => {
    expect(
      visibleUserSpots(spots, { genres: ['ramen'], includeNone: false }).map((s) => s.genre),
    ).toEqual(['ramen']);
    // 칩을 하나도 안 골라도 「장르 없음」은 자기 몫만 감춘다.
    expect(
      visibleUserSpots(spots, { genres: [], includeNone: false }).map((s) => s.genre),
    ).toEqual(['ramen', 'cafe']);
  });

  it('is a plain predicate for one spot', () => {
    expect(passesUserFilter({ genre: 'bar' }, { genres: ['cafe'], includeNone: true })).toBe(
      false,
    );
  });
});

describe('userGenreCounts', () => {
  it('counts per genre with null as its own key', () => {
    const ws = build([
      card('a', { gourmetGenre: 'ramen', location: at(1, 2) }),
      card('b', { gourmetGenre: 'ramen', location: at(1, 2) }),
      card('c', { location: at(1, 2) }),
    ]);
    const counts = userGenreCounts(userGourmetSpots(ws, 'trip').spots);
    expect(counts.get('ramen')).toBe(2);
    expect(counts.get(null)).toBe(1);
    expect(counts.get('cafe')).toBeUndefined();
  });
});

describe('emptyUserGourmetHint / missingLocationLine', () => {
  it('tells the three empties apart', () => {
    expect(emptyUserGourmetHint(0, 0, 0)).toContain('카드를 만들면');
    expect(emptyUserGourmetHint(0, 2, 0)).toContain('위치를 넣으면');
    expect(emptyUserGourmetHint(3, 0, 0)).toContain('장르');
    // 볼 것이 있으면 아무 말도 하지 않는다.
    expect(emptyUserGourmetHint(3, 0, 2)).toBe('');
  });

  it('says how many cards cannot be pinned, and nothing when none', () => {
    expect(missingLocationLine(3)).toBe('위치 없는 3곳');
    expect(missingLocationLine(0)).toBe('');
  });
});
