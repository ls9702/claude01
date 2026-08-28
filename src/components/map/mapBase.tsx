import { divIcon, type DivIcon } from 'leaflet';
import { TileLayer } from 'react-leaflet';
import { MY_LOCATION_HEX } from '../../map/geolocate';
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
  /**
   * 이 핀이 대는 이름표 (M35).
   *
   * 지도 탭의 핀은 계속 `map-marker`다 — 스펙 절반이 그 이름으로 핀을 센다.
   * 카드 안의 「위치 확인」 미리보기는 자기 이름을 쓴다: 지도 위의 핀이 아니라
   * 그 카드 하나를 보여 주는 그림이라, 같은 이름으로 세어지면 곤란하다.
   */
  testId = 'map-marker',
): DivIcon {
  const hex = colorHex(color);
  const html = [
    `<div data-testid="${escapeHtml(testId)}" data-card-id="${escapeHtml(cardId)}"`,
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

/** 「내 위치」 파란 점의 지름 (M42). */
const MY_LOCATION_PX = 18;

/** 「내 위치」로 이동할 때의 최소 배율 — 동네가 보이는 정도. */
export const MY_LOCATION_ZOOM = 16;

/**
 * 「나」를 나타내는 파란 점 (M42) — 카테고리 핀과 절대 헷갈리면 안 되는 표식.
 *
 * 그래서 물방울이 아니라 **동그라미**이고, 팔레트의 어느 카테고리 색도 아닌
 * 지도 앱 공통의 파랑이다. `data-testid`를 달기 위해 `CircleMarker` 대신
 * `divIcon`을 쓴다 — SVG path에는 이름표를 붙일 자리가 마땅치 않다.
 */
export function myLocationIcon(): DivIcon {
  const html = [
    '<div data-testid="map-my-location"',
    ` style="width:${MY_LOCATION_PX}px;height:${MY_LOCATION_PX}px;border-radius:9999px;`,
    `background:${MY_LOCATION_HEX};border:3px solid #fff;`,
    'box-shadow:0 1px 6px rgba(28,25,23,0.45);"></div>',
  ].join('');

  return divIcon({
    html,
    className: 'tb-my-location',
    iconSize: [MY_LOCATION_PX, MY_LOCATION_PX],
    iconAnchor: [MY_LOCATION_PX / 2, MY_LOCATION_PX / 2],
  });
}
