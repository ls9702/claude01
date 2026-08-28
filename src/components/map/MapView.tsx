import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { latLngBounds } from 'leaflet';
import { Circle, MapContainer, Marker, Popup, ZoomControl, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { useIsDesktop } from '../../hooks/useMediaQuery';
import { DIRECTIONS_LABEL, directionsUrl, previousStopMap } from '../../map/directions';
import {
  emptyFilterHint,
  scopeCards,
  type MapFilter,
  type MapScopeKind,
} from '../../map/filter';
import { MY_LOCATION_HEX, geoOn, useMyLocation, type GeoFix } from '../../map/geolocate';
import { useGoogleMapsKey } from '../../map/gmapsKey';
import { loadMapFilter, saveMapFilter } from '../../stores/mapFilterPref';
import { loadRouteChoice, saveRouteChoice, storedDayId } from '../../stores/mapRoutePref';
import { useUiStore } from '../../stores/uiStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import type { BoardColumn, Card, Day, Id, Sheet as SheetModel } from '../../types/models';
import { dayRouteWindowed } from '../../timeline/route';
import { colorClasses } from '../../utils/colors';
import { formatBudget } from '../../utils/money';
import { cardCommentCount, cardSpent } from '../../utils/spend';
import { formatDuration } from '../../utils/time';
import { dayTitle, daySubtitle } from '../../timeline/dayLabel';
import Icon, { EmojiIcon } from '../common/Icon';
import PatchNotesButton from '../common/PatchNotesButton';
import SyncStatusChip from '../common/SyncStatusChip';
import {
  BTN_SIZE_SM,
  CHIP_BUTTON,
  CHIP_MONEY,
  CHIP_NEUTRAL,
  DANGER_TEXT_BUTTON_CLASS,
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
  withBtnSize,
} from '../common/formStyles';
import GoogleMapView from './GoogleMapView';
import MapReady from './MapReady';
import RouteLayer, { type RouteDrawing } from './RouteLayer';
import {
  DESTINATION_ZOOM,
  FIT_MAX_ZOOM,
  FIT_PAD,
  MY_LOCATION_ZOOM,
  OsmTiles,
  WORLD_CENTER,
  WORLD_ZOOM,
  cardPinIcon,
  myLocationIcon,
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
      <h1 className="shrink-0 whitespace-nowrap text-title text-ink">지도</h1>
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

interface FitViewProps extends FitPinsProps {
  /**
   * Where to sit when there is nothing to fit — the trip's 목적지 (M12).
   *
   * Pins always win: once a card is on the map the user is looking at their own
   * plan, and a destination that framed it out would be a step backwards.
   */
  fallback?: { lat: number; lng: number };
}

/** Frames every marker once per trip; falls back to 목적지, then to the world. */
function FitPins({ points, fallback, fitKey, ready }: FitViewProps) {
  const map = useMap();
  const fittedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!ready || fittedRef.current === fitKey) return;
    fittedRef.current = fitKey;

    if (points.length === 0) {
      if (fallback) map.setView([fallback.lat, fallback.lng], DESTINATION_ZOOM, { animate: false });
      else map.setView(WORLD_CENTER, WORLD_ZOOM, { animate: false });
      return;
    }
    const bounds = latLngBounds(points.map((point) => [point.lat, point.lng]));
    map.fitBounds(bounds.pad(FIT_PAD), { animate: false, maxZoom: FIT_MAX_ZOOM });
  }, [map, points, fallback, fitKey, ready]);

  return null;
}

interface CenterReportProps {
  onCenter: (lat: number, lng: number) => void;
}

/**
 * Publishes the map's settled center so the panel can wear it as data attrs.
 *
 * `moveend`, not `move`: this feeds a React state update, and re-rendering
 * every pin on every frame of a pan is a cost the screen would show. Every
 * automatic re-frame in this file is `animate: false`, which still ends in one
 * `moveend` — so the attributes are exact for the case that matters.
 */
function CenterReport({ onCenter }: CenterReportProps) {
  const map = useMap();

  useEffect(() => {
    const emit = () => {
      const center = map.getCenter();
      onCenter(center.lat, center.lng);
    };
    emit();
    map.on('moveend', emit);
    map.on('zoomend', emit);
    return () => {
      map.off('moveend', emit);
      map.off('zoomend', emit);
    };
  }, [map, onCenter]);

  return null;
}

/**
 * Frames a chosen subset once per choice — the day's route, and the filter's
 * pins (M27).
 *
 * Unlike {@link FitPins} an empty input is a no-op: turning the route off,
 * picking a day with nothing located on it, or filtering down to nothing must
 * leave the user's view alone rather than throwing them back out to the world.
 * `fitKey` is the *choice*, not the content, so panning around inside one
 * selection is never undone.
 */
function FitOnce({ points, fitKey, ready }: FitPinsProps) {
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
 * 「내 위치」 — 파란 점, 정확도 원, 그리고 켤 때 한 번의 이동 (M42).
 *
 * 갱신마다 화면을 따라 움직이지 않는 이유는 {@link FitOnce}가 필터마다 다시
 * 맞추지 **않는** 이유와 같다: 지도를 손으로 옮겨 다른 동네를 보고 있는 사람을
 * 앱이 계속 끌고 오면, 그건 도움이 아니라 힘겨루기다. 그래서 「이번에 켠 뒤 처음
 * 온 좌표」에서만 움직이고(`session`), 그 뒤에는 점만 따라간다.
 *
 * 배율은 **낮추지 않는다** — 이미 골목까지 확대해 둔 사용자를 동네 배율로
 * 되돌리면 그것도 같은 힘겨루기다.
 */
function MyLocationLayer({ fix, session }: { fix: GeoFix | null; session: number }) {
  const map = useMap();
  const pannedRef = useRef<number | null>(null);

  useEffect(() => {
    if (!fix || pannedRef.current === session) return;
    pannedRef.current = session;
    map.setView([fix.lat, fix.lng], Math.max(map.getZoom(), MY_LOCATION_ZOOM), { animate: false });
  }, [map, fix, session]);

  if (!fix) return null;

  return (
    <>
      {fix.accuracyM > 0 ? (
        <Circle
          center={[fix.lat, fix.lng]}
          radius={fix.accuracyM}
          // 정확도 원은 「이 안 어딘가」라는 사실이지 누를 것이 아니다.
          interactive={false}
          pathOptions={{
            color: MY_LOCATION_HEX,
            weight: 1,
            opacity: 0.35,
            fillColor: MY_LOCATION_HEX,
            fillOpacity: 0.12,
            className: 'tb-my-accuracy',
          }}
        />
      ) : null}
      <Marker
        position={[fix.lat, fix.lng]}
        icon={myLocationIcon()}
        interactive={false}
        keyboard={false}
        zIndexOffset={900}
      />
    </>
  );
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

/**
 * A one-line chip strip that wears its right-hand fade only while it has more.
 *
 * Two rows need this now — 표시 and 경로 (M27) — and a second copy of the
 * measurement is a second place for the fade to go stale. The measure runs
 * after *every* render on purpose: chips appear and disappear with the trip's
 * days and sheets, and none of that goes through a scroll event.
 */
function useStripFade() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [overflow, setOverflow] = useState(false);

  const measure = () => {
    const node = ref.current;
    if (!node) return;
    const more = node.scrollWidth - node.clientWidth - node.scrollLeft > 4;
    setOverflow((current) => (current === more ? current : more));
  };
  useEffect(measure);

  return { ref, overflow, measure };
}

/** Which day(s) the route control is drawing: nothing, one day, or all. */
type RouteSelection = { kind: 'off' } | { kind: 'day'; dayId: Id } | { kind: 'all' };

/**
 * The colour of *one* day's route.
 *
 * Ink (M9 §4.7-6): a single day's route answers "in what order", not "of what
 * kind", and borrowing the category palette for it meant the 할일 purple and
 * the day-2 purple were the same purple.
 */
const ROUTE_HEX = '#453f3a';

/**
 * 전체 mode's per-day inks (M15 §3).
 *
 * With every day drawn at once one colour is not enough — 「일차별 지도 분리 및
 * 전체 일정 표시」 asks for a whole-trip view where the days are still tellable
 * apart. These are deliberately *not* the category palette (that is what M9
 * ruled out): six deep, saturated line colours whose only job on this screen is
 * to say "different day", cycled for trips longer than six days. The 일자-순번
 * badges stay, so the reading never depends on colour alone.
 */
const ROUTE_DAY_HEX: readonly string[] = [
  '#1d4ed8',
  '#b91c1c',
  '#047857',
  '#a16207',
  '#7c3aed',
  '#0e7490',
];

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
  /**
   * 「내 위치」 (M42) — 두 지도가 나눠 쓰는 하나의 상태.
   *
   * 훅이 여기 사는 이유는 버튼이 여기 있기 때문이다: 지도 컨테이너 **바깥**의
   * 오버레이라 엔진이 갈려도 자리가 같고, 그래서 Leaflet이든 구글이든 「내
   * 위치」는 같은 버튼, 같은 파란 점, 같은 안내 한 줄이다.
   */
  const myLocation = useMyLocation();
  /** 이 기기가 구글 지도를 쓸 수 있는가 (M41) — 없으면 지금까지 그대로 OSM. */
  const googleKey = useGoogleMapsKey();
  /**
   * 구글 스크립트를 못 불러왔다 (잘못된 키·차단·오프라인).
   *
   * 한 번 실패하면 이 여행을 보는 동안은 OSM으로 그린다 — 실패한 로더를 매
   * 렌더마다 다시 부르면 화면이 깜빡이기만 한다. 키가 바뀌면(부트스트랩이 새
   * 키를 물어 왔다) 다시 시도한다.
   */
  const [googleFailed, setGoogleFailed] = useState(false);
  useEffect(() => setGoogleFailed(false), [googleKey]);

  /** Leaflet's measured viewport; `0 × 0` until the container is laid out. */
  const [size, setSize] = useState({ x: 0, y: 0 });
  /** The map's settled center, mirrored onto `map-root` for tests (M12). */
  const [center, setCenter] = useState<{ lat: number; lng: number } | null>(null);
  /**
   * 카테고리 필터 — 꺼 둔 칼럼들 (M3의 범례 칩, M27에서 기억까지 한다).
   *
   * 이 화면의 카테고리 컨트롤은 범례 칩 **하나뿐**이다. 「맛집만 보기」를 위한
   * 두 번째 줄을 따로 만들면 같은 일을 하는 버튼이 두 벌이 되고, 어느 쪽이
   * 이기는지를 사용자가 외워야 한다.
   */
  const [mutedColumns, setMutedColumns] = useState<readonly Id[]>([]);
  /** 일정 범위 필터 (M27) — 무엇을 지도에 올릴 것인가. */
  const [scope, setScope] = useState<MapScopeKind>('all');
  /** 「일자별」이 보고 있는 일자. 일자 칩 줄이 곧 이 선택의 피커다. */
  const [scopeDayId, setScopeDayId] = useState<Id | undefined>(undefined);
  /** 경로 controls: which sheet is being read, and what is drawn from it. */
  const [routeSheetId, setRouteSheetId] = useState<Id | undefined>(undefined);
  const [selection, setSelection] = useState<RouteSelection>({ kind: 'off' });

  const scopeStrip = useStripFade();
  const routeStrip = useStripFade();

  const onSize = useCallback((next: { x: number; y: number }) => {
    setSize((current) => (current.x === next.x && current.y === next.y ? current : next));
  }, []);

  const onCenter = useCallback((lat: number, lng: number) => {
    setCenter((current) =>
      current && current.lat === lat && current.lng === lng ? current : { lat, lng },
    );
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

  /** Every located pin of the trip — what {@link FitPins} frames (M12). */
  const fitPoints = useMemo(() => pins.map((pin) => pin.card.location!), [pins]);

  /**
   * The trip's 목적지, when it is a usable point (M12).
   *
   * Only consulted while the trip has no located card — see {@link FitPins}.
   */
  const destination = useMemo(() => {
    const point = trip?.destination;
    if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return undefined;
    return { lat: point.lat, lng: point.lng };
  }, [trip?.destination]);

  /**
   * Re-frame on a new trip *and* on a newly-picked 목적지: the second is the
   * whole point of setting one, and the trip id alone would never change.
   */
  const fitKey = `${trip?.id ?? ''}:${destination ? `${destination.lat},${destination.lng}` : ''}`;

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

  /** The window mapping's axis — which day comes before which (M16-B). */
  const routeDayOrder = useMemo<Id[]>(() => routeSheet?.dayOrder ?? [], [routeSheet?.dayOrder]);

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
        // One strong ink line for one day; a colour per day for 전체.
        color:
          selection.kind === 'all'
            ? ROUTE_DAY_HEX[routeDays.indexOf(day) % ROUTE_DAY_HEX.length]
            : ROUTE_HEX,
        // 지도 1일차 == 일정표 1일차: the same 05시 window decides membership,
        // so a 새벽 이동 closes the previous night's chain of arrows (M16-B).
        route: dayRouteWindowed(workspace, day.id, routeDayOrder),
      }))
      .filter((drawing) => drawing.route.stops.length > 0);
  }, [selection, routeDays, routeDayOrder, workspace]);

  /**
   * Does this trip have anything to draw at all?
   *
   * The 전체 default only makes sense once at least one located card has been
   * scheduled; before that the control would open on a mode with nothing in it.
   */
  const hasRoutableDay = useMemo(
    () => routeDays.some((day) => dayRouteWindowed(workspace, day.id, routeDayOrder).stops.length > 0),
    [routeDays, routeDayOrder, workspace],
  );

  /** The cards the *selected day* passes through — everything else dims. */
  const routeCardIds = useMemo(
    () => new Set(drawings.flatMap((drawing) => drawing.route.stops.map((stop) => stop.cardId))),
    [drawings],
  );

  const routePoints = useMemo(
    () => drawings.flatMap((drawing) => drawing.route.stops),
    [drawings],
  );

  /**
   * 「길찾기」의 출발지 (M42) — 한 날을 보고 있을 때 그 날의 앞 장소.
   *
   * 구글 지도 갈래도 같은 함수를 부른다({@link GoogleMapView}). 같은 카드의 같은
   * 링크가 두 엔진에서 다르면 그건 두 개의 앱이다.
   */
  const previousStops = useMemo(
    () => previousStopMap(selection.kind === 'day' ? drawings.map((item) => item.route.stops) : []),
    [selection.kind, drawings],
  );

  const routeKey =
    selection.kind === 'off'
      ? 'off'
      : `${routeSheet?.id ?? ''}:${selection.kind === 'all' ? 'all' : selection.dayId}`;

  /* --- 필터 (M27) ---------------------------------------------------- */

  /**
   * 범위 필터가 읽는 일자 — 경로가 고른 그 일자다.
   *
   * 「일자별」에 두 번째 일자 피커를 붙이지 않는 이유: 이 화면에는 이미 일자
   * 칩 줄이 있고, 그 줄이 고른 날과 지도가 보여 주는 날이 서로 다를 수 있다면
   * 그건 컨트롤이 하나 더 생긴 게 아니라 화면이 두 개로 갈라진 것이다.
   */
  const scopeDay = useMemo(
    () => routeDays.find((day) => day.id === scopeDayId),
    [routeDays, scopeDayId],
  );

  const filter = useMemo<MapFilter>(
    () => ({
      scope: scope === 'day' ? { kind: 'day', dayId: scopeDay?.id } : { kind: scope },
      sheetId: routeSheet?.id,
      mutedColumns,
    }),
    [scope, scopeDay?.id, routeSheet?.id, mutedColumns],
  );

  /** 범위만 통과한 카드들 — 카테고리를 끄기 *전*의 집합 (빈 화면 안내용). */
  const scopedIds = useMemo(
    () => new Set(scopeCards(workspace, trip?.id, filter).map((card) => card.id)),
    [workspace, trip?.id, filter],
  );

  /** 실제로 그리는 핀 — 범위 ∩ 카테고리. */
  const visiblePins = useMemo(
    () => pins.filter((pin) => scopedIds.has(pin.card.id) && !mutedColumns.includes(pin.column.id)),
    [pins, scopedIds, mutedColumns],
  );

  const filterPoints = useMemo(
    () => visiblePins.map((pin) => pin.card.location!),
    [visiblePins],
  );

  /**
   * 다시 맞출 이유가 되는 것들만 — **선택**이지 내용이 아니다.
   *
   * 필터를 좁히면 남은 곳들이 화면에 꽉 차야 한다. 반대로 같은 필터 안에서
   * 지도를 끌어다 놓은 사용자를 다시 끌어다 놓는 일은 없어야 해서, 핀의 좌표는
   * 이 열쇠에 들어가지 않는다 (`FitOnce`의 계약).
   */
  const filterKey = [
    trip?.id ?? '',
    routeSheet?.id ?? '',
    scope,
    scope === 'day' ? (scopeDay?.id ?? '') : '',
    [...mutedColumns].sort().join(','),
  ].join('|');

  /* --- 구글 지도 시트 (M41) ------------------------------------------ */

  /**
   * 이 화면을 구글로 그릴 것인가.
   *
   * 두 가지가 동시에 참이어야 한다: 위 「표시」 줄이 고른 **일정표**가 구글
   * 시트이고, 범위가 그 일정표를 읽는 범위(일정 전체·일자별)일 것. 「전체
   * 아이템」과 「미확정」은 특정 일정표의 화면이 아니라 여행 전체의 화면이라,
   * 어느 시트의 엔진을 따라야 하는지 물음 자체가 성립하지 않는다 — 그 둘은
   * 언제나 M3부터의 OSM 지도다.
   */
  const sheetDrivenScope = scope === 'sheet' || scope === 'day';
  const googleSheet = routeSheet?.mapEngine === 'google';
  /** 구글로 그리려던 참인가 — 키가 없어도 참이다(안내 한 줄이 이 값을 읽는다). */
  const googleWanted = googleSheet && sheetDrivenScope;
  const googleMode = googleWanted && Boolean(googleKey) && !googleFailed;

  /**
   * 구글 핀 중 물러나야 하는 것들 — Leaflet 마커의 `dimmed` 인자와 같은 판정.
   *
   * 한 날의 동선을 보는 동안 다른 날의 장소는 사라지지 않고 반 톤 낮아진다
   * (M15 §3). 판정은 한 곳에서만 하고 두 렌더러가 나눠 쓴다.
   */
  const dimmedCardIds = useMemo<Id[]>(
    () =>
      selection.kind === 'day' && routeCardIds.size > 0
        ? visiblePins.filter((pin) => !routeCardIds.has(pin.card.id)).map((pin) => pin.card.id)
        : [],
    [selection, routeCardIds, visiblePins],
  );

  // A day (or a whole sheet) that disappears must not leave a dangling route.
  useEffect(() => {
    if (selection.kind !== 'day') return;
    if (!routeDays.some((day) => day.id === selection.dayId)) setSelection({ kind: 'off' });
  }, [selection, routeDays]);

  /**
   * What the control opens on (M15 §3).
   *
   * Was: 「off, always」 — and the owner never found the chip row, so they never
   * saw an arrow. Now: this device's last choice for *this* trip, else 전체 as
   * soon as the trip has a located, scheduled card. `resolvedTripRef` makes it
   * a once-per-trip decision, so a later tap on 끔 is never overruled by a
   * re-render.
   */
  const resolvedTripRef = useRef<Id | null>(null);
  useEffect(() => {
    // Blank first, so a previous trip's day id can never survive the switch;
    // the effect below runs in the same commit and puts the real choice in.
    setSelection({ kind: 'off' });
    setRouteSheetId(undefined);
    resolvedTripRef.current = null;
  }, [trip?.id]);

  useEffect(() => {
    const tripId = trip?.id;
    if (!tripId || resolvedTripRef.current === tripId) return;

    const stored = loadRouteChoice(tripId);
    const storedDay = storedDayId(stored);
    if (storedDay) {
      // Only once the days are in hand — a remembered day id cannot be
      // honoured against an empty list.
      if (routeDays.length === 0) return;
      resolvedTripRef.current = tripId;
      if (routeDays.some((day) => day.id === storedDay)) {
        setSelection({ kind: 'day', dayId: storedDay });
      }
      return;
    }
    if (stored === 'off' || stored === 'all') {
      resolvedTripRef.current = tripId;
      setSelection({ kind: stored === 'all' ? 'all' : 'off' });
      return;
    }
    if (!hasRoutableDay) return;
    resolvedTripRef.current = tripId;
    setSelection({ kind: 'all' });
  }, [trip?.id, routeDays, hasRoutableDay]);

  // A legend chip for a category that no longer has pins would be unreachable.
  useEffect(() => {
    setMutedColumns((current) => {
      const next = current.filter((id) => legendColumns.some((column) => column.id === id));
      return next.length === current.length ? current : next;
    });
  }, [legendColumns]);

  /**
   * 필터도 이 기기가 기억한다 (M27) — 경로 선택과 똑같은 방식으로.
   *
   * 여행을 바꾸면 먼저 기본값으로 비운다: 앞 여행의 일자 id나 카테고리 id가
   * 다음 여행까지 따라가면 그건 기억이 아니라 오작동이다. 바로 아래 효과가 같은
   * 커밋에서 이 여행의 기억을 넣는다.
   *
   * 이 효과는 범례 정리 효과 **뒤에** 온다. 두 효과가 한 커밋에서 같이 돌 때
   * 위쪽의 함수형 갱신은 여기서 넣은 값 위에 얹히므로, 순서가 뒤집히면 방금
   * 불러온 카테고리 선택이 지워질 수 있다.
   */
  const filterTripRef = useRef<Id | null>(null);
  useEffect(() => {
    setScope('all');
    setScopeDayId(undefined);
    setMutedColumns([]);
    filterTripRef.current = null;
  }, [trip?.id]);

  useEffect(() => {
    const tripId = trip?.id;
    if (!tripId || filterTripRef.current === tripId) return;

    const stored = loadMapFilter(tripId);
    // 기억한 일자는 일자 목록이 손에 들어온 다음에야 확인할 수 있다.
    if (stored.scope === 'day' && routeDays.length === 0) return;

    filterTripRef.current = tripId;
    setMutedColumns(stored.muted);
    if (stored.dayId && routeDays.some((day) => day.id === stored.dayId)) {
      setScopeDayId(stored.dayId);
    }
    // 사라진 일자를 가리키는 「일자별」은 전체로 연다 — 빈 지도보다 낫다.
    if (stored.scope !== 'day' || routeDays.some((day) => day.id === stored.dayId)) {
      setScope(stored.scope);
    }
  }, [trip?.id, routeDays]);

  // 일자가 사라지면 「일자별」은 첫날로, 일자가 통째로 없으면 전체로 돌아온다.
  useEffect(() => {
    if (scope !== 'day') return;
    if (routeDays.length === 0) {
      setScope('all');
      return;
    }
    if (!routeDays.some((day) => day.id === scopeDayId)) setScopeDayId(routeDays[0].id);
  }, [scope, scopeDayId, routeDays]);

  if (!trip) return <TripPrompt />;

  const ready = size.x > 0 && size.y > 0;
  /** 「내 위치」 버튼이 눌린 모양으로 서 있어야 하는가. */
  const locating = geoOn(myLocation.state);

  /** Hands the card over to the 보드 tab, which opens its edit sheet. */
  const editOnBoard = (card: Card) => {
    focusCard(card.id);
    setTab('board');
  };

  /** Every filter pick goes through here, so every pick is remembered (M27). */
  const rememberFilter = (next: {
    scope?: MapScopeKind;
    dayId?: Id | undefined;
    muted?: readonly Id[];
  }) => {
    const nextScope = next.scope ?? scope;
    const nextDay = 'dayId' in next ? next.dayId : scopeDayId;
    const nextMuted = next.muted ?? mutedColumns;
    setScope(nextScope);
    setScopeDayId(nextDay);
    setMutedColumns(nextMuted);
    filterTripRef.current = trip.id;
    saveMapFilter(trip.id, { scope: nextScope, dayId: nextDay, muted: [...nextMuted] });
  };

  const toggleColumn = (columnId: Id) =>
    rememberFilter({
      muted: mutedColumns.includes(columnId)
        ? mutedColumns.filter((id) => id !== columnId)
        : [...mutedColumns, columnId],
    });

  /** Every route pick goes through here, so every pick is remembered. */
  const chooseRoute = (next: RouteSelection) => {
    setSelection(next);
    resolvedTripRef.current = trip.id;
    saveRouteChoice(trip.id, next.kind === 'day' ? `day:${next.dayId}` : next.kind);
    // 일자 칩은 경로의 피커이자 「일자별」 범위의 피커다 — 한 번 누르면 둘 다.
    if (next.kind === 'day') rememberFilter({ dayId: next.dayId });
  };

  /**
   * 범위 세그먼트 — 그날의 동선이 「일자별」의 자연스러운 짝이다.
   *
   * 미확정은 반대다: 일정표에 없는 곳들만 남긴 화면 위에 그 일정표의 화살표가
   * 떠 있으면, 화살표는 지금 보이지도 않는 핀들을 잇게 된다. 그래서 경로를 끈다.
   */
  const chooseScope = (kind: MapScopeKind) => {
    if (kind === 'day') {
      const dayId = scopeDay?.id ?? routeDays[0]?.id;
      if (!dayId) return;
      // 경로부터 옮기고 범위를 적는다: 두 호출 다 이번 렌더의 상태를 읽으므로,
      // 마지막에 적는 쪽이 온전한 다음 상태여야 한다.
      if (selection.kind !== 'day' || selection.dayId !== dayId) {
        chooseRoute({ kind: 'day', dayId });
      }
      rememberFilter({ scope: 'day', dayId });
      return;
    }
    rememberFilter({ scope: kind });
    if (kind === 'unscheduled' && selection.kind !== 'off') chooseRoute({ kind: 'off' });
  };

  /** 빈 화면에서 한 번에 원래대로 — 범위도 카테고리도. */
  const resetFilter = () => rememberFilter({ scope: 'all', muted: [] });

  /** 끔 / 전체 / 1일차 … — one segmented control, not a chip you must find. */
  const segmentClass = (active: boolean) =>
    [
      'inline-flex h-9 shrink-0 items-center rounded-full px-3 text-micro',
      'transition-colors duration-[140ms] ease-quick lg:h-8',
      active
        ? 'bg-inverse text-surface'
        : 'text-ink-muted hover:bg-surface hover:text-ink',
    ].join(' ');

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
          <h1
            id="view-map-title"
            // 제목은 줄바꿈되지 않는다 (M18 §1).
            className="shrink-0 whitespace-nowrap text-display text-ink"
          >
            지도
          </h1>
          <p data-testid="map-trip-title" className="mt-1 min-w-0 truncate text-label text-ink-muted">
            {trip.title}
          </p>
        </div>
        {isDesktop ? null : (
          // M18 §4 — 여기는 `<span className="ml-auto">` 하나였다. 안에 든
          // 프로필 칩과 동기화 점은 둘 다 `grid`(=블록)이라, inline 상자 안에서
          // 위아래로 쌓여 헤더가 두 줄이 됐다. 보드·일정 헤더는 처음부터 flex
          // 줄로 감싸고 있었고, 이 화면만 빠져 있었다.
          <span className="ml-auto flex shrink-0 items-center gap-1">
            <PatchNotesButton />
            <SyncStatusChip variant="dot" />
          </span>
        )}
      </header>

      {/* Under the h1, never over it (M9 §3.5). Desktop wears the chip in the
          top bar instead, so only one of the two ever mounts. */}

      {legendColumns.length > 0 ? (
        <div
          data-testid="map-legend"
          className="flex shrink-0 flex-wrap items-center gap-2 px-4 pb-2"
          role="group"
          aria-label="카테고리 필터"
        >
          {/* 표시·경로 줄과 같은 자리에 같은 활자로 — 세 줄이 한 벌로 읽힌다. */}
          <span className="shrink-0 text-micro font-normal text-ink-muted">카테고리</span>
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
          {/* 꺼 둔 것이 있을 때만 나타나는 되돌리기 — 카테고리가 여섯인 여행에서
              하나씩 다시 켜는 일을 시키지 않는다. 컨트롤이 하나 더 생기는 게
              아니라, 이 줄이 스스로를 되돌리는 방법이다. */}
          {mutedColumns.length > 0 ? (
            <button
              type="button"
              data-testid="map-legend-all"
              onClick={() => rememberFilter({ muted: [] })}
              className={`${CHIP_BUTTON} shrink-0`}
            >
              전체 카테고리
            </button>
          ) : null}
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

      {/* 표시 (M27) — 지도에 무엇을 올릴 것인가.
          일정표 선택이 여기로 온 이유: 이 줄과 아래 경로 줄이 **같은 일정표**를
          읽는다. 고르는 자리가 아래 줄에만 있으면, 위 줄이 무엇을 기준으로
          「일정 전체」라고 말하는지가 화면에 없다. */}
      {pins.length > 0 && sheets.length > 0 ? (
        <div
          className={['relative shrink-0', scopeStrip.overflow ? 'tb-strip-fade' : ''].join(' ')}
        >
          <div
            ref={scopeStrip.ref}
            onScroll={scopeStrip.measure}
            data-testid="map-scope-controls"
            className="flex items-center gap-2 overflow-x-auto px-4 pb-2"
            role="group"
            aria-label="표시 범위"
          >
            <span className="shrink-0 text-micro font-normal text-ink-muted">표시</span>

            <div className="relative shrink-0">
              <select
                data-testid="map-route-sheet-select"
                aria-label="일정표 선택"
                value={routeSheet?.id ?? ''}
                onChange={(event) => {
                  setRouteSheetId(event.target.value);
                  // Another 일정표 is another itinerary — show all of it.
                  chooseRoute({ kind: 'all' });
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

            <div
              data-testid="map-scope-segments"
              className="flex shrink-0 items-center gap-1 rounded-full bg-sunken p-1"
            >
              {(
                [
                  ['all', '전체 아이템', 'map-scope-all'],
                  ['sheet', '일정 전체', 'map-scope-sheet'],
                  ...(routeDays.length > 0
                    ? ([['day', '일자별', 'map-scope-day']] as const)
                    : []),
                  ['unscheduled', '미확정', 'map-scope-unscheduled'],
                ] as const
              ).map(([kind, label, testId]) => (
                <button
                  key={kind}
                  type="button"
                  data-testid={testId}
                  data-active={scope === kind}
                  aria-pressed={scope === kind}
                  onClick={() => chooseScope(kind)}
                  className={segmentClass(scope === kind)}
                >
                  {label}
                </button>
              ))}
            </div>

            {scope === 'day' && scopeDay ? (
              <span
                data-testid="map-scope-day-label"
                data-day-id={scopeDay.id}
                className="shrink-0 text-micro font-normal text-ink-faint"
              >
                {`${dayTitle(scopeDay, routeDays.indexOf(scopeDay))}만 보는 중`}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      {routeDays.length > 0 ? (
        <div
          // The fade belongs to a *wrapper*, not to the scroller: an `::after`
          // pinned to the right inside an `overflow-x-auto` box is positioned
          // against the scrolled content, so it slides away with the chips
          // instead of standing at the viewport's edge (§4.7-2).
          className={['relative shrink-0', routeStrip.overflow ? 'tb-strip-fade' : ''].join(' ')}
        >
          <div
            ref={routeStrip.ref}
            onScroll={routeStrip.measure}
            data-testid="map-route-controls"
            // One line that scrolls, not two lines that push the map down.
            className="flex items-center gap-2 overflow-x-auto px-4 pb-2"
            role="group"
            aria-label="일자별 경로"
          >
            <span className="shrink-0 text-micro font-normal text-ink-muted">경로</span>

            {/* One segmented control — 끔 · 전체 · 일차 — rather than a row of
                chips that could each be missed. `전체` no longer toggles
                itself off: 끔 is a segment of its own now (M15 §3). */}
            <div
              data-testid="map-route-segments"
              className="flex shrink-0 items-center gap-1 rounded-full bg-sunken p-1"
            >
              <button
                type="button"
                data-testid="map-route-off"
                data-active={selection.kind === 'off'}
                aria-pressed={selection.kind === 'off'}
                onClick={() => chooseRoute({ kind: 'off' })}
                className={segmentClass(selection.kind === 'off')}
              >
                끔
              </button>
              <button
                type="button"
                data-testid="map-route-all"
                data-active={selection.kind === 'all'}
                aria-pressed={selection.kind === 'all'}
                onClick={() => chooseRoute({ kind: 'all' })}
                className={segmentClass(selection.kind === 'all')}
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
                    title={daySubtitle(day, index) || undefined}
                    onClick={() => chooseRoute({ kind: 'day', dayId: day.id })}
                    className={segmentClass(active)}
                  >
                    {dayTitle(day, index)}
                  </button>
                );
              })}
            </div>

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

      {/* 구글로 그리려 했는데 그럴 수 없는 화면 (M41) — 지도는 그대로 뜨고,
          왜 다른 지도인지만 한 줄로 말한다. 오프라인 안내와 같은 자리·같은
          활자: 「지도에 대해 알아 둘 것」은 언제나 지도 바로 위에 선다. */}
      {googleWanted && !googleMode ? (
        <p
          data-testid="map-google-fallback"
          data-reason={googleKey ? 'failed' : 'no-key'}
          className="shrink-0 px-4 pb-2 text-label font-normal text-ink-muted"
        >
          {googleKey
            ? '구글 지도를 불러오지 못해 OSM으로 보여요'
            : '구글 지도 키가 없어 OSM으로 보여요'}
        </p>
      ) : null}

      {/* `isolate` traps Leaflet's internal z-indexes (panes go up to 700) so
          they cannot paint over the bottom sheets and the tab bar. */}
      <div
        data-testid="map-root"
        data-ready={ready}
        data-map-width={size.x}
        data-map-height={size.y}
        // Rounded to ~110m: enough to tell 오사카 from 서울 without a test
        // failing on the metre Leaflet's pixel maths lands on.
        data-center-lat={center ? center.lat.toFixed(3) : undefined}
        data-center-lng={center ? center.lng.toFixed(3) : undefined}
        className="relative isolate mx-4 mb-4 min-h-0 flex-1 overflow-hidden rounded-lg border border-line bg-sunken"
      >
        {/* M41 — 구글 시트를 보고 있으면 같은 자리에 구글 지도가 선다. 아래
            Leaflet 갈래는 한 글자도 손대지 않았다: 지금까지의 모든 지도(그리고
            그 위의 스펙 절반)가 그 갈래이고, 새 엔진 때문에 옛 엔진이 흔들리는
            것이 이 마일스톤에서 가장 비싼 실수일 것이다. */}
        {googleMode ? (
          <GoogleMapView
            apiKey={googleKey ?? ''}
            pins={visiblePins}
            dimmedCardIds={dimmedCardIds}
            drawings={drawings}
            fitPoints={filterPoints}
            fitKey={filterKey}
            routePoints={routePoints}
            routeKey={routeKey}
            // 실제 경로를 물어보는 유일한 조건 (M42): 지금 한 날을 보고 있는가.
            routeDayId={selection.kind === 'day' ? selection.dayId : undefined}
            myLocation={myLocation.state.fix}
            myLocationSession={myLocation.state.session}
            fallback={destination}
            currency={trip.currency}
            onEditCard={editOnBoard}
            onRemoveLocation={(card) => updateCard(card.id, { location: undefined })}
            onFail={() => setGoogleFailed(true)}
          />
        ) : (
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
          <CenterReport onCenter={onCenter} />
          <FitPins points={fitPoints} fallback={destination} fitKey={fitKey} ready={ready} />
          {/* 필터를 바꾸면 남은 곳들로 화면을 다시 맞춘다 (M27). 비면 그대로 둔다 —
              아무것도 없는 화면으로 사용자를 끌고 가지 않는 게 `FitOnce`의 계약. */}
          <FitOnce points={filterPoints} fitKey={filterKey} ready={ready} />
          <FitOnce points={routePoints} fitKey={routeKey} ready={ready} />
          <MyLocationLayer fix={myLocation.state.fix} session={myLocation.state.session} />

          {visiblePins.map(({ card, column }) => (
            <Marker
              key={card.id}
              position={[card.location!.lat, card.location!.lng]}
              icon={cardPinIcon(
                column.color,
                column.icon,
                card.id,
                column.id,
                // 일차별 지도 분리: while one day is on screen, the places that
                // belong to the other days step back rather than disappear.
                selection.kind === 'day' && routeCardIds.size > 0 && !routeCardIds.has(card.id),
              )}
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
                    {/* 실제로 그 길을 걷는 일은 구글 지도 앱이 한다 (M42).
                        한 날을 보고 있으면 그 날의 앞 장소가 출발지로 실린다. */}
                    {(() => {
                      const href = directionsUrl(card.location, previousStops.get(card.id));
                      return href ? (
                        <a
                          data-testid="map-popup-directions"
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`${SECONDARY_BUTTON_CLASS} w-full`}
                        >
                          <Icon name="route" size={16} />
                          {DIRECTIONS_LABEL}
                        </a>
                      ) : null;
                    })()}
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
        )}

        {/* 내 위치 (M42) — 지도 컨테이너 **바깥**의 오버레이라 두 엔진에서 자리가
            같다. Leaflet의 ＋/− 는 오른쪽 위 10px에 두 칸(≈64px)을 차지하므로 그
            바로 아래에 선다; 구글은 자기 확대 버튼을 오른쪽 **아래**에 두어 이
            자리가 비어 있다. Leaflet 컨트롤이 z-index 1000까지 올라오므로 그 위. */}
        <button
          type="button"
          data-testid="map-locate"
          data-active={locating}
          aria-pressed={locating}
          aria-label="내 위치"
          title="내 위치"
          onClick={myLocation.toggle}
          className={[
            'absolute right-2.5 top-[5.5rem] z-[1100] grid h-11 w-11 place-items-center',
            'rounded-full border bg-surface/95 shadow-raise',
            'transition-colors duration-[140ms] ease-quick',
            locating ? 'border-ink text-ink' : 'border-line text-ink-muted hover:text-ink',
          ].join(' ')}
        >
          <Icon name="locate" size={20} />
        </button>

        {/* 거절·불가·시간초과는 모달이 아니라 버튼 아래 한 줄이다 (M42). 방금
            스스로 거절한 사람에게 앱이 창을 띄워 되묻는 일은 없어야 한다. */}
        {myLocation.state.message ? (
          <p
            data-testid="map-locate-error"
            className="absolute right-2.5 top-[9.25rem] z-[1100] max-w-[11rem] rounded-md bg-surface/95 px-2 py-1 text-right text-micro font-normal text-ink-muted shadow-raise"
          >
            {myLocation.state.message}
          </p>
        ) : null}

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

        {/* 필터가 다 걸러 낸 화면 (M27) — 회색 판이 아니라 한 줄과 되돌리기.
            핀이 아예 없는 여행은 위쪽 안내가 이미 맡고 있으므로 둘은 겹치지
            않는다. */}
        {pins.length > 0 && visiblePins.length === 0 ? (
          <div className="pointer-events-none absolute inset-0 z-[500] flex items-center justify-center p-6">
            <div
              data-testid="map-filter-empty"
              className="pointer-events-auto max-w-[22rem] rounded-lg bg-surface/95 px-5 py-4 text-center shadow-float"
            >
              <p className="text-label font-normal text-ink-muted">
                {emptyFilterHint(filter, scopedIds.size)}
              </p>
              <button
                type="button"
                data-testid="map-filter-reset"
                onClick={resetFilter}
                className={`${withBtnSize(SECONDARY_BUTTON_CLASS, BTN_SIZE_SM)} mt-3`}
              >
                전체 아이템 보기
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
