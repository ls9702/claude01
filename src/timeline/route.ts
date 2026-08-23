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

/** Sort key: start time, then creation, then id — always deterministic. */
const byStart = (a: TimelineEntry, b: TimelineEntry): number =>
  a.startMin - b.startMin || a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1);

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
  if (entries.length === 0) return emptyRoute();

  const transportId = transportColumnId(workspace, day.tripId);

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
