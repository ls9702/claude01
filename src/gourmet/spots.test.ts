import { describe, expect, it } from 'vitest';
import { GOURMET_ENTRIES, type GourmetEntry } from '../data/gourmet';
import type { GourmetPlace } from '../map/googlePlaces';
import {
  cardMemoLine,
  curatedSpot,
  genreAreaLine,
  googleSpot,
  lookupQuery,
  progressLabel,
  ratingLine,
  reservableLine,
  resolvedFromPlace,
} from './spots';

const entry: GourmetEntry = {
  id: 'ichiran-dotonbori',
  name: '이치란 도톤보리점',
  localName: '一蘭 道頓堀店',
  genre: 'ramen',
  city: 'osaka',
  area: '도톤보리',
  tabelog: 3.58,
  reservable: false,
  note: '칸막이 1인석',
  surveyedAt: '2026-08',
};

const place: GourmetPlace = {
  name: 'Ichiran Dotonbori',
  lat: 34.6687,
  lng: 135.5013,
  address: '오사카시 주오구',
  rating: 4.42,
  ratingCount: 5200,
  placeId: 'p-ichiran',
  types: ['ramen_restaurant', 'restaurant', 'food'],
};

describe('씨앗 데이터', () => {
  it('id가 겹치지 않는다 — 캐시의 키다', () => {
    const ids = GOURMET_ENTRIES.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('좌표를 들고 있지 않다 — 일부러', () => {
    for (const item of GOURMET_ENTRIES) {
      expect(item).not.toHaveProperty('lat');
      expect(item).not.toHaveProperty('lng');
    }
  });

  it('다섯 갈래가 모두 있고 두 도시를 돈다', () => {
    expect(new Set(GOURMET_ENTRIES.map((item) => item.genre))).toEqual(
      new Set(['sushi', 'ramen', 'katsu', 'okonomiyaki', 'dessert']),
    );
    expect(new Set(GOURMET_ENTRIES.map((item) => item.city))).toEqual(new Set(['osaka', 'kyoto']));
  });
});

describe('큐레이션 한 줄', () => {
  it('조사값과 구글 답이 한 모양으로 접힌다', () => {
    const spot = curatedSpot(entry, {
      lat: 34.6687,
      lng: 135.5013,
      address: '오사카시 주오구',
      googleRating: 4.42,
      googleRatingCount: 5200,
      placeId: 'p-ichiran',
      cachedAt: '2026-08-29T00:00:00.000Z',
    });
    expect(spot.key).toBe('curated:ichiran-dotonbori');
    expect(spot.source).toBe('curated');
    expect(spot.name).toBe('이치란 도톤보리점');
    expect(spot.localName).toBe('一蘭 道頓堀店');
    expect(spot.googleRating).toBe(4.42);
    expect(spot.tabelog).toBe(3.58);
    expect(spot.placeId).toBe('p-ichiran');
  });

  it('예약 여부는 조사값이 이긴다 — 구글의 빈 값이 사람의 확인을 덮지 않는다', () => {
    const spot = curatedSpot(
      { ...entry, reservable: true },
      { lat: 1, lng: 2, cachedAt: '', reservable: undefined },
    );
    expect(spot.reservable).toBe(true);
  });

  it('검색어는 상호 + 동네', () => {
    expect(lookupQuery(entry)).toBe('一蘭 道頓堀店 도톤보리');
  });
});

describe('구글 한 줄', () => {
  it('타입에서 갈래를 되읽는다', () => {
    const spot = googleSpot(place, ['sushi', 'ramen', 'dessert']);
    expect(spot.key).toBe('google:p-ichiran');
    expect(spot.source).toBe('google');
    expect(spot.genre).toBe('ramen');
    expect(spot.googleRating).toBe(4.42);
    expect(spot.tabelog).toBeUndefined();
  });

  it('못 읽으면 주어진 갈래로 — 키워드 검색은 무엇을 물었는지 안다', () => {
    const spot = googleSpot({ ...place, types: ['restaurant'] }, ['sushi'], 'katsu');
    expect(spot.genre).toBe('katsu');
  });

  it('place id가 없으면 좌표가 이름이 된다', () => {
    const spot = googleSpot({ ...place, placeId: undefined }, ['ramen']);
    expect(spot.key).toBe('google:34.66870,135.50130');
    expect(spot.placeId).toBeUndefined();
  });

  it('이름이 비어 있어도 한 줄은 이름을 가진다', () => {
    expect(googleSpot({ ...place, name: '' }, []).name).toBe('이름 없는 곳');
  });
});

describe('캐시에 적을 답', () => {
  it('구글 답 그대로, 시각과 함께', () => {
    const resolved = resolvedFromPlace(place, new Date('2026-08-29T01:02:03.000Z'));
    expect(resolved).toEqual({
      lat: 34.6687,
      lng: 135.5013,
      address: '오사카시 주오구',
      googleRating: 4.42,
      googleRatingCount: 5200,
      placeId: 'p-ichiran',
      cachedAt: '2026-08-29T01:02:03.000Z',
    });
  });
});

describe('화면에 쓰는 문장들', () => {
  const spot = curatedSpot(entry, { lat: 1, lng: 2, googleRating: 4.5, cachedAt: '' });

  it('장르 · 지역', () => {
    expect(genreAreaLine(spot)).toBe('라멘 · 도톤보리');
    expect(genreAreaLine({ ...spot, area: undefined })).toBe('라멘');
    expect(genreAreaLine({ ...spot, genre: null, area: undefined })).toBe('맛집');
  });

  it('두 평점은 나란히, 하나뿐이면 그렇다고 말한다', () => {
    expect(ratingLine(spot)).toBe('⭐ 구글 4.5 · 타베로그 3.6');
    expect(ratingLine({ ...spot, tabelog: undefined })).toBe('⭐ 구글 4.5 (구글만)');
    expect(ratingLine({ ...spot, tabelog: undefined, googleRating: undefined })).toBe(
      '⭐ 구글 평점 없음 (구글만)',
    );
  });

  it('예약은 세 가지 — 모름을 아는 척하지 않는다', () => {
    expect(reservableLine({ ...spot, reservable: true })).toBe('예약 가능');
    expect(reservableLine({ ...spot, reservable: false })).toBe('예약 불가');
    expect(reservableLine({ ...spot, reservable: undefined })).toBe('예약 정보 없음');
  });

  it('카드 메모는 평점과 예약을 한 문장으로', () => {
    expect(cardMemoLine(spot)).toBe('⭐ 구글 4.5 · 타베로그 3.6 · 예약 불가');
  });

  it('진행 표시', () => {
    expect(progressLabel(12, 48)).toBe('맛집 정보 불러오는 중 12/48');
  });
});
