import { Fragment } from 'react';
import { divIcon, type DivIcon } from 'leaflet';
import { Marker, Polyline, Popup } from 'react-leaflet';
import type { BoardColumn, Card, Id } from '../../types/models';
import {
  formatDistanceKm,
  haversineKm,
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
  /**
   * 1-based position of the day inside the sheet, set **only** in 전체 mode.
   *
   * With several days drawn at once the per-day stop numbers restart, so the
   * badges read `1 · 1 · 2` — which looks like a bug rather than like two
   * days. When this is set the badge says `일자-순번` (`2-1`) instead.
   */
  dayIndex?: number;
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
function stopIcon(order: number, cardId: Id, color: string, dayIndex?: number): DivIcon {
  // `data-order` stays the plain stop number whatever the badge reads.
  const label = dayIndex === undefined ? String(order) : `${dayIndex}-${order}`;
  const width = dayIndex === undefined ? 18 : 26;
  const html = [
    `<div data-testid="route-stop" data-order="${order}"`,
    ` data-card-id="${escapeHtml(cardId)}"`,
    ` style="width:${width}px;height:18px;border-radius:9999px;background:${color};`,
    `border:2px solid #fff;${SHADOW};display:flex;align-items:center;justify-content:center;`,
    `color:#fff;font-size:10px;font-weight:700;line-height:1;font-variant-numeric:tabular-nums;">`,
    escapeHtml(label),
    '</div>',
  ].join('');

  return divIcon({
    html,
    className: 'tb-route-stop',
    iconSize: [width, 18],
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
 *
 * M15 §3 — the arrowhead was 16px of thin outline and the owner reported never
 * having seen one. It is 22px now, with a heavier white keyline and a drop
 * shadow, so 이동 방향 reads over any tile without zooming in.
 */
const ARROW_PX = 22;

function legIcon(
  bearing: number,
  fromCardId: Id,
  toCardId: Id,
  color: string,
  rideIcon?: string,
): DivIcon {
  const arrow = [
    `<svg width="${ARROW_PX}" height="${ARROW_PX}" viewBox="0 0 24 24" aria-hidden="true"`,
    ` style="transform:rotate(${bearing.toFixed(1)}deg);display:block;`,
    `filter:drop-shadow(0 1px 2px rgba(28,25,23,0.45));">`,
    `<path d="M12 1.5 L20.5 21.5 L12 16.6 L3.5 21.5 Z" fill="${color}" stroke="#ffffff"`,
    ` stroke-width="2.2" stroke-linejoin="round" />`,
    '</svg>',
  ].join('');

  const pill = rideIcon
    ? [
        `<span style="background:#fff;border-radius:9999px;padding:1px 5px;font-size:12px;`,
        `line-height:1.4;${SHADOW};">`,
        escapeHtml(rideIcon),
        '</span>',
      ].join('')
    : '';

  const width = rideIcon ? 52 : ARROW_PX;
  const html = [
    `<div data-testid="route-leg" data-from="${escapeHtml(fromCardId)}"`,
    ` data-to="${escapeHtml(toCardId)}"`,
    ` data-ride="${rideIcon ? 'true' : 'false'}"`,
    ` style="width:${width}px;height:${ARROW_PX}px;display:flex;align-items:center;`,
    `justify-content:center;gap:2px;">`,
    pill,
    arrow,
    '</div>',
  ].join('');

  return divIcon({
    html,
    className: 'tb-route-leg',
    iconSize: [width, ARROW_PX],
    iconAnchor: [width / 2, ARROW_PX / 2],
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
        const { route, color, dayId, dayTitle, dayIndex } = drawing;
        if (route.stops.length === 0) return null;

        return (
          <Fragment key={dayId}>
            {route.stops.length > 1 ? (
              <Polyline
                positions={route.stops.map((stop) => [stop.lat, stop.lng] as [number, number])}
                pathOptions={{ color, weight: 5, opacity: 0.85, lineJoin: 'round' }}
              />
            ) : null}

            {route.stops.map((stop) => (
              <Marker
                key={`${dayId}:${stop.order}`}
                position={[stop.lat, stop.lng]}
                icon={stopIcon(stop.order, stop.cardId, color, dayIndex)}
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
                      <p className="text-micro font-normal text-ink-faint">{dayTitle}</p>
                      <p className="mt-1 text-title text-ink">
                        {cards[leg.from.cardId]?.title ?? '출발'} →{' '}
                        {cards[leg.to.cardId]?.title ?? '도착'}
                      </p>
                      <p className="mt-1 text-label font-normal tabular-nums text-ink-muted">
                        {legTiming(leg)}
                      </p>
                      {/* The same straight-line fact the 일정 tab's gap chip
                          states — one measurement, two places to read it. */}
                      <p
                        data-testid="route-leg-distance"
                        data-km={haversineKm(leg.from, leg.to).toFixed(2)}
                        className="text-label font-normal tabular-nums text-ink-muted"
                      >
                        직선 {formatDistanceKm(haversineKm(leg.from, leg.to))}
                      </p>
                      {ride ? (
                        <p
                          data-testid="route-leg-transport"
                          data-card-id={ride.id}
                          className="mt-1 text-label text-ink"
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
