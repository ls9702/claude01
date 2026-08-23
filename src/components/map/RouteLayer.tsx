import { Fragment } from 'react';
import { divIcon, type DivIcon } from 'leaflet';
import { Marker, Polyline, Popup } from 'react-leaflet';
import type { BoardColumn, Card, Id } from '../../types/models';
import {
  legBearingDeg,
  legMidpoint,
  type DayRoute,
  type RouteLeg,
} from '../../timeline/route';
import { formatClock, formatDuration } from '../../utils/time';

/** One day's route, ready to draw. */
export interface RouteDrawing {
  dayId: Id;
  /** Heading used in the arrow popups (`1일차`, `10/12 (토)`, …). */
  dayTitle: string;
  /** Line color as literal hex — Leaflet never sees a Tailwind class. */
  color: string;
  route: DayRoute;
}

interface RouteLayerProps {
  drawings: readonly RouteDrawing[];
  cards: Record<Id, Card>;
  columns: Record<Id, BoardColumn>;
}

/** `&` → `&amp;` … — everything below ends up inside a raw HTML string. */
const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const SHADOW = 'box-shadow:0 1px 4px rgba(28,25,23,0.35)';

/**
 * The numbered badge that says "this is the 3rd stop of the day".
 *
 * It is a **layer of its own**, offset up and to the right of the category pin
 * rather than replacing it: the pin still answers "what kind of place is this",
 * the badge answers "when do I get there".
 */
function stopIcon(order: number, cardId: Id, color: string): DivIcon {
  const html = [
    `<div data-testid="route-stop" data-order="${order}"`,
    ` data-card-id="${escapeHtml(cardId)}"`,
    ` style="width:18px;height:18px;border-radius:9999px;background:${color};`,
    `border:2px solid #fff;${SHADOW};display:flex;align-items:center;justify-content:center;`,
    `color:#fff;font-size:10px;font-weight:700;line-height:1;font-variant-numeric:tabular-nums;">`,
    String(order),
    '</div>',
  ].join('');

  return divIcon({
    html,
    className: 'tb-route-stop',
    iconSize: [18, 18],
    // Up and to the right of the pin's tip, clear of the emoji.
    iconAnchor: [-6, 38],
  });
}

/**
 * The arrowhead sitting at a leg's midpoint, rotated to the leg's bearing.
 *
 * No plugin and no canvas: an inline SVG chevron drawn pointing **north** and
 * turned by `bearing` degrees, which is what a polyline decorator would do
 * anyway. A leg that carries a ride also gets a white pill with that category's
 * emoji, so 🚗 / ✈️ reads at a glance.
 */
function legIcon(
  bearing: number,
  fromCardId: Id,
  toCardId: Id,
  color: string,
  rideIcon?: string,
): DivIcon {
  const arrow = [
    `<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"`,
    ` style="transform:rotate(${bearing.toFixed(1)}deg);display:block;">`,
    `<path d="M12 2 L20 21 L12 16.5 L4 21 Z" fill="${color}" stroke="#ffffff"`,
    ` stroke-width="1.6" stroke-linejoin="round" />`,
    '</svg>',
  ].join('');

  const pill = rideIcon
    ? [
        `<span style="background:#fff;border-radius:9999px;padding:1px 5px;font-size:11px;`,
        `line-height:1.4;${SHADOW};">`,
        escapeHtml(rideIcon),
        '</span>',
      ].join('')
    : '';

  const width = rideIcon ? 48 : 20;
  const html = [
    `<div data-testid="route-leg" data-from="${escapeHtml(fromCardId)}"`,
    ` data-to="${escapeHtml(toCardId)}"`,
    ` style="width:${width}px;height:20px;display:flex;align-items:center;`,
    `justify-content:center;gap:2px;">`,
    pill,
    arrow,
    '</div>',
  ].join('');

  return divIcon({
    html,
    className: 'tb-route-leg',
    iconSize: [width, 20],
    iconAnchor: [width / 2, 10],
    popupAnchor: [0, -8],
  });
}

/** `10:00 → 11:30 · 1시간 30분`, or just the times when the gap is zero. */
function legTiming(leg: RouteLeg): string {
  const gap = Math.max(leg.to.startMin - leg.from.startMin, 0);
  const times = `${formatClock(leg.from.startMin)} → ${formatClock(leg.to.startMin)}`;
  return gap > 0 ? `${times} · ${formatDuration(gap)}` : times;
}

/**
 * Draws one or more days' routes on top of the pin layer.
 *
 * The layer deliberately **ignores the legend filter**: the legend hides
 * categories of *places*, while the route answers "what order do I do this day
 * in" — dropping a muted stop would silently redraw the itinerary into
 * something the user never planned.
 */
export default function RouteLayer({ drawings, cards, columns }: RouteLayerProps) {
  return (
    <>
      {drawings.map((drawing) => {
        const { route, color, dayId, dayTitle } = drawing;
        if (route.stops.length === 0) return null;

        return (
          <Fragment key={dayId}>
            {route.stops.length > 1 ? (
              <Polyline
                positions={route.stops.map((stop) => [stop.lat, stop.lng] as [number, number])}
                pathOptions={{ color, weight: 4, opacity: 0.75, lineJoin: 'round' }}
              />
            ) : null}

            {route.stops.map((stop) => (
              <Marker
                key={`${dayId}:${stop.order}`}
                position={[stop.lat, stop.lng]}
                icon={stopIcon(stop.order, stop.cardId, color)}
                // The category pin underneath owns the popup; this badge is
                // pure decoration and must not swallow the tap.
                interactive={false}
                keyboard={false}
                zIndexOffset={600}
              />
            ))}

            {route.legs.map((leg) => {
              const mid = legMidpoint(leg.from, leg.to);
              const ride = leg.transportCardId ? cards[leg.transportCardId] : undefined;
              const rideIcon = ride ? columns[ride.columnId]?.icon : undefined;

              return (
                <Marker
                  key={`${dayId}:${leg.from.order}-${leg.to.order}`}
                  position={[mid.lat, mid.lng]}
                  icon={legIcon(
                    legBearingDeg(leg.from, leg.to),
                    leg.from.cardId,
                    leg.to.cardId,
                    color,
                    rideIcon,
                  )}
                  zIndexOffset={500}
                >
                  <Popup>
                    <div data-testid="route-leg-popup" data-day-id={dayId} className="min-w-40">
                      <p className="text-[11px] text-stone-400">{dayTitle}</p>
                      <p className="text-sm font-semibold text-stone-800">
                        {cards[leg.from.cardId]?.title ?? '출발'} →{' '}
                        {cards[leg.to.cardId]?.title ?? '도착'}
                      </p>
                      <p className="mt-0.5 text-[11px] tabular-nums text-stone-500">
                        {legTiming(leg)}
                      </p>
                      {ride ? (
                        <p
                          data-testid="route-leg-transport"
                          data-card-id={ride.id}
                          className="mt-1 text-[11px] font-medium text-stone-600"
                        >
                          {rideIcon ?? '🚗'} {ride.title}
                        </p>
                      ) : null}
                    </div>
                  </Popup>
                </Marker>
              );
            })}
          </Fragment>
        );
      })}
    </>
  );
}
