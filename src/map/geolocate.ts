/**
 * 「내 위치」 — 지도 위의 파란 점 (M42).
 *
 * 여행지에서 지도를 여는 사람이 제일 먼저 묻는 것은 「내가 지금 어디지」다. 그
 * 답은 브라우저가 이미 알고 있고(`navigator.geolocation`), 이 파일이 하는 일은
 * 그 답을 **켜고 끄는 규칙**을 순수한 상태 기계 하나로 못박는 것이다.
 *
 * ## 규칙
 *
 * - 처음 누르면 권한을 묻고(브라우저가), 좌표가 오면 파란 점이 서고 지도가 그리로
 *   한 번 이동한다. 그 뒤의 갱신은 점만 따라 움직인다 — 지도를 손으로 옮겨 놓은
 *   사람을 GPS가 매초 끌고 오면 그건 도움이 아니라 방해다.
 * - 다시 누르면 점이 사라지고 감시(watch)가 멈춘다.
 * - 거절·불가·시간초과는 **한 줄**로 말한다. 모달도, 다시 시도 버튼도 없다 —
 *   사용자가 방금 스스로 거절한 것을 앱이 되묻는 화면이 되면 안 된다.
 * - 탭이 숨으면 감시를 멈추고, 돌아오면 켜져 있던 경우에만 다시 켠다. GPS는
 *   배터리를 먹는다. 화면을 안 보는 동안에도 켜 두는 것은 그냥 손해다.
 *
 * 상태 기계가 순수한 덕분에 이 규칙들은 브라우저 없이 단위 테스트로 확인된다.
 * React가 하는 일은 아래 훅 하나 — `watchPosition`을 걸고 떼는 것뿐이다.
 */

import { useCallback, useEffect, useReducer } from 'react';

/**
 * 파란 점과 그 정확도 원의 색.
 *
 * 두 렌더러(Leaflet·구글)가 이 한 값을 나눠 쓴다 — 「나」가 지도마다 다른 색이면
 * 그건 두 개의 앱이다. 카테고리 팔레트의 어느 색도 아닌 지도 앱 공통의 파랑인
 * 것도 일부러다: 이 점은 계획이 아니라 사실이다.
 */
export const MY_LOCATION_HEX = '#1d4ed8';

/** 브라우저가 알려 준 한 자리. */
export interface GeoFix {
  lat: number;
  lng: number;
  /** 정확도 반경(m) — 파란 점을 감싸는 옅은 원. */
  accuracyM: number;
}

/** 지금 이 기능이 서 있는 자리. */
export type GeoStatus = 'off' | 'locating' | 'active' | 'error';

export interface GeoState {
  status: GeoStatus;
  /** 마지막으로 받은 좌표. 꺼져 있으면 `null`. */
  fix: GeoFix | null;
  /** 화면에 뜨는 한 줄. 문제가 없으면 `null`. */
  message: string | null;
  /** 탭이 숨어 감시만 멈춘 상태 — 점은 그대로 있다. */
  suspended: boolean;
  /**
   * 켠 횟수. 지도를 **한 번만** 이동시키기 위한 열쇠다: 이 값이 바뀐 뒤 처음
   * 오는 좌표에서만 화면이 움직인다.
   */
  session: number;
}

export type GeoEvent =
  | { kind: 'start' }
  | { kind: 'stop' }
  /** 버튼 한 번 — 켜져 있으면 끄고, 아니면 켠다. */
  | { kind: 'toggle' }
  | { kind: 'fix'; fix: GeoFix }
  | { kind: 'error'; code: number }
  | { kind: 'unsupported' }
  | { kind: 'hide' }
  | { kind: 'show' };

/** 권한을 거절당했다. */
export const GEO_DENIED_MESSAGE = '위치 권한이 꺼져 있어요';
/** 기기가 지금은 위치를 모른다. */
export const GEO_UNAVAILABLE_MESSAGE = '지금은 위치를 찾을 수 없어요';
/** 오래 기다렸는데 답이 없다. */
export const GEO_TIMEOUT_MESSAGE = '위치를 찾는 데 시간이 걸려요';
/** 이 브라우저에는 그 기능이 없다. */
export const GEO_UNSUPPORTED_MESSAGE = '이 기기에서는 위치를 쓸 수 없어요';

/**
 * `GeolocationPositionError.code` → 한 줄.
 *
 * 숫자를 그대로 쓰는 이유: 상수(`PERMISSION_DENIED`)는 브라우저 전역에만 있고,
 * 이 파일은 브라우저 없이도 돌아야 한다.
 */
export function geoErrorMessage(code: number): string {
  if (code === 1) return GEO_DENIED_MESSAGE;
  if (code === 3) return GEO_TIMEOUT_MESSAGE;
  return GEO_UNAVAILABLE_MESSAGE;
}

/** 아무것도 하지 않는 처음. */
export const initialGeoState: GeoState = {
  status: 'off',
  fix: null,
  message: null,
  suspended: false,
  session: 0,
};

/** 규칙 전부 (순수). */
export function geoReduce(state: GeoState, event: GeoEvent): GeoState {
  switch (event.kind) {
    case 'start':
      // 이미 켜져 있으면 다시 켜지 않는다 — 두 번째 탭은 끄는 동작이고, 그건
      // 호출부가 'stop'으로 보낸다.
      if (state.status === 'locating' || state.status === 'active') return state;
      return {
        status: 'locating',
        fix: null,
        message: null,
        suspended: false,
        session: state.session + 1,
      };

    case 'stop':
      if (state.status === 'off' && state.fix === null && state.message === null) return state;
      return { ...initialGeoState, session: state.session };

    // 한 번 누른 것이 켜기인지 끄기인지는 지금 상태만 보면 안다. 오류로 서 있던
    // 자리에서 다시 누르는 것은 「그래도 한 번 더」이므로 켜기다.
    case 'toggle':
      return geoReduce(state, { kind: geoOn(state) ? 'stop' : 'start' });

    case 'fix':
      // 꺼져 있는 동안 늦게 도착한 좌표는 버린다 — 껐는데 점이 뜨면 안 된다.
      if (state.status === 'off' || state.status === 'error') return state;
      return { ...state, status: 'active', fix: event.fix, message: null };

    case 'error':
      if (state.status === 'off') return state;
      return {
        status: 'error',
        fix: null,
        message: geoErrorMessage(event.code),
        suspended: false,
        session: state.session,
      };

    case 'unsupported':
      return {
        status: 'error',
        fix: null,
        message: GEO_UNSUPPORTED_MESSAGE,
        suspended: false,
        session: state.session,
      };

    case 'hide':
      if (state.status !== 'locating' && state.status !== 'active') return state;
      if (state.suspended) return state;
      return { ...state, suspended: true };

    case 'show':
      if (!state.suspended) return state;
      return { ...state, suspended: false };

    default:
      return state;
  }
}

/** 지금 브라우저를 붙잡고 있어야 하는가. */
export function geoWatching(state: GeoState): boolean {
  return (state.status === 'locating' || state.status === 'active') && !state.suspended;
}

/** 버튼이 눌린 모양으로 서 있어야 하는가. */
export function geoOn(state: GeoState): boolean {
  return state.status === 'locating' || state.status === 'active';
}

/**
 * `watchPosition` 설정.
 *
 * 높은 정확도를 켜는 이유는 이 점이 「이 골목이 맞나」에 쓰이기 때문이고,
 * `maximumAge`를 조금 주는 이유는 방금 받은 좌표가 있으면 즉시 점을 세우는 쪽이
 * 15초를 기다리는 쪽보다 낫기 때문이다.
 */
export const GEO_WATCH_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  maximumAge: 10_000,
  timeout: 15_000,
};

/** 훅이 화면에 돌려주는 것. */
export interface MyLocation {
  state: GeoState;
  /** 버튼 한 번 — 켜져 있으면 끄고, 꺼져 있으면 켠다. */
  toggle: () => void;
}

/**
 * 「내 위치」 하나를 소유하는 훅.
 *
 * 감시는 {@link geoWatching}이 참인 동안에만 걸린다. 그래서 탭이 숨으면 효과가
 * 정리되며 `clearWatch`가 불리고, 지도를 떠나(언마운트) 버리면 같은 정리가 한 번
 * 더 안전하게 돈다 — 배터리 이야기가 코드에서 한 곳으로 모인다.
 */
export function useMyLocation(): MyLocation {
  const [state, dispatch] = useReducer(geoReduce, initialGeoState);
  const watching = geoWatching(state);

  useEffect(() => {
    if (!watching) return;
    const geo = typeof navigator === 'undefined' ? undefined : navigator.geolocation;
    if (!geo) {
      dispatch({ kind: 'unsupported' });
      return;
    }

    const id = geo.watchPosition(
      (position) =>
        dispatch({
          kind: 'fix',
          fix: {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracyM: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : 0,
          },
        }),
      (error) => dispatch({ kind: 'error', code: error.code }),
      GEO_WATCH_OPTIONS,
    );

    return () => geo.clearWatch(id);
  }, [watching]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onVisibility = () =>
      dispatch({ kind: document.visibilityState === 'hidden' ? 'hide' : 'show' });
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  const toggle = useCallback(() => dispatch({ kind: 'toggle' }), []);

  return { state, toggle };
}
