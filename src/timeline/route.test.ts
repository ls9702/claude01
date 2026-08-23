import { describe, expect, it } from 'vitest';
import { emptyWorkspace, type GeoPoint, type Id, type Workspace } from '../types/models';
import {
  dayRoute,
  formatDistanceKm,
  haversineKm,
  legBearingDeg,
  legMidpoint,
  transportColumnId,
} from './route';

const AT = 1_760_000_000_000;

/**
 * One trip with a 이동수단 column (`c-move`) and a 볼거리 column (`c-see`),
 * one sheet and one day (`d1`).
 */
function scaffold(): Workspace {
  const ws = emptyWorkspace();
  ws.trips.t1 = {
    id: 't1',
    title: '도쿄',
    currency: 'JPY',
    columnOrder: ['c-move', 'c-see'],
    sheetOrder: ['s1'],
    createdAt: AT,
    updatedAt: AT,
  };
  ws.columns['c-move'] = {
    id: 'c-move',
    tripId: 't1',
    name: '이동수단',
    color: 'sky',
    icon: '🚗',
    cardOrder: [],
    createdAt: AT,
    updatedAt: AT,
  };
  ws.columns['c-see'] = {
    id: 'c-see',
    tripId: 't1',
    name: '볼거리',
    color: 'emerald',
    icon: '🎡',
    cardOrder: [],
    createdAt: AT,
    updatedAt: AT,
  };
  ws.sheets.s1 = {
    id: 's1',
    tripId: 't1',
    name: '일정 1',
    dayOrder: ['d1'],
    createdAt: AT,
    updatedAt: AT,
  };
  ws.days.d1 = {
    id: 'd1',
    tripId: 't1',
    sheetId: 's1',
    label: '1일차',
    createdAt: AT,
    updatedAt: AT,
  };
  return ws;
}

function addCard(ws: Workspace, id: Id, columnId: Id, location?: GeoPoint): void {
  ws.cards[id] = {
    id,
    tripId: 't1',
    columnId,
    title: id,
    location,
    createdAt: AT,
    updatedAt: AT,
  };
  ws.columns[columnId].cardOrder.push(id);
}

/** Schedules `cardId` on `dayId` at `startMin`; `createdAt` breaks ties. */
function place(
  ws: Workspace,
  entryId: Id,
  cardId: Id,
  startMin: number,
  dayId: Id = 'd1',
  createdAt: number = AT,
): void {
  ws.entries[entryId] = {
    id: entryId,
    tripId: 't1',
    cardId,
    dayId,
    startMin,
    durationMin: 60,
    createdAt,
    updatedAt: createdAt,
  };
}

const at = (lat: number, lng: number): GeoPoint => ({ lat, lng });

describe('transportColumnId', () => {
  it('finds the 🚗 column', () => {
    expect(transportColumnId(scaffold(), 't1')).toBe('c-move');
  });

  it('falls back to the 이동수단 name when the icon was changed', () => {
    const ws = scaffold();
    ws.columns['c-move'] = { ...ws.columns['c-move'], icon: '🚈' };
    expect(transportColumnId(ws, 't1')).toBe('c-move');
  });

  it('is null for a trip with neither, and for no trip at all', () => {
    const ws = scaffold();
    ws.columns['c-move'] = { ...ws.columns['c-move'], icon: '🚈', name: '탈것' };
    expect(transportColumnId(ws, 't1')).toBeNull();
    expect(transportColumnId(ws, undefined)).toBeNull();
    expect(transportColumnId(ws, 'nope')).toBeNull();
  });
});

describe('dayRoute — stops', () => {
  it('orders the located cards of the day by start time', () => {
    const ws = scaffold();
    addCard(ws, 'k1', 'c-see', at(35.7, 139.7));
    addCard(ws, 'k2', 'c-see', at(35.6, 139.8));
    addCard(ws, 'k3', 'c-see', at(35.5, 139.9));
    place(ws, 'e3', 'k3', 900);
    place(ws, 'e1', 'k1', 540);
    place(ws, 'e2', 'k2', 720);

    const route = dayRoute(ws, 'd1');
    expect(route.stops.map((stop) => stop.cardId)).toEqual(['k1', 'k2', 'k3']);
    expect(route.stops.map((stop) => stop.order)).toEqual([1, 2, 3]);
    expect(route.stops.map((stop) => stop.startMin)).toEqual([540, 720, 900]);
    expect(route.stops[0]).toMatchObject({ lat: 35.7, lng: 139.7 });
    expect(route.legs).toHaveLength(2);
    expect(route.legs[0].from.cardId).toBe('k1');
    expect(route.legs[0].to.cardId).toBe('k2');
  });

  it('leaves out cards with no location, and days that are not this one', () => {
    const ws = scaffold();
    ws.days.d2 = { ...ws.days.d1, id: 'd2', label: '2일차' };
    ws.sheets.s1.dayOrder.push('d2');
    addCard(ws, 'k1', 'c-see', at(35.7, 139.7));
    addCard(ws, 'k2', 'c-see');
    addCard(ws, 'k3', 'c-see', at(35.5, 139.9));
    place(ws, 'e1', 'k1', 540);
    place(ws, 'e2', 'k2', 600);
    place(ws, 'e3', 'k3', 660, 'd2');

    const route = dayRoute(ws, 'd1');
    expect(route.stops.map((stop) => stop.cardId)).toEqual(['k1']);
    expect(route.legs).toEqual([]);
  });

  it('treats a located 이동수단 card as a stop of its own', () => {
    const ws = scaffold();
    addCard(ws, 'k1', 'c-see', at(35.7, 139.7));
    addCard(ws, 'station', 'c-move', at(35.65, 139.75));
    addCard(ws, 'k2', 'c-see', at(35.6, 139.8));
    place(ws, 'e1', 'k1', 540);
    place(ws, 'e2', 'station', 600);
    place(ws, 'e3', 'k2', 660);

    const route = dayRoute(ws, 'd1');
    expect(route.stops.map((stop) => stop.cardId)).toEqual(['k1', 'station', 'k2']);
    expect(route.legs).toHaveLength(2);
    expect(route.legs.every((leg) => leg.transportCardId === undefined)).toBe(true);
  });

  it('drops a location with non-finite coordinates', () => {
    const ws = scaffold();
    addCard(ws, 'k1', 'c-see', at(Number.NaN, 139.7));
    place(ws, 'e1', 'k1', 540);
    expect(dayRoute(ws, 'd1').stops).toEqual([]);
  });

  it('is empty for an unknown or empty day', () => {
    const ws = scaffold();
    expect(dayRoute(ws, 'd1')).toEqual({ stops: [], legs: [] });
    expect(dayRoute(ws, 'nope')).toEqual({ stops: [], legs: [] });
  });

  it('breaks a start-time tie deterministically', () => {
    const ws = scaffold();
    addCard(ws, 'k1', 'c-see', at(35.7, 139.7));
    addCard(ws, 'k2', 'c-see', at(35.6, 139.8));
    place(ws, 'e1', 'k1', 600, 'd1', AT + 10);
    place(ws, 'e2', 'k2', 600, 'd1', AT + 5);

    // Same minute → the older entry leads.
    expect(dayRoute(ws, 'd1').stops.map((stop) => stop.cardId)).toEqual(['k2', 'k1']);
  });
});

describe('dayRoute — 이동수단 legs', () => {
  it('attaches a location-less 이동수단 card sitting between two stops', () => {
    const ws = scaffold();
    addCard(ws, 'k1', 'c-see', at(35.7, 139.7));
    addCard(ws, 'ride', 'c-move');
    addCard(ws, 'k2', 'c-see', at(35.6, 139.8));
    place(ws, 'e1', 'k1', 540);
    place(ws, 'e2', 'ride', 600);
    place(ws, 'e3', 'k2', 660);

    const [leg] = dayRoute(ws, 'd1').legs;
    expect(leg.transportCardId).toBe('ride');
  });

  it('does not attach a ride that falls outside the two stops', () => {
    const ws = scaffold();
    addCard(ws, 'k1', 'c-see', at(35.7, 139.7));
    addCard(ws, 'k2', 'c-see', at(35.6, 139.8));
    addCard(ws, 'ride', 'c-move');
    place(ws, 'e1', 'k1', 540);
    place(ws, 'e2', 'k2', 660);
    place(ws, 'e3', 'ride', 900); // after the last stop

    expect(dayRoute(ws, 'd1').legs[0].transportCardId).toBeUndefined();
  });

  it('ignores a non-이동수단 card between the stops', () => {
    const ws = scaffold();
    addCard(ws, 'k1', 'c-see', at(35.7, 139.7));
    addCard(ws, 'lunch', 'c-see');
    addCard(ws, 'k2', 'c-see', at(35.6, 139.8));
    place(ws, 'e1', 'k1', 540);
    place(ws, 'e2', 'lunch', 600);
    place(ws, 'e3', 'k2', 660);

    expect(dayRoute(ws, 'd1').legs[0].transportCardId).toBeUndefined();
  });

  it('takes the first ride when the gap holds two', () => {
    const ws = scaffold();
    addCard(ws, 'k1', 'c-see', at(35.7, 139.7));
    addCard(ws, 'bus', 'c-move');
    addCard(ws, 'train', 'c-move');
    addCard(ws, 'k2', 'c-see', at(35.6, 139.8));
    place(ws, 'e1', 'k1', 540);
    place(ws, 'e2', 'bus', 570);
    place(ws, 'e3', 'train', 600);
    place(ws, 'e4', 'k2', 660);

    expect(dayRoute(ws, 'd1').legs[0].transportCardId).toBe('bus');
  });

  it('attaches nothing when the trip has no 이동수단 column', () => {
    const ws = scaffold();
    ws.columns['c-move'] = { ...ws.columns['c-move'], icon: '🚈', name: '탈것' };
    addCard(ws, 'k1', 'c-see', at(35.7, 139.7));
    addCard(ws, 'ride', 'c-move');
    addCard(ws, 'k2', 'c-see', at(35.6, 139.8));
    place(ws, 'e1', 'k1', 540);
    place(ws, 'e2', 'ride', 600);
    place(ws, 'e3', 'k2', 660);

    expect(dayRoute(ws, 'd1').legs[0].transportCardId).toBeUndefined();
  });
});

describe('legBearingDeg / legMidpoint', () => {
  it('points north / east / south / west', () => {
    expect(legBearingDeg({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(0, 5);
    expect(legBearingDeg({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })).toBeCloseTo(90, 5);
    expect(legBearingDeg({ lat: 0, lng: 0 }, { lat: -1, lng: 0 })).toBeCloseTo(180, 5);
    expect(legBearingDeg({ lat: 0, lng: 0 }, { lat: 0, lng: -1 })).toBeCloseTo(270, 5);
  });

  it('squeezes longitude by cos(lat), so a NE hop at 60° is not 45°', () => {
    // At lat 60 one degree of longitude is half a degree of latitude wide.
    const bearing = legBearingDeg({ lat: 60, lng: 0 }, { lat: 61, lng: 1 });
    expect(bearing).toBeGreaterThan(20);
    expect(bearing).toBeLessThan(30);
  });

  it('degrades to 0 for a zero-length leg', () => {
    expect(legBearingDeg({ lat: 35, lng: 139 }, { lat: 35, lng: 139 })).toBe(0);
  });

  it('halves the leg', () => {
    expect(legMidpoint({ lat: 0, lng: 0 }, { lat: 10, lng: 20 })).toEqual({ lat: 5, lng: 10 });
  });
});

describe('haversineKm', () => {
  it('measures a known hop — 난바 → 우메다 is about 4km', () => {
    const km = haversineKm({ lat: 34.6659, lng: 135.5011 }, { lat: 34.7025, lng: 135.4959 });
    expect(km).toBeGreaterThan(3.9);
    expect(km).toBeLessThan(4.2);
  });

  it('is one degree of latitude ≈ 111km, and symmetric', () => {
    const north = haversineKm({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
    expect(north).toBeGreaterThan(110);
    expect(north).toBeLessThan(112);
    expect(haversineKm({ lat: 1, lng: 0 }, { lat: 0, lng: 0 })).toBeCloseTo(north, 9);
  });

  it('squeezes longitude with latitude', () => {
    const equator = haversineKm({ lat: 0, lng: 0 }, { lat: 0, lng: 1 });
    const north60 = haversineKm({ lat: 60, lng: 0 }, { lat: 60, lng: 1 });
    expect(north60).toBeLessThan(equator * 0.55);
    expect(north60).toBeGreaterThan(equator * 0.45);
  });

  it('is 0 for the same point and for garbled coordinates', () => {
    expect(haversineKm({ lat: 35, lng: 139 }, { lat: 35, lng: 139 })).toBe(0);
    expect(haversineKm({ lat: Number.NaN, lng: 139 }, { lat: 35, lng: 139 })).toBe(0);
  });
});

describe('formatDistanceKm', () => {
  it('reads metres below a kilometre and km above it', () => {
    expect(formatDistanceKm(0.85)).toBe('850m');
    expect(formatDistanceKm(0.333)).toBe('333m');
    expect(formatDistanceKm(3.44)).toBe('3.4km');
    expect(formatDistanceKm(12)).toBe('12km');
    expect(formatDistanceKm(1)).toBe('1km');
  });

  it('never prints 1000m', () => {
    expect(formatDistanceKm(0.9999)).toBe('1km');
  });

  it('is empty for nonsense', () => {
    expect(formatDistanceKm(Number.NaN)).toBe('');
    expect(formatDistanceKm(-1)).toBe('');
  });
});
