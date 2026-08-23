import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { latLngBounds } from 'leaflet';
import { MapContainer, Marker, Popup, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { useIsDesktop } from '../../hooks/useMediaQuery';
import { useUiStore } from '../../stores/uiStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import type { BoardColumn, Card, Day, Id, Sheet as SheetModel } from '../../types/models';
import { dayRoute } from '../../timeline/route';
import { COLOR_HEX, COLOR_TOKENS, colorClasses } from '../../utils/colors';
import { formatBudget } from '../../utils/money';
import { cardCommentCount, cardSpent } from '../../utils/spend';
import { formatDuration } from '../../utils/time';
import { dayTitle } from '../timeline/DayColumn';
import MapReady from './MapReady';
import RouteLayer, { type RouteDrawing } from './RouteLayer';
import {
  FIT_MAX_ZOOM,
  FIT_PAD,
  OsmTiles,
  WORLD_CENTER,
  WORLD_ZOOM,
  cardPinIcon,
} from './mapBase';

/** A located card plus the column it draws its color and icon from. */
interface Pin {
  card: Card;
  column: BoardColumn;
}

/** Shown when no trip is active — mirrors the board's and the timeline's picker. */
function TripPrompt() {
  const workspace = useWorkspaceStore((s) => s.workspace);
  const setTab = useUiStore((s) => s.setTab);
  const setActiveTrip = useUiStore((s) => s.setActiveTrip);
  const trips = useMemo(
    () => Object.values(workspace.trips).sort((a, b) => b.createdAt - a.createdAt),
    [workspace.trips],
  );

  return (
    <section
      data-testid="view-map"
      className="mx-auto flex max-w-md flex-col items-center gap-4 px-6 py-16 text-center"
    >
      <span aria-hidden="true" className="text-4xl">
        🗺️
      </span>
      <h1 className="text-xl font-semibold text-stone-800">지도</h1>
      <p className="text-sm leading-relaxed text-stone-400">
        {trips.length > 0 ? '어떤 여행의 지도를 열까요?' : '먼저 여행을 만들면 지도가 열려요.'}
      </p>

      {trips.length > 0 ? (
        <ul data-testid="map-trip-picker" className="mt-1 w-full space-y-2">
          {trips.map((trip) => (
            <li key={trip.id}>
              <button
                type="button"
                data-testid="map-trip-option"
                data-trip-id={trip.id}
                onClick={() => setActiveTrip(trip.id)}
                className="w-full rounded-xl border border-stone-200 bg-white px-4 py-3 text-left text-sm font-medium text-stone-700 shadow-sm hover:shadow-md"
              >
                {trip.title}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <button
          type="button"
          data-testid="map-goto-trips"
          onClick={() => setTab('trips')}
          className="rounded-full bg-stone-800 px-5 py-2.5 text-sm font-semibold text-white hover:bg-stone-900"
        >
          여행 만들러 가기
        </button>
      )}
    </section>
  );
}

interface FitPinsProps {
  points: readonly { lat: number; lng: number }[];
  /** Refit whenever this changes — the trip id, in practice. */
  fitKey: string;
  /** Fitting before the container is measured would pick the wrong zoom. */
  ready: boolean;
}

/** Frames every marker once per trip; falls back to a world view. */
function FitPins({ points, fitKey, ready }: FitPinsProps) {
  const map = useMap();
  const fittedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!ready || fittedRef.current === fitKey) return;
    fittedRef.current = fitKey;

    if (points.length === 0) {
      map.setView(WORLD_CENTER, WORLD_ZOOM, { animate: false });
      return;
    }
    const bounds = latLngBounds(points.map((point) => [point.lat, point.lng]));
    map.fitBounds(bounds.pad(FIT_PAD), { animate: false, maxZoom: FIT_MAX_ZOOM });
  }, [map, points, fitKey, ready]);

  return null;
}

/**
 * Frames the picked day's route, once per selection.
 *
 * Unlike {@link FitPins} an empty input is a no-op: turning the route off, or
 * picking a day with nothing located on it, must leave the user's view alone
 * rather than throwing them back out to the world.
 */
function FitRoute({ points, fitKey, ready }: FitPinsProps) {
  const map = useMap();
  const fittedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!ready || points.length === 0 || fittedRef.current === fitKey) return;
    fittedRef.current = fitKey;
    const bounds = latLngBounds(points.map((point) => [point.lat, point.lng]));
    map.fitBounds(bounds.pad(FIT_PAD), { animate: false, maxZoom: FIT_MAX_ZOOM });
  }, [map, points, fitKey, ready]);

  return null;
}

/**
 * `navigator.onLine`, kept live.
 *
 * Tiles come from openstreetmap.org and nothing else on this screen does, so
 * offline means "the map will be blank squares" — worth one line of Korean
 * rather than letting the user wonder what broke. The service worker still
 * serves whatever tiles it cached, which is why this is a hint and not an
 * error state that hides the map.
 */
function useOnline(): boolean {
  const [online, setOnline] = useState(
    () => typeof navigator === 'undefined' || navigator.onLine !== false,
  );

  useEffect(() => {
    const update = () => setOnline(navigator.onLine !== false);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    update();
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  return online;
}

/** Which day(s) the route control is drawing: nothing, one day, or all. */
type RouteSelection = { kind: 'off' } | { kind: 'day'; dayId: Id } | { kind: 'all' };

/** Line color of a single-day route — neutral, so the pins keep the palette. */
const SINGLE_ROUTE_HEX = '#334155';

/**
 * The 지도 tab: every located card of the active trip as a colored pin.
 *
 * Locations are *written* from the board (검색 / 지도에서 선택 inside the card
 * sheet); this view reads them, and the only edit it offers is taking a card
 * back off the map.
 */
export default function MapView() {
  const workspace = useWorkspaceStore((s) => s.workspace);
  const updateCard = useWorkspaceStore((s) => s.updateCard);
  const activeTripId = useUiStore((s) => s.activeTripId);
  const activeSheetId = useUiStore((s) => s.activeSheetId);
  const setTab = useUiStore((s) => s.setTab);
  const focusCard = useUiStore((s) => s.focusCard);
  const isDesktop = useIsDesktop();
  const online = useOnline();

  /** Leaflet's measured viewport; `0 × 0` until the container is laid out. */
  const [size, setSize] = useState({ x: 0, y: 0 });
  /** Column ids toggled off in the legend. */
  const [mutedColumns, setMutedColumns] = useState<readonly Id[]>([]);
  /** 경로 controls: which sheet is being read, and what is drawn from it. */
  const [routeSheetId, setRouteSheetId] = useState<Id | undefined>(undefined);
  const [selection, setSelection] = useState<RouteSelection>({ kind: 'off' });

  const onSize = useCallback((next: { x: number; y: number }) => {
    setSize((current) => (current.x === next.x && current.y === next.y ? current : next));
  }, []);

  const trip = activeTripId ? workspace.trips[activeTripId] : undefined;

  const pins = useMemo<Pin[]>(() => {
    if (!trip) return [];
    const list: Pin[] = [];
    for (const columnId of trip.columnOrder) {
      const column = workspace.columns[columnId];
      if (!column) continue;
      for (const cardId of column.cardOrder) {
        const card = workspace.cards[cardId];
        if (!card?.location) continue;
        if (!Number.isFinite(card.location.lat) || !Number.isFinite(card.location.lng)) continue;
        list.push({ card, column });
      }
    }
    return list;
  }, [trip, workspace.columns, workspace.cards]);

  /** Only categories that actually put something on the map get a chip. */
  const legendColumns = useMemo<BoardColumn[]>(() => {
    const seen = new Set<Id>();
    const columns: BoardColumn[] = [];
    for (const pin of pins) {
      if (seen.has(pin.column.id)) continue;
      seen.add(pin.column.id);
      columns.push(pin.column);
    }
    return columns;
  }, [pins]);

  const visiblePins = useMemo(
    () => pins.filter((pin) => !mutedColumns.includes(pin.column.id)),
    [pins, mutedColumns],
  );

  const fitPoints = useMemo(() => pins.map((pin) => pin.card.location!), [pins]);

  /* --- 경로 (M6) ---------------------------------------------------- */

  const sheets = useMemo<SheetModel[]>(
    () =>
      (trip?.sheetOrder ?? [])
        .map((sheetId) => workspace.sheets[sheetId])
        .filter((sheet): sheet is SheetModel => Boolean(sheet)),
    [trip?.sheetOrder, workspace.sheets],
  );

  /** The 경로 sheet: the user's pick, else whatever the 일정 tab is showing. */
  const routeSheet =
    sheets.find((sheet) => sheet.id === routeSheetId) ??
    sheets.find((sheet) => sheet.id === activeSheetId) ??
    sheets[0];

  const routeDays = useMemo<Day[]>(
    () =>
      (routeSheet?.dayOrder ?? [])
        .map((dayId) => workspace.days[dayId])
        .filter((day): day is Day => Boolean(day)),
    [routeSheet?.dayOrder, workspace.days],
  );

  const drawings = useMemo<RouteDrawing[]>(() => {
    if (selection.kind === 'off') return [];
    const wanted =
      selection.kind === 'all'
        ? routeDays
        : routeDays.filter((day) => day.id === selection.dayId);

    return wanted
      .map<RouteDrawing>((day) => ({
        dayId: day.id,
        dayTitle: dayTitle(day, routeDays.indexOf(day)),
        // One neutral line for a single day; the palette cycles for 전체 so
        // two days crossing the same street stay tellable apart.
        color:
          selection.kind === 'all'
            ? COLOR_HEX[COLOR_TOKENS[routeDays.indexOf(day) % COLOR_TOKENS.length]]
            : SINGLE_ROUTE_HEX,
        route: dayRoute(workspace, day.id),
      }))
      .filter((drawing) => drawing.route.stops.length > 0);
  }, [selection, routeDays, workspace]);

  const routePoints = useMemo(
    () => drawings.flatMap((drawing) => drawing.route.stops),
    [drawings],
  );

  const routeKey =
    selection.kind === 'off'
      ? 'off'
      : `${routeSheet?.id ?? ''}:${selection.kind === 'all' ? 'all' : selection.dayId}`;

  // A day (or a whole sheet) that disappears must not leave a dangling route.
  useEffect(() => {
    if (selection.kind !== 'day') return;
    if (!routeDays.some((day) => day.id === selection.dayId)) setSelection({ kind: 'off' });
  }, [selection, routeDays]);

  // Switching trips resets the control rather than pointing it at a stale sheet.
  useEffect(() => {
    setSelection({ kind: 'off' });
    setRouteSheetId(undefined);
  }, [trip?.id]);

  // A legend chip for a category that no longer has pins would be unreachable.
  useEffect(() => {
    setMutedColumns((current) => {
      const next = current.filter((id) => legendColumns.some((column) => column.id === id));
      return next.length === current.length ? current : next;
    });
  }, [legendColumns]);

  if (!trip) return <TripPrompt />;

  const ready = size.x > 0 && size.y > 0;
  const height = isDesktop ? 'calc(100dvh - 12rem)' : 'calc(100dvh - 15rem)';

  const toggleColumn = (columnId: Id) =>
    setMutedColumns((current) =>
      current.includes(columnId)
        ? current.filter((id) => id !== columnId)
        : [...current, columnId],
    );

  /** Hands the card over to the 보드 tab, which opens its edit sheet. */
  const editOnBoard = (card: Card) => {
    focusCard(card.id);
    setTab('board');
  };

  return (
    <section data-testid="view-map" aria-labelledby="view-map-title" className="pb-2">
      <header className="flex items-baseline gap-2 px-4 pb-2 pt-5">
        <h1 id="view-map-title" className="text-2xl font-bold tracking-tight text-stone-800">
          지도
        </h1>
        <p data-testid="map-trip-title" className="min-w-0 truncate text-sm text-stone-400">
          {trip.title}
        </p>
        <span
          data-testid="map-pin-count"
          data-count={visiblePins.length}
          className="ml-auto shrink-0 text-xs tabular-nums text-stone-400"
        >
          📍 {visiblePins.length}
        </span>
      </header>

      {legendColumns.length > 0 ? (
        <div
          data-testid="map-legend"
          className="flex flex-wrap items-center gap-1.5 px-4 pb-2"
          role="group"
          aria-label="카테고리 필터"
        >
          {legendColumns.map((column) => {
            const active = !mutedColumns.includes(column.id);
            const colors = colorClasses(column.color);
            return (
              <button
                key={column.id}
                type="button"
                data-testid="map-legend-chip"
                data-column-id={column.id}
                data-active={active}
                aria-pressed={active}
                onClick={() => toggleColumn(column.id)}
                className={[
                  'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors',
                  active ? colors.chip : 'bg-stone-100 text-stone-400 line-through',
                ].join(' ')}
              >
                <span aria-hidden="true">{column.icon}</span>
                <span className="max-w-24 truncate">{column.name}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      {routeDays.length > 0 ? (
        <div
          data-testid="map-route-controls"
          className="flex flex-wrap items-center gap-1.5 px-4 pb-2"
          role="group"
          aria-label="일자별 경로"
        >
          <span className="text-[11px] font-medium text-stone-400">경로</span>

          {sheets.length > 0 ? (
            <select
              data-testid="map-route-sheet-select"
              aria-label="일정표 선택"
              value={routeSheet?.id ?? ''}
              onChange={(event) => {
                setRouteSheetId(event.target.value);
                setSelection({ kind: 'off' });
              }}
              className="max-w-32 rounded-full border border-stone-200 bg-white px-2 py-1 text-[11px] font-medium text-stone-600"
            >
              {sheets.map((sheet) => (
                <option key={sheet.id} value={sheet.id}>
                  {sheet.name}
                </option>
              ))}
            </select>
          ) : null}

          <button
            type="button"
            data-testid="map-route-all"
            data-active={selection.kind === 'all'}
            aria-pressed={selection.kind === 'all'}
            onClick={() =>
              setSelection((current) =>
                current.kind === 'all' ? { kind: 'off' } : { kind: 'all' },
              )
            }
            className={[
              'rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors',
              selection.kind === 'all'
                ? 'bg-stone-800 text-white'
                : 'bg-stone-100 text-stone-500 hover:bg-stone-200',
            ].join(' ')}
          >
            전체
          </button>

          {routeDays.map((day, index) => {
            const active = selection.kind === 'day' && selection.dayId === day.id;
            return (
              <button
                key={day.id}
                type="button"
                data-testid="map-route-day"
                data-day-id={day.id}
                data-active={active}
                aria-pressed={active}
                onClick={() =>
                  setSelection((current) =>
                    current.kind === 'day' && current.dayId === day.id
                      ? { kind: 'off' }
                      : { kind: 'day', dayId: day.id },
                  )
                }
                className={[
                  'rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors',
                  active
                    ? 'bg-stone-800 text-white'
                    : 'bg-stone-100 text-stone-500 hover:bg-stone-200',
                ].join(' ')}
              >
                {dayTitle(day, index)}
              </button>
            );
          })}

          {selection.kind !== 'off' && routePoints.length === 0 ? (
            <span data-testid="map-route-empty" className="text-[11px] text-stone-400">
              위치가 있는 일정이 없어요
            </span>
          ) : null}
        </div>
      ) : null}

      {!online ? (
        <p data-testid="map-offline-hint" className="px-4 pb-2 text-xs text-stone-400">
          오프라인이라 지도를 불러올 수 없어요
        </p>
      ) : null}

      {/* `isolate` traps Leaflet's internal z-indexes (panes go up to 700) so
          they cannot paint over the bottom sheets and the tab bar. */}
      <div
        data-testid="map-root"
        data-ready={ready}
        data-map-width={size.x}
        data-map-height={size.y}
        className="relative isolate mx-4 overflow-hidden rounded-2xl border border-stone-200 bg-stone-100"
        style={{ height }}
      >
        <MapContainer
          center={WORLD_CENTER}
          zoom={WORLD_ZOOM}
          scrollWheelZoom
          className="h-full w-full"
        >
          <OsmTiles />
          <MapReady onSize={onSize} />
          <FitPins points={fitPoints} fitKey={trip.id} ready={ready} />
          <FitRoute points={routePoints} fitKey={routeKey} ready={ready} />

          {visiblePins.map(({ card, column }) => (
            <Marker
              key={card.id}
              position={[card.location!.lat, card.location!.lng]}
              icon={cardPinIcon(column.color, column.icon, card.id, column.id)}
            >
              <Popup>
                <div data-testid="map-popup" data-card-id={card.id} className="min-w-44">
                  <p className="text-sm font-semibold text-stone-800">{card.title}</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-stone-500">
                    {card.location?.address ?? ''}
                  </p>

                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {typeof card.defaultDurationMin === 'number' &&
                    card.defaultDurationMin > 0 ? (
                      <span
                        data-testid="map-popup-chip-duration"
                        className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${colorClasses(column.color).chip}`}
                      >
                        ⏱ {formatDuration(card.defaultDurationMin)}
                      </span>
                    ) : null}
                    {typeof card.budget === 'number' && Number.isFinite(card.budget) ? (
                      <span
                        data-testid="map-popup-chip-budget"
                        className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${colorClasses(column.color).chip}`}
                      >
                        💰 {formatBudget(card.budget, trip.currency)}
                      </span>
                    ) : null}
                    {cardSpent(card) > 0 ? (
                      <span
                        data-testid="map-popup-chip-spent"
                        data-spent={cardSpent(card)}
                        className="rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-medium text-stone-600"
                      >
                        💸 {formatBudget(cardSpent(card), trip.currency)}
                      </span>
                    ) : null}
                    {cardCommentCount(card) > 0 ? (
                      <span
                        data-testid="map-popup-chip-comments"
                        data-count={cardCommentCount(card)}
                        className="rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-medium text-stone-600"
                      >
                        💬 {cardCommentCount(card)}
                      </span>
                    ) : null}
                  </div>

                  <div className="mt-2 flex flex-col gap-1">
                    <button
                      type="button"
                      data-testid="map-popup-edit"
                      onClick={() => editOnBoard(card)}
                      className="rounded-lg bg-stone-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-stone-900"
                    >
                      보드에서 편집
                    </button>
                    <button
                      type="button"
                      data-testid="map-popup-remove"
                      onClick={() => updateCard(card.id, { location: undefined })}
                      className="rounded-lg px-3 py-1.5 text-xs font-medium text-rose-500 hover:bg-rose-50"
                    >
                      지도에서 제거
                    </button>
                  </div>
                </div>
              </Popup>
            </Marker>
          ))}

          {/* Drawn on top of the pins, and deliberately not filtered by the
              legend — see RouteLayer's doc comment. */}
          <RouteLayer
            drawings={drawings}
            cards={workspace.cards}
            columns={workspace.columns}
          />
        </MapContainer>

        {pins.length === 0 ? (
          <div className="pointer-events-none absolute inset-0 z-[500] flex items-center justify-center p-6">
            <div
              data-testid="map-empty"
              className="max-w-xs rounded-2xl border border-stone-200 bg-white/95 px-5 py-4 text-center shadow-lg"
            >
              <span aria-hidden="true" className="text-3xl">
                📍
              </span>
              <p className="mt-2 text-sm font-semibold text-stone-700">
                카드에 위치를 추가하면 여기에 표시돼요
              </p>
              <p className="mt-1 text-xs leading-relaxed text-stone-400">
                보드에서 카드를 열고 「🔍 검색」이나 「📍 지도에서 선택」을 눌러보세요.
              </p>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
