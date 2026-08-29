import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  GOOGLE_MAP_ID,
  googleMarkerLibrary,
  loadGoogleMaps,
  type GoogleCircle,
  type GoogleMap,
  type GoogleMapsApi,
  type GoogleMarker,
  type GoogleMarkerLibrary,
  type GooglePolyline,
} from '../../map/googleLoader';
import { DIRECTIONS_LABEL, directionsUrl, previousStopMap } from '../../map/directions';
import { MY_LOCATION_HEX, type GeoFix } from '../../map/geolocate';
import {
  formatRouteDuration,
  pathMidpoint,
  routeDayFingerprint,
  routeLeg,
  routeLegPairs,
  type RouteLegResult,
} from '../../map/googleRoutes';
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
  SECONDARY_BUTTON_CLASS,
} from '../common/formStyles';
import GourmetLayer from './GourmetLayer';
import { createDurationChipElement, createMyLocationElement, createPinElement } from './googlePin';
import type { RouteDrawing } from './RouteLayer';
import { DESTINATION_ZOOM, FIT_MAX_ZOOM, MY_LOCATION_ZOOM, WORLD_ZOOM } from './mapBase';

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
  /**
   * 지금 「일자별」로 보고 있는 **한 날** (M42) — 실제 경로를 물어볼 유일한 조건.
   *
   * 이 값이 있을 때만 그 날의 다리마다 Routes API를 부른다. 전체(여러 날)와
   * 일정 전체는 값이 없고, 그래서 한 번도 부르지 않는다 — 화면 한 번에 열 개씩
   * 나가는 유료 호출을 막는 것은 규칙이 아니라 이 한 줄의 존재다.
   */
  routeDayId?: Id;
  /** 「내 위치」의 마지막 좌표 (M42). 꺼져 있으면 `null`. */
  myLocation?: GeoFix | null;
  /** 켠 횟수 — 이 값이 바뀐 뒤 처음 오는 좌표에서만 화면이 그리로 간다. */
  myLocationSession?: number;
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
 * 아직 진짜 길을 모르는 다리의 점선 (M42).
 *
 * 구글 지도에서 점선은 「투명한 선 + 반복 심볼」로 그린다 — `strokeOpacity: 0`이
 * 곧 「이 선은 눈금으로만 보인다」는 뜻이다. M41의 보정 팝업이 두 점을 잇는 데
 * 쓰는 그 방식 그대로다.
 */
const DASH_SYMBOL = { path: 'M 0,-1 0,1', strokeOpacity: 1, scale: 3 };

/** 점선 눈금 사이 간격. */
const DASH_REPEAT = '12px';

/** 다리 하나의 이름 — 그 날 안에서만 유일하면 된다. */
const legKey = (index: number, fromCardId: Id, toCardId: Id): string =>
  `${index}:${fromCardId}>${toCardId}`;

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
  routeDayId,
  myLocation,
  myLocationSession = 0,
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
  /** 다리 가운데의 「23분」 칩들 — 선과 같이 났다 같이 사라진다. */
  const chipsRef = useRef<{ marker: GoogleMarker; element: HTMLElement }[]>([]);

  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  /** 열려 있는 카드 팝업 — 핀 하나를 눌렀을 때. */
  const [openCardId, setOpenCardId] = useState<Id | null>(null);
  /**
   * 카드 팝업이 열린 횟수 (M43) — 맛집 팝업에게 물러나라고 말하는 신호.
   *
   * 두 팝업은 화면의 **같은 자리**(아래 두 칸)에 뜬다. 한쪽이 열릴 때 다른
   * 쪽이 닫히지 않으면 두 장이 겹치고, 그 아래 장의 버튼은 누를 수 없다.
   */
  const [cardPopupToken, setCardPopupToken] = useState(0);
  const openCardPopup = (cardId: Id) => {
    setOpenCardId(cardId);
    setCardPopupToken((current) => current + 1);
  };
  /** 맛집 팝업이 열렸다는 신호를 받는 쪽 — 효과의 의존성이라 신원이 고정이어야 한다. */
  const closeCardPopup = useCallback(() => setOpenCardId(null), []);
  /**
   * 구글이 답해 준 실제 경로들 — 다리 이름 → 선과 시간 (M42).
   *
   * 한 다리씩 도착하는 대로 채워진다. 아직 없는 다리는 직선 점선으로 남고, 그
   * 상태가 그대로 남는 것도 정상이다(대중교통도 도보도 길이 없는 다리).
   */
  const [routes, setRoutes] = useState<Record<string, RouteLegResult>>({});

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

  /* --- 컨테이너가 커졌다 (M45) ---------------------------------------- */

  /**
   * 모바일 전체화면은 이 컨테이너를 `fixed inset-0`으로 키운다. 구글 지도는
   * 자기가 만들어질 때 잰 크기를 들고 있으므로, 말해 주지 않으면 타일이 옛 상자
   * 안에만 그려지고 나머지는 회색으로 남는다.
   *
   * Leaflet 쪽 {@link MapReady}가 하는 일과 같은 일이다 — 그쪽은
   * `invalidateSize()`, 이쪽은 `event.trigger(map, 'resize')`. 두 갈래가 같은
   * `ResizeObserver` 계약을 쓰는 편이 「전체화면 때만 부른다」보다 낫다: 회전도,
   * 탭 전환도, 데스크톱 브레이크포인트도 같은 사고를 낼 수 있다.
   */
  useEffect(() => {
    const container = containerRef.current;
    if (status !== 'ready' || !container) return;

    const settle = () => {
      const maps = mapsRef.current;
      const map = mapRef.current;
      if (!maps || !map) return;
      // 가짜 지도(e2e)와 옛 로더에는 `event`가 없다 — 없으면 아무 일도 없다.
      maps.event?.trigger?.(map, 'resize');
    };

    const observer = new ResizeObserver(settle);
    observer.observe(container);
    window.addEventListener('orientationchange', settle);

    return () => {
      observer.disconnect();
      window.removeEventListener('orientationchange', settle);
    };
  }, [status]);

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
      element.addEventListener('click', () => openCardPopup(card.id));

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

  /* --- 실제 경로 물어보기 (M42) --------------------------------------- */

  /**
   * 이미 물어본 「그 날 그 정거장들」. 지문이 그대로면 두 번 묻지 않는다.
   *
   * 여기에 더해 `map/googleRoutes.ts`가 (출발·도착·이동수단)마다 세션 캐시를
   * 들고 있어서, 어제 본 날을 다시 골라도 네트워크로는 나가지 않는다. 이 화면은
   * 리렌더가 잦고(필터·팝업·핀), 그때마다 유료 호출이 나가는 것이 이 기능에서
   * 가장 비싼 실수일 것이다.
   */
  const askedRef = useRef<string | null>(null);

  useEffect(() => {
    if (status !== 'ready') return;

    // 일자별이 아니면 아무것도 묻지 않고, 들고 있던 경로도 놓는다 — 전체 모드의
    // 화면에 어제의 선이 남아 있으면 안 된다.
    if (!routeDayId || !apiKey) {
      askedRef.current = null;
      setRoutes((current) => (Object.keys(current).length === 0 ? current : {}));
      return;
    }

    const drawing = drawings.find((item) => item.dayId === routeDayId);
    if (!drawing) return;

    const fingerprint = routeDayFingerprint(routeDayId, drawing.route.stops);
    if (askedRef.current === fingerprint) return;
    askedRef.current = fingerprint;
    setRoutes({});

    const pairs = routeLegPairs(drawing.route.stops);
    if (pairs.length === 0) return;

    void (async () => {
      // **순차**로. 다리 다섯 개짜리 날이 구글에 다섯 개를 동시에 던지는 그림은
      // 사용자가 화면을 스치기만 해도 벌어진다.
      for (let index = 0; index < pairs.length; index += 1) {
        const pair = pairs[index];
        const result = await routeLeg(apiKey, pair.from, pair.to);
        // 그만둘 이유는 하나뿐이다: **다른 날**을 물어보기 시작했다. 효과의
        // 정리 함수로 끊지 않는 이유가 여기 있다 — 이 효과는 같은 지문으로도
        // (부모가 다시 그리면) 여러 번 돌 수 있고, 그때마다 진행 중인 줄을
        // 끊으면 다리 다섯 개짜리 날은 영영 두 번째 다리에서 멈춘다.
        if (askedRef.current !== fingerprint) return;
        if (!result) continue;
        const key = legKey(index, pair.fromCardId, pair.toCardId);
        setRoutes((current) => ({ ...current, [key]: result }));
      }
    })();
  }, [status, routeDayId, drawings, apiKey]);

  /* --- 동선 -------------------------------------------------------- */

  useEffect(() => {
    const maps = mapsRef.current;
    const map = mapRef.current;
    const markerLib = markerLibRef.current;
    if (status !== 'ready' || !maps || !map) return;

    const clear = () => {
      for (const line of linesRef.current) line.setMap(null);
      linesRef.current = [];
      for (const { marker, element } of chipsRef.current) {
        marker.map = null;
        element.remove();
      }
      chipsRef.current = [];
    };
    clear();

    /** 방향 없는 선은 동선이 아니라 낙서다 (M6) — 선을 따라 반복되는 화살촉. */
    const arrowIcon = (color: string) => ({
      icon: {
        path: maps.SymbolPath?.FORWARD_CLOSED_ARROW ?? 1,
        scale: 3,
        strokeColor: color,
        fillColor: color,
        fillOpacity: 1,
      },
      repeat: ARROW_REPEAT,
    });

    for (const drawing of drawings) {
      const stops = drawing.route.stops;
      if (stops.length < 2) continue;

      // 여러 날을 한 화면에 보는 전체 모드는 M41 그대로 — 하루가 선 하나다.
      if (!routeDayId || drawing.dayId !== routeDayId) {
        linesRef.current.push(
          new maps.Polyline({
            map,
            path: stops.map((stop) => ({ lat: stop.lat, lng: stop.lng })),
            strokeColor: drawing.color,
            strokeWeight: 5,
            strokeOpacity: 0.85,
            icons: [arrowIcon(drawing.color)],
            zIndex: 40,
          }),
        );
        continue;
      }

      // 고른 한 날은 **다리 단위**로 그린다 (M42): 진짜 길을 아는 다리는 그 길로,
      // 모르는 다리는 직선 점선으로. 두 종류의 선이 한눈에 구별되는 것이 핵심이다
      // — 실선은 사실이고 점선은 짐작이다.
      routeLegPairs(stops).forEach((pair, index) => {
        const result = routes[legKey(index, pair.fromCardId, pair.toCardId)];

        if (!result) {
          linesRef.current.push(
            new maps.Polyline({
              map,
              path: [pair.from, pair.to],
              strokeColor: drawing.color,
              strokeWeight: 4,
              // 점선: 선 자체는 투명하고 눈금만 보인다.
              strokeOpacity: 0,
              icons: [
                { icon: { ...DASH_SYMBOL, strokeColor: drawing.color }, repeat: DASH_REPEAT },
                arrowIcon(drawing.color),
              ],
              zIndex: 40,
            }),
          );
          return;
        }

        linesRef.current.push(
          new maps.Polyline({
            map,
            path: result.path,
            strokeColor: drawing.color,
            strokeWeight: 5,
            strokeOpacity: 0.85,
            icons: [arrowIcon(drawing.color)],
            zIndex: 41,
          }),
        );

        const label = formatRouteDuration(result.durationSec);
        const mid = pathMidpoint(result.path);
        if (!label || !mid || !markerLib) return;
        const element = createDurationChipElement(label);
        element.setAttribute('data-mode', result.mode);
        const marker = new markerLib.AdvancedMarkerElement({
          map,
          position: { lat: mid.lat, lng: mid.lng },
          content: element,
          title: label,
          zIndex: 60,
        });
        chipsRef.current.push({ marker, element });
      });
    }

    return clear;
  }, [status, drawings, routeDayId, routes]);

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

  /* --- 내 위치 (M42) -------------------------------------------------- */

  const myMarkerRef = useRef<{ marker: GoogleMarker; element: HTMLElement } | null>(null);
  const myCircleRef = useRef<GoogleCircle | null>(null);

  useEffect(() => {
    const maps = mapsRef.current;
    const map = mapRef.current;
    const markerLib = markerLibRef.current;
    if (status !== 'ready' || !maps || !map || !markerLib) return;

    const clear = () => {
      if (myMarkerRef.current) {
        myMarkerRef.current.marker.map = null;
        myMarkerRef.current.element.remove();
        myMarkerRef.current = null;
      }
      myCircleRef.current?.setMap(null);
      myCircleRef.current = null;
    };
    clear();
    if (!myLocation) return;

    const element = createMyLocationElement();
    const position = { lat: myLocation.lat, lng: myLocation.lng };
    myMarkerRef.current = {
      marker: new markerLib.AdvancedMarkerElement({
        map,
        position,
        content: element,
        title: '내 위치',
        zIndex: 900,
      }),
      element,
    };

    // 정확도 원은 있으면 좋은 것이지 없으면 안 되는 것이 아니다 — `Circle`이
    // 없는 구현에서는 점만 선다.
    if (maps.Circle && myLocation.accuracyM > 0) {
      myCircleRef.current = new maps.Circle({
        map,
        center: position,
        radius: myLocation.accuracyM,
        strokeColor: MY_LOCATION_HEX,
        strokeOpacity: 0.35,
        strokeWeight: 1,
        fillColor: MY_LOCATION_HEX,
        fillOpacity: 0.12,
        clickable: false,
        zIndex: 10,
      });
    }

    return clear;
  }, [status, myLocation]);

  /**
   * 켤 때 한 번만 그리로 (M42).
   *
   * 갱신마다 따라가면, 지도를 손으로 옮겨 다른 동네를 보던 사용자가 GPS에게
   * 끌려 돌아온다. 그래서 「이번에 켠 뒤 처음 온 좌표」에서만 화면이 움직인다.
   */
  const panRef = useRef<number | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (status !== 'ready' || !map || !myLocation) return;
    if (panRef.current === myLocationSession) return;
    panRef.current = myLocationSession;
    map.setCenter({ lat: myLocation.lat, lng: myLocation.lng });
    map.setZoom(MY_LOCATION_ZOOM);
  }, [status, myLocation, myLocationSession]);

  // 사라진 카드의 팝업이 화면에 남아 있으면 안 된다.
  useEffect(() => {
    if (openCardId && !pins.some((pin) => pin.card.id === openCardId)) setOpenCardId(null);
  }, [pins, openCardId]);

  const openCard = pins.find((pin) => pin.card.id === openCardId)?.card;

  /**
   * 「길찾기」의 출발지 (M42) — 한 날을 보고 있을 때 그 날의 **앞 장소**.
   *
   * 판정도 규칙도 Leaflet 지도와 같은 {@link previousStopMap} 하나다. 여러 날이
   * 한 화면에 있을 때는 부르지 않는다: 같은 카드가 두 날에 있으면 앞 장소가 둘이
   * 되고, 그때 링크는 절반의 확률로 거짓말이 된다.
   */
  const previousStops = useMemo(
    () =>
      previousStopMap(
        routeDayId
          ? drawings.filter((item) => item.dayId === routeDayId).map((item) => item.route.stops)
          : [],
      ),
    [drawings, routeDayId],
  );

  const openCardDirections = directionsUrl(
    openCard?.location,
    openCard ? previousStops.get(openCard.id) : undefined,
  );

  return (
    <div
      data-testid="google-map"
      data-engine="google"
      data-status={status}
      data-pin-count={pins.length}
      data-route-count={drawings.length}
      // 실제 경로를 몇 다리나 그렸는가 (M42) — 나머지는 직선 점선으로 남아 있다.
      data-real-legs={Object.keys(routes).length}
      className="relative h-full w-full"
    >
      <div ref={containerRef} data-testid="google-map-canvas" className="h-full w-full" />

      {/* 「주변 맛집」 (M43) — 구글 지도가 실제로 선 뒤에만, 그리고 여기에만.
          Leaflet 갈래는 이 컴포넌트를 알지 못하고, 그래서 OSM 시트에는 버튼
          자체가 없다. 레이어는 자기 핀만 붙였다 떼고, 카드 핀·동선·필터가 쓰는
          상태에는 손대지 않는다. */}
      {status === 'ready' && mapsRef.current && mapRef.current && markerLibRef.current ? (
        <GourmetLayer
          maps={mapsRef.current}
          map={mapRef.current}
          markerLib={markerLibRef.current}
          fallbackCenter={fallback}
          onOpenSpot={closeCardPopup}
          closeToken={cardPopupToken}
        />
      ) : null}

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
            {/* 실제로 그 길을 걷는 일은 구글 지도 앱이 한다 (M42). 값이 들지
                않는 링크 하나로 거기까지 넘긴다. */}
            {openCardDirections ? (
              <a
                data-testid="gmap-popup-directions"
                href={openCardDirections}
                target="_blank"
                rel="noopener noreferrer"
                className={`${SECONDARY_BUTTON_CLASS} w-full`}
              >
                <Icon name="route" size={16} />
                {DIRECTIONS_LABEL}
              </a>
            ) : null}
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
