import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GourmetEntry } from '../../data/gourmet';
import {
  GENRE_EMOJI,
  GENRE_LABEL,
  GOURMET_GENRES,
  GOURMET_MIN_RATING,
  activeGenres,
  emptyGourmetHint,
  spotEmoji,
  toggleGenre,
  visibleGourmetSpots,
  type GourmetFilter,
  type GourmetSpot,
} from '../../gourmet/filter';
import { loadGourmetCache, saveGourmetResolved } from '../../gourmet/cache';
import { gourmetEntries } from '../../gourmet/entries';
import { GOURMET_POOL_WIDTH, runPool } from '../../gourmet/pool';
import {
  CITY_CENTER,
  NEARBY_MAX_RESULTS,
  NEARBY_RADIUS_M,
  nearbyCacheKey,
  nearbyFallbackQueries,
  nearbyPlan,
} from '../../gourmet/nearby';
import {
  cardMemoLine,
  curatedSpot,
  genreAreaLine,
  googleSpot,
  lookupQuery,
  progressLabel,
  ratingLine,
  reservableLine,
  resolvedFromPlace,
} from '../../gourmet/spots';
import {
  DIRECTIONS_LABEL,
  PLACE_PAGE_LABEL,
  directionsUrl,
  placePageUrl,
} from '../../map/directions';
import {
  latLngValue,
  type GoogleMap,
  type GoogleMapsApi,
  type GoogleMarker,
  type GoogleMarkerLibrary,
} from '../../map/googleLoader';
import {
  searchGourmetPlace,
  searchGourmetPlaces,
  searchNearbyGourmet,
} from '../../map/googlePlaces';
import { useUiStore } from '../../stores/uiStore';
import { useUndoStore } from '../../stores/undoStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import {
  loadGourmetFilter,
  loadGourmetPanelCollapsed,
  saveGourmetFilter,
  saveGourmetPanelCollapsed,
} from '../../stores/gourmetPref';
import { pickGourmetColumn } from '../../board/gourmetColumn';
import type { BoardColumn } from '../../types/models';
import { matchColumn } from '../ai/AiSuggestSheet';
import Icon from '../common/Icon';
import {
  BTN_SIZE_SM,
  CHIP_BUTTON,
  CHIP_SELECTED,
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
  withBtnSize,
} from '../common/formStyles';
import { createGourmetPinElement } from './googlePin';
import {
  claimMapPanel,
  claimMapPopup,
  mapPopupZ,
  registerMapPanel,
  registerMapPopup,
} from './mapLayerSlots';

/**
 * 「주변 맛집」 레이어 — 구글 지도 위에만 서는 참고 층 (M43).
 *
 * ## 왜 구글 시트에만 있나
 *
 * 이 레이어의 두 출처가 전부 구글 Places다. OSM 지도에 이 버튼을 두면 누르는
 * 순간 「지금 보는 지도와 상관없는 데이터」가 얹히고, 그 뒤에 나오는 평점·예약·
 * 장소 페이지는 전부 구글의 것이다. 그래서 버튼은 `GoogleMapView` 안에 산다 —
 * 조건문이 아니라 **사는 자리**로 규칙을 지킨다.
 *
 * ## 두 출처
 *
 * | 출처 | 언제 나가나 | 얼마나 |
 * |---|---|---|
 * | 큐레이션 | 레이어를 **처음 켤 때**, 캐시에 없는 집만 | 한 집당 기기 **평생 한 번** |
 * | 구글 실시간 | 켤 때 한 번 + 「이 지역에서 다시 검색」 | 한 번에 최대 3콜 |
 *
 * 지도를 미는 것만으로는 **아무 호출도 나가지 않는다**. 판을 옮길 때마다
 * 자동으로 다시 묻는 설계는 손가락 하나로 청구서를 만든다 — 그래서 다시 묻는
 * 일은 언제나 사람이 버튼을 눌러야 벌어진다.
 *
 * 끄면 전부 사라진다: 핀도, 팝업도, 진행 중이던 조회도(토큰이 바뀌면 그 줄은
 * 자기 결과를 버린다). 카드 핀·동선·필터는 이 레이어를 모른다.
 */

/** 이 세션의 근처 검색 기억 — (중심, 갈래) → 결과. 리로드하면 사라진다. */
const nearbySession = new Map<string, GourmetSpot[]>();

/** 테스트 전용 — 세션 기억을 비운다. */
export function resetGourmetSessionForTests(): void {
  nearbySession.clear();
}

interface GourmetLayerProps {
  maps: GoogleMapsApi;
  map: GoogleMap;
  markerLib: GoogleMarkerLibrary;
  /** 화면 한가운데를 읽을 수 없을 때 대신 볼 자리 — 여행의 목적지. */
  fallbackCenter?: { lat: number; lng: number };
  /** 맛집 팝업이 열렸다 — 카드 팝업은 물러난다. */
  onOpenSpot: () => void;
  /** 이 값이 바뀌면 맛집 팝업을 닫는다 — 카드 팝업이 열렸다는 신호. */
  closeToken: number;
}

/** 갈래 이름을 못 읽은 구글 결과가 핀에 적는 값. */
const OTHER_GENRE = 'other';

export default function GourmetLayer({
  maps,
  map,
  markerLib,
  fallbackCenter,
  onOpenSpot,
  closeToken,
}: GourmetLayerProps) {
  const workspace = useWorkspaceStore((s) => s.workspace);
  const addCard = useWorkspaceStore((s) => s.addCard);
  const activeTripId = useUiStore((s) => s.activeTripId);
  const notify = useUndoStore((s) => s.notify);

  const [active, setActive] = useState(false);
  const [filter, setFilter] = useState<GourmetFilter>(() => loadGourmetFilter());
  /**
   * 필터 패널을 접어 두었는가 (M45) — 기기별로 기억한다.
   *
   * 신고는 폰에서 왔다: 패널이 화면의 절반을 덮어 지도가 보이지 않는다. 칩 열한
   * 개는 한 번 고르고 나면 다시 볼 일이 드문 물건인데, 그것이 지도 앞에 서 있다.
   *
   * **핀은 접힘과 상관없다.** 접기는 필터를 끄는 것이 아니라 필터의 **손잡이**를
   * 치우는 것이다 — 접었더니 추천이 사라졌다면 그건 접기가 아니라 끄기다.
   */
  const [panelCollapsed, setPanelCollapsed] = useState<boolean>(() =>
    loadGourmetPanelCollapsed(),
  );
  const [curated, setCurated] = useState<GourmetSpot[]>([]);
  const [live, setLive] = useState<GourmetSpot[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [searching, setSearching] = useState(false);
  const [openKey, setOpenKey] = useState<string | null>(null);

  /* --- 자리 합의 (M50, `mapLayerSlots.ts`) ---------------------------- */

  /**
   * 이 층의 패널·팝업을 ⭐ 층이 접고 닫을 수 있게 등록한다.
   *
   * 접기는 기기 설정으로 남는다(`saveGourmetPanelCollapsed`) — 남이 접어 준
   * 것도 내가 접은 것과 같은 상태여야, 다음에 지도를 열었을 때 화면이 방금
   * 보던 모양 그대로다.
   */
  useEffect(
    () => registerMapPanel('gourmet', () => setPanelCollapsed(saveGourmetPanelCollapsed(true))),
    [],
  );
  useEffect(() => registerMapPopup('gourmet', () => setOpenKey(null)), []);

  /** 펼치기·열기의 유일한 문 — 남의 것을 먼저 치우고 내 것을 연다. */
  const expandPanel = useCallback(() => {
    claimMapPanel('gourmet');
    setPanelCollapsed(saveGourmetPanelCollapsed(false));
  }, []);
  const openSpotKey = useCallback((key: string) => {
    claimMapPopup('gourmet');
    setOpenKey(key);
  }, []);

  const markersRef = useRef<{ marker: GoogleMarker; element: HTMLElement }[]>([]);
  /**
   * 지금 살아 있는 활성화의 번호.
   *
   * 끄거나 다시 켜면 올라간다. 진행 중이던 조회는 답이 올 때마다 이 값을
   * 확인하고, 자기 번호가 아니면 결과를 **버린다** — 「끈 뒤에 핀이 하나씩
   * 돋아나는」 화면이 이 기능에서 가장 이상한 버그일 것이다.
   */
  const runRef = useRef(0);

  /* --- 화면 한가운데 ------------------------------------------------ */

  const readCenter = useCallback((): { lat: number; lng: number } | null => {
    const raw = map.getCenter?.();
    if (raw) {
      const lat = latLngValue(raw.lat);
      const lng = latLngValue(raw.lng);
      if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
    }
    return fallbackCenter ?? null;
  }, [map, fallbackCenter]);

  /* --- 큐레이션 목록 해석 (한 집당 평생 한 번) ------------------------ */

  const resolveCurated = useCallback(
    async (token: number) => {
      const cache = loadGourmetCache();
      const cached: GourmetSpot[] = [];
      // 조사 배열을 직접 읽지 않는다 — 무엇을 조회할지는 이음매가 답한다
      // (`gourmet/entries.ts`). 이 한 줄이 조회와 화면 둘 다를 덮는다.
      const entries = gourmetEntries();
      const pending: GourmetEntry[] = entries.filter((entry) => {
        const hit = cache[entry.id];
        if (hit) cached.push(curatedSpot(entry, hit));
        return !hit;
      });
      if (runRef.current !== token) return;
      setCurated(cached);

      if (pending.length === 0) return;
      const total = pending.length;
      setProgress({ done: 0, total });

      // M43은 **순차**였다: 「마흔 집을 동시에 던지면 구글은 받아 주지만 사용자의
      // 폰이 먼저 넘어간다」. 그 걱정은 지금도 옳다 — 틀린 것은 폭이 1이었다는
      // 점뿐이고, 그래서 127집이 127번의 왕복으로 줄을 서 「불러오는게 너무
      // 늦다」가 됐다 (M45).
      //
      // 이제 폭이 여섯이다. 동시에 살아 있는 요청은 여섯을 넘지 않고, 끄면
      // (`stop`) 남은 칸은 아예 집지 않는다. 자세한 계약은 `gourmet/pool.ts`.
      let done = 0;
      await runPool(
        pending,
        GOURMET_POOL_WIDTH,
        async (entry) => {
          const place = await searchGourmetPlace(
            maps,
            lookupQuery(entry),
            CITY_CENTER[entry.city],
          );
          // 껐거나 다시 켰다 — 이 줄의 답은 이제 아무의 것도 아니다.
          if (runRef.current !== token) return;

          if (place) {
            const resolved = resolvedFromPlace(place);
            // 찾은 것만 적는다. **실패는 캐시하지 않는다** — 오늘 못 찾은 집을
            // 영영 못 찾은 집으로 만들면 안 되고, 다음에 켤 때 다시 물으면 된다.
            saveGourmetResolved(entry.id, resolved);
            setCurated((current) => [...current, curatedSpot(entry, resolved)]);
          }
          // 진행은 **완료 기준**이다 — 끝나는 순서는 보장되지 않으므로 칸 번호가
          // 아니라 끝난 개수를 센다.
          done += 1;
          setProgress({ done, total });
        },
        { stop: () => runRef.current !== token },
      );

      if (runRef.current !== token) return;
      setProgress(null);
    },
    [maps],
  );

  /* --- 구글 실시간 (사람이 부를 때만) --------------------------------- */

  const runNearby = useCallback(
    async (token: number, force = false) => {
      const center = readCenter();
      if (!center) return;

      const genres = activeGenres(filter);
      const key = nearbyCacheKey(center, genres);
      const remembered = nearbySession.get(key);
      if (remembered && !force) {
        setLive(remembered);
        return;
      }

      setSearching(true);
      const plan = nearbyPlan(genres);
      const found: GourmetSpot[] = [];

      const askKeyword = async (
        query: { textQuery: string; minRating: number; genre: (typeof genres)[number] },
      ) => {
        const places = await searchGourmetPlaces(maps, query.textQuery, center, {
          minRating: query.minRating,
          maxResultCount: NEARBY_MAX_RESULTS,
        });
        for (const place of places) found.push(googleSpot(place, plan.typedGenres, query.genre));
      };

      // M45 — 여기도 순차였다. 최대 세 개의 호출이 서로를 기다릴 이유가 없다:
      // 셋은 **서로 다른 질문**이고, 답이 오는 순서는 화면에 아무 뜻도 없다
      // (순위는 아래에서 평점으로 우리가 다시 매긴다). 폭을 따로 두지 않는 이유는
      // 이 갈래의 호출 수가 애초에 3으로 못박혀 있기 때문이다 (`nearbyPlan`).
      const jobs: Promise<void>[] = [];
      if (plan.includedTypes.length > 0) {
        jobs.push(
          (async () => {
            try {
              const places = await searchNearbyGourmet(maps, center, plan.includedTypes, {
                radius: NEARBY_RADIUS_M,
                maxResultCount: NEARBY_MAX_RESULTS,
              });
              for (const place of places) found.push(googleSpot(place, plan.typedGenres));
            } catch {
              // 타입 이름을 구글이 거절했다(요청 전체가 400으로 떨어진다). 빈
              // 지도 대신 조금 덜 정확한 결과를 보여 준다 — 키워드로 한 계단.
              await Promise.all(nearbyFallbackQueries(plan).map((query) => askKeyword(query)));
            }
          })(),
        );
      }
      for (const query of plan.textQueries) jobs.push(askKeyword(query));

      try {
        await Promise.all(jobs);
      } finally {
        if (runRef.current === token) setSearching(false);
      }

      if (runRef.current !== token) return;

      // 순위는 우리가 정한다: 문턱을 넘은 것만, 평점 높은 순으로, 스물까지.
      const seen = new Set<string>();
      const ranked = found
        .filter((spot) => {
          if (seen.has(spot.key)) return false;
          seen.add(spot.key);
          return typeof spot.googleRating === 'number' && spot.googleRating >= GOURMET_MIN_RATING;
        })
        .sort((a, b) => (b.googleRating ?? 0) - (a.googleRating ?? 0))
        .slice(0, NEARBY_MAX_RESULTS);

      nearbySession.set(key, ranked);
      setLive(ranked);
    },
    [maps, filter, readCenter],
  );

  /* --- 켜고 끄기 ---------------------------------------------------- */

  useEffect(() => {
    if (!active) {
      // 번호를 올리는 것만으로 진행 중이던 모든 줄이 자기 결과를 버린다.
      runRef.current += 1;
      setCurated([]);
      setLive([]);
      setProgress(null);
      setSearching(false);
      setOpenKey(null);
      return;
    }

    runRef.current += 1;
    const token = runRef.current;
    void resolveCurated(token);
    void runNearby(token);
    // 필터가 바뀌었다고 다시 묻지 않는다 — 칩은 **이미 받아 온 것**을 거를 뿐이고,
    // 새 갈래를 켠 사람이 새 결과를 원하면 「이 지역에서 다시 검색」이 있다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  /** 카드 팝업이 열렸다 — 두 장이 같은 자리에 겹치지 않는다. */
  useEffect(() => {
    setOpenKey(null);
  }, [closeToken]);

  /* --- 화면에 세울 목록 ---------------------------------------------- */

  const allSpots = useMemo(() => [...curated, ...live], [curated, live]);
  const spots = useMemo(() => visibleGourmetSpots(allSpots, filter), [allSpots, filter]);

  /* --- 핀 ----------------------------------------------------------- */

  useEffect(() => {
    const clear = () => {
      for (const { marker, element } of markersRef.current) {
        marker.map = null;
        element.remove();
      }
      markersRef.current = [];
    };
    clear();
    if (!active) return;

    for (const spot of spots) {
      const element = createGourmetPinElement({
        emoji: spotEmoji(spot),
        spotKey: spot.key,
        source: spot.source,
        genre: spot.genre ?? OTHER_GENRE,
      });
      element.addEventListener('click', () => {
        onOpenSpot();
        openSpotKey(spot.key);
      });
      const marker = new markerLib.AdvancedMarkerElement({
        map,
        position: { lat: spot.lat, lng: spot.lng },
        content: element,
        title: spot.name,
      });
      markersRef.current.push({ marker, element });
    }

    return clear;
  }, [active, spots, map, markerLib, onOpenSpot, openSpotKey]);

  /** 사라진 곳의 팝업이 남아 있으면 안 된다. */
  useEffect(() => {
    if (openKey && !spots.some((spot) => spot.key === openKey)) setOpenKey(null);
  }, [spots, openKey]);

  const openSpot = spots.find((spot) => spot.key === openKey);

  /* --- 필터 칩 ------------------------------------------------------- */

  const update = (next: GourmetFilter) => setFilter(saveGourmetFilter(next));

  const chipClass = (selected: boolean) => (selected ? CHIP_SELECTED : CHIP_BUTTON);

  /* --- 보드에 카드로 추가 -------------------------------------------- */

  /**
   * 어느 칸에 넣을 것인가 — 🍚 맛집이 있으면 거기, 없으면 🍽️ 식사 (M43 → M49).
   *
   * M49가 계단을 하나 위에 얹었다. 상설 「맛집」 칸이 생겼으므로, 그 칸을 든
   * 여행에서는 **거기가 옳은 자리**다: 방금 지도에서 고른 집은 「가 보고 싶은
   * 집」이고 그 목록이 사는 곳이 맛집 칸이다(그리고 거기 놓여야 ⭐ 층에 뜬다).
   * 판정은 이름이 아니라 **플래그**로 한다 — 사람이 칸 이름을 「먹킷리스트」로
   * 바꿔도 그 칸은 여전히 맛집 칸이다 (`board/gourmetColumn.pickGourmetColumn`).
   *
   * 없으면 M43 그대로다({@link matchColumn}): 정확히 맞는 이름 → 느슨하게 걸치는
   * 이름 → 그래도 없으면 **첫 칸**. 잘못된 칸에 놓인 카드는 2초짜리 드래그지만,
   * 만들어지지 않은 카드는 막다른 길이다.
   */
  const addToBoard = (spot: GourmetSpot) => {
    if (!activeTripId) return;
    const columns = (workspace.trips[activeTripId]?.columnOrder ?? [])
      .map((columnId) => workspace.columns[columnId])
      .filter((column): column is BoardColumn => Boolean(column));
    const column = pickGourmetColumn(columns) ?? matchColumn(columns, '식사');
    if (!column) return;

    addCard(activeTripId, column.id, {
      title: spot.name,
      memo: cardMemoLine(spot),
      location: {
        lat: spot.lat,
        lng: spot.lng,
        ...(spot.address ? { address: spot.address } : {}),
      },
    });
    notify(`「${column.name}」에 카드로 담았어요`);
    setOpenKey(null);
  };

  /* --- 화면 --------------------------------------------------------- */

  const total = allSpots.length;

  return (
    <>
      {/* 토글은 「내 위치」와 같은 크기·같은 테두리로, 지도의 **반대쪽** 위에
          선다. 오른쪽 줄에는 이미 「내 위치」와 그 아래 안내 한 줄이 서므로,
          같은 열에 얹으면 위치 오류가 뜬 순간 두 컨트롤이 겹친다. */}
      <button
        type="button"
        data-testid="gourmet-toggle"
        data-active={active}
        aria-pressed={active}
        aria-label="주변 맛집"
        title="주변 맛집"
        // 층을 **켜는 것**도 패널을 펼치는 일이다 (M50): 이 층이 펼친 채로
        // 나타나면 ⭐ 층은 알약으로 물러난다. 접힌 채로 켜지는 경우에는 자리를
        // 다투지 않으므로 남의 패널을 건드리지 않는다.
        onClick={() => {
          if (!active && !panelCollapsed) claimMapPanel('gourmet');
          setActive((current) => !current);
        }}
        // 전체화면에서는 노치 아래로 (M50) — `--map-safe-top`은 지도 상자가 심는다.
        style={{ top: 'calc(var(--map-safe-top, 0px) + 5.5rem)' }}
        className={[
          'absolute left-2.5 z-[1100] grid h-11 w-11 place-items-center',
          'rounded-full border bg-surface/95 shadow-raise',
          'transition-colors duration-[140ms] ease-quick',
          active ? 'border-ink text-ink' : 'border-line text-ink-muted hover:text-ink',
        ].join(' ')}
      >
        <span aria-hidden="true" style={{ fontSize: 18, lineHeight: 1 }}>
          🍜
        </span>
      </button>

      {/* 필터 패널은 두 둥근 버튼(「내 위치」·이 토글) **아래**에서 시작한다 —
          같은 높이에 두면 z-index가 더 높은 버튼들이 패널 위에 떠서 겹친다.
          그리고 맛집 팝업이 열리면 물러난다: 390px에서 둘을 세로로 나란히
          세울 자리가 없고, 한 집을 읽는 동안 칩 열한 개가 필요하지도 않다. */}
      {/* 접힌 패널 (M45) — 요약 한 줄짜리 알약. 펼친 패널과 **같은** testid를
          쓴다: 화면에 서 있는 것은 언제나 「그 패널」 하나이고, 접혀 있는지는
          속성 하나가 말한다. 자리도 같은 자리에서 시작한다(둥근 버튼 둘 아래). */}
      {active && !openSpot && panelCollapsed ? (
        <div
          data-testid="gourmet-panel"
          data-collapsed="true"
          data-spot-count={spots.length}
          style={{ top: 'calc(var(--map-safe-top, 0px) + 12.25rem)' }}
          className="absolute left-2 right-2 z-[1050] flex flex-col items-start gap-1"
        >
          <button
            type="button"
            data-testid="gourmet-panel-toggle"
            data-collapsed="true"
            aria-expanded={false}
            aria-label={`주변 맛집 ${spots.length}곳 — 필터 펼치기`}
            onClick={expandPanel}
            className="inline-flex h-9 max-w-full items-center gap-1 rounded-full bg-surface/97 px-3 text-label text-ink shadow-float transition-colors duration-[140ms] ease-quick hover:bg-surface"
          >
            <span aria-hidden="true">🍜</span>
            <span className="min-w-0 truncate">주변 맛집 {spots.length}곳</span>
            <Icon name="chevron-down" size={16} className="text-ink-faint" />
          </button>
          {/* 접혀 있어도 진행은 말한다 — 「왜 아직 핀이 안 뜨나」의 답이다. */}
          {progress ? (
            <p
              data-testid="gourmet-progress"
              className="max-w-full truncate rounded-full bg-surface/97 px-3 py-0.5 text-micro font-normal text-ink-muted shadow-raise"
            >
              {progressLabel(progress.done, progress.total)}
            </p>
          ) : null}
        </div>
      ) : null}

      {active && !openSpot && !panelCollapsed ? (
        <div
          data-testid="gourmet-panel"
          data-collapsed="false"
          data-spot-count={spots.length}
          // 높이는 **지도 상자의 실높이**에서 계산한다 (M50, 헌터B #1).
          //
          // 예전의 `max-h-[55%]`는 상자의 55%였을 뿐, 이 패널이 상자 위쪽
          // 12.25rem을 이미 비우고 시작한다는 사실을 몰랐다. 그래서 325px짜리
          // 폰 지도에서 패널의 아래끝이 상자 밖으로 49px 튀어나가 아래쪽 ⭐
          // 패널을 121px 덮었다. 이제 남은 자리(100% − 시작점 − 아래쪽 알약
          // 자리)만 쓰고, 넘치는 내용은 안에서 스크롤한다.
          style={{
            top: 'calc(var(--map-safe-top, 0px) + 12.25rem)',
            maxHeight: 'calc(100% - var(--map-safe-top, 0px) - 15.5rem)',
          }}
          className="absolute inset-x-2 z-[1050] space-y-2 overflow-y-auto rounded-lg bg-surface/97 p-3 shadow-float"
        >
          <div className="flex items-center gap-2">
            <p className="min-w-0 flex-1 truncate text-label text-ink">
              주변 맛집 {spots.length}곳
            </p>
            <button
              type="button"
              data-testid="gourmet-research"
              disabled={searching}
              onClick={() => void runNearby(runRef.current, true)}
              className={`${withBtnSize(SECONDARY_BUTTON_CLASS, BTN_SIZE_SM)} shrink-0`}
            >
              <Icon name="search" size={16} />
              {searching ? '검색 중…' : '이 지역에서 다시 검색'}
            </button>
            <button
              type="button"
              data-testid="gourmet-panel-toggle"
              data-collapsed="false"
              aria-expanded={true}
              aria-label="필터 접기"
              title="필터 접기"
              onClick={() => setPanelCollapsed(saveGourmetPanelCollapsed(true))}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-ink-faint transition-colors duration-[140ms] ease-quick hover:bg-sunken hover:text-ink"
            >
              <Icon name="chevron-up" size={16} />
            </button>
          </div>

          {progress ? (
            <p data-testid="gourmet-progress" className="text-micro font-normal text-ink-muted">
              {progressLabel(progress.done, progress.total)}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-1">
            {GOURMET_GENRES.map((genre) => {
              const selected = filter.genres.includes(genre);
              return (
                <button
                  key={genre}
                  type="button"
                  data-testid="gourmet-genre-chip"
                  data-genre={genre}
                  data-active={selected}
                  aria-pressed={selected}
                  onClick={() => update({ ...filter, genres: toggleGenre(filter.genres, genre) })}
                  className={chipClass(selected)}
                >
                  <span aria-hidden="true">{GENRE_EMOJI[genre]}</span>
                  {GENRE_LABEL[genre]}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-1">
            <span className="text-micro font-normal text-ink-faint">예약</span>
            {(
              [
                ['all', '전체'],
                ['yes', '가능'],
                ['no', '불가'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                data-testid="gourmet-reservable-chip"
                data-value={value}
                data-active={filter.reservable === value}
                aria-pressed={filter.reservable === value}
                onClick={() => update({ ...filter, reservable: value })}
                className={chipClass(filter.reservable === value)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-1">
            <span className="text-micro font-normal text-ink-faint">소스</span>
            {(
              [
                ['all', '전체'],
                ['curated', '큐레이션'],
                ['google', '구글'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                data-testid="gourmet-source-chip"
                data-value={value}
                data-active={filter.source === value}
                aria-pressed={filter.source === value}
                onClick={() => update({ ...filter, source: value })}
                className={chipClass(filter.source === value)}
              >
                {label}
              </button>
            ))}
          </div>

          {spots.length === 0 && !progress && !searching ? (
            <p data-testid="gourmet-empty" className="text-label font-normal text-ink-muted">
              {emptyGourmetHint(total)}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* 핀 하나를 눌렀을 때 아래에서 올라오는 한 장 — 카드 팝업(`gmap-popup`)과
          같은 자리, 같은 옷. 다른 것은 담긴 사실뿐이다. */}
      {active && openSpot ? (
        <div
          data-testid="gourmet-popup"
          data-spot-key={openSpot.key}
          data-source={openSpot.source}
          // z가 1160인 이유 (M49): 지도 아래쪽에 ⭐ 층의 패널(z-1050)이 설 수
          // 있게 되면서, 팝업이 패널 뒤로 숨는 일이 없도록 카드 팝업(1150) 바로
          // 위로 올렸다. 서는 자리는 그대로 화면 아래 두 칸이다.
          //
          // M50 — 두 층의 팝업은 이제 서로를 닫으므로 겹칠 일이 없지만, 그래도
          // **방금 연 쪽**이 한 칸 위에 선다 (`mapPopupZ`): 닫기가 한 프레임
          // 늦어도 사람이 누른 것이 밑에 깔리지는 않는다 (헌터B #2).
          style={{ zIndex: mapPopupZ('gourmet') }}
          className="absolute inset-x-2 bottom-2 space-y-3 rounded-lg bg-surface/97 p-4 shadow-float"
        >
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-title text-ink">{openSpot.name}</p>
              <p className="mt-1 text-label font-normal text-ink-muted">
                {genreAreaLine(openSpot)}
              </p>
              <p
                data-testid="gourmet-popup-rating"
                className="mt-1 text-label font-normal text-ink"
              >
                {ratingLine(openSpot)}
              </p>
              <p
                data-testid="gourmet-popup-reservable"
                className="mt-0.5 text-label font-normal text-ink-muted"
              >
                {reservableLine(openSpot)}
              </p>
              {openSpot.note ? (
                <p className="mt-1 line-clamp-2 text-label font-normal text-ink-muted">
                  {openSpot.note}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              data-testid="gourmet-popup-close"
              aria-label="닫기"
              onClick={() => setOpenKey(null)}
              className="-mr-1 -mt-1 grid h-9 w-9 shrink-0 place-items-center rounded-full text-ink-faint transition-colors duration-[140ms] ease-quick hover:bg-sunken hover:text-ink"
            >
              <Icon name="close" size={20} />
            </button>
          </div>

          <div className="flex flex-col gap-1">
            <button
              type="button"
              data-testid="gourmet-popup-add"
              onClick={() => addToBoard(openSpot)}
              className={`${PRIMARY_BUTTON_CLASS} w-full`}
            >
              보드에 카드로 추가
            </button>
            {/* 사용자가 가장 자주 묻는 것은 「여기 어떤 집이지」다 — 사진·영업
                시간·리뷰는 구글 지도 앱이 이미 잘한다 (M43). */}
            {(() => {
              const href = placePageUrl(
                openSpot.localName ?? openSpot.name,
                openSpot,
                openSpot.placeId,
              );
              return href ? (
                <a
                  data-testid="gourmet-popup-place"
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`${SECONDARY_BUTTON_CLASS} w-full`}
                >
                  <Icon name="map" size={16} />
                  {PLACE_PAGE_LABEL}
                </a>
              ) : null;
            })()}
            {(() => {
              const href = directionsUrl(openSpot);
              return href ? (
                <a
                  data-testid="gourmet-popup-directions"
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
          </div>
        </div>
      ) : null}
    </>
  );
}
