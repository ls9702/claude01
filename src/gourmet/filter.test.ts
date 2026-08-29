import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GOURMET_FILTER,
  GENRE_EMOJI,
  GENRE_EMOJI_FALLBACK,
  GOURMET_GENRES,
  GOURMET_MIN_RATING,
  activeGenres,
  emptyGourmetHint,
  matchesGourmetFilter,
  passesRatingGate,
  spotEmoji,
  toggleGenre,
  visibleGourmetSpots,
  type GourmetFilter,
  type GourmetSpot,
} from './filter';

const spot = (overrides: Partial<GourmetSpot> = {}): GourmetSpot => ({
  key: overrides.key ?? `curated:${overrides.id ?? 'a'}`,
  source: 'curated',
  id: 'a',
  name: '이치란',
  genre: 'ramen',
  lat: 34.6,
  lng: 135.5,
  googleRating: 4.5,
  ...overrides,
});

describe('평점 문턱', () => {
  it('4.3 이상만 통과한다', () => {
    expect(passesRatingGate(4.3)).toBe(true);
    expect(passesRatingGate(4.9)).toBe(true);
    expect(passesRatingGate(4.29)).toBe(false);
  });

  it('모르는 평점은 통과하지 못한다 — 모른다를 괜찮다로 읽지 않는다', () => {
    expect(passesRatingGate(undefined)).toBe(false);
    expect(passesRatingGate(null)).toBe(false);
    expect(passesRatingGate(Number.NaN)).toBe(false);
  });

  it('문턱은 4.3이다', () => {
    expect(GOURMET_MIN_RATING).toBe(4.3);
  });
});

describe('장르 칩', () => {
  it('켜고 끄기가 뒤집힌다', () => {
    expect(toggleGenre([], 'sushi')).toEqual(['sushi']);
    expect(toggleGenre(['sushi', 'ramen'], 'sushi')).toEqual(['ramen']);
  });

  it('아무것도 고르지 않으면 다섯 갈래 전부가 활성이다', () => {
    expect(activeGenres(DEFAULT_GOURMET_FILTER)).toEqual([...GOURMET_GENRES]);
  });

  it('고른 것이 있으면 표시 순서대로 그것만', () => {
    expect(activeGenres({ ...DEFAULT_GOURMET_FILTER, genres: ['dessert', 'sushi'] })).toEqual([
      'sushi',
      'dessert',
    ]);
  });

  it('갈래를 못 읽은 줄은 기본 이모지를 쓴다', () => {
    expect(spotEmoji(spot({ genre: 'sushi' }))).toBe(GENRE_EMOJI.sushi);
    expect(spotEmoji(spot({ genre: null }))).toBe(GENRE_EMOJI_FALLBACK);
  });
});

describe('필터 한 줄 판정', () => {
  const base: GourmetFilter = { genres: [], reservable: 'all', source: 'all' };

  it('출처를 고르면 그쪽만', () => {
    expect(matchesGourmetFilter(spot(), { ...base, source: 'curated' })).toBe(true);
    expect(matchesGourmetFilter(spot(), { ...base, source: 'google' })).toBe(false);
  });

  it('장르는 고른 것만, 빈 선택은 전체', () => {
    expect(matchesGourmetFilter(spot({ genre: 'ramen' }), { ...base, genres: ['sushi'] })).toBe(
      false,
    );
    expect(matchesGourmetFilter(spot({ genre: 'ramen' }), { ...base, genres: ['ramen'] })).toBe(
      true,
    );
    expect(matchesGourmetFilter(spot({ genre: 'ramen' }), base)).toBe(true);
  });

  it('갈래를 못 읽은 구글 줄은 장르 칩을 통과한다', () => {
    expect(
      matchesGourmetFilter(spot({ source: 'google', genre: null }), { ...base, genres: ['sushi'] }),
    ).toBe(true);
  });

  it('예약 칩이 「전체」가 아니면 모르는 곳은 빠진다', () => {
    expect(matchesGourmetFilter(spot({ reservable: true }), { ...base, reservable: 'yes' })).toBe(
      true,
    );
    expect(matchesGourmetFilter(spot({ reservable: false }), { ...base, reservable: 'yes' })).toBe(
      false,
    );
    expect(matchesGourmetFilter(spot({ reservable: undefined }), { ...base, reservable: 'yes' })).toBe(
      false,
    );
    expect(matchesGourmetFilter(spot({ reservable: undefined }), { ...base, reservable: 'no' })).toBe(
      false,
    );
    expect(matchesGourmetFilter(spot({ reservable: undefined }), base)).toBe(true);
  });
});

describe('화면에 세울 목록', () => {
  it('평점이 문턱을 못 넘는 곳은 사라진다 — 큐레이션도 예외가 아니다', () => {
    const list = visibleGourmetSpots(
      [spot({ id: 'a', key: 'curated:a', googleRating: 4.5 }), spot({ id: 'b', key: 'curated:b', googleRating: 4.1 })],
      DEFAULT_GOURMET_FILTER,
    );
    expect(list.map((item) => item.id)).toEqual(['a']);
  });

  it('큐레이션이 먼저, 그 안에서는 평점 높은 순', () => {
    const list = visibleGourmetSpots(
      [
        spot({ key: 'google:g1', source: 'google', id: 'g1', googleRating: 4.9, placeId: 'g1' }),
        spot({ key: 'curated:a', id: 'a', googleRating: 4.4 }),
        spot({ key: 'curated:b', id: 'b', googleRating: 4.7 }),
      ],
      DEFAULT_GOURMET_FILTER,
    );
    expect(list.map((item) => item.id)).toEqual(['b', 'a', 'g1']);
  });

  it('같은 place id면 큐레이션이 이긴다', () => {
    const list = visibleGourmetSpots(
      [
        spot({ key: 'curated:a', id: 'a', placeId: 'p1', googleRating: 4.4 }),
        spot({ key: 'google:p1', source: 'google', id: 'p1', placeId: 'p1', googleRating: 4.4 }),
      ],
      DEFAULT_GOURMET_FILTER,
    );
    expect(list).toHaveLength(1);
    expect(list[0].source).toBe('curated');
  });

  it('같은 key가 두 번 들어와도 한 번만 선다', () => {
    const list = visibleGourmetSpots([spot(), spot()], DEFAULT_GOURMET_FILTER);
    expect(list).toHaveLength(1);
  });
});

describe('빈 화면 안내', () => {
  it('찾은 것이 아예 없을 때와 걸러진 때가 다르다', () => {
    expect(emptyGourmetHint(0)).toContain('찾지 못했어요');
    expect(emptyGourmetHint(4)).toContain('고른 조건');
  });
});
