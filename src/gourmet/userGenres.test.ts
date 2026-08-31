import { describe, expect, it } from 'vitest';
import { GENRE_EMOJI, GENRE_LABEL, GOURMET_GENRES } from './filter';
import {
  NO_GENRE_EMOJI,
  NO_GENRE_LABEL,
  USER_GENRE_EMOJI,
  USER_GENRE_LABEL,
  USER_GOURMET_GENRES,
  isUserGourmetGenre,
  toggleUserGenre,
  userGenreEmoji,
  userGenreLabel,
  userGenreOf,
} from './userGenres';

describe('USER_GOURMET_GENRES', () => {
  it('is the M43 five plus 카페·식사·술집, in that order', () => {
    expect(USER_GOURMET_GENRES).toEqual([
      'sushi',
      'ramen',
      'katsu',
      'okonomiyaki',
      'dessert',
      'cafe',
      'meal',
      'bar',
    ]);
    // 앞의 다섯은 M43의 순서 **그대로**여야 한다 — 사람이 외운 자리다.
    expect(USER_GOURMET_GENRES.slice(0, 5)).toEqual(GOURMET_GENRES);
  });

  it('borrows the shared five from M43 so the two layers cannot drift', () => {
    for (const genre of GOURMET_GENRES) {
      expect(USER_GENRE_EMOJI[genre]).toBe(GENRE_EMOJI[genre]);
      expect(USER_GENRE_LABEL[genre]).toBe(GENRE_LABEL[genre]);
    }
    expect(USER_GENRE_EMOJI.cafe).toBe('☕');
    expect(USER_GENRE_EMOJI.meal).toBe('🍚');
    expect(USER_GENRE_EMOJI.bar).toBe('🍶');
  });

  it('gives every genre an emoji and a Korean label', () => {
    for (const genre of USER_GOURMET_GENRES) {
      expect(USER_GENRE_EMOJI[genre]).toBeTruthy();
      expect(USER_GENRE_LABEL[genre]).toBeTruthy();
    }
  });
});

describe('isUserGourmetGenre / userGenreOf', () => {
  it('accepts the eight and nothing else', () => {
    expect(isUserGourmetGenre('cafe')).toBe(true);
    expect(isUserGourmetGenre('sushi')).toBe(true);
    expect(isUserGourmetGenre('izakaya')).toBe(false);
    expect(isUserGourmetGenre(undefined)).toBe(false);
    expect(isUserGourmetGenre(3)).toBe(false);
  });

  it('folds an unknown stored value into "no genre" rather than throwing', () => {
    expect(userGenreOf('bar')).toBe('bar');
    expect(userGenreOf('yakiniku')).toBeNull();
    expect(userGenreOf(undefined)).toBeNull();
  });
});

describe('userGenreEmoji / userGenreLabel', () => {
  it('falls back to the 🍽️ of M43 and to 「장르 없음」', () => {
    expect(userGenreEmoji('ramen')).toBe('🍜');
    expect(userGenreEmoji(undefined)).toBe(NO_GENRE_EMOJI);
    expect(userGenreEmoji('something-else')).toBe(NO_GENRE_EMOJI);
    expect(userGenreLabel('cafe')).toBe('카페');
    expect(userGenreLabel(undefined)).toBe(NO_GENRE_LABEL);
  });
});

describe('toggleUserGenre', () => {
  it('adds, removes, and always answers in the canonical order', () => {
    expect(toggleUserGenre([], 'bar')).toEqual(['bar']);
    // 고른 순서가 아니라 정해진 순서로 접힌다.
    expect(toggleUserGenre(['bar'], 'sushi')).toEqual(['sushi', 'bar']);
    expect(toggleUserGenre(['sushi', 'bar'], 'sushi')).toEqual(['bar']);
    expect(toggleUserGenre(['bar'], 'bar')).toEqual([]);
  });

  it('never mutates the list it was given', () => {
    const genres = ['sushi'] as const;
    toggleUserGenre(genres, 'cafe');
    expect(genres).toEqual(['sushi']);
  });
});
