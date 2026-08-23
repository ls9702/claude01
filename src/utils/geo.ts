/**
 * Geocoding — the app's only network call (M3).
 *
 * Every request to Nominatim goes through {@link searchPlaces}, which keeps the
 * URL, the response shape and the error text in one place — and gives e2e a
 * single `**\/nominatim.openstreetmap.org/**` route to stub.
 *
 * OSM's usage policy is respected by construction: search runs **only** on an
 * explicit submit (no typeahead), asks for 5 results, and the caller waits
 * {@link SEARCH_COOLDOWN_MS} between requests. No custom headers are sent —
 * a browser would strip them anyway and they would trip CORS preflight.
 * Reverse geocoding is deliberately not used; a hand-dropped pin is labelled
 * with its own coordinates instead (see {@link formatLatLng}).
 */

import type { GeoPoint } from '../types/models';

/** Search endpoint. Kept whole so tests can match on it. */
export const NOMINATIM_SEARCH_URL = 'https://nominatim.openstreetmap.org/search';

/** How many results a search asks for. */
export const SEARCH_LIMIT = 5;

/** Minimum gap between two searches; the 검색 button stays disabled that long. */
export const SEARCH_COOLDOWN_MS = 1200;

/** Friendly Korean message shown for any network/parse failure. */
export const SEARCH_ERROR_MESSAGE = '장소를 찾지 못했어요. 잠시 후 다시 시도해 주세요.';

/** The three `jsonv2` fields this app reads. */
interface RawPlace {
  lat?: unknown;
  lon?: unknown;
  display_name?: unknown;
}

/** `35.65953`, `'139.7005'` → `"35.6595, 139.7005"`. */
export const formatLatLng = (lat: number, lng: number): string =>
  `${lat.toFixed(4)}, ${lng.toFixed(4)}`;

/** The address written onto a pin the user placed by hand. */
export const pinAddress = (lat: number, lng: number): string => formatLatLng(lat, lng);

/** `"37.5665, 126.9780"` — a hand-dropped pin's address, commas and all. */
const LATLNG_RE = /^-?\d+(\.\d+)?,\s*-?\d+(\.\d+)?$/;

/**
 * Shortens an address **for display only** — the stored value never changes.
 *
 * Nominatim hands back the whole administrative chain ("시부야 스크램블 교차로,
 * 2초메, 시부야구, 도쿄도, 일본"), which is far more than a 4mm-tall board chip
 * can say. Only the head of that chain is the place's name, so that is what the
 * chip shows and the `title` keeps the rest.
 *
 * A coordinate pair is checked **first** and returned untouched: it contains a
 * comma too, and "첫 쉼표 앞" would turn a pin's label into a bare latitude.
 */
export const shortPlace = (address: string): string => {
  const value = address.trim();
  if (LATLNG_RE.test(value)) return value;
  const head = value.split(',')[0]?.trim();
  return head && head.length > 0 ? head : value;
};

/** Coerces Nominatim's stringified numbers; `null` for anything unusable. */
const toNumber = (value: unknown): number | null => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * Maps a raw `jsonv2` payload to {@link GeoPoint}s, dropping rows without
 * usable coordinates. Exported (and pure) so it can be unit-tested without a
 * network stub.
 */
export function parsePlaces(raw: unknown): GeoPoint[] {
  if (!Array.isArray(raw)) return [];
  const places: GeoPoint[] = [];
  for (const row of raw as RawPlace[]) {
    if (!row || typeof row !== 'object') continue;
    const lat = toNumber(row.lat);
    const lng = toNumber(row.lon);
    if (lat === null || lng === null) continue;
    const address =
      typeof row.display_name === 'string' && row.display_name.trim().length > 0
        ? row.display_name.trim()
        : formatLatLng(lat, lng);
    places.push({ lat, lng, address });
  }
  return places;
}

/** The query string sent to Nominatim, without the origin. */
export function searchUrl(query: string): string {
  const params = new URLSearchParams({
    format: 'jsonv2',
    q: query,
    limit: String(SEARCH_LIMIT),
    'accept-language': 'ko',
  });
  return `${NOMINATIM_SEARCH_URL}?${params.toString()}`;
}

/**
 * Looks a place up by name. Resolves to at most {@link SEARCH_LIMIT} points —
 * an empty array means "nothing matched", while a network or HTTP failure
 * rejects with {@link SEARCH_ERROR_MESSAGE} for the UI to show as-is.
 */
export async function searchPlaces(query: string, signal?: AbortSignal): Promise<GeoPoint[]> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];

  let response: Response;
  try {
    response = await fetch(searchUrl(trimmed), { signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new Error(SEARCH_ERROR_MESSAGE);
  }
  if (!response.ok) throw new Error(SEARCH_ERROR_MESSAGE);

  try {
    return parsePlaces(await response.json());
  } catch {
    throw new Error(SEARCH_ERROR_MESSAGE);
  }
}
