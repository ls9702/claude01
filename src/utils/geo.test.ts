import { describe, expect, it } from 'vitest';
import { SEARCH_LIMIT, formatLatLng, parsePlaces, searchUrl } from './geo';

describe('formatLatLng', () => {
  it('rounds to four decimals — enough for a street corner', () => {
    expect(formatLatLng(35.659528, 139.700523)).toBe('35.6595, 139.7005');
    expect(formatLatLng(0, 0)).toBe('0.0000, 0.0000');
    expect(formatLatLng(-33.8688, 151.2093)).toBe('-33.8688, 151.2093');
  });
});

describe('searchUrl', () => {
  it('asks Nominatim for five Korean-labelled jsonv2 rows', () => {
    const url = new URL(searchUrl('시부야 스크램블'));
    expect(url.origin + url.pathname).toBe('https://nominatim.openstreetmap.org/search');
    expect(url.searchParams.get('format')).toBe('jsonv2');
    expect(url.searchParams.get('q')).toBe('시부야 스크램블');
    expect(url.searchParams.get('limit')).toBe(String(SEARCH_LIMIT));
    expect(url.searchParams.get('accept-language')).toBe('ko');
  });
});

describe('parsePlaces', () => {
  it('maps lat/lon strings and display_name onto GeoPoints', () => {
    expect(
      parsePlaces([
        { lat: '35.6595', lon: '139.7005', display_name: '시부야 스크램블 교차로, 도쿄' },
      ]),
    ).toEqual([{ lat: 35.6595, lng: 139.7005, address: '시부야 스크램블 교차로, 도쿄' }]);
  });

  it('drops rows without usable coordinates', () => {
    expect(
      parsePlaces([
        { lat: 'nope', lon: '139.7', display_name: 'a' },
        null,
        'junk',
        { lon: '139.7', display_name: 'b' },
        { lat: 1, lon: 2, display_name: 'c' },
      ]),
    ).toEqual([{ lat: 1, lng: 2, address: 'c' }]);
  });

  it('falls back to coordinates when there is no display_name', () => {
    expect(parsePlaces([{ lat: '1.5', lon: '2.5' }])).toEqual([
      { lat: 1.5, lng: 2.5, address: '1.5000, 2.5000' },
    ]);
  });

  it('treats a non-array payload as no results', () => {
    expect(parsePlaces({ error: 'nope' })).toEqual([]);
    expect(parsePlaces(null)).toEqual([]);
  });
});
