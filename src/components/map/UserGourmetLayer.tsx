import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DIRECTIONS_LABEL, directionsUrl } from '../../map/directions';
import {
  NO_GENRE_EMOJI,
  NO_GENRE_LABEL,
  USER_GENRE_EMOJI,
  USER_GENRE_LABEL,
  USER_GOURMET_GENRES,
  toggleUserGenre,
  userGenreLabel,
} from '../../gourmet/userGenres';
import {
  emptyUserGourmetHint,
  missingLocationLine,
  userGenreCounts,
  userGourmetSpots,
  visibleUserSpots,
  type UserGourmetFilter,
  type UserGourmetSpot,
} from '../../gourmet/userSpots';
import {
  loadUserGourmetFilter,
  loadUserGourmetPanelCollapsed,
  saveUserGourmetFilter,
  saveUserGourmetPanelCollapsed,
} from '../../stores/userGourmetPref';
import type { Id, Workspace } from '../../types/models';
import {
  claimMapPanel,
  claimMapPopup,
  mapPopupZ,
  registerMapPanel,
  registerMapPopup,
} from './mapLayerSlots';
import Icon from '../common/Icon';
import {
  CHIP_BUTTON,
  CHIP_SELECTED,
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
} from '../common/formStyles';

/**
 * 「우리 맛집」 레이어 — **두 지도 엔진 모두**에 서는 참고 층 (M49).
 *
 * ## M43과 무엇이 다른가
 *
 * 「주변 맛집」(🍜)은 구글 Places가 원천이라 구글 시트에만 살 수 있었다 — 그
 * 규칙을 조건문이 아니라 **사는 자리**로 지켰다(레이어가 `GoogleMapView` 안에
 * 산다). 이 층은 반대다: 원천이 **우리 워크스페이스의 카드**라 물어볼 곳이 없고,
 * 그래서 OSM 시트에서도 똑같이 뜬다. 그래서 이 파일은 어느 엔진에도 속하지 않고
 * `MapView`의 오버레이로 산다 — 「내 위치」가 두 엔진에서 같은 버튼인 것과 같은
 * 자리, 같은 이유다.
 *
 * 핀을 **그리는 일**만 엔진이 갈린다(Leaflet은 `divIcon`, 구글은 요소). 무엇을
 * 그릴지는 여기 한 곳에서 정하므로 두 지도가 다른 답을 말할 수 없다.
 *
 * ## 배치를 묻지 않는다
 *
 * 맛집 칸의 **위치 있는 카드 전부**가 뜬다. M27의 범위 필터(일정 전체·일자별)는
 * 카드 핀의 규칙이고, 이 목록은 대부분 아직 어느 날에도 안 넣은 후보다 — 그것을
 * 보려고 만든 층에 「일정에 넣은 것만」이라는 문을 달면 층 자체가 비어 버린다.
 *
 * 끄면 통째로 사라진다(M43의 그 철학): 핀도, 패널도, 팝업도.
 */

/* ------------------------------------------------------------------ *
 * 상태 — 두 엔진이 나눠 쓰는 하나
 * ------------------------------------------------------------------ */

export interface UserGourmetState {
  active: boolean;
  toggle: () => void;
  /** 필터를 통과해 지금 지도에 서는 것들. */
  spots: UserGourmetSpot[];
  /** 위치가 있는 맛집 카드 전부의 수 — 필터 이전. */
  total: number;
  /** 위치가 없어 핀이 될 수 없는 카드 수. */
  missing: number;
  filter: UserGourmetFilter;
  setFilter: (next: UserGourmetFilter) => void;
  collapsed: boolean;
  setCollapsed: (next: boolean) => void;
  /** 팝업이 열린 카드. */
  openCardId: Id | null;
  open: (cardId: Id) => void;
  close: () => void;
  openSpot: UserGourmetSpot | undefined;
}

/**
 * 이 여행의 맛집 목록과 레이어의 켜짐/필터/팝업 상태 (기기별 기억 포함).
 *
 * 레이어를 켠 상태는 기억하지 않는다 — 이유는 `stores/userGourmetPref.ts`.
 */
export function useUserGourmetLayer(
  workspace: Workspace,
  tripId: Id | undefined,
): UserGourmetState {
  const [active, setActive] = useState(false);
  const [filter, setFilterState] = useState<UserGourmetFilter>(() => loadUserGourmetFilter());
  const [collapsed, setCollapsedState] = useState<boolean>(() =>
    loadUserGourmetPanelCollapsed(),
  );
  const [openCardId, setOpenCardId] = useState<Id | null>(null);

  const set = useMemo(() => userGourmetSpots(workspace, tripId), [workspace, tripId]);
  const spots = useMemo(() => visibleUserSpots(set.spots, filter), [set.spots, filter]);

  // 여행을 바꾸면 레이어는 꺼진 채로 시작한다 — 앞 여행의 맛집 핀이 다음 여행의
  // 지도에 남아 있을 수는 없고, 켜 둔 상태를 물려주는 것도 기억하지 않는다는
  // 규칙과 어긋난다.
  useEffect(() => {
    setActive(false);
    setOpenCardId(null);
  }, [tripId]);

  // 꺼지면 팝업도 닫힌다. 그리고 사라진 곳(필터가 걸렀거나 카드가 지워졌다)의
  // 팝업이 화면에 남아 있어서도 안 된다.
  useEffect(() => {
    if (!active) {
      setOpenCardId(null);
      return;
    }
    if (openCardId && !spots.some((spot) => spot.cardId === openCardId)) setOpenCardId(null);
  }, [active, spots, openCardId]);

  const setFilter = useCallback((next: UserGourmetFilter) => {
    setFilterState(saveUserGourmetFilter(next));
  }, []);

  /**
   * 펼칠 때는 🍜 층의 패널을 먼저 접는다 (M50, `mapLayerSlots.ts`).
   *
   * 폰 지도 상자는 두 패널을 세로로 세울 만큼 높지 않다 — 「위/아래로 나눠
   * 놓았으니 안 겹친다」는 규약이 360×640에서 121px 겹침으로 무너졌다
   * (헌터B #1). 크게 펼쳐진 패널이 언제나 하나뿐이면 남은 자리는 계산 가능한
   * 상수가 되고, 아래 `max-h`가 그 계산이다.
   */
  const setCollapsed = useCallback((next: boolean) => {
    if (!next) claimMapPanel('usergourmet');
    setCollapsedState(saveUserGourmetPanelCollapsed(next));
  }, []);

  // 🍜 층이 이 패널을 접고 이 팝업을 닫을 수 있게 등록한다.
  useEffect(
    () =>
      registerMapPanel('usergourmet', () =>
        setCollapsedState(saveUserGourmetPanelCollapsed(true)),
      ),
    [],
  );
  useEffect(() => registerMapPopup('usergourmet', () => setOpenCardId(null)), []);

  /**
   * 이 셋의 **신원이 고정**이어야 한다.
   *
   * `open`은 구글 갈래의 마커 효과가 의존성으로 든다(`GoogleMapView`). 렌더마다
   * 새 함수를 주면 그 효과가 매번 다시 돌아 맛집 마커를 지웠다 다시 붙이고,
   * 화면에서는 그것이 깜빡임으로 보인다.
   *
   * M50 — `toggle`은 켜는 순간 🍜 층의 패널을 접어야 하므로 최신 `active`·
   * `collapsed`를 알아야 하는데, 그 둘을 의존성에 넣으면 위의 규칙이 깨진다.
   * 그래서 값은 ref로 읽는다: 신원은 고정이고, 읽는 것은 늘 지금 값이다.
   */
  const activeRef = useRef(active);
  activeRef.current = active;
  const collapsedRef = useRef(collapsed);
  collapsedRef.current = collapsed;

  const toggle = useCallback(() => {
    if (!activeRef.current && !collapsedRef.current) claimMapPanel('usergourmet');
    setActive((current) => !current);
  }, []);
  const open = useCallback((cardId: Id) => {
    // 한 층의 말풍선이 열리면 다른 층의 것은 닫힌다 (M50, 헌터B #2).
    claimMapPopup('usergourmet');
    setOpenCardId(cardId);
  }, []);
  const close = useCallback(() => setOpenCardId(null), []);

  return {
    active,
    toggle,
    spots,
    total: set.spots.length,
    missing: set.missing,
    filter,
    setFilter,
    collapsed,
    setCollapsed,
    openCardId,
    open,
    close,
    openSpot: spots.find((spot) => spot.cardId === openCardId),
  };
}

/* ------------------------------------------------------------------ *
 * 토글 버튼
 * ------------------------------------------------------------------ */

interface ToggleProps {
  state: UserGourmetState;
  /**
   * 왼쪽 줄에서 이 버튼이 설 높이.
   *
   * 구글 시트에는 그 위에 🍜(M43)이 서 있으므로 한 칸 아래다. OSM 시트에는 🍜이
   * 아예 없으니 그 자리를 그대로 쓴다 — 빈 칸을 남겨 두면 「저기 뭔가 사라졌나」가
   * 된다.
   */
  top: string;
}

export function UserGourmetToggle({ state, top }: ToggleProps) {
  return (
    <button
      type="button"
      data-testid="usergourmet-toggle"
      data-active={state.active}
      aria-pressed={state.active}
      aria-label="내 맛집"
      title="내 맛집"
      onClick={state.toggle}
      // 전체화면에서는 노치 아래로 (M50) — `--map-safe-top`은 지도 상자가 심는다.
      style={{ top: `calc(var(--map-safe-top, 0px) + ${top})` }}
      className={[
        'absolute left-2.5 z-[1100] grid h-11 w-11 place-items-center',
        'rounded-full border bg-surface/95 shadow-raise',
        'transition-colors duration-[140ms] ease-quick',
        state.active ? 'border-ink text-ink' : 'border-line text-ink-muted hover:text-ink',
      ].join(' ')}
    >
      <span aria-hidden="true" style={{ fontSize: 18, lineHeight: 1 }}>
        ⭐
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------ *
 * 필터 패널
 * ------------------------------------------------------------------ */

/**
 * 장르 칩 패널 — 지도의 **아래쪽**에 선다.
 *
 * 위쪽 왼편은 이미 세 칸(전체화면·🍜·⭐)이 쓰고 있고, M43의 패널이 그 아래
 * 자리를 통째로 쓴다. 390px에서 두 패널을 세로로 나란히 세울 자리는 없다 —
 * 그래서 이 패널은 반대편 끝에 산다. 두 층을 동시에 켜도 패널이 겹치지 않는
 * 유일한 배치이고, 팝업이 열리면(위든 아래든) 팝업이 이긴다.
 */
export function UserGourmetPanel({ state }: { state: UserGourmetState }) {
  if (!state.active || state.openSpot) return null;

  const counts = userGenreCounts(state.spots);
  const missingLine = missingLocationLine(state.missing);
  const hint = emptyUserGourmetHint(state.total, state.missing, state.spots.length);

  if (state.collapsed) {
    return (
      <div
        data-testid="usergourmet-panel"
        data-collapsed="true"
        data-spot-count={state.spots.length}
        className="absolute inset-x-2 bottom-2 z-[1050] flex flex-col items-start gap-1"
      >
        <button
          type="button"
          data-testid="usergourmet-panel-toggle"
          data-collapsed="true"
          aria-expanded={false}
          aria-label={`내 맛집 ${state.spots.length}곳 — 장르 펼치기`}
          onClick={() => state.setCollapsed(false)}
          className="inline-flex h-9 max-w-full items-center gap-1 rounded-full bg-surface/97 px-3 text-label text-ink shadow-float transition-colors duration-[140ms] ease-quick hover:bg-surface"
        >
          <span aria-hidden="true">⭐</span>
          <span className="min-w-0 truncate">내 맛집 {state.spots.length}곳</span>
          <Icon name="chevron-up" size={16} className="text-ink-faint" />
        </button>
      </div>
    );
  }

  const chip = (selected: boolean) => (selected ? CHIP_SELECTED : CHIP_BUTTON);

  return (
    <div
      data-testid="usergourmet-panel"
      data-collapsed="false"
      data-spot-count={state.spots.length}
      // 🍜 패널과 같은 계산 (M50): 이 패널이 위로 자랄 수 있는 끝은 🍜 층이
      // 접혀 서 있는 알약의 아래다 — 상자 위 12.25rem에서 시작하는 그 알약
      // 높이(2.25rem)와 사이 여백을 뺀 만큼. 예전의 `45%`는 상자의 절반 가까이를
      // 무조건 차지해 위쪽 패널과 포개졌다.
      style={{ maxHeight: 'calc(100% - var(--map-safe-top, 0px) - 15rem)' }}
      className="absolute inset-x-2 bottom-2 z-[1050] space-y-2 overflow-y-auto rounded-lg bg-surface/97 p-3 shadow-float"
    >
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 truncate text-label text-ink">
          내 맛집 {state.spots.length}곳
        </p>
        <button
          type="button"
          data-testid="usergourmet-panel-toggle"
          data-collapsed="false"
          aria-expanded={true}
          aria-label="장르 접기"
          title="장르 접기"
          onClick={() => state.setCollapsed(true)}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-ink-faint transition-colors duration-[140ms] ease-quick hover:bg-sunken hover:text-ink"
        >
          <Icon name="chevron-down" size={16} />
        </button>
      </div>

      <div className="flex flex-wrap gap-1">
        {USER_GOURMET_GENRES.map((genre) => {
          const selected = state.filter.genres.includes(genre);
          return (
            <button
              key={genre}
              type="button"
              data-testid="usergourmet-genre-chip"
              data-genre={genre}
              data-active={selected}
              data-count={counts.get(genre) ?? 0}
              aria-pressed={selected}
              onClick={() =>
                state.setFilter({
                  ...state.filter,
                  genres: toggleUserGenre(state.filter.genres, genre),
                })
              }
              className={chip(selected)}
            >
              <span aria-hidden="true">{USER_GENRE_EMOJI[genre]}</span>
              {USER_GENRE_LABEL[genre]}
            </button>
          );
        })}
        {/* 「장르 없음」은 아홉 번째 갈래가 아니라 **포함 여부**다 — 그래서 켜짐이
            기본이고, 여덟 칩과 달리 끄는 쪽이 선택이다. */}
        <button
          type="button"
          data-testid="usergourmet-none-chip"
          data-active={state.filter.includeNone}
          data-count={counts.get(null) ?? 0}
          aria-pressed={state.filter.includeNone}
          onClick={() =>
            state.setFilter({ ...state.filter, includeNone: !state.filter.includeNone })
          }
          className={chip(state.filter.includeNone)}
        >
          <span aria-hidden="true">{NO_GENRE_EMOJI}</span>
          {NO_GENRE_LABEL}
        </button>
      </div>

      {/* 핀을 세울 수 없는 카드는 한 줄로만 말한다 (M49) — 지도가 못 하는 일을
          지도 위에서 길게 설명하지 않는다. 고치는 자리는 보드의 카드 편집이다. */}
      {missingLine ? (
        <p
          data-testid="usergourmet-missing"
          data-count={state.missing}
          className="text-micro font-normal text-ink-faint"
        >
          {missingLine} · 카드에 위치를 넣으면 지도에 떠요
        </p>
      ) : null}

      {hint ? (
        <p data-testid="usergourmet-empty" className="text-label font-normal text-ink-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 핀 팝업
 * ------------------------------------------------------------------ */

interface PopupProps {
  state: UserGourmetState;
  /** 「보드에서 편집」 — 카드 핀 팝업이 쓰는 그 길 그대로. */
  onEdit: (cardId: Id) => void;
}

/**
 * 한 곳을 눌렀을 때 아래에서 올라오는 한 장.
 *
 * **두 엔진이 같은 팝업을 쓴다.** Leaflet의 네이티브 `Popup`을 쓰지 않는 이유가
 * 여기 있다: 그쪽을 쓰면 OSM에서는 핀 위에 말풍선이, 구글에서는 아래에서 카드가
 * 올라와 같은 곳이 두 얼굴을 갖게 된다. 구글 쪽 카드 팝업이 이미 이 모양이므로
 * (`gmap-popup`), 새 층은 그 모양을 따른다.
 */
export function UserGourmetPopup({ state, onEdit }: PopupProps) {
  const spot = state.openSpot;
  if (!state.active || !spot) return null;

  const href = directionsUrl({ lat: spot.lat, lng: spot.lng });

  return (
    <div
      data-testid="usergourmet-popup"
      data-card-id={spot.cardId}
      data-genre={spot.genre ?? 'none'}
      // M50 — 고정 1200을 버리고 두 층이 같은 눈금을 쓴다 (`mapPopupZ`).
      // 1200은 「내가 늘 위」라는 선언이라, 🍜 팝업을 눌러 연 사람에게도 이
      // 말풍선이 위에 얹혔다 (헌터B #2). 이제 방금 연 쪽이 위에 선다.
      style={{ zIndex: mapPopupZ('usergourmet') }}
      className="absolute inset-x-2 bottom-2 space-y-3 rounded-lg bg-surface/97 p-4 shadow-float"
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-title text-ink">
            <span aria-hidden="true">{spot.emoji}</span> {spot.title}
          </p>
          <p
            data-testid="usergourmet-popup-genre"
            className="mt-1 text-label font-normal text-ink-muted"
          >
            {userGenreLabel(spot.genre)}
            {spot.address ? ` · ${spot.address}` : ''}
          </p>
          {spot.memo ? (
            <p className="mt-1 line-clamp-2 text-label font-normal text-ink-muted">
              {spot.memo}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          data-testid="usergourmet-popup-close"
          aria-label="닫기"
          onClick={state.close}
          className="-mr-1 -mt-1 grid h-9 w-9 shrink-0 place-items-center rounded-full text-ink-faint transition-colors duration-[140ms] ease-quick hover:bg-sunken hover:text-ink"
        >
          <Icon name="close" size={20} />
        </button>
      </div>

      <div className="flex flex-col gap-1">
        <button
          type="button"
          data-testid="usergourmet-popup-edit"
          onClick={() => onEdit(spot.cardId)}
          className={`${PRIMARY_BUTTON_CLASS} w-full`}
        >
          보드에서 편집
        </button>
        {href ? (
          <a
            data-testid="usergourmet-popup-directions"
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className={`${SECONDARY_BUTTON_CLASS} w-full`}
          >
            <Icon name="route" size={16} />
            {DIRECTIONS_LABEL}
          </a>
        ) : null}
      </div>
    </div>
  );
}
