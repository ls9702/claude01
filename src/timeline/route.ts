/**
 * A day's itinerary as a route (M6).
 *
 * The 지도 tab can draw the day the user actually planned: every located card
 * scheduled on that day, in start-time order, joined by arrows. The mapping is
 * deliberately mechanical —
 *
 * - **stop** = an entry of the day whose card has a usable `location`. A
 *   transport card (🚗 / 이동수단) that *does* carry a location is a stop like
 *   any other: a station is a place.
 * - **leg** = the hop between two consecutive stops.
 * - a transport card **without** a location that sits between the two stops in
 *   time is attached to that leg as `transportCardId`, so the arrow can wear
 *   the 🚗 / ✈️ of the ride instead of a bare chevron.
 *
 * Pure and React-free so the map layer only has to draw what comes back.
 */

import type { BoardColumn, Id, TimelineEntry, Workspace } from '../types/models';
import { windowedDayEntries } from './dayWindow';

/** Icon that marks a board column as the trip's 이동수단 category. */
export const TRANSPORT_ICON = '🚗';

/** Name that marks a board column as the trip's 이동수단 category. */
export const TRANSPORT_COLUMN_NAME = '이동수단';

/** One place the day passes through. */
export interface RouteStop {
  cardId: Id;
  lat: number;
  lng: number;
  /** 1-based position along the day. */
  order: number;
  /** Start of the entry that put this stop here, minutes from midnight. */
  startMin: number;
}

/** The hop between two consecutive stops. */
export interface RouteLeg {
  from: RouteStop;
  to: RouteStop;
  /**
   * A location-less 이동수단 card scheduled between the two stops — the ride
   * itself. Absent when the gap holds no such card.
   */
  transportCardId?: Id;
}

/** What {@link dayRoute} hands the map. */
export interface DayRoute {
  stops: RouteStop[];
  legs: RouteLeg[];
}

/** An empty route — an unknown day, or a day with nothing located on it. */
export const emptyRoute = (): DayRoute => ({ stops: [], legs: [] });

/**
 * The trip's 이동수단 column: the one carrying {@link TRANSPORT_ICON}, else the
 * one named {@link TRANSPORT_COLUMN_NAME}. `null` when the trip has neither —
 * legs then simply never carry a `transportCardId`.
 */
export function transportColumnId(workspace: Workspace, tripId: Id | undefined): Id | null {
  if (!tripId) return null;
  const columns = (workspace.trips[tripId]?.columnOrder ?? [])
    .map((columnId) => workspace.columns[columnId])
    .filter((column): column is BoardColumn => Boolean(column));

  const byIcon = columns.find((column) => column.icon === TRANSPORT_ICON);
  if (byIcon) return byIcon.id;
  const byName = columns.find((column) => column.name.trim() === TRANSPORT_COLUMN_NAME);
  return byName?.id ?? null;
}

/**
 * Sort key: start time, then creation, then id — always deterministic.
 *
 * Exported because `timeline/gap.ts` walks the very same entry list to map a
 * {@link RouteStop} back onto the entry that produced it; the two orderings
 * must be the identical one, not merely similar.
 */
export const byStart = (a: TimelineEntry, b: TimelineEntry): number =>
  a.startMin - b.startMin || a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1);

/** Mean Earth radius, in kilometres. */
const EARTH_RADIUS_KM = 6371;

const RAD = Math.PI / 180;

/**
 * Great-circle distance between two points, in kilometres (M7b).
 *
 * The 이동 갭 칩 states a **straight-line** fact — no roads, no timetable — so
 * the haversine is not an approximation of the answer, it *is* the answer.
 * Non-finite coordinates degrade to `0` rather than `NaN`.
 */
export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  if (![a.lat, a.lng, b.lat, b.lng].every((value) => Number.isFinite(value))) return 0;

  const dLat = (b.lat - a.lat) * RAD;
  const dLng = (b.lng - a.lng) * RAD;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * `3.44` → `"3.4km"`, `12` → `"12km"`, `0.85` → `"850m"`.
 *
 * Under a kilometre the number reads in metres, because `0.9km` is a distance
 * nobody quotes. Shared by the gap chip and the map's leg popup so the same hop
 * never reads two different ways.
 */
export function formatDistanceKm(km: number): string {
  if (!Number.isFinite(km) || km < 0) return '';
  if (km < 1) {
    const metres = Math.round(km * 1000);
    if (metres < 1000) return `${metres}m`;
  }
  return `${(Math.round(km * 10) / 10).toFixed(1).replace(/\.0$/, '')}km`;
}

/**
 * Bearing from `from` to `to` in degrees clockwise from north (`0` = up).
 *
 * An equirectangular approximation — longitudes are squeezed by `cos(lat)` —
 * which is exact enough for an arrowhead a few pixels wide, and needs no
 * projection from the map.
 */
export function legBearingDeg(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): number {
  const midLat = ((from.lat + to.lat) / 2) * (Math.PI / 180);
  const dx = (to.lng - from.lng) * Math.cos(midLat);
  const dy = to.lat - from.lat;
  if (dx === 0 && dy === 0) return 0;
  const deg = (Math.atan2(dx, dy) * 180) / Math.PI;
  return (deg + 360) % 360;
}

/** Midpoint of a leg, in the same flat approximation. */
export function legMidpoint(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): { lat: number; lng: number } {
  return { lat: (from.lat + to.lat) / 2, lng: (from.lng + to.lng) / 2 };
}

/**
 * The route of one day.
 *
 * Returns `{ stops: [], legs: [] }` for an unknown day, and a route with no
 * legs when only one stop is located. Legend filters do **not** apply here —
 * the route is a schedule view, so hiding a category on the map never breaks
 * the chain of arrows.
 */
export function dayRoute(workspace: Workspace, dayId: Id): DayRoute {
  const day = workspace.days[dayId];
  if (!day) return emptyRoute();

  const entries = Object.values(workspace.entries)
    .filter((entry) => entry.dayId === dayId)
    .sort(byStart);
  return routeOfEntries(workspace, day.tripId, entries);
}

/**
 * The route of one **window** day — 05시부터 다음 날 05시까지 (M16-B).
 *
 * 지도 1일차 must be the same set of stops as 일정표 1일차, or the two tabs are
 * describing different trips. The 새벽 이동 that closes a night therefore hangs
 * off the *previous* day's chain of arrows, which is where the user drew it.
 *
 * The ordering is the window's, not the clock's: `23:40 → 00:20` is two stops
 * in that order, which `byStart` alone would have reversed.
 */
export function dayRouteWindowed(
  workspace: Workspace,
  dayId: Id,
  dayOrder: readonly Id[],
): DayRoute {
  const day = workspace.days[dayId];
  if (!day) return emptyRoute();

  const entries = windowedDayEntries(workspace, dayId, dayOrder).map((row) => row.entry);
  return routeOfEntries(workspace, day.tripId, entries);
}

/**
 * The stop/leg walk itself, over an **already ordered** entry list.
 *
 * Shared by {@link dayRoute} and {@link dayRouteWindowed} so the two can never
 * drift apart: the only thing that separates them is which entries they get and
 * in what order.
 */
function routeOfEntries(
  workspace: Workspace,
  tripId: Id,
  entries: readonly TimelineEntry[],
): DayRoute {
  if (entries.length === 0) return emptyRoute();

  const transportId = transportColumnId(workspace, tripId);

  /** Stop index inside `entries`, so the gaps can be scanned for a ride. */
  const stops: RouteStop[] = [];
  const stopAt: number[] = [];

  entries.forEach((entry, index) => {
    const location = workspace.cards[entry.cardId]?.location;
    if (!location) return;
    if (!Number.isFinite(location.lat) || !Number.isFinite(location.lng)) return;
    stops.push({
      cardId: entry.cardId,
      lat: location.lat,
      lng: location.lng,
      order: stops.length + 1,
      startMin: entry.startMin,
    });
    stopAt.push(index);
  });

  const legs: RouteLeg[] = [];
  for (let i = 0; i + 1 < stops.length; i += 1) {
    const leg: RouteLeg = { from: stops[i], to: stops[i + 1] };

    if (transportId) {
      for (let index = stopAt[i] + 1; index < stopAt[i + 1]; index += 1) {
        const card = workspace.cards[entries[index].cardId];
        if (!card || card.columnId !== transportId || card.location) continue;
        leg.transportCardId = card.id;
        break;
      }
    }
    legs.push(leg);
  }

  return { stops, legs };
}
