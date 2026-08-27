/**
 * 장소 검색의 AI 절반 (M28) — 프롬프트·스키마·파서, 그리고 한 번의 호출.
 *
 * Nominatim은 한국어 음차·별명에 약하다. 「츠텐카쿠」(通天閣)도 「글리코상」
 * (도톤보리의 글리코 간판)도 OSM에는 그 이름으로 들어 있지 않아서 검색 결과가
 * 0건이 된다. 사람이 부르는 이름을 실제 장소로 옮기는 일은 지명 색인이 아니라
 * 모델이 잘하는 일이라, 그 한 단계만 Gemini에게 맡긴다.
 *
 * ## 왜 grounding이 아니라 스키마인가
 *
 * `ai.php`는 `responseSchema`와 `google_search`를 함께 보내지 못한다(M11). 둘 중
 * 하나를 골라야 하는데, 기본값은 **스키마 쪽**이다.
 *
 *  - 좌표는 파싱이 전부다. 스키마가 있으면 `{places:[{lat,lng,…}]}`가 그대로
 *    오지만, grounding 답은 산문이라 매번 정규식으로 긁어내야 한다.
 *    (실제로 그 대비가 필요해서 {@link extractJsonObject}가 있다.)
 *  - grounding은 느리다. 이 화면은 사용자가 검색 버튼을 누르고 기다리는
 *    화면이고, 2~4초와 8초는 다른 기능이다.
 *  - 통천각·글리코 간판 정도의 랜드마크 좌표는 모델이 이미 알고 있다.
 *
 * 대신 **첫 시도가 빈손이면 한 번만 grounding으로 재시도**한다. 모델이 모르는
 * 작은 가게는 검색이 답을 알고, 그때는 느린 편이 없는 것보다 낫다. 재시도까지
 * 빈손이면 호출자가 Nominatim으로 내려간다(`map/placeSearch.ts`).
 *
 * `kind`는 새로 만들지 않고 기존 `ask`를 쓴다 — 서버는 kind를 세 개만 받으므로
 * 새 kind는 `server/ai.php` 변경(=NAS 재배포)을 뜻하는데, 이 기능에 서버가 더
 * 해줄 일은 없다.
 */

import type { GeoPoint } from '../types/models';
import { callAi, type AiResult } from './aiClient';
import { truncate } from './prompts';

/** 한 번의 검색이 돌려주는 최대 후보 수. Nominatim의 `SEARCH_LIMIT`와 같다. */
export const MAX_PLACE_CANDIDATES = 5;

/** 검색어에서 모델에 넘기는 최대 길이. */
export const MAX_PLACE_QUERY = 120;

/**
 * 화면에 뿌릴 후보 한 줄.
 *
 * {@link GeoPoint}를 그대로 확장하므로 그대로 골라도 되지만, `localName`과
 * `locality`는 **검색 화면에서만 사는 값**이다. 워크스페이스에 저장되는 것은
 * 언제나 `{lat,lng,address}` 세 칸뿐이다(스키마 버전 1 고정).
 */
export interface PlaceCandidate extends GeoPoint {
  /** 한국어 표기 — 결과 줄의 제목. */
  name: string;
  /** 현지 언어 표기(通天閣). 사용자가 「이 장소가 맞나」를 확인하는 근거. */
  localName?: string;
  /** 도시·동네 한 줄(오사카). */
  locality?: string;
  /**
   * 좌표를 OpenStreetMap에 맞춰 조였는지 (M35 — `map/refine.ts`).
   *
   * `localName`·`locality`와 같은 부류다: 결과 줄에만 사는 값이고 저장되지 않는다.
   * 없거나 `false`면 좌표가 모델의 기억 그대로라는 뜻이다.
   */
  refined?: boolean;
}

/** 후보 하나를 저장 가능한 {@link GeoPoint}로 좁힌다. */
export function toGeoPoint(candidate: PlaceCandidate): GeoPoint {
  const address = [candidate.name, candidate.locality]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(', ');
  return { lat: candidate.lat, lng: candidate.lng, address: address || candidate.name };
}

/** 장소 검색 답변의 상시 규칙. */
export const PLACES_SYSTEM =
  '당신은 한국인 여행자를 돕는 장소 검색 도우미예요. 실제로 존재하는 장소만 답하고, ' +
  '한국어 음차·별명(츠텐카쿠, 글리코상 같은 것)도 원래 장소로 알아들어요. ' +
  'name은 한국어 표기, localName은 그 나라에서 쓰는 표기예요. ' +
  'lat·lng는 그 장소의 실제 위경도(십진수)예요. 확실하지 않은 장소는 아예 넣지 않고, ' +
  '아무것도 찾지 못하면 빈 목록을 돌려줘요.';

/**
 * {@link PlaceCandidate}를 고정하는 Gemini `responseSchema`.
 *
 * `propertyOrdering`은 `SUGGEST_SCHEMA`와 같은 이유로 있다: 생성 순서가 고정되면
 * 두 답을 눈으로 비교할 수 있다.
 */
export const PLACES_SCHEMA = {
  type: 'object',
  properties: {
    places: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          localName: { type: 'string' },
          locality: { type: 'string' },
          lat: { type: 'number' },
          lng: { type: 'number' },
        },
        required: ['name', 'lat', 'lng'],
        propertyOrdering: ['name', 'localName', 'locality', 'lat', 'lng'],
      },
    },
  },
  required: ['places'],
} as const;

/**
 * 「츠텐카쿠」 + 여행지 → 후보를 물어보는 프롬프트.
 *
 * 여행지(M12의 `Trip.destination`)가 들어가는 것이 이 프롬프트의 핵심이다.
 * 「글리코상」은 도톤보리에만 있는 것이 아니고, 별명은 도시를 알아야 풀린다.
 */
export function buildPlacesPrompt(query: string, destination?: string): string {
  const where = destination?.trim();
  const lines = [
    `찾는 장소: ${truncate(query, MAX_PLACE_QUERY)}`,
    where ? `여행지: ${where}` : '',
    '',
    `이 이름에 해당하는 실제 장소를 1~${MAX_PLACE_CANDIDATES}개 찾아 주세요.`,
    where ? '- 별명·음차만 적혀 있으면 위 여행지 안에서 먼저 찾아요.' : '',
    '- name은 한국어 표기, localName은 현지 언어 표기예요(예: 통천각 / 通天閣).',
    '- locality는 도시나 동네 이름 한 줄이에요(예: 오사카).',
    '- lat·lng는 그 장소의 실제 좌표예요. 도시 중심 좌표로 대충 채우지 않아요.',
    '- 확실하지 않은 장소는 넣지 않아요. 없으면 빈 목록이 정답이에요.',
  ];
  return lines.filter((line) => line !== '').join('\n');
}

/* ------------------------------------------------------------------ *
 * 답 읽기
 * ------------------------------------------------------------------ */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** 좌표 한 칸: 유한한 수여야 하고, 문자열로 와도 받아 준다. */
const toNumber = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/**
 * 산문 속의 JSON 오브젝트 하나를 꺼낸다.
 *
 * grounding 재시도에는 스키마가 없어서(서버가 떨군다) 답이 ```json 펜스나
 * 「이렇게 찾았어요:」 뒤에 붙어 온다. 첫 `{`부터 마지막 `}`까지를 잘라 보는 것이
 * 전부이고, 실패는 그냥 `null`이다 — 여기서 던지면 Nominatim 대체가 아니라
 * 오류 화면이 된다.
 */
export function extractJsonObject(raw: string): unknown {
  const value = raw.trim();
  if (value === '') return null;

  const fenced = /```(?:json)?\s*\n?([\s\S]*?)\n?```/i.exec(value);
  const body = fenced ? fenced[1].trim() : value;

  const attempts = [body];
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start >= 0 && end > start) attempts.push(body.slice(start, end + 1));

  for (const attempt of attempts) {
    try {
      return JSON.parse(attempt);
    } catch {
      /* 다음 후보로 */
    }
  }
  return null;
}

/**
 * `{places:[…]}` → 쓸 수 있는 후보만.
 *
 * 스키마가 있어도 보장은 아니다. 이름이 비었거나, 좌표가 수가 아니거나, 위경도
 * 범위를 벗어난 줄은 **조용히 버린다**. 모델이 지어낸 좌표 하나가 지도에 핀을
 * 세우는 것보다, 그 줄이 없어서 Nominatim으로 내려가는 편이 언제나 낫다.
 */
export function parsePlaceCandidates(json: unknown): PlaceCandidate[] {
  const list = isRecord(json) ? json.places : null;
  if (!Array.isArray(list)) return [];

  const rows: PlaceCandidate[] = [];
  for (const raw of list) {
    if (!isRecord(raw)) continue;

    const name = text(raw.name);
    if (!name) continue;

    const lat = toNumber(raw.lat);
    const lng = toNumber(raw.lng);
    if (lat === null || lng === null) continue;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;
    // 0,0은 대서양 한가운데 — 모델이 값을 못 채웠을 때 나오는 전형적인 쓰레기다.
    if (lat === 0 && lng === 0) continue;

    const localName = text(raw.localName);
    const locality = text(raw.locality);
    rows.push({
      name,
      lat,
      lng,
      ...(localName && localName !== name ? { localName } : {}),
      ...(locality ? { locality } : {}),
    });
    if (rows.length >= MAX_PLACE_CANDIDATES) break;
  }
  return rows;
}

/** 스키마 답이면 `json`, grounding 답이면 본문에서 긁어낸 JSON을 읽는다. */
export function parsePlaceAnswer(result: AiResult): PlaceCandidate[] {
  const fromJson = parsePlaceCandidates(result.json);
  if (fromJson.length > 0) return fromJson;
  return parsePlaceCandidates(extractJsonObject(result.text));
}

/* ------------------------------------------------------------------ *
 * 호출
 * ------------------------------------------------------------------ */

/** {@link aiSearchPlaces}가 받는 것. */
export interface AiPlaceSearchOptions {
  /** 여행의 목적지 주소(M12) — 별명이 어느 도시의 것인지 알려 준다. */
  destination?: string;
  /** 첫 시도가 빈손일 때 grounding으로 한 번 더 물어볼지. 기본 `true`. */
  retryGrounded?: boolean;
}

/**
 * 한 번(필요하면 두 번)의 AI 장소 검색.
 *
 * 던지는 것은 `AiError` 뿐이고, 그 처리는 호출자(`map/placeSearch.ts`)의 몫이다:
 * 여기서 Nominatim을 부르지 않는 이유는, 대체 규칙이 한 곳에만 있어야 테스트할
 * 수 있기 때문이다.
 */
export async function aiSearchPlaces(
  query: string,
  options: AiPlaceSearchOptions = {},
): Promise<PlaceCandidate[]> {
  const trimmed = query.trim();
  if (trimmed === '') return [];

  const prompt = buildPlacesPrompt(trimmed, options.destination);

  const first = await callAi('ask', {
    prompt,
    system: PLACES_SYSTEM,
    schema: PLACES_SCHEMA,
  });
  const candidates = parsePlaceAnswer(first);
  if (candidates.length > 0 || options.retryGrounded === false) return candidates;

  // 모델이 모르는 이름일 수 있다. 이 한 번만 검색을 붙여 준다 — 스키마는 서버가
  // 떨구므로 답은 산문이고, 그래서 파서가 둘 다 읽을 줄 안다.
  const grounded = await callAi('ask', {
    prompt,
    system: PLACES_SYSTEM,
    grounding: true,
  });
  return parsePlaceAnswer(grounded);
}
