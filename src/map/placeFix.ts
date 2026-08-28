/**
 * 배치할 때 위치를 한 번 되묻는 규칙 (M41) — 순수 함수만.
 *
 * 사연: 이 앱의 좌표는 세 군데서 온다. 사람이 찍은 핀, Nominatim 검색, 그리고
 * AI가 기억해 낸 좌표(M28·M35·M37). 셋 다 「구글 지도에서 보이는 그 가게」와
 * 수백 m 어긋날 수 있고, 실제로 어긋났다(M37의 잇푸도 난바점). 그런데 사람이
 * 그 사실을 알아채는 순간은 검색할 때가 아니라 **일정에 놓을 때**다 — 그때
 * 비로소 「내일 여기서 저기까지 걸어갈 수 있나」를 묻기 때문이다.
 *
 * 그래서 구글 시트에 카드를 놓으면, 그 자리에서 구글에 같은 이름을 한 번 물어
 * 보고 답이 충분히 멀 때만 조용히 확인을 청한다. 규칙은 세 줄이다:
 *
 * 1. **배치는 절대 막지 않는다** — 놓는 일은 이미 끝났고, 이 팝업은 그 뒤에 온다.
 * 2. 카드에 위치가 없으면 → 제안한다 (있는 편이 없는 편보다 낫다).
 * 3. 위치가 있으면 → {@link PLACE_FIX_MIN_M}보다 멀 때만 제안한다.
 *
 * 50m인 이유: 그보다 가까운 차이는 같은 건물의 다른 출입구이거나 도로 반대편
 * 이고, 그걸 물으면 팝업이 「예/아니오를 묻는 잡음」이 된다. 반대로 100m를
 * 넘어가면 다른 블록이고, 걸어가는 사람에게는 다른 장소다.
 *
 * 이 파일은 React도 구글도 모른다 — 거리 계산은 지도 경로가 이미 쓰는
 * {@link haversineKm}, 표기는 {@link formatDistanceKm} 하나를 그대로 빌린다.
 */

import { formatDistanceKm, haversineKm } from '../timeline/route';
import type { GeoPoint, Id, Workspace } from '../types/models';

/** 이보다 가까우면 묻지 않는다 — 같은 건물의 다른 문일 뿐이다. */
export const PLACE_FIX_MIN_M = 50;

/** 지도에 찍을 수 있는 좌표 한 쌍. */
export interface PlacePoint {
  lat: number;
  lng: number;
}

/** 구글이 돌려준 한 곳 — 팝업이 필요로 하는 전부. */
export interface PlaceSuggestion {
  /** `displayName` — 구글이 부르는 이름. */
  name: string;
  lat: number;
  lng: number;
  /** `formattedAddress`. 보정하면 카드의 주소가 이 값이 된다. */
  address?: string;
}

/** 물어볼지 말지, 그리고 그 이유. */
export interface PlaceFixDecision {
  /** 팝업을 띄울 것인가. */
  offer: boolean;
  /** 왜 그렇게 정했는가 — 팝업의 문장이 이 값에서 갈린다. */
  reason: 'no-location' | 'far' | 'near' | 'no-result';
  /** 기존 핀과 제안 사이의 거리(km). 기존 위치가 없으면 `0`. */
  distanceKm: number;
}

/** 좌표가 지도에 올릴 수 있는 값인가. */
export function isUsablePoint(point: PlacePoint | GeoPoint | undefined | null): boolean {
  if (!point) return false;
  return Number.isFinite(point.lat) && Number.isFinite(point.lng);
}

/**
 * 이 제안을 사람에게 보여 줄 것인가.
 *
 * 결과가 없으면 아무 일도 없었던 것처럼 지나간다(`no-result`) — 구글이 못 찾은
 * 것은 사용자의 잘못이 아니고, 그걸 알리는 팝업은 순수한 방해다.
 */
export function decidePlaceFix(
  current: GeoPoint | PlacePoint | undefined,
  suggestion: PlaceSuggestion | null | undefined,
): PlaceFixDecision {
  if (!suggestion || !isUsablePoint(suggestion)) {
    return { offer: false, reason: 'no-result', distanceKm: 0 };
  }
  if (!isUsablePoint(current)) {
    return { offer: true, reason: 'no-location', distanceKm: 0 };
  }

  const distanceKm = haversineKm(current as PlacePoint, suggestion);
  return distanceKm * 1000 > PLACE_FIX_MIN_M
    ? { offer: true, reason: 'far', distanceKm }
    : { offer: false, reason: 'near', distanceKm };
}

/**
 * 팝업의 첫 줄 — 「기존 위치와 250m 차이」.
 *
 * 카드에 위치가 없던 경우는 거리를 말할 수 없으니 대신 왜 떴는지를 말한다.
 * 거리 표기는 지도 경로 팝업과 같은 {@link formatDistanceKm}라, 같은 거리가 두
 * 화면에서 다르게 읽히는 일이 없다.
 */
export function placeFixDistanceLine(decision: PlaceFixDecision): string {
  if (decision.reason === 'no-location') return '카드에 위치가 없어 구글 결과를 제안해요';
  return `기존 위치와 ${formatDistanceKm(decision.distanceKm)} 차이`;
}

/** 보정이 무엇을 건드리는지 — 이 한 줄이 팝업의 경고다. */
export const PLACE_FIX_WARNING = '보정하면 이 카드의 위치가 바뀌어요 — 다른 시트와 지도에도 적용됩니다';

/**
 * 이 일자가 구글 시트의 일자인가 — 보정 팝업이 뜨는 유일한 조건이다.
 *
 * 배치 경로가 둘(드래그·탭)이라 판단도 두 번 하게 되는데, 두 곳이 서로 다르게
 * 판단하면 사용자에게는 「어떤 때는 뜨고 어떤 때는 안 뜨는 팝업」이 된다.
 */
export function isGoogleSheetDay(workspace: Workspace, dayId: Id | undefined): boolean {
  const day = dayId ? workspace.days[dayId] : undefined;
  if (!day) return false;
  return workspace.sheets[day.sheetId]?.mapEngine === 'google';
}

/**
 * 구글에 물어볼 때 기준으로 삼을 지점 — 카드의 현재 위치, 없으면 여행의 목적지.
 *
 * 「이치란」은 전 세계에 있다. 편향점이 없으면 구글은 도쿄를 줄 수도, 후쿠오카를
 * 줄 수도 있고, 그 답으로 오사카 카드를 보정하면 이 기능은 위치를 고치는 게
 * 아니라 부수는 기능이 된다.
 */
export function placeFixBias(
  workspace: Workspace,
  cardId: Id,
): PlacePoint | undefined {
  const card = workspace.cards[cardId];
  if (!card) return undefined;
  if (isUsablePoint(card.location)) {
    return { lat: card.location!.lat, lng: card.location!.lng };
  }
  const destination = workspace.trips[card.tripId]?.destination;
  return isUsablePoint(destination) ? { lat: destination!.lat, lng: destination!.lng } : undefined;
}
