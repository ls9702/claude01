import { describe, expect, it } from 'vitest';
import {
  PLACE_FIX_MIN_M,
  decidePlaceFix,
  isGoogleSheetDay,
  isUsablePoint,
  placeFixBias,
  placeFixDistanceLine,
} from './placeFix';
import { emptyWorkspace, type Workspace } from '../types/models';

/** 오사카 난바 근처의 한 점. */
const BASE = { lat: 34.6659, lng: 135.5013 };

/** `metres` 만큼 북쪽으로 옮긴 점 — 위도 1도 ≈ 111.32km. */
const north = (metres: number) => ({ lat: BASE.lat + metres / 111_320, lng: BASE.lng });

const suggestionAt = (point: { lat: number; lng: number }) => ({
  name: '이치란 난바점',
  lat: point.lat,
  lng: point.lng,
  address: '오사카부 오사카시',
});

describe('decidePlaceFix', () => {
  it('결과가 없으면 아무것도 묻지 않는다', () => {
    expect(decidePlaceFix(BASE, null)).toEqual({
      offer: false,
      reason: 'no-result',
      distanceKm: 0,
    });
    expect(decidePlaceFix(BASE, undefined).offer).toBe(false);
  });

  it('좌표가 망가진 결과도 결과 없음으로 읽는다', () => {
    expect(decidePlaceFix(BASE, { name: 'x', lat: Number.NaN, lng: 1 }).reason).toBe('no-result');
  });

  it('카드에 위치가 없으면 언제나 제안한다', () => {
    const decision = decidePlaceFix(undefined, suggestionAt(BASE));
    expect(decision).toEqual({ offer: true, reason: 'no-location', distanceKm: 0 });
  });

  it(`${PLACE_FIX_MIN_M}m보다 가까우면 묻지 않는다`, () => {
    const decision = decidePlaceFix(BASE, suggestionAt(north(20)));
    expect(decision.offer).toBe(false);
    expect(decision.reason).toBe('near');
    expect(decision.distanceKm * 1000).toBeLessThan(PLACE_FIX_MIN_M);
  });

  it(`${PLACE_FIX_MIN_M}m를 넘으면 묻는다`, () => {
    const decision = decidePlaceFix(BASE, suggestionAt(north(250)));
    expect(decision.offer).toBe(true);
    expect(decision.reason).toBe('far');
    expect(Math.round(decision.distanceKm * 1000)).toBe(250);
  });

  it('경계값(50m 정확히)은 묻지 않는 쪽이다', () => {
    const decision = decidePlaceFix(BASE, suggestionAt(north(PLACE_FIX_MIN_M)));
    expect(decision.offer).toBe(false);
  });
});

describe('placeFixDistanceLine', () => {
  it('거리를 지도 경로와 같은 표기로 말한다', () => {
    expect(placeFixDistanceLine(decidePlaceFix(BASE, suggestionAt(north(250))))).toBe(
      '기존 위치와 250m 차이',
    );
    expect(placeFixDistanceLine(decidePlaceFix(BASE, suggestionAt(north(2400))))).toBe(
      '기존 위치와 2.4km 차이',
    );
  });

  it('위치가 없던 카드에는 거리 대신 이유를 말한다', () => {
    expect(placeFixDistanceLine(decidePlaceFix(undefined, suggestionAt(BASE)))).toBe(
      '카드에 위치가 없어 구글 결과를 제안해요',
    );
  });
});

describe('isUsablePoint', () => {
  it('유한한 좌표만 통과시킨다', () => {
    expect(isUsablePoint({ lat: 0, lng: 0 })).toBe(true);
    expect(isUsablePoint(undefined)).toBe(false);
    expect(isUsablePoint({ lat: Number.NaN, lng: 0 })).toBe(false);
    expect(isUsablePoint({ lat: 1, lng: Number.POSITIVE_INFINITY })).toBe(false);
  });
});

/** 일자 하나를 든 시트 하나짜리 워크스페이스. */
function workspaceWithSheet(engine?: 'google'): Workspace {
  const workspace = emptyWorkspace();
  workspace.trips.t1 = {
    id: 't1',
    title: '오사카',
    currency: 'KRW',
    columnOrder: ['c1'],
    sheetOrder: ['s1'],
    destination: { lat: 34.69, lng: 135.5 },
    createdAt: 1,
    updatedAt: 1,
  };
  workspace.sheets.s1 = {
    id: 's1',
    tripId: 't1',
    name: '일정 1',
    dayOrder: ['d1'],
    ...(engine ? { mapEngine: engine } : {}),
    createdAt: 1,
    updatedAt: 1,
  };
  workspace.days.d1 = { id: 'd1', tripId: 't1', sheetId: 's1', createdAt: 1, updatedAt: 1 };
  workspace.columns.c1 = {
    id: 'c1',
    tripId: 't1',
    name: '맛집',
    color: 'amber',
    icon: '🍜',
    cardOrder: ['card1'],
    createdAt: 1,
    updatedAt: 1,
  };
  workspace.cards.card1 = {
    id: 'card1',
    tripId: 't1',
    columnId: 'c1',
    title: '이치란',
    createdAt: 1,
    updatedAt: 1,
  };
  return workspace;
}

describe('isGoogleSheetDay', () => {
  it('구글 시트의 일자에만 참이다', () => {
    expect(isGoogleSheetDay(workspaceWithSheet('google'), 'd1')).toBe(true);
    expect(isGoogleSheetDay(workspaceWithSheet(), 'd1')).toBe(false);
  });

  it('모르는 일자·없는 일자는 거짓이다', () => {
    expect(isGoogleSheetDay(workspaceWithSheet('google'), 'nope')).toBe(false);
    expect(isGoogleSheetDay(workspaceWithSheet('google'), undefined)).toBe(false);
  });
});

describe('placeFixBias', () => {
  it('카드에 위치가 있으면 그 위치로 기운다', () => {
    const workspace = workspaceWithSheet('google');
    workspace.cards.card1 = { ...workspace.cards.card1, location: { lat: 34.66, lng: 135.5 } };
    expect(placeFixBias(workspace, 'card1')).toEqual({ lat: 34.66, lng: 135.5 });
  });

  it('위치가 없으면 여행의 목적지로 기운다', () => {
    expect(placeFixBias(workspaceWithSheet('google'), 'card1')).toEqual({ lat: 34.69, lng: 135.5 });
  });

  it('둘 다 없으면 기울이지 않는다', () => {
    const workspace = workspaceWithSheet('google');
    workspace.trips.t1 = { ...workspace.trips.t1, destination: undefined };
    expect(placeFixBias(workspace, 'card1')).toBeUndefined();
    expect(placeFixBias(workspace, 'nope')).toBeUndefined();
  });
});
