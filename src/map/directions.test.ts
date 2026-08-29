import { describe, expect, it } from 'vitest';
import {
  DIRECTIONS_BASE,
  DIRECTIONS_LABEL,
  PLACE_PAGE_LABEL,
  PLACE_SEARCH_BASE,
  directionsUrl,
  placePageUrl,
  previousStopMap,
} from './directions';

const NAMBA = { lat: 34.6659, lng: 135.5013 };
const TSUTENKAKU = { lat: 34.6525, lng: 135.5063 };

describe('directionsUrl', () => {
  it('도착지만 있으면 도착지만 싣는다 — 출발은 구글이 현재 위치로 채운다', () => {
    expect(directionsUrl(NAMBA)).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=34.6659,135.5013&travelmode=transit',
    );
  });

  it('앞 장소를 아는 자리에서는 출발지도 싣는다', () => {
    expect(directionsUrl(TSUTENKAKU, NAMBA)).toBe(
      `${DIRECTIONS_BASE}?api=1&origin=34.6659,135.5013&destination=34.6525,135.5063&travelmode=transit`,
    );
  });

  it('출발지가 없거나 쓸 수 없으면 도착지만 남는다', () => {
    const only = directionsUrl(NAMBA);
    expect(directionsUrl(NAMBA, null)).toBe(only);
    expect(directionsUrl(NAMBA, undefined)).toBe(only);
    expect(directionsUrl(NAMBA, { lat: Number.NaN, lng: 135 })).toBe(only);
  });

  it('도착지가 없으면 링크 자체가 없다 — 버튼도 서지 않는다', () => {
    expect(directionsUrl(null)).toBeNull();
    expect(directionsUrl(undefined)).toBeNull();
    expect(directionsUrl({ lat: Number.NaN, lng: 135.5 })).toBeNull();
    expect(directionsUrl({ lat: 34.6, lng: Number.POSITIVE_INFINITY })).toBeNull();
  });

  it('쉼표는 쉼표로 남고, 좌표는 여섯 자리까지만 적힌다', () => {
    const url = directionsUrl({ lat: 34.66591234567, lng: 135.50131234567 })!;
    expect(url).toContain('destination=34.665912,135.501312');
    expect(url).not.toContain('%2C');
  });

  it('버튼의 말은 한 곳에서만 정해진다', () => {
    expect(DIRECTIONS_LABEL).toBe('길찾기');
  });
});

describe('previousStopMap', () => {
  const stops = [
    { cardId: 'a', lat: 34.66, lng: 135.5 },
    { cardId: 'b', lat: 34.67, lng: 135.51 },
    { cardId: 'c', lat: 34.68, lng: 135.52 },
  ];

  it('두 번째 정거장부터 앞 자리를 기억한다', () => {
    const previous = previousStopMap([stops]);
    expect(previous.get('a')).toBeUndefined();
    expect(previous.get('b')).toEqual({ lat: 34.66, lng: 135.5 });
    expect(previous.get('c')).toEqual({ lat: 34.67, lng: 135.51 });
  });

  it('첫 장소에는 출발지가 없다 — 링크는 도착지만 싣는다', () => {
    const previous = previousStopMap([stops]);
    expect(directionsUrl({ lat: 34.66, lng: 135.5 }, previous.get('a'))).not.toContain('origin=');
    expect(directionsUrl({ lat: 34.67, lng: 135.51 }, previous.get('b'))).toContain(
      'origin=34.66,135.5',
    );
  });

  it('한 날에 같은 카드가 두 번 나오면 처음 것을 남긴다', () => {
    const previous = previousStopMap([
      [...stops, { cardId: 'b', lat: 34.69, lng: 135.53 }],
    ]);
    expect(previous.get('b')).toEqual({ lat: 34.66, lng: 135.5 });
  });

  it('빈 목록·정거장 하나짜리 날에는 아무것도 없다', () => {
    expect(previousStopMap([]).size).toBe(0);
    expect(previousStopMap([[stops[0]]]).size).toBe(0);
  });
});

/* ------------------------------------------------------------------ *
 * 장소 페이지 링크 (M43)
 * ------------------------------------------------------------------ */

describe('placePageUrl', () => {
  it('place id가 있으면 그 가게의 페이지를 바로 연다', () => {
    expect(placePageUrl('一蘭 道頓堀店', NAMBA, 'ChIJ_place')).toBe(
      `${PLACE_SEARCH_BASE}?api=1&query=${encodeURIComponent('一蘭 道頓堀店')}&query_place_id=ChIJ_place`,
    );
  });

  it('id가 없으면 이름과 좌표를 함께 실어 그 자리 근처를 찾게 한다', () => {
    expect(placePageUrl('미즈노', NAMBA)).toBe(
      `${PLACE_SEARCH_BASE}?api=1&query=${encodeURIComponent('미즈노 34.6659,135.5013')}`,
    );
  });

  it('이름만·좌표만 있어도 링크는 선다', () => {
    expect(placePageUrl('미즈노')).toBe(
      `${PLACE_SEARCH_BASE}?api=1&query=${encodeURIComponent('미즈노')}`,
    );
    expect(placePageUrl(undefined, NAMBA)).toBe(
      `${PLACE_SEARCH_BASE}?api=1&query=${encodeURIComponent('34.6659,135.5013')}`,
    );
  });

  it('가리킬 것이 하나도 없으면 링크가 아니다', () => {
    expect(placePageUrl('  ')).toBeNull();
    expect(placePageUrl(undefined, { lat: Number.NaN, lng: 1 })).toBeNull();
  });

  it('버튼의 말은 한 곳에서 온다', () => {
    expect(PLACE_PAGE_LABEL).toBe('구글 지도 앱에서 보기');
  });
});
