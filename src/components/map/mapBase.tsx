import { divIcon, type DivIcon } from 'leaflet';
import { TileLayer } from 'react-leaflet';
import type { Id } from '../../types/models';
import { colorHex } from '../../utils/colors';

/** OpenStreetMap's standard raster tiles. */
export const OSM_TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

/** Attribution required by the OSM tile usage policy. */
export const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> 기여자';

/** Fallback view when there is nothing to fit: most of the world. */
export const WORLD_CENTER: [number, number] = [20, 0];
export const WORLD_ZOOM = 2;

/** Fallback view for the pin picker when the card has no location yet. */
export const SEOUL_CENTER: [number, number] = [37.5665, 126.978];
export const SEOUL_ZOOM = 12;

/**
 * Zoom used when a trip's 목적지 is all we have to go on (M12).
 *
 * A destination is a *city*, not an address — Nominatim answers "일본 오사카"
 * with one point in the middle of it. 11 frames roughly that city and its
 * neighbours; the 15 of {@link FIT_MAX_ZOOM} would frame one block of it.
 */
export const DESTINATION_ZOOM = 11;

/** Never zoom past this when fitting a single marker. */
export const FIT_MAX_ZOOM = 15;

/** `fitBounds` padding, as a fraction of the bounds' size. */
export const FIT_PAD = 0.2;

/** The OSM base layer, with its attribution. */
export function OsmTiles() {
  return <TileLayer url={OSM_TILE_URL} attribution={OSM_ATTRIBUTION} maxZoom={19} />;
}

/** `&` → `&amp;` … — column icons and ids end up inside a raw HTML string. */
const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const PIN_PX = 30;

/**
 * A teardrop pin in the column's color with the column's emoji inside.
 *
 * Leaflet builds a `DivIcon` from an HTML **string**, which the Tailwind
 * scanner never sees — so every rule here is inline, and the color comes from
 * {@link colorHex} rather than from a class. The rotated square makes the
 * classic map-pin silhouette; the emoji is counter-rotated to stay upright.
 * The tip sits ~6px below the icon box, hence the `iconAnchor` of 36.
 */
export function cardPinIcon(
  color: string,
  icon: string,
  cardId: Id,
  columnId: Id,
  /**
   * Fade the pin back (M15 §3) — a place that belongs to some *other* day
   * while one day's route is on screen. Still a pin, still tappable; just no
   * longer competing with the day being read.
   */
  dimmed = false,
): DivIcon {
  const hex = colorHex(color);
  const html = [
    `<div data-testid="map-marker" data-card-id="${escapeHtml(cardId)}"`,
    ` data-column-id="${escapeHtml(columnId)}"`,
    ` data-dimmed="${dimmed ? 'true' : 'false'}"`,
    ` style="width:${PIN_PX}px;height:${PIN_PX}px;background:${hex};border:2px solid #fff;`,
    dimmed ? 'opacity:0.35;' : '',
    `border-radius:50% 50% 50% 0;transform:rotate(-45deg);`,
    `box-shadow:0 2px 6px rgba(28,25,23,0.35);display:flex;align-items:center;`,
    `justify-content:center;">`,
    `<span style="transform:rotate(45deg);font-size:15px;line-height:1;">`,
    escapeHtml(icon),
    '</span></div>',
  ].join('');

  return divIcon({
    html,
    // Leaflet's own class adds a white box we do not want.
    className: 'tb-pin',
    iconSize: [PIN_PX, PIN_PX],
    iconAnchor: [PIN_PX / 2, PIN_PX + 6],
    popupAnchor: [0, -PIN_PX - 2],
  });
}
