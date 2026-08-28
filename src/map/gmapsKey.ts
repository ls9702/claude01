/**
 * 이 기기가 쓸 구글 지도 브라우저 키 (M41).
 *
 * 키는 **기기별 설정**이다 — `ai/aiSettings`의 토글, `sync/settings`의 주소와
 * 같은 자리에 살고, 워크스페이스에는 절대 들어가지 않는다. 워크스페이스는 두
 * 기기 사이를 오가는 데이터라, 거기 키를 넣으면 백업 파일·서버 JSON·내보내기에
 * 전부 키가 복사된다.
 *
 * 키를 **손으로 넣는 화면은 없다**. 값은 NAS의 `bootstrap-config.json`이 주고
 * (`sync/bootstrap`), 앱은 그것을 이 자리에 옮겨 적을 뿐이다. 그래서 키가 있는
 * 기기 = NAS 페이지로 앱을 연 기기이고, 없는 기기(GitHub Pages, 파일 없는 배포)는
 * 구글 지도를 아예 모르는 채로 지금까지와 똑같이 동작한다.
 *
 * 키가 HTML에서 읽힌다는 사실은 이 앱에서 새로운 이야기가 아니다: 동기화 토큰이
 * 이미 같은 파일에 있다(M14의 의도된 맞바꿈). 구글 키 쪽은 그 위에 **HTTP
 * 리퍼러 제한**이 걸려 있어, 다른 사이트로 복사해 가면 구글이 거절한다.
 */

import { create } from 'zustand';

/** 키가 앉는 자리. `trip-board/ai`·`trip-board/bootstrap`과 같은 이름공간. */
export const GMAPS_KEY_STORAGE = 'trip-board/gmaps-key';

/** `localStorage`, or `null` where it is missing or blocked (Node, private mode). */
function storage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

/**
 * 쓸 만한 키인가 — 문자열이고, 공백을 걷어내도 남는 것이 있어야 한다.
 *
 * 모양은 검사하지 않는다. 구글이 발급하는 키의 형식은 구글의 사정이고, 여기서
 * 정규식을 하나 두면 언젠가 멀쩡한 키를 이 앱이 거절하게 된다. 빈 문자열만
 * 거른다 — 그건 「키 없음」을 잘못 적은 것이므로.
 */
export function normalizeGoogleMapsKey(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** 저장된 키, 없거나 읽을 수 없으면 `null`. 절대 던지지 않는다. */
export function loadGoogleMapsKey(): string | null {
  try {
    return normalizeGoogleMapsKey(storage()?.getItem(GMAPS_KEY_STORAGE) ?? null);
  } catch {
    return null;
  }
}

/**
 * 키를 적어 둔다. `null`을 주면 지운다.
 *
 * 저장에 실패해도 조용하다 — 이건 설정이지 데이터가 아니고, 못 적으면 그저 이번
 * 세션에만 구글 지도가 되는 기기다.
 */
export function saveGoogleMapsKey(raw: unknown): string | null {
  const key = normalizeGoogleMapsKey(raw);
  try {
    const store = storage();
    if (key) store?.setItem(GMAPS_KEY_STORAGE, key);
    else store?.removeItem(GMAPS_KEY_STORAGE);
  } catch {
    /* quota / private mode */
  }
  return key;
}

/** 화면들이 지켜보는 한 가지 사실: 이 기기에 키가 있는가. */
export interface GoogleMapsKeyState {
  /** 키 자체. 로더 말고는 아무도 이 값을 읽을 필요가 없다. */
  key: string | null;
  /** 키를 적고 화면에 알린다. 부트스트랩이 부르는 유일한 길. */
  setKey: (raw: unknown) => void;
}

/**
 * 스토어인 이유는 `ai/aiSettings`가 스토어인 이유와 같다: 키는 앱이 뜬 **뒤에**
 * (부트스트랩 fetch가 끝나고) 도착하는데, 그때 이미 지도 탭과 시트 마법사가
 * 화면에 있을 수 있다. 모듈 변수였다면 둘 다 리로드 전까지 키를 모른다.
 */
export const useGoogleMapsKeyStore = create<GoogleMapsKeyState>()((set) => ({
  key: loadGoogleMapsKey(),
  setKey: (raw) => set({ key: saveGoogleMapsKey(raw) }),
}));

/** 이 기기의 키, 실시간으로. 없으면 `null`. */
export function useGoogleMapsKey(): string | null {
  return useGoogleMapsKeyStore((s) => s.key);
}

/**
 * 구글 지도를 **고를 수 있는가** — 엔진 선택 UI가 나타나는 조건이고, 배치 보정
 * 팝업이 뜨는 조건이며, 구글 시트가 실제로 구글로 그려지는 조건이다.
 *
 * 셋 다 같은 한 가지에 달려 있다: 키가 있느냐. 그래서 판단도 한 곳에서만 한다.
 */
export function hasGoogleMapsKey(): boolean {
  return useGoogleMapsKeyStore.getState().key !== null;
}
