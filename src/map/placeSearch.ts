/**
 * 장소 검색 한 곳 (M28) — AI 먼저, 안 되면 OpenStreetMap.
 *
 * 화면(`components/map/PlaceSearch`)은 이제 Nominatim을 직접 부르지 않고 여기만
 * 부른다. 규칙은 한 문장이다: **AI를 쓸 수 있으면 AI에게 먼저 묻고, 그게 어떤
 * 이유로든 답이 되지 못하면 Nominatim으로 내려간다.**
 *
 * | 상황                                   | 결과 |
 * | -------------------------------------- | ---- |
 * | AI 토글 off / 서버에 키 없음 / Pages    | 곧장 OSM, 안내 없음 |
 * | AI 호출 실패(네트워크·502·파싱)         | OSM + 한 줄 안내 |
 * | AI 429(분당 20건 퓨즈)                  | OSM + 한 줄 안내 |
 * | AI가 후보를 하나도 못 냄                | OSM + 한 줄 안내 |
 * | AI가 후보를 냄                          | AI 결과 |
 *
 * 안내가 「AI 토글 off」에만 없는 것은 의도다. 그건 실패가 아니라 이 기기의 평소
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
import { refineCandidates } from './refine';

/** 결과가 어디서 왔는지. */
export type PlaceSource = 'ai' | 'osm';

/** OSM으로 내려간 이유. `'ai-off'`만 사용자에게 알리지 않는다. */
export type FallbackReason = 'ai-off' | 'ai-error' | 'ai-rate' | 'ai-empty';

/** 검색 한 번의 결과. */
export interface SmartSearchResult {
  results: PlaceCandidate[];
  source: PlaceSource;
  /** OSM으로 내려간 이유 — 화면의 한 줄 안내를 만드는 데 쓴다. */
  reason?: FallbackReason;
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

/** 테스트가 갈아끼우는 넷. 기본값은 진짜 AI와 진짜 Nominatim이다. */
export interface SmartSearchDeps {
  /** 토글·동기화·서버 키 세 조건(M11). */
  isAiEnabled: () => boolean;
  aiSearch: (query: string, destination?: string) => Promise<PlaceCandidate[]>;
  osmSearch: (query: string, signal?: AbortSignal) => Promise<GeoPoint[]>;
  /** 이름 스냅이 빗나간 후보의 정식 주소를 되묻는다 (M37 — `map/refine.ts`). */
  aiAddress: (candidate: PlaceCandidate) => Promise<string | null>;
}

const DEFAULT_DEPS: SmartSearchDeps = {
  isAiEnabled: aiEnabled,
  aiSearch: (query, destination) => aiSearchPlaces(query, { destination }),
  osmSearch: searchPlaces,
  aiAddress: aiPlaceAddress,
};

/** {@link searchPlacesSmart}가 받는 것. */
export interface SmartSearchOptions {
  /** 여행의 목적지 주소(M12). 별명을 도시에 붙여 주는 유일한 단서. */
  destination?: string;
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

  let reason: FallbackReason = 'ai-off';
  if (deps.isAiEnabled()) {
    try {
      const found = await deps.aiSearch(trimmed, options.destination);
      if (found.length > 0) return { results: found, source: 'ai' };
      reason = 'ai-empty';
    } catch (failure) {
      // 사용자가 검색을 취소했으면 대체 요청까지 보낼 이유가 없다.
      if (failure instanceof DOMException && failure.name === 'AbortError') throw failure;
      reason = fallbackReasonFor(failure);
    }
  }

  const points = await deps.osmSearch(trimmed, options.signal);
  const note = FALLBACK_NOTES[reason];
  return {
    results: points.map(osmCandidate),
    source: 'osm',
    reason,
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
