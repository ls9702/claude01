import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { latLngBounds } from 'leaflet';
import { MapContainer, Marker, Popup, ZoomControl, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { useIsDesktop } from '../../hooks/useMediaQuery';
import { useUiStore } from '../../stores/uiStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import type { BoardColumn, Card, Day, Id, Sheet as SheetModel } from '../../types/models';
import { dayRoute } from '../../timeline/route';
import { colorClasses } from '../../utils/colors';
import { formatBudget } from '../../utils/money';
import { cardCommentCount, cardSpent } from '../../utils/spend';
import { formatDuration } from '../../utils/time';
import { dayTitle } from '../../timeline/dayLabel';
import Icon, { EmojiIcon } from '../common/Icon';
import BackupNudge from '../common/BackupNudge';
import SyncStatusChip from '../common/SyncStatusChip';
import {
  CHIP_BUTTON,
  CHIP_MONEY,
  CHIP_NEUTRAL,
  CHIP_SELECTED,
  DANGER_TEXT_BUTTON_CLASS,
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
} from '../common/formStyles';
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
      className="mx-auto flex w-full max-w-md shrink-0 flex-col items-center gap-4 px-6 pb-16 pt-12 text-center"
    >
      <Icon name="map" size={24} className="text-ink-faint" />
      <h1 className="text-title text-ink">지도</h1>
      <p className="text-label font-normal text-ink-muted">
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
                className={`${SECONDARY_BUTTON_CLASS} w-full justify-start`}
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
          className={PRIMARY_BUTTON_CLASS}
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

/**
 * The route's only colour.
 *
 * Ink, for one day and for 전체 alike (M9 §4.7-6): a route answers "in what
 * order", not "of what kind", and borrowing the category palette for it meant
 * the 할일 purple and the day-2 purple were the same purple. Days are told
 * apart by the numbered stop badges instead.
 */
const ROUTE_HEX = '#453f3a';

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

  /** The day-chip strip only wears its right-hand fade while it has more. */
  const routeStripRef = useRef<HTMLDivElement | null>(null);
  const [routeOverflow, setRouteOverflow] = useState(false);
  const measureRouteStrip = () => {
    const node = routeStripRef.current;
    if (!node) return;
    const more = node.scrollWidth - node.clientWidth - node.scrollLeft > 4;
    setRouteOverflow((current) => (current === more ? current : more));
  };
  useEffect(measureRouteStrip);

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
        // Only 전체 needs the 일자-순번 badge: on a single day the stop
        // numbers already run 1, 2, 3 with nothing to confuse them with.
        ...(selection.kind === 'all' ? { dayIndex: routeDays.indexOf(day) + 1 } : {}),
        // One ink line whatever is drawn — days are told apart by the badges.
        color: ROUTE_HEX,
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
    <section
      data-testid="view-map"
      aria-labelledby="view-map-title"
      // One flex column: the map takes the height the rows above it leave over
      // rather than a `calc(100dvh - 15rem)` guess (M9 §S6).
      className="flex min-h-0 flex-1 flex-col"
    >
      <header className="flex shrink-0 items-center gap-3 px-4 pb-4 pt-6">
        <div className="min-w-0">
          <h1 id="view-map-title" className="text-display text-ink">
            지도
          </h1>
          <p data-testid="map-trip-title" className="mt-1 min-w-0 truncate text-label text-ink-muted">
            {trip.title}
          </p>
        </div>
        {isDesktop ? null : (
          <span className="ml-auto">
            <SyncStatusChip variant="dot" />
          </span>
        )}
      </header>

      {/* Under the h1, never over it (M9 §3.5). Desktop wears the chip in the
          top bar instead, so only one of the two ever mounts. */}
      {isDesktop ? null : <BackupNudge variant="banner" className="mx-4 mb-4" />}

      {legendColumns.length > 0 ? (
        <div
          data-testid="map-legend"
          className="flex shrink-0 flex-wrap items-center gap-2 px-4 pb-2"
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
                // The legend is the one place the category palette survives on
                // this screen — it is a colour key, so it has to be coloured.
                className={[
                  'inline-flex h-9 shrink-0 items-center gap-1 rounded-full px-3 text-micro',
                  'transition-colors duration-[140ms] ease-quick lg:h-8',
                  active ? colors.chip : 'bg-sunken text-ink-faint line-through',
                ].join(' ')}
              >
                <EmojiIcon emoji={column.icon} className="bg-surface/60" />
                <span className="max-w-24 truncate">{column.name}</span>
              </button>
            );
          })}
          {/* Third-rank fact, so it sits at the end of the key rather than
              beside the h1 (M9 §4.7-7). */}
          <span
            data-testid="map-pin-count"
            data-count={visiblePins.length}
            className="ml-auto inline-flex shrink-0 items-center gap-1 text-micro font-normal tabular-nums text-ink-muted"
          >
            <Icon name="pin" size={16} />
            {visiblePins.length}
          </span>
        </div>
      ) : (
        <div className="flex shrink-0 items-center px-4 pb-2">
          <span
            data-testid="map-pin-count"
            data-count={visiblePins.length}
            className="ml-auto inline-flex shrink-0 items-center gap-1 text-micro font-normal tabular-nums text-ink-muted"
          >
            <Icon name="pin" size={16} />
            {visiblePins.length}
          </span>
        </div>
      )}

      {routeDays.length > 0 ? (
        <div
          // The fade belongs to a *wrapper*, not to the scroller: an `::after`
          // pinned to the right inside an `overflow-x-auto` box is positioned
          // against the scrolled content, so it slides away with the chips
          // instead of standing at the viewport's edge (§4.7-2).
          className={[
            'relative shrink-0',
            routeOverflow ? 'tb-strip-fade' : '',
          ].join(' ')}
        >
          <div
            ref={routeStripRef}
            onScroll={measureRouteStrip}
            data-testid="map-route-controls"
            // One line that scrolls, not two lines that push the map down.
            className="flex items-center gap-2 overflow-x-auto px-4 pb-2"
            role="group"
            aria-label="일자별 경로"
          >
            <span className="shrink-0 text-micro font-normal text-ink-muted">경로</span>

            {sheets.length > 0 ? (
              <div className="relative shrink-0">
                <select
                  data-testid="map-route-sheet-select"
                  aria-label="일정표 선택"
                  value={routeSheet?.id ?? ''}
                  onChange={(event) => {
                    setRouteSheetId(event.target.value);
                    setSelection({ kind: 'off' });
                  }}
                  className="h-9 max-w-32 appearance-none rounded-md border border-line bg-surface pl-3 pr-8 text-label text-ink outline-none transition-colors duration-[140ms] ease-quick hover:border-line-strong focus:border-ink lg:h-8"
                >
                  {sheets.map((sheet) => (
                    <option key={sheet.id} value={sheet.id}>
                      {sheet.name}
                    </option>
                  ))}
                </select>
                <Icon
                  name="chevron-down"
                  size={16}
                  className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-ink-faint"
                />
              </div>
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
              className={selection.kind === 'all' ? CHIP_SELECTED : CHIP_BUTTON}
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
                  className={active ? CHIP_SELECTED : CHIP_BUTTON}
                >
                  {dayTitle(day, index)}
                </button>
              );
            })}

            {selection.kind !== 'off' && routePoints.length === 0 ? (
              <span
                data-testid="map-route-empty"
                className="shrink-0 text-micro font-normal text-ink-faint"
              >
                위치가 있는 일정이 없어요
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      {!online ? (
        <p
          data-testid="map-offline-hint"
          className="shrink-0 px-4 pb-2 text-label font-normal text-ink-muted"
        >
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
        className="relative isolate mx-4 mb-4 min-h-0 flex-1 overflow-hidden rounded-lg border border-line bg-sunken"
      >
        <MapContainer
          center={WORLD_CENTER}
          zoom={WORLD_ZOOM}
          scrollWheelZoom
          // Zoom lives top-right so a popup opening above a pin never has to
          // share the top-left corner with it (M9 §4.7-1).
          zoomControl={false}
          className="h-full w-full"
        >
          <ZoomControl position="topright" />
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
                <div
                  data-testid="map-popup"
                  data-card-id={card.id}
                  className="min-w-52 max-w-[17rem] space-y-3"
                >
                  <div>
                    <p className="text-title text-ink">{card.title}</p>
                    {/* Full address in the tooltip, two lines on screen. */}
                    <p
                      title={card.location?.address ?? ''}
                      className="mt-1 line-clamp-2 text-label font-normal text-ink-muted"
                    >
                      {card.location?.address ?? ''}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-1">
                    {typeof card.defaultDurationMin === 'number' &&
                    card.defaultDurationMin > 0 ? (
                      <span data-testid="map-popup-chip-duration" className={CHIP_NEUTRAL}>
                        <Icon name="clock" size={16} />
                        {formatDuration(card.defaultDurationMin)}
                      </span>
                    ) : null}
                    {typeof card.budget === 'number' && Number.isFinite(card.budget) ? (
                      <span data-testid="map-popup-chip-budget" className={CHIP_NEUTRAL}>
                        <Icon name="wallet" size={16} />
                        {formatBudget(card.budget, trip.currency)}
                      </span>
                    ) : null}
                    {cardSpent(card) > 0 ? (
                      <span
                        data-testid="map-popup-chip-spent"
                        data-spent={cardSpent(card)}
                        className={CHIP_MONEY}
                      >
                        <Icon name="receipt" size={16} />
                        {formatBudget(cardSpent(card), trip.currency)}
                      </span>
                    ) : null}
                    {cardCommentCount(card) > 0 ? (
                      <span
                        data-testid="map-popup-chip-comments"
                        data-count={cardCommentCount(card)}
                        className={CHIP_NEUTRAL}
                      >
                        <Icon name="comment" size={16} />
                        {cardCommentCount(card)}
                      </span>
                    ) : null}
                  </div>

                  <div className="flex flex-col gap-1">
                    <button
                      type="button"
                      data-testid="map-popup-edit"
                      onClick={() => editOnBoard(card)}
                      className={`${PRIMARY_BUTTON_CLASS} w-full`}
                    >
                      보드에서 편집
                    </button>
                    {/* The same destructive action wears the same clothes here
                        as in every sheet footer (M9 §4.7-4). */}
                    <button
                      type="button"
                      data-testid="map-popup-remove"
                      onClick={() => updateCard(card.id, { location: undefined })}
                      className={`${DANGER_TEXT_BUTTON_CLASS} w-full`}
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
              className="max-w-[22rem] rounded-lg bg-surface/95 px-5 py-4 text-center shadow-float"
            >
              <Icon name="pin" size={24} className="mx-auto text-ink-faint" />
              <p className="mt-2 text-title text-ink">카드에 위치를 추가하면 여기에 표시돼요</p>
              <p className="mt-1 text-label font-normal text-ink-muted">
                보드에서 카드를 열고 「검색」이나 「지도에서 선택」을 눌러보세요.
              </p>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
