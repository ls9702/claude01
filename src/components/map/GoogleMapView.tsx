import { useEffect, useMemo, useRef, useState } from 'react';
import {
  GOOGLE_MAP_ID,
  googleMarkerLibrary,
  loadGoogleMaps,
  type GoogleMap,
  type GoogleMapsApi,
  type GoogleMarker,
  type GoogleMarkerLibrary,
  type GooglePolyline,
} from '../../map/googleLoader';
import type { BoardColumn, Card, Id } from '../../types/models';
import { formatBudget } from '../../utils/money';
import { cardCommentCount, cardSpent } from '../../utils/spend';
import { formatDuration } from '../../utils/time';
import Icon from '../common/Icon';
import {
  CHIP_MONEY,
  CHIP_NEUTRAL,
  DANGER_TEXT_BUTTON_CLASS,
  PRIMARY_BUTTON_CLASS,
} from '../common/formStyles';
import { createPinElement } from './googlePin';
import type { RouteDrawing } from './RouteLayer';
import { DESTINATION_ZOOM, FIT_MAX_ZOOM, WORLD_ZOOM } from './mapBase';

/** A located card plus the column it draws its color and icon from. */
export interface GooglePin {
  card: Card;
  column: BoardColumn;
}

interface GoogleMapViewProps {
  apiKey: string;
  /** 그릴 핀 — 이미 M27의 범위·카테고리 필터를 통과한 것들. */
  pins: readonly GooglePin[];
  /** 지금 고른 일자에 속하지 않아 물러나야 하는 카드들. */
  dimmedCardIds: readonly Id[];
  /** 그릴 동선 — 색·순서까지 OSM 지도와 같은 계산에서 나온다. */
  drawings: readonly RouteDrawing[];
  /** 필터가 바뀌면 여기로 화면을 다시 맞춘다. */
  fitPoints: readonly { lat: number; lng: number }[];
  fitKey: string;
  /** 경로 선택이 바뀌면 여기로. */
  routePoints: readonly { lat: number; lng: number }[];
  routeKey: string;
  /** 맞출 것이 하나도 없을 때 앉을 자리 — 여행의 목적지 (M12). */
  fallback?: { lat: number; lng: number };
  /** 통화 — 팝업의 예산·지출 칩이 읽는다. */
  currency: string;
  onEditCard: (card: Card) => void;
  onRemoveLocation: (card: Card) => void;
  /** 구글을 못 불러왔다 — 화면은 OSM으로 되돌아간다. */
  onFail: () => void;
}

/** `fitBounds`가 남기는 여백(px). Leaflet의 20% 패딩과 같은 인상. */
const FIT_PADDING_PX = 48;

/** 화살표 사이 간격 — 짧은 다리에도 하나는 서고, 긴 다리도 줄줄이 서지 않는다. */
const ARROW_REPEAT = '80px';

/**
 * 구글 지도로 그리는 지도 탭 (M41).
 *
 * **렌더러일 뿐이다.** 무엇을 그릴지는 전부 {@link MapView}가 정해서 넘겨준다 —
 * 범위·카테고리 필터(`map/filter.ts`)도, 05시 창의 일자 판정도, 동선의 색과
 * 순서(`timeline/route`)도 OSM 지도와 **완전히 같은 계산**이다. 이 파일이 하는
 * 일은 그 결과를 Leaflet 대신 구글의 클래스들에 얹는 것뿐이고, 그래서 두 지도가
 * 서로 다른 답을 말할 수가 없다.
 *
 * React가 DOM을 만들지 않는 컴포넌트다: 지도·핀·선은 구글이 자기 방식으로
 * 그리므로 여기서는 `useRef`에 담아 직접 붙이고 뗀다. React가 그리는 것은
 * 컨테이너 하나와, 핀을 눌렀을 때 아래에서 올라오는 카드 팝업 하나뿐이다.
 *
 * 실패는 조용하다 — 키가 틀렸거나 스크립트가 막히면 {@link GoogleMapViewProps.onFail}
 * 을 부르고, 화면은 안내 한 줄과 함께 OSM으로 돌아간다.
 */
export default function GoogleMapView({
  apiKey,
  pins,
  dimmedCardIds,
  drawings,
  fitPoints,
  fitKey,
  routePoints,
  routeKey,
  fallback,
  currency,
  onEditCard,
  onRemoveLocation,
  onFail,
}: GoogleMapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapsRef = useRef<GoogleMapsApi | null>(null);
  const mapRef = useRef<GoogleMap | null>(null);
  const markerLibRef = useRef<GoogleMarkerLibrary | null>(null);
  const markersRef = useRef<{ marker: GoogleMarker; element: HTMLElement }[]>([]);
  const linesRef = useRef<GooglePolyline[]>([]);

  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  /** 열려 있는 카드 팝업 — 핀 하나를 눌렀을 때. */
  const [openCardId, setOpenCardId] = useState<Id | null>(null);

  /* --- 지도 하나 만들기 ---------------------------------------------- */

  useEffect(() => {
    let cancelled = false;

    void loadGoogleMaps(apiKey)
      .then(async (maps) => {
        const markerLib = await googleMarkerLibrary(maps);
        const container = containerRef.current;
        if (cancelled || !container) return;

        mapsRef.current = maps;
        markerLibRef.current = markerLib;
        mapRef.current = new maps.Map(container, {
          center: fallback ?? { lat: 20, lng: 0 },
          zoom: fallback ? DESTINATION_ZOOM : WORLD_ZOOM,
          // AdvancedMarkerElement가 붙으려면 map id가 있어야 한다 — 왜 이 값인지는
          // {@link GOOGLE_MAP_ID}.
          mapId: GOOGLE_MAP_ID,
          // 지도가 답해야 할 질문은 「이 일정이 어디에 흩어져 있나」 하나다.
          // 스트리트뷰·위성·전체화면 버튼은 그 질문의 답이 아니다.
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          clickableIcons: false,
        });
        setStatus('ready');
      })
      .catch(() => {
        if (cancelled) return;
        setStatus('failed');
        onFail();
      });

    return () => {
      cancelled = true;
    };
    // 키가 바뀌는 일은 부트스트랩이 새 키를 물어 왔을 때뿐이고, 그때는 지도를
    // 다시 세우는 것이 맞다. 나머지 props는 아래 효과들이 따로 따라간다.
  }, [apiKey]);

  /* --- 핀 --------------------------------------------------------- */

  const dimmed = useMemo(() => new Set(dimmedCardIds), [dimmedCardIds]);

  useEffect(() => {
    const maps = mapsRef.current;
    const map = mapRef.current;
    const markerLib = markerLibRef.current;
    if (status !== 'ready' || !maps || !map || !markerLib) return;

    for (const { marker, element } of markersRef.current) {
      marker.map = null;
      element.remove();
    }
    markersRef.current = [];

    for (const { card, column } of pins) {
      const point = card.location;
      if (!point) continue;
      const element = createPinElement({
        color: column.color,
        icon: column.icon,
        cardId: card.id,
        columnId: column.id,
        dimmed: dimmed.has(card.id),
      });
      // 구글의 이벤트 시스템을 거치지 않는다 — 요소는 우리가 만들었고, 클릭도
      // 우리 것이다. 핀 하나 = 카드 하나 = 팝업 하나.
      element.addEventListener('click', () => setOpenCardId(card.id));

      const marker = new markerLib.AdvancedMarkerElement({
        map,
        position: { lat: point.lat, lng: point.lng },
        content: element,
        title: card.title,
      });
      markersRef.current.push({ marker, element });
    }

    return () => {
      for (const { marker, element } of markersRef.current) {
        marker.map = null;
        element.remove();
      }
      markersRef.current = [];
    };
  }, [status, pins, dimmed]);

  /* --- 동선 -------------------------------------------------------- */

  useEffect(() => {
    const maps = mapsRef.current;
    const map = mapRef.current;
    if (status !== 'ready' || !maps || !map) return;

    for (const line of linesRef.current) line.setMap(null);
    linesRef.current = [];

    for (const drawing of drawings) {
      if (drawing.route.stops.length < 2) continue;
      const line = new maps.Polyline({
        map,
        path: drawing.route.stops.map((stop) => ({ lat: stop.lat, lng: stop.lng })),
        strokeColor: drawing.color,
        strokeWeight: 5,
        strokeOpacity: 0.85,
        // 방향 없는 선은 동선이 아니라 낙서다 (M6). Leaflet 쪽은 다리 가운데에
        // SVG 화살촉을 세우고, 여기서는 구글이 선을 따라 같은 화살촉을 반복한다.
        icons: [
          {
            icon: {
              path: maps.SymbolPath?.FORWARD_CLOSED_ARROW ?? 1,
              scale: 3,
              strokeColor: drawing.color,
              fillColor: drawing.color,
              fillOpacity: 1,
            },
            repeat: ARROW_REPEAT,
          },
        ],
        zIndex: 40,
      });
      linesRef.current.push(line);
    }

    return () => {
      for (const line of linesRef.current) line.setMap(null);
      linesRef.current = [];
    };
  }, [status, drawings]);

  /* --- 화면 맞추기 --------------------------------------------------- */

  /**
   * 「선택이 바뀌면 다시 맞추고, 같은 선택 안에서는 손대지 않는다」 — Leaflet
   * 쪽 {@link FitOnce}의 계약을 그대로 옮긴 것이다. 비어 있으면 아무것도 하지
   * 않는다: 아무것도 없는 화면으로 사용자를 끌고 가지 않는다.
   */
  const fitTo = (points: readonly { lat: number; lng: number }[]) => {
    const maps = mapsRef.current;
    const map = mapRef.current;
    if (!maps || !map || points.length === 0) return;
    const bounds = new maps.LatLngBounds();
    for (const point of points) bounds.extend({ lat: point.lat, lng: point.lng });
    map.fitBounds(bounds, FIT_PADDING_PX);
    if (points.length === 1) map.setZoom(FIT_MAX_ZOOM);
  };

  const filterFitRef = useRef<string | null>(null);
  useEffect(() => {
    if (status !== 'ready' || filterFitRef.current === fitKey) return;
    if (fitPoints.length === 0) return;
    filterFitRef.current = fitKey;
    // fitTo는 ref만 읽으므로 의존성이 아니다 — 이 효과가 반응하는 것은 오직
    // 「선택이 바뀌었는가」다.
    fitTo(fitPoints);
  }, [status, fitKey, fitPoints]);

  const routeFitRef = useRef<string | null>(null);
  useEffect(() => {
    if (status !== 'ready' || routeFitRef.current === routeKey) return;
    if (routePoints.length === 0) return;
    routeFitRef.current = routeKey;
    fitTo(routePoints);
  }, [status, routeKey, routePoints]);

  // 사라진 카드의 팝업이 화면에 남아 있으면 안 된다.
  useEffect(() => {
    if (openCardId && !pins.some((pin) => pin.card.id === openCardId)) setOpenCardId(null);
  }, [pins, openCardId]);

  const openCard = pins.find((pin) => pin.card.id === openCardId)?.card;

  return (
    <div
      data-testid="google-map"
      data-engine="google"
      data-status={status}
      data-pin-count={pins.length}
      data-route-count={drawings.length}
      className="relative h-full w-full"
    >
      <div ref={containerRef} data-testid="google-map-canvas" className="h-full w-full" />

      {status === 'loading' ? (
        <p
          data-testid="google-map-loading"
          className="pointer-events-none absolute inset-x-0 top-3 mx-auto w-fit rounded-full bg-surface/95 px-3 py-1 text-micro font-normal text-ink-muted shadow-raise"
        >
          구글 지도를 불러오는 중…
        </p>
      ) : null}

      {/* 핀을 누르면 아래에서 올라오는 카드 한 장. 구글의 InfoWindow를 쓰지 않는
          이유는 그 안이 이 앱의 활자·버튼을 입을 수 없기 때문이다 — 같은 카드가
          두 지도에서 다른 옷을 입으면 그건 다른 앱이다. */}
      {openCard ? (
        <div
          data-testid="gmap-popup"
          data-card-id={openCard.id}
          className="absolute inset-x-2 bottom-2 z-10 space-y-3 rounded-lg bg-surface/97 p-4 shadow-float"
        >
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-title text-ink">{openCard.title}</p>
              <p
                title={openCard.location?.address ?? ''}
                className="mt-1 line-clamp-2 text-label font-normal text-ink-muted"
              >
                {openCard.location?.address ?? ''}
              </p>
            </div>
            <button
              type="button"
              data-testid="gmap-popup-close"
              aria-label="닫기"
              onClick={() => setOpenCardId(null)}
              className="-mr-1 -mt-1 grid h-9 w-9 shrink-0 place-items-center rounded-full text-ink-faint transition-colors duration-[140ms] ease-quick hover:bg-sunken hover:text-ink"
            >
              <Icon name="close" size={20} />
            </button>
          </div>

          <div className="flex flex-wrap gap-1">
            {typeof openCard.defaultDurationMin === 'number' && openCard.defaultDurationMin > 0 ? (
              <span data-testid="gmap-popup-chip-duration" className={CHIP_NEUTRAL}>
                <Icon name="clock" size={16} />
                {formatDuration(openCard.defaultDurationMin)}
              </span>
            ) : null}
            {typeof openCard.budget === 'number' && Number.isFinite(openCard.budget) ? (
              <span data-testid="gmap-popup-chip-budget" className={CHIP_NEUTRAL}>
                <Icon name="wallet" size={16} />
                {formatBudget(openCard.budget, currency)}
              </span>
            ) : null}
            {cardSpent(openCard) > 0 ? (
              <span
                data-testid="gmap-popup-chip-spent"
                data-spent={cardSpent(openCard)}
                className={CHIP_MONEY}
              >
                <Icon name="receipt" size={16} />
                {formatBudget(cardSpent(openCard), currency)}
              </span>
            ) : null}
            {cardCommentCount(openCard) > 0 ? (
              <span
                data-testid="gmap-popup-chip-comments"
                data-count={cardCommentCount(openCard)}
                className={CHIP_NEUTRAL}
              >
                <Icon name="comment" size={16} />
                {cardCommentCount(openCard)}
              </span>
            ) : null}
          </div>

          <div className="flex flex-col gap-1">
            <button
              type="button"
              data-testid="gmap-popup-edit"
              onClick={() => onEditCard(openCard)}
              className={`${PRIMARY_BUTTON_CLASS} w-full`}
            >
              보드에서 편집
            </button>
            <button
              type="button"
              data-testid="gmap-popup-remove"
              onClick={() => {
                onRemoveLocation(openCard);
                setOpenCardId(null);
              }}
              className={`${DANGER_TEXT_BUTTON_CLASS} w-full`}
            >
              지도에서 제거
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
