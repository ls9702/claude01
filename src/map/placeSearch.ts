/**
 * 장소 검색 한 곳 (M28 → M44) — 구글 먼저, 그다음 AI, 안 되면 OpenStreetMap.
 *
 * 화면(`components/map/PlaceSearch`)은 Nominatim을 직접 부르지 않고 여기만
 * 부른다. 규칙은 세 계단이고, **위 계단이 답을 내면 아래는 부르지 않는다.**
 *
 * | 계단 | 언제 | 결과 |
 * | --- | --- | --- |
 * | ① 구글 Places (M44) | 이 기기에 구글 키가 있을 때 | `source: 'google'` |
 * | ② AI (M28) | 구글이 없거나 못 찾았고, AI 토글이 켜져 있을 때 | `source: 'ai'` |
 * | ③ Nominatim (M3) | 위 둘 다 답이 못 될 때 | `source: 'osm'` |
 *
 * ## 왜 구글이 위인가 (M44)
 *
 * ②·③의 조합에는 구멍이 하나 있었다. 모델은 **이름을 잘 옮기지만 좌표는 블록
 * 단위로 흘리고**(그래서 M35가 OSM에 되물어 조인다), OSM 색인에 없는 가게는 그
 * 조이기가 통째로 실패한다. 「마루하치 슈퍼 난바점」 같은 동네 가게가 매번 다른
 * 자리에 꽂히던 이유가 그것이다. 구글 Places는 그 색인을 가지고 있고, 그 좌표는
 * **조일 필요조차 없다** — 원본이기 때문이다.
 *
 * | 상황                                   | 결과 |
 * | -------------------------------------- | ---- |
 * | 구글 키 없음(Pages·부트스트랩 없는 배포) | 조용히 ②로, 안내 없음 |
 * | 구글 로드/호출 실패                      | ②로 + (AI가 답하면) 한 줄 안내 |
 * | 구글이 못 찾음                           | ②로 + (AI가 답하면) 한 줄 안내 |
 * | AI 토글 off / 서버에 키 없음 / Pages    | 곧장 OSM, 안내 없음 |
 * | AI 호출 실패(네트워크·502·파싱)         | OSM + 한 줄 안내 |
 * | AI 429(분당 20건 퓨즈)                  | OSM + 한 줄 안내 |
 * | AI가 후보를 하나도 못 냄                | OSM + 한 줄 안내 |
 * | AI가 후보를 냄                          | AI 결과 |
 *
 * 안내가 「토글 off」에만 없는 것은 의도다. 그건 실패가 아니라 이 기기의 평소
 * 상태이고, GitHub Pages 빌드에서는 영원히 그 상태다 — 매번 사과할 일이 아니다.
 *
 * M35에서 한 겹이 더 붙었다: AI가 낸 후보는 화면에 나가기 전에 좌표를 한 번 더
 * OSM에 맞춰 조인다({@link searchPlacesRefined} + `map/refine.ts`). 모델은 이름을
 * 잘 옮기고 좌표는 블록 단위로 흘리기 때문이다.
 *
 * OSM 경로는 M3 그대로다. {@link searchPlaces}를 감싸지도, 인자를 바꾸지도 않는다:
 * 백엔드가 없는 배포에서는 이 길이 유일한 길이라 손대지 않는 것이 안전하다.
 */

import { AiError, aiEnabled } from '../ai/aiClient';
import { aiPlaceAddress, aiSearchPlaces, type PlaceCandidate } from '../ai/aiPlaces';
import type { GeoPoint } from '../types/models';
import { searchPlaces } from '../utils/geo';
import { googlePlaceSearch, hasGoogleLookup } from './googlePlaceLookup';
import { refineCandidates } from './refine';

/** 결과가 어디서 왔는지. */
export type PlaceSource = 'google' | 'ai' | 'osm';

/** OSM으로 내려간 이유. `'ai-off'`만 사용자에게 알리지 않는다. */
export type FallbackReason = 'ai-off' | 'ai-error' | 'ai-rate' | 'ai-empty';

/**
 * 구글을 1순위로 쓰지 **못한** 이유 (M44).
 *
 * `'google-off'`는 이 기기에 키가 없다는 뜻이고, 그건 실패가 아니라 평소 상태다
 * (GitHub Pages 빌드에서는 영원히 그렇다) — `'ai-off'`가 조용한 것과 같은 이유로
 * 조용하다.
 */
export type GoogleFallbackReason = 'google-off' | 'google-error' | 'google-empty';

/** 검색 한 번의 결과. */
export interface SmartSearchResult {
  results: PlaceCandidate[];
  source: PlaceSource;
  /** OSM으로 내려간 이유 — 화면의 한 줄 안내를 만드는 데 쓴다. */
  reason?: FallbackReason;
  /** 구글을 못 쓴 이유 (M44). 키가 없으면 `'google-off'`. */
  googleReason?: GoogleFallbackReason;
  /** 그 한 줄. 안내할 것이 없으면 아예 없다. */
  note?: string;
}

/** 이유별 안내 문구. 짧게, 사과하지 않고, 무엇을 보고 있는지만. */
export const FALLBACK_NOTES: Record<FallbackReason, string | undefined> = {
  'ai-off': undefined,
  'ai-error': 'AI 검색이 안 돼서 OpenStreetMap 결과예요',
  'ai-rate': 'AI 요청이 많아서 OpenStreetMap 결과예요',
  'ai-empty': 'AI가 찾지 못해서 OpenStreetMap 결과예요',
};

/**
 * 구글이 답이 되지 못했을 때의 한 줄 (M44) — **AI 결과를 보고 있을 때만** 쓴다.
 *
 * OSM까지 내려간 화면에는 {@link FALLBACK_NOTES}가 이미 「어디 결과인지」를
 * 말하고 있고, 한 줄에 두 개의 사과를 담으면 아무것도 읽히지 않는다. 그래서 이
 * 문구들은 「구글은 못 썼지만 AI가 답했다」는 한 가지 상황의 것이다.
 */
export const GOOGLE_FALLBACK_NOTES: Record<GoogleFallbackReason, string | undefined> = {
  'google-off': undefined,
  'google-error': '구글 지도를 불러오지 못해 AI 결과예요',
  'google-empty': '구글에서 찾지 못해 AI 결과예요',
};

/** 실패 하나를 이유 하나로. `AiError`가 아닌 것도 전부 오류로 친다. */
export function fallbackReasonFor(failure: unknown): FallbackReason {
  return failure instanceof AiError && failure.kind === 'rate' ? 'ai-rate' : 'ai-error';
}

/**
 * OSM의 {@link GeoPoint}를 결과 줄로. 이름은 주소 그대로이고, 현지 표기는 없다 —
 * Nominatim은 `accept-language=ko`로 이미 한국어 주소를 준다.
 */
export function osmCandidate(point: GeoPoint): PlaceCandidate {
  return { ...point, name: point.address ?? `${point.lat}, ${point.lng}` };
}

/** 테스트가 갈아끼우는 것들. 기본값은 진짜 구글·AI·Nominatim이다. */
export interface SmartSearchDeps {
  /** 이 기기에 구글 키가 있는가 (M44 — `map/gmapsKey.ts`). */
  hasGoogle: () => boolean;
  /** 구글 Places 후보들. 못 부르면 **던진다**(빈 배열은 「없다」는 답이다). */
  googleSearch: (query: string, bias?: GeoPoint) => Promise<PlaceCandidate[]>;
  /** 토글·동기화·서버 키 세 조건(M11). */
  isAiEnabled: () => boolean;
  aiSearch: (query: string, destination?: string) => Promise<PlaceCandidate[]>;
  osmSearch: (query: string, signal?: AbortSignal) => Promise<GeoPoint[]>;
  /** 이름 스냅이 빗나간 후보의 정식 주소를 되묻는다 (M37 — `map/refine.ts`). */
  aiAddress: (candidate: PlaceCandidate) => Promise<string | null>;
}

const DEFAULT_DEPS: SmartSearchDeps = {
  hasGoogle: hasGoogleLookup,
  googleSearch: googlePlaceSearch,
  isAiEnabled: aiEnabled,
  aiSearch: (query, destination) => aiSearchPlaces(query, { destination }),
  osmSearch: searchPlaces,
  aiAddress: aiPlaceAddress,
};

/** {@link searchPlacesSmart}가 받는 것. */
export interface SmartSearchOptions {
  /** 여행의 목적지 주소(M12). 별명을 도시에 붙여 주는 유일한 단서. */
  destination?: string;
  /**
   * 여행의 목적지 **좌표** (M44) — 구글에게 검색을 기울여 달라고 말하는 값.
   *
   * 문자열 목적지와 따로 받는 이유는 두 엔진이 서로 다른 것을 이해하기 때문이다:
   * 모델은 「오사카, 일본」을 읽고, Places는 반경 안의 좌표를 읽는다. 없으면
   * 전 세계 검색이 되므로 있으면 반드시 싣는다.
   */
  bias?: GeoPoint;
  signal?: AbortSignal;
  /** 테스트용. 실제 화면은 넘기지 않는다. */
  deps?: Partial<SmartSearchDeps>;
}

/**
 * 장소 하나를 찾는다. **던지는 것은 OSM 경로의 실패뿐**이다.
 *
 * AI 쪽 실패는 결과가 아니라 경로 선택으로 흡수된다: 호출자는 「AI가 죽었다」를
 * 알 필요가 없고, 결과와 (있다면) 한 줄 안내만 받는다.
 */
export async function searchPlacesSmart(
  query: string,
  options: SmartSearchOptions = {},
): Promise<SmartSearchResult> {
  const trimmed = query.trim();
  if (trimmed === '') return { results: [], source: 'osm' };

  const deps = { ...DEFAULT_DEPS, ...options.deps };

  /* --- 0순위: 구글 Places (M44) ------------------------------------- */

  let googleReason: GoogleFallbackReason = 'google-off';
  if (deps.hasGoogle()) {
    try {
      const found = await deps.googleSearch(trimmed, options.bias);
      // 구글의 좌표가 곧 원본이다 — 조일 것이 없다(`searchPlacesRefined` 참고).
      if (found.length > 0) return { results: found, source: 'google' };
      googleReason = 'google-empty';
    } catch (failure) {
      if (failure instanceof DOMException && failure.name === 'AbortError') throw failure;
      // 키가 잘못됐든, 스크립트가 막혔든, 오프라인이든 — 다음 계단이 있다.
      googleReason = 'google-error';
    }
  }

  /* --- 1순위: AI (M28) ---------------------------------------------- */

  let reason: FallbackReason = 'ai-off';
  if (deps.isAiEnabled()) {
    try {
      const found = await deps.aiSearch(trimmed, options.destination);
      if (found.length > 0) {
        const note = GOOGLE_FALLBACK_NOTES[googleReason];
        return {
          results: found,
          source: 'ai',
          googleReason,
          ...(note ? { note } : {}),
        };
      }
      reason = 'ai-empty';
    } catch (failure) {
      // 사용자가 검색을 취소했으면 대체 요청까지 보낼 이유가 없다.
      if (failure instanceof DOMException && failure.name === 'AbortError') throw failure;
      reason = fallbackReasonFor(failure);
    }
  }

  /* --- 2순위: OpenStreetMap (M3) ------------------------------------ */

  const points = await deps.osmSearch(trimmed, options.signal);
  const note = FALLBACK_NOTES[reason];
  return {
    results: points.map(osmCandidate),
    source: 'osm',
    reason,
    googleReason,
    ...(note ? { note } : {}),
  };
}

/**
 * 화면이 부르는 것 (M35) — {@link searchPlacesSmart} + 좌표 보정.
 *
 * 경로 선택은 위 함수가 그대로 하고, 여기서는 그 결과가 **AI에서 온 것일 때만**
 * 한 걸음을 더 얹는다: 후보의 현지 표기로 Nominatim에 물어 좌표를 조인다
 * (`map/refine.ts`). OSM 결과는 이미 OSM 좌표라 손댈 것이 없다.
 *
 * 둘을 한 함수로 합치지 않은 이유는 규칙이 서로 다르기 때문이다 — 「어디에서
 * 찾을까」와 「찾은 좌표를 믿을까」는 따로 읽히고 따로 시험된다.
 *
 * M37에서 그 보정에 두 번째 계단이 붙었다: 이름으로 못 찾은 앞 후보들에 한해
 * AI에게 **정식 주소**를 되묻고 그 주소를 지오코딩한다. OSM에 없는 작은 가게가
 * 그래도 자기 건물 위에는 앉게 하는 길이다.
 *
 * M44의 구글 결과(`source: 'google'`)는 이 함수를 **그냥 지나간다**. 조건이 이미
 * 「AI에서 온 것일 때만」이라 코드는 한 줄도 늘지 않았지만, 이유는 적어 둘 값이
 * 있다: 보정은 「모델의 기억을 지도에 맞추는」 일이고, 구글 좌표는 지도 그 자체다.
 * 그것을 OSM으로 한 번 더 옮기면 정확도를 올리는 것이 아니라 원본을 사본으로
 * 바꾸는 것이다.
 */
export async function searchPlacesRefined(
  query: string,
  options: SmartSearchOptions = {},
): Promise<SmartSearchResult> {
  const found = await searchPlacesSmart(query, options);
  if (found.source !== 'ai' || found.results.length === 0) return found;

  const osmSearch = options.deps?.osmSearch ?? DEFAULT_DEPS.osmSearch;
  const askAddress = options.deps?.aiAddress ?? DEFAULT_DEPS.aiAddress;
  const results = await refineCandidates(found.results, {
    osmSearch,
    askAddress,
    signal: options.signal,
  });
  return { ...found, results };
}
