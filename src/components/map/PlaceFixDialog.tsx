import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  GOOGLE_MAP_ID,
  googleMarkerLibrary,
  loadGoogleMaps,
  type GoogleMap,
  type GoogleMapsApi,
  type GoogleMarker,
  type GooglePolyline,
} from '../../map/googleLoader';
import {
  PLACE_FIX_WARNING,
  placeFixDistanceLine,
  type PlaceFixDecision,
  type PlaceSuggestion,
} from '../../map/placeFix';
import type { Card } from '../../types/models';
import { PRIMARY_BUTTON_CLASS, SECONDARY_BUTTON_CLASS } from '../common/formStyles';
import { createDotElement } from './googlePin';

interface PlaceFixDialogProps {
  apiKey: string;
  card: Card;
  suggestion: PlaceSuggestion;
  decision: PlaceFixDecision;
  /** 「구글 위치로 보정」. */
  onConfirm: () => void;
  /** 「그대로 두기」. */
  onCancel: () => void;
}

/** 점선 한 칸의 모양 — 두 점 사이를 잇는 선이 「경로」로 읽히면 안 된다. */
const DASH_SYMBOL = { path: 'M 0,-1 0,1', strokeOpacity: 1, scale: 3 };

/** 두 점만 든 화면의 여백(px). 둘이 가까울수록 넉넉해야 둘로 보인다. */
const FIT_PADDING_PX = 56;

/** 한 점만 있을 때(카드에 위치가 없던 경우)의 배율. */
const SINGLE_ZOOM = 16;

/**
 * 배치 시 위치 보정 (M41) — 「구글은 여길 저기라고 하는데, 옮길까요?」
 *
 * 이 팝업이 존재하는 이유는 M37의 신고 한 줄이다: 저장된 좌표가 구글 지도와
 * 수백 m 어긋나 있어도 **일정에 놓기 전까지는 아무도 모른다**. 그래서 놓는
 * 순간에 딱 한 번, 조용히 묻는다.
 *
 * 화면이 지켜야 하는 세 가지:
 *
 * 1. **두 핀을 한 그림에** — 「250m 차이」라는 숫자보다 두 점 사이의 점선이
 *    먼저 말한다. 숫자만 보여 주면 그게 길 건너인지 옆 동네인지를 알 수 없다.
 * 2. **무엇이 바뀌는지 먼저** — 보정은 카드의 위치를 바꾸고, 카드는 여행 전체가
 *    나눠 쓰는 것이라 다른 시트의 지도도 같이 움직인다. 그 사실을 누르기 전에.
 * 3. **390px에서 스크롤 없이** — 지도 40vh + 두 줄 + 44px 버튼 둘. 확인을 위해
 *    스크롤해야 하는 확인 창은 확인 창이 아니다.
 */
export default function PlaceFixDialog({
  apiKey,
  card,
  suggestion,
  decision,
  onConfirm,
  onCancel,
}: PlaceFixDialogProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapsRef = useRef<GoogleMapsApi | null>(null);
  const mapRef = useRef<GoogleMap | null>(null);
  const markersRef = useRef<GoogleMarker[]>([]);
  const lineRef = useRef<GooglePolyline | null>(null);
  const [ready, setReady] = useState(false);

  const existing = card.location;
  const hasExisting = Boolean(
    existing && Number.isFinite(existing.lat) && Number.isFinite(existing.lng),
  );

  // ConfirmDialog·MapModal과 같은 이유로 캡처 단계에서 삼킨다 (M50): 이 물음이
  // 시트 위에 떠 있을 때 Escape 한 번이 물음과 시트를 함께 닫으면 안 된다.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onCancel();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onCancel]);

  useEffect(() => {
    let cancelled = false;

    void loadGoogleMaps(apiKey)
      .then(async (maps) => {
        const markerLib = await googleMarkerLibrary(maps);
        const container = containerRef.current;
        if (cancelled || !container) return;

        mapsRef.current = maps;
        const map = new maps.Map(container, {
          center: { lat: suggestion.lat, lng: suggestion.lng },
          zoom: SINGLE_ZOOM,
          mapId: GOOGLE_MAP_ID,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          clickableIcons: false,
        });
        mapRef.current = map;

        markersRef.current.push(
          new markerLib.AdvancedMarkerElement({
            map,
            position: { lat: suggestion.lat, lng: suggestion.lng },
            content: createDotElement('suggested', 'place-fix-pin-suggested'),
            title: suggestion.name || card.title,
          }),
        );

        if (hasExisting && existing) {
          markersRef.current.push(
            new markerLib.AdvancedMarkerElement({
              map,
              position: { lat: existing.lat, lng: existing.lng },
              content: createDotElement('existing', 'place-fix-pin-existing'),
              title: card.title,
            }),
          );

          lineRef.current = new maps.Polyline({
            map,
            path: [
              { lat: existing.lat, lng: existing.lng },
              { lat: suggestion.lat, lng: suggestion.lng },
            ],
            // 실선은 「이 길로 간다」로 읽힌다. 이건 길이 아니라 두 후보의 사이다.
            strokeOpacity: 0,
            icons: [{ icon: DASH_SYMBOL, offset: '0', repeat: '12px' }],
            strokeColor: '#57534e',
            zIndex: 20,
          });

          const bounds = new maps.LatLngBounds();
          bounds.extend({ lat: existing.lat, lng: existing.lng });
          bounds.extend({ lat: suggestion.lat, lng: suggestion.lng });
          map.fitBounds(bounds, FIT_PADDING_PX);
        }

        setReady(true);
      })
      .catch(() => {
        // 미니 지도를 못 그려도 팝업은 남는다 — 거리와 경고만으로도 답할 수 있는
        // 질문이고, 여기서 창을 닫아 버리면 방금 배치한 카드가 조용히 어긋난 채
        // 남는다.
        if (!cancelled) setReady(false);
      });

    return () => {
      cancelled = true;
      for (const marker of markersRef.current) marker.map = null;
      markersRef.current = [];
      lineRef.current?.setMap(null);
      lineRef.current = null;
    };
  }, [apiKey, card.title, existing, hasExisting, suggestion]);

  return createPortal(
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label="위치 보정"
      data-testid="place-fix-dialog"
      data-card-id={card.id}
      data-has-existing={hasExisting ? 'true' : 'false'}
      data-distance-m={Math.round(decision.distanceKm * 1000)}
      data-reason={decision.reason}
      // 확인 대화상자와 같은 층 (z-70): 지금 화면에서 가장 위에 있는 질문이다.
      // `tb-vp-fill`: 가시 뷰포트에 맞춘다 (M51 — `Sheet`와 같은 이유).
      className="tb-vp-fill fixed inset-0 z-70 flex items-center justify-center p-4"
    >
      <button
        type="button"
        aria-label="그대로 두기"
        onClick={onCancel}
        className="tb-overlay absolute inset-0 h-full w-full cursor-default bg-ink/45 backdrop-blur-[2px]"
      />
      <div className="tb-sheet-panel relative flex w-full max-w-[22rem] flex-col gap-3 rounded-lg bg-surface p-4 shadow-float">
        <div>
          <h2 className="truncate text-title text-ink">{card.title}</h2>
          <p className="mt-0.5 truncate text-label font-normal text-ink-muted">
            구글: {suggestion.name || suggestion.address || '이름 없는 장소'}
          </p>
        </div>

        <div
          data-testid="place-fix-map"
          data-ready={ready ? 'true' : 'false'}
          // 40vh — 폰에서 두 점과 그 사이가 보이는 최소치이자, 아래 두 줄과
          // 버튼 둘이 같은 화면에 남는 최대치.
          className="isolate h-[40vh] max-h-72 min-h-32 w-full overflow-hidden rounded-md border border-line bg-sunken"
        >
          <div ref={containerRef} className="h-full w-full" />
        </div>

        <p
          data-testid="place-fix-distance"
          className="text-label font-normal tabular-nums text-ink"
        >
          {placeFixDistanceLine(decision)}
        </p>

        <p
          data-testid="place-fix-warning"
          className="rounded-md bg-warn-wash px-3 py-2 text-micro font-normal text-warn-ink ring-1 ring-warn/40"
        >
          {PLACE_FIX_WARNING}
        </p>

        <div className="flex gap-2">
          <button
            type="button"
            data-testid="place-fix-keep"
            onClick={onCancel}
            className={`flex-1 ${SECONDARY_BUTTON_CLASS}`}
          >
            그대로 두기
          </button>
          <button
            type="button"
            data-testid="place-fix-apply"
            onClick={onConfirm}
            className={`flex-1 ${PRIMARY_BUTTON_CLASS}`}
          >
            구글 위치로 보정
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
