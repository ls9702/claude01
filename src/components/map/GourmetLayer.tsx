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
import { loadGourmetFilter, saveGourmetFilter } from '../../stores/gourmetPref';
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
  const [curated, setCurated] = useState<GourmetSpot[]>([]);
  const [live, setLive] = useState<GourmetSpot[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [searching, setSearching] = useState(false);
  const [openKey, setOpenKey] = useState<string | null>(null);

  const markersRef = useRef<{ marker: GoogleMarker; element: HTMLElement }[]>([]);
  /**
   * 지금 살아 있는 활성화의 번호.
   *
   * 끄거나 다시 켜면 올라간다. 진행 중이던 순차 조회는 답이 올 때마다 이 값을
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
      setProgress({ done: 0, total: pending.length });

      // **순차**로. 마흔 집을 동시에 던지면 구글은 받아 주지만 사용자의 폰이
      // 먼저 넘어간다 — 그리고 취소도 불가능해진다.
      for (let index = 0; index < pending.length; index += 1) {
        const entry = pending[index];
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
        setProgress({ done: index + 1, total: pending.length });
      }

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

      try {
        if (plan.includedTypes.length > 0) {
          try {
            const places = await searchNearbyGourmet(maps, center, plan.includedTypes, {
              radius: NEARBY_RADIUS_M,
              maxResultCount: NEARBY_MAX_RESULTS,
            });
            for (const place of places) found.push(googleSpot(place, plan.typedGenres));
          } catch {
            // 타입 이름을 구글이 거절했다(요청 전체가 400으로 떨어진다). 빈
            // 지도 대신 조금 덜 정확한 결과를 보여 준다 — 키워드로 한 계단.
            for (const query of nearbyFallbackQueries(plan)) await askKeyword(query);
          }
        }
        for (const query of plan.textQueries) await askKeyword(query);
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
        setOpenKey(spot.key);
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
  }, [active, spots, map, markerLib, onOpenSpot]);

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
   * 어느 칸에 넣을 것인가 — 🍽️ 식사.
   *
   * 이름으로 찾는다({@link matchColumn}): 새 여행은 「식사」 칸을 달고 태어나지만
   * (`SEED_COLUMNS`) 사용자가 이름을 바꿨을 수도, 지웠을 수도 있다. 정확히 맞는
   * 이름 → 느슨하게 걸치는 이름 → 그래도 없으면 **첫 칸**. 잘못된 칸에 놓인
   * 카드는 2초짜리 드래그지만, 만들어지지 않은 카드는 막다른 길이다.
   */
  const addToBoard = (spot: GourmetSpot) => {
    if (!activeTripId) return;
    const columns = (workspace.trips[activeTripId]?.columnOrder ?? [])
      .map((columnId) => workspace.columns[columnId])
      .filter((column): column is BoardColumn => Boolean(column));
    const column = matchColumn(columns, '식사');
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
        onClick={() => setActive((current) => !current)}
        className={[
          'absolute left-2.5 top-[5.5rem] z-[1100] grid h-11 w-11 place-items-center',
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
      {active && !openSpot ? (
        <div
          data-testid="gourmet-panel"
          data-spot-count={spots.length}
          className="absolute inset-x-2 top-[9.5rem] z-[1050] max-h-[55%] space-y-2 overflow-y-auto rounded-lg bg-surface/97 p-3 shadow-float"
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
          className="absolute inset-x-2 bottom-2 z-20 space-y-3 rounded-lg bg-surface/97 p-4 shadow-float"
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
