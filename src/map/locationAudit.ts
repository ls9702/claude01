/**
 * 위치 재정비 (M36 → M44) — 이미 저장된 카드 좌표를 다시 맞추기.
 *
 * M44에서 좌표의 **원천**이 갈렸다: 이 기기에 구글 지도 키가 있으면
 * {@link proposeLocation}은 구글 Places에게 묻고 그 좌표를 그대로 제안한다(조일
 * 이유가 없는 원본이다). 키가 없으면 아래 M36~M37의 길이 한 글자도 다르지 않게
 * 돈다 — 판정도, 30m/3km의 벽도, 「고른 것만 적용」도 전부 그대로다.
 *
 * M35는 **새로 찾는** 장소의 좌표를 고쳤다: AI가 현지 표기를 알아내고
 * (`ai/aiPlaces`), 그 표기로 Nominatim에 되물어 좌표를 스냅한다(`map/refine`).
 * 그런데 M35 이전에 꽂아 둔 핀들은 그 단계를 거치지 않았다 — 사용자가 신고한
 * 「히요리 호텔」처럼 한두 블록씩 어긋난 채 워크스페이스에 남아 있다.
 *
 * 이 파일은 그 핀들에게 **같은 한 단계를 뒤늦게** 적용한다. 새 알고리즘을 짜지
 * 않는다: {@link proposeLocation}은 `aiSearchPlaces` → `refineCandidates`를 그대로
 * 부르고, 거리는 M35의 `haversineKm`로 잰다. 다른 것은 입력뿐이다 — 검색창의
 * 글자 대신 **이미 저장된 카드 하나**가 질문이 된다.
 *
 * ## 세 가지 안전장치
 *
 * 이 도구의 위험은 하나다: **사람이 손으로 맞춰 둔 핀을 기계가 밀어 버리는 것.**
 * 그래서 규칙이 셋이다.
 *
 *  1. **OSM이 확인해 준 좌표만 제안한다.** `refineCandidates`가 `refined`를 달아
 *     주지 않은 후보 — 즉 모델의 기억뿐인 좌표 — 는 제안이 아니다. 블록 단위로
 *     흘리는 좌표를 이미 자리 잡은 핀 위에 덮는 것은 개선이 아니라 교환이다.
 *  2. **{@link AUDIT_MIN_MOVE_M} 안쪽은 건드리지 않는다.** 30m는 GPS 오차이자
 *     건물 한 채의 폭이다. 그 정도 차이로 핀을 옮기면 목록만 길어진다.
 *  3. **{@link AUDIT_MAX_MOVE_KM} 밖은 다른 장소로 본다.** 같은 이름의 다른 도시를
 *     붙잡았을 때 여행이 통째로 옮겨 가는 것을 막는 마지막 벽이다. M35의
 *     `REFINE_RADIUS_KM`과 같은 3km인 것은 우연이 아니다 — 같은 질문에 대한 같은
 *     대답이다.
 *
 * 그리고 마지막 안전장치는 코드가 아니라 화면에 있다: 무엇도 자동으로 적용되지
 * 않는다. 훑고(`scanAudit`) → 목록을 보여주고 → 사람이 고른 것만
 * ({@link applyPlan}) 저장한다.
 *
 * 전부 순수 함수 + 의존성을 주입받는 async generator 하나 — React도 store도
 * 모른다.
 */

import { AiError } from '../ai/aiClient';
import type { PlaceCandidate } from '../ai/aiPlaces';
import type { Card, GeoPoint, Id, Workspace } from '../types/models';
import { locatedCards } from './filter';
import { REFINE_RADIUS_KM, haversineKm, nearestWithin, refineCandidates } from './refine';

/**
 * 이보다 가까운 제안은 「이미 정확하다」로 친다(m).
 *
 * 30m는 휴대폰 GPS의 평범한 오차이고 건물 한 채의 폭이다. 여기서 더 내려가면
 * 목록의 대부분이 「1m 옮기기」로 채워져, 정말 옮겨야 할 두어 줄이 그 안에 묻힌다.
 */
export const AUDIT_MIN_MOVE_M = 30;

/**
 * 이보다 먼 제안은 아예 버린다(km).
 *
 * M35가 AI 좌표 주변에 그은 반경과 같은 값이다. 거기서는 「AI가 말한 자리에서
 * 3km 안이면 같은 장소」였고, 여기서는 「지금 핀에서 3km 안이면 같은 장소」다 —
 * 재는 기준점만 다르고 묻는 것은 똑같다.
 */
export const AUDIT_MAX_MOVE_KM = REFINE_RADIUS_KM;

/**
 * 카드 하나에 대해 검토할 AI 후보 수.
 *
 * 검색창(M28)은 다섯 줄을 사람에게 보여 주고 고르게 하지만, 여기서는 고를 사람이
 * 없다. 뒤로 갈수록 「혹시 이것일지도」인 후보들이라, 셋을 넘기면 얻는 것보다
 * 잘못 짚을 위험이 빨리 는다.
 */
export const AUDIT_MAX_CANDIDATES = 3;

/**
 * 카드 하나가 좌표 확인에 쓸 수 있는 Nominatim 요청 수.
 *
 * M35의 6은 「검색 한 번」의 예산이었다. 여기서는 그 검색이 카드 수만큼 반복되므로
 * 예산을 절반으로 줄인다 — 무료 서비스에 서른 번 연속으로 여섯 발씩 쏘지 않는다.
 */
export const AUDIT_REFINE_QUERIES = 3;

/**
 * 카드 하나가 주소 경유 스냅(M37)에 쓸 수 있는 grounded 호출 수.
 *
 * 검색창은 앞의 두 후보에 그 계단을 허락하지만(`ADDRESS_FALLBACK_CANDIDATES`),
 * 여기서는 **가장 앞 후보 하나**다. 카드 서른 장이 순차로 도는 길이고 grounded
 * 호출은 2~8초라, 후보마다 붙이면 훑기가 분 단위로 늘어지고 분당 20건 퓨즈가
 * 중간에 터진다. 한 장당 한 번이면 서른 장이 여전히 퓨즈 안이다.
 */
export const AUDIT_ADDRESS_CANDIDATES = 1;

/** 카드 한 줄의 판정. */
export type AuditStatus =
  /** OSM이 확인해 준 다른 자리가 있고, 옮길 만큼 멀다 — 유일하게 적용되는 줄. */
  | 'movable'
  /** 제안이 {@link AUDIT_MIN_MOVE_M} 안쪽 — 이미 맞다. */
  | 'near'
  /** 제안이 {@link AUDIT_MAX_MOVE_KM} 밖 — 다른 장소로 본다. */
  | 'far'
  /** AI가 못 찾았거나, OSM이 확인해 주지 못했다. */
  | 'missing'
  /** 확인하는 도중 실패했다(네트워크·AI 오류). */
  | 'failed';

/** 훑기의 입력 한 줄 — 저장된 카드 하나에서 뽑아낸 질문. */
export interface AuditTarget {
  cardId: Id;
  columnId: Id;
  /** 카드 제목. 그대로 검색어가 된다. */
  title: string;
  /** 지금 저장돼 있는 좌표. */
  from: GeoPoint;
  /** 프롬프트의 「여행지」 칸에 실릴 한 줄 ({@link auditHint}). */
  hint?: string;
}

/** 훑기의 결과 한 줄. */
export interface AuditRow extends AuditTarget {
  status: AuditStatus;
  /** 제안된 좌표. `missing`·`failed`에는 없다. */
  to?: PlaceCandidate;
  /** 지금 자리에서 제안까지의 거리(km). `to`가 있을 때만 있다. */
  distanceKm?: number;
}

/** 적용 한 건 — 카드 하나에 써 넣을 좌표. */
export interface AuditApply {
  cardId: Id;
  location: GeoPoint;
}

/* ------------------------------------------------------------------ *
 * 입력 만들기
 * ------------------------------------------------------------------ */

/** 「34.6525, 135.5063」 — 손으로 찍은 핀의 주소는 좌표 그 자체다. */
const LATLNG_ADDRESS = /^-?\d+(\.\d+)?,\s*-?\d+(\.\d+)?$/;

/**
 * 이 카드를 물어볼 때 프롬프트에 실을 「여행지」 한 줄.
 *
 * 1순위는 **카드에 저장된 주소**다. 「히요리 호텔」은 세상에 여럿 있고, 그 카드에
 * 이미 붙어 있는 「…나니와구, 오사카시, 일본」이 어느 히요리 호텔인지 아는 가장
 * 가까운 단서다 — 여행 전체의 목적지보다 좁다.
 *
 * 다만 손으로 찍은 핀의 주소는 좌표 문자열이라 단서가 되지 못한다(`utils/geo`의
 * `pinAddress`). 그럴 때는 여행의 목적지로 내려가고, 그것도 없으면 아무것도 싣지
 * 않는다 — 빈 문맥이 틀린 문맥보다 낫다.
 */
export function auditHint(card: Card, destination?: GeoPoint): string | undefined {
  const address = card.location?.address?.trim() ?? '';
  if (address !== '' && !LATLNG_ADDRESS.test(address)) return address;

  const fallback = destination?.address?.trim() ?? '';
  return fallback !== '' ? fallback : undefined;
}

/**
 * 이 여행에서 다시 맞춰 볼 카드들 — 지도에 찍히는 그 순서 그대로.
 *
 * 위치가 없는 카드는 애초에 대상이 아니고(고칠 좌표가 없다), 제목이 빈 카드도
 * 아니다(물어볼 말이 없다). {@link locatedCards}를 그대로 쓰므로 지도 탭이 보여
 * 주는 핀 목록과 언제나 같은 집합이다.
 */
export function auditTargets(workspace: Workspace, tripId: Id | undefined): AuditTarget[] {
  const destination = tripId ? workspace.trips[tripId]?.destination : undefined;

  const targets: AuditTarget[] = [];
  for (const card of locatedCards(workspace, tripId)) {
    const title = card.title.trim();
    if (title === '' || !card.location) continue;
    const hint = auditHint(card, destination);
    targets.push({
      cardId: card.id,
      columnId: card.columnId,
      title,
      from: card.location,
      ...(hint ? { hint } : {}),
    });
  }
  return targets;
}

/* ------------------------------------------------------------------ *
 * 판정 — 순수 규칙
 * ------------------------------------------------------------------ */

/**
 * 후보들 중 **지금 핀에 가장 가까운** 하나. 없으면 `null`.
 *
 * 이 도구는 장소를 새로 찾는 것이 아니라 이미 있는 핀을 확인하는 것이다. 그래서
 * 「모델이 가장 자신 있어 한 후보」가 아니라 「지금 자리에 가장 가까운 후보」가
 * 답이다 — 대강의 자리는 이미 사용자가 알려 준 셈이니까.
 *
 * 거리 계산은 M35의 {@link nearestWithin} 그대로다. 반경을 두지 않는 것은 일부러다:
 * 「너무 멀다」의 판정은 {@link evaluateProposal} 한 곳에만 있어야 하고, 여기서 한 번
 * 더 자르면 같은 규칙이 두 파일에 흩어진다.
 */
export function nearestCandidate(
  origin: GeoPoint,
  candidates: readonly PlaceCandidate[],
): PlaceCandidate | null {
  const near = nearestWithin(origin, candidates, Infinity);
  // `nearestWithin`은 배열의 원소를 그대로 돌려주므로 동일성으로 되찾을 수 있다.
  return near ? (candidates.find((candidate) => candidate === near) ?? null) : null;
}

/** 제안 하나를 판정으로. 거리는 제안이 있을 때만 함께 나온다. */
export function evaluateProposal(
  from: GeoPoint,
  to: PlaceCandidate | null,
): { status: AuditStatus; distanceKm?: number } {
  if (!to) return { status: 'missing' };

  const distanceKm = haversineKm(from, to);
  if (distanceKm * 1000 < AUDIT_MIN_MOVE_M) return { status: 'near', distanceKm };
  if (distanceKm > AUDIT_MAX_MOVE_KM) return { status: 'far', distanceKm };
  return { status: 'movable', distanceKm };
}

/** 판정 하나를 줄 하나로. */
export function buildRow(target: AuditTarget, to: PlaceCandidate | null): AuditRow {
  const { status, distanceKm } = evaluateProposal(target.from, to);
  return {
    ...target,
    status,
    ...(to ? { to } : {}),
    ...(distanceKm === undefined ? {} : { distanceKm }),
  };
}

/** 「210m」 · 「1.4km」 — 옮길 거리 한 마디. */
export function formatDistance(km: number): string {
  const metres = Math.round(Math.max(0, km) * 1000);
  if (metres < 1000) return `${metres}m`;
  return `${(metres / 1000).toFixed(1)}km`;
}

/** 목록에서 체크할 수 있는 줄인가 — 적용되는 것은 이것뿐이다. */
export const isApplicable = (row: AuditRow): boolean => row.status === 'movable';

/**
 * 「선택 적용」이 실제로 쓸 목록 — 체크된 `movable` 줄만.
 *
 * **주소는 그대로 둔다.** 바뀌는 것은 좌표 두 칸뿐이라는 M35의 규칙이 여기서도
 * 같다: 사용자가 「히요리 호텔」이라 적어 둔 줄이 재정비 한 번에 OSM의 행정구역
 * 사슬로 바뀌면, 고쳐 준 것이 아니라 남의 글씨로 덮은 것이다.
 */
export function applyPlan(
  rows: readonly AuditRow[],
  checked: ReadonlySet<Id>,
): AuditApply[] {
  const plan: AuditApply[] = [];
  for (const row of rows) {
    if (!isApplicable(row) || !row.to || !checked.has(row.cardId)) continue;
    const address = row.from.address;
    plan.push({
      cardId: row.cardId,
      location: {
        lat: row.to.lat,
        lng: row.to.lng,
        ...(address === undefined ? {} : { address }),
      },
    });
  }
  return plan;
}

/**
 * 적용 직전의 좌표들 — 실행 취소가 되돌려 놓을 목록.
 *
 * 계획과 **같은 순서, 같은 길이**로 나온다: 되돌리기는 방금 한 일의 정확한 역이지
 * 「원래대로 비슷하게」가 아니다.
 */
export function restoreSnapshot(
  rows: readonly AuditRow[],
  plan: readonly AuditApply[],
): AuditApply[] {
  const byId = new Map(rows.map((row) => [row.cardId, row] as const));
  const restore: AuditApply[] = [];
  for (const item of plan) {
    const row = byId.get(item.cardId);
    if (row) restore.push({ cardId: row.cardId, location: row.from });
  }
  return restore;
}

/* ------------------------------------------------------------------ *
 * 제안 만들기 — M35 기계를 그대로 돌린다
 * ------------------------------------------------------------------ */

/** {@link proposeLocation}이 갈아끼울 수 있는 것들. */
export interface ProposeDeps {
  /**
   * 구글 Places 후보들 (M44) — **주어지면 이 길만 쓴다**.
   *
   * 실제로는 `map/googlePlaceLookup.googlePlaceSearch`. 이 기기에 구글 키가
   * 없으면 화면이 아예 넘기지 않고, 그때는 M36~M37의 AI+OSM 길이 그대로 돈다.
   *
   * 구글이 답한 좌표는 보정 단계를 지나지 않는다 — 조일 이유가 없는 원본이다.
   */
  googleSearch?: (query: string, hint?: string) => Promise<PlaceCandidate[]>;
  /** 실제로는 `ai/aiPlaces.aiSearchPlaces`. */
  aiSearch: (query: string, hint?: string) => Promise<PlaceCandidate[]>;
  /** 실제로는 `utils/geo.searchPlaces`. */
  osmSearch: (query: string, signal?: AbortSignal) => Promise<GeoPoint[]>;
  /**
   * 실제로는 `ai/aiPlaces.aiPlaceAddress` (M37).
   *
   * 없으면 주소 경유 계단 없이 M36 그대로 돈다 — 이름으로 확인되지 않는 카드는
   * 「제안 없음」이 된다.
   */
  aiAddress?: (candidate: PlaceCandidate) => Promise<string | null>;
}

/** {@link proposeLocation}이 받는 것. */
export interface ProposeOptions extends ProposeDeps {
  signal?: AbortSignal;
}

/**
 * 카드 하나의 새 좌표 후보. **OSM이 확인해 준 것만** 돌려준다.
 *
 * 순서는 M35의 검색과 글자 그대로 같다 — AI에게 물어 현지 표기를 얻고
 * (`aiSearchPlaces`), 그 표기로 Nominatim에 되물어 좌표를 스냅한다
 * (`refineCandidates`). 다른 것은 셋뿐이다:
 *
 *  - **grounding 재시도를 끈다.** 카드 서른 장을 순차로 도는 길이라, 못 찾을
 *    때마다 느린 두 번째 호출을 붙이면 분당 20건 퓨즈에 그대로 걸린다. 못 찾은
 *    카드는 「제안 없음」으로 남고, 그 한 장은 카드 편집의 검색이 (재시도까지 붙여)
 *    맡는다.
 *  - **후보를 {@link AUDIT_MAX_CANDIDATES}개로 줄인다.** 고를 사람이 없는 자리다.
 *  - **`refined`가 없는 후보는 버린다.** 이 도구의 존재 이유가 「모델의 기억으로
 *    찍힌 좌표」를 고치는 것인데, 그 자리에 또 다른 기억을 넣으면 아무것도 나아지지
 *    않는다.
 *
 * M37의 주소 경유 계단은 **그대로 따라 들어온다**. 검색창과 같은 기계를 부르므로
 * 이름으로 확인되지 않는 카드(=OSM에 없는 작은 가게)도 주소로 한 번 더 확인되고,
 * 그렇게 확인된 좌표는 위의 셋째 규칙을 통과한다 — `refined`가 붙어 있으니까.
 * 다른 것은 예산뿐이다: 카드 한 장에 grounded 호출은 {@link AUDIT_ADDRESS_CANDIDATES}번.
 *
 * 던지는 것은 AI 쪽 실패(`AiError`)와 취소(`AbortError`)뿐이다 — 둘 다
 * {@link scanAudit}이 받아 준다. 주소 되묻기의 실패도 그중 **훑기를 멈춰야 할
 * 것만**({@link isFatalScanError}) 밖으로 내보낸다. `refineCandidates`는 이 계단의
 * 실패를 조용히 삼키도록 되어 있는데(검색창에서는 그게 맞다), 카드 서른 장을 도는
 * 자리에서 429를 삼키면 남은 카드가 전부 같은 벽에 8초씩 부딪친다.
 */
export async function proposeLocation(
  target: AuditTarget,
  options: ProposeOptions,
): Promise<PlaceCandidate | null> {
  const query = target.title.trim();
  if (query === '') return null;

  /* --- 구글이 있으면 구글만 (M44) ------------------------------------ */

  /**
   * 왜 「구글이 못 찾으면 AI로」가 아닌가.
   *
   * 이 파일의 첫째 규칙이 「OSM이 확인해 준 좌표만 제안한다」인 것과 같은
   * 이유다: 이 도구의 존재 이유가 **모델의 기억으로 찍힌 좌표를 고치는 것**인데,
   * 구글이 모르는 가게에 대해 모델의 기억을 다시 제안하면 아무것도 나아지지
   * 않는다. 구글이 모르면 「제안 없음」이 정직한 답이고, 그 한 장은 카드 편집의
   * 검색이 (사람이 보고 고르는 자리에서) 맡는다.
   *
   * 덤으로 AI 프록시의 분당 퓨즈와 Nominatim의 초당 정책이 이 길에는 없다.
   * 그래도 훑기는 여전히 순차다(`scanAudit`) — 카드 서른 장을 동시에 던질
   * 이유는 어느 엔진에서도 없다.
   */
  if (options.googleSearch) {
    const hits = await options.googleSearch(query, target.hint);
    return nearestCandidate(target.from, hits);
  }

  const found = await options.aiSearch(query, target.hint);
  if (found.length === 0) return null;

  const { aiAddress } = options;
  /** 삼켜진 실패 중 훑기를 멈춰야 할 것 — 아래에서 다시 던진다. */
  let fatal: unknown = null;

  const refined = await refineCandidates(found.slice(0, AUDIT_MAX_CANDIDATES), {
    osmSearch: options.osmSearch,
    signal: options.signal,
    maxQueries: AUDIT_REFINE_QUERIES,
    maxAddressCandidates: AUDIT_ADDRESS_CANDIDATES,
    ...(aiAddress
      ? {
          askAddress: async (candidate: PlaceCandidate) => {
            try {
              return await aiAddress(candidate);
            } catch (failure) {
              if (isFatalScanError(failure)) fatal = failure;
              throw failure;
            }
          },
        }
      : {}),
  });
  if (fatal) throw fatal;

  return nearestCandidate(
    target.from,
    refined.filter((candidate) => candidate.refined === true),
  );
}

/* ------------------------------------------------------------------ *
 * 훑기
 * ------------------------------------------------------------------ */

/** 사용자가 취소했는가. */
const isAbort = (failure: unknown): boolean =>
  failure instanceof DOMException && failure.name === 'AbortError';

/**
 * 한 카드의 실패가 **남은 카드까지** 실패시키는 종류인가.
 *
 * 429(분당 퓨즈)는 그렇다: 다음 카드도, 그다음 카드도 같은 답을 받는다. 서른 줄의
 * 「확인 실패」를 만들어 놓고 사람에게 읽으라고 하느니, 거기서 멈추고 지금까지의
 * 결과를 보여 주는 편이 낫다. 토큰·토글 문제(`auth`·`unavailable`)도 같은 부류다.
 *
 * 반대로 `network`·`server`·`parse`는 그 카드 하나의 사정일 수 있으므로 계속 간다.
 */
export function isFatalScanError(failure: unknown): boolean {
  return (
    failure instanceof AiError &&
    (failure.kind === 'rate' || failure.kind === 'auth' || failure.kind === 'unavailable')
  );
}

/** {@link scanAudit}이 받는 것. */
export interface ScanDeps {
  /** 카드 하나의 제안. 실제로는 {@link proposeLocation}. */
  propose: (target: AuditTarget, signal?: AbortSignal) => Promise<PlaceCandidate | null>;
  signal?: AbortSignal;
}

/**
 * 카드들을 **한 장씩 순서대로** 훑으며 줄을 하나씩 내놓는다.
 *
 * 동시에 쏘지 않는 이유는 두 가지다: AI 프록시의 분당 20건 퓨즈, 그리고 Nominatim의
 * 초당 1건 정책. 어차피 이 화면은 「N/M」을 세며 기다리는 화면이므로, 순차가
 * 느린 것이 아니라 순차라서 셀 수 있다.
 *
 * **던지지 않는다.** 취소(`AbortError`)는 조용히 끝내고, 카드 하나의 실패는
 * `failed` 줄로 내보내며, {@link isFatalScanError}에 해당하면 그 줄까지만 내고
 * 멈춘다. 어느 쪽이든 그때까지 나온 줄은 호출자의 손에 남아 있다 — 훑기를
 * 중간에 끊는 것이 결과를 버리는 일이면 아무도 취소 버튼을 누르지 않는다.
 */
export async function* scanAudit(
  targets: readonly AuditTarget[],
  deps: ScanDeps,
): AsyncGenerator<AuditRow, void, void> {
  for (const target of targets) {
    if (deps.signal?.aborted) return;

    let proposal: PlaceCandidate | null = null;
    try {
      proposal = await deps.propose(target, deps.signal);
    } catch (failure) {
      if (isAbort(failure)) return;
      yield { ...target, status: 'failed' };
      if (isFatalScanError(failure)) return;
      continue;
    }

    if (deps.signal?.aborted) return;
    yield buildRow(target, proposal);
  }
}
