/**
 * 지도에 무엇을 띄울지 정하는 순수 규칙 (M27).
 *
 * 지도는 M3부터 「이 여행의 위치 있는 카드 전부」를 한 번에 뿌렸다. 카드가 서른
 * 장을 넘어가면 그 화면은 지도가 아니라 압정 상자다 — 사용자가 실제로 묻는 것은
 * 「오늘 어디를 도나」, 「이 일정표에 넣어 둔 곳들만」, 「아직 어디에도 못 넣은
 * 곳은 뭐가 남았나」, 그리고 「맛집만」이다. 이 파일은 그 네 질문(범위)과 다섯
 * 번째 질문(카테고리)을 한 곳에서 답한다.
 *
 * ## 범위 네 가지
 *
 * | 범위 | 뜻 |
 * |---|---|
 * | `all` | 여행의 위치 있는 카드 전부 — M3부터의 동작이고, 기본값이다 |
 * | `sheet` | 고른 일정표의 **어느 날짜에든** 배치된 카드 |
 * | `day` | 고른 일정표의 **한 날짜**에 배치된 카드 (05시 창) |
 * | `unscheduled` | 위치는 있는데 그 일정표에는 없는 카드 — 「미확정」 |
 *
 * `sheet`와 `unscheduled`는 서로의 여집합이다(위치 있는 카드 안에서). 그래서 둘
 * 다 같은 한 집합 {@link sheetPlacedCardIds} 하나에서 나온다 — 두 번 세면 언젠가
 * 어긋난다.
 *
 * ## 일자 판정은 05시 창이다
 *
 * 「1일차」는 1일차 05:00부터 2일차 05:00까지다 (`timeline/dayWindow`). 새벽 2시
 * 라멘은 전날 밤의 일정이고, 일정표·필요 예산·동선이 이미 그렇게 센다. 지도의
 * 일자 필터가 달력 자정을 쓰면 같은 카드가 일정표에는 1일차, 지도에는 2일차로
 * 보인다 — 그래서 여기서도 {@link windowedDayEntries} 하나만 쓴다.
 *
 * ## 카테고리는 「꺼 둔 것」으로 센다
 *
 * 범례 칩(M3)이 이미 칼럼별 on/off였고, 그게 이 앱의 카테고리 필터다. 새 컨트롤을
 * 하나 더 만들면 같은 일을 하는 버튼이 두 벌이 된다. 그래서 여기서도 「보여 줄
 * 칼럼 목록」이 아니라 「꺼 둔 칼럼 목록」을 받는다: 카테고리를 새로 만들면
 * (사용자는 「맛집」을 만든다) 켜진 채로 등장하는 쪽이 언제나 옳다.
 *
 * 전부 순수 함수 — 워크스페이스를 읽기만 하고, React도 store도 모른다.
 */

import { windowedDayEntries, type DayAxis } from '../timeline/dayWindow';
import type { Card, Id, Workspace } from '../types/models';

/** 어떤 범위로 볼 것인가. */
export type MapScopeKind = 'all' | 'sheet' | 'day' | 'unscheduled';

/** 범위 선택 하나 — `day`일 때만 일자를 함께 든다. */
export interface MapScope {
  kind: MapScopeKind;
  /** `kind: 'day'`가 보고 있는 일자. 다른 범위에서는 무시된다. */
  dayId?: Id;
}

/** 기본 범위 — M3부터의 동작 그대로 「전체 아이템」. */
export const DEFAULT_MAP_SCOPE: MapScope = { kind: 'all' };

/** 지도 화면이 들고 있는 필터 전체. */
export interface MapFilter {
  scope: MapScope;
  /** 범위가 읽는 일정표. 없으면 일정 관련 범위는 아무것도 고르지 않는다. */
  sheetId?: Id;
  /** 꺼 둔 카테고리(보드 칼럼) — 나머지는 전부 보인다. */
  mutedColumns: readonly Id[];
}

/** 지도에 찍을 수 있는 위치인가 — 좌표가 둘 다 유한해야 한다. */
export function isLocated(card: Card | undefined): card is Card {
  const point = card?.location;
  if (!point) return false;
  return Number.isFinite(point.lat) && Number.isFinite(point.lng);
}

/**
 * 여행의 위치 있는 카드 — 보드 순서(칼럼 순서 → 칼럼 안 카드 순서)대로.
 *
 * 지도의 핀 목록과 같은 순서다: 범례 칩이 카테고리를 발견하는 순서이기도 해서,
 * 같은 여행이면 언제나 같은 줄로 그려진다.
 */
export function locatedCards(workspace: Workspace, tripId: Id | undefined): Card[] {
  const trip = tripId ? workspace.trips[tripId] : undefined;
  if (!trip) return [];

  const cards: Card[] = [];
  for (const columnId of trip.columnOrder) {
    const column = workspace.columns[columnId];
    if (!column) continue;
    for (const cardId of column.cardOrder) {
      const card = workspace.cards[cardId];
      if (isLocated(card)) cards.push(card);
    }
  }
  return cards;
}

/** 한 일정표가 들고 있는 일자 id들. 모르는 시트면 `null`. */
function sheetDayIds(workspace: Workspace, sheetId: Id | undefined): Set<Id> | null {
  const sheet = sheetId ? workspace.sheets[sheetId] : undefined;
  if (!sheet) return null;
  return new Set(sheet.dayOrder);
}

/**
 * 그 일정표의 어느 날짜에든 배치된 카드 id.
 *
 * 05시 창은 여기서 필요 없다 — 창은 한 시트 **안에서** 어느 열에 그릴지를 정할
 * 뿐, 엔트리가 어느 시트 소속인지를 바꾸지 않는다.
 */
export function sheetPlacedCardIds(workspace: Workspace, sheetId: Id | undefined): Set<Id> {
  const dayIds = sheetDayIds(workspace, sheetId);
  const placed = new Set<Id>();
  if (!dayIds) return placed;

  for (const entry of Object.values(workspace.entries)) {
    if (dayIds.has(entry.dayId)) placed.add(entry.cardId);
  }
  return placed;
}

/**
 * 그 **창**(05시~다음 날 05시)에 배치된 카드 id — 지도 1일차 = 일정표 1일차.
 *
 * 축(`dayOrder`)이 필요한 이유는 새벽 엔트리가 *앞 날*로 접히기 때문이다. 시트
 * 밖의 일자를 물으면 빈 집합이다: 다른 시트의 하루를 이 시트의 필터가 답할 수는
 * 없다.
 */
export function dayCardIdsWindowed(
  workspace: Workspace,
  dayId: Id | undefined,
  dayOrder: DayAxis,
): Set<Id> {
  const cardIds = new Set<Id>();
  if (!dayId) return cardIds;
  if (!dayOrder.some((item) => (typeof item === 'string' ? item : item.id) === dayId)) {
    return cardIds;
  }

  for (const row of windowedDayEntries(workspace, dayId, dayOrder)) {
    cardIds.add(row.entry.cardId);
  }
  return cardIds;
}

/**
 * 범위 하나가 허락하는 카드들 — 카테고리는 아직 보지 않는다.
 *
 * 언제나 {@link locatedCards}의 부분집합이고, 그 순서를 지킨다: 지도가 그리는
 * 것은 핀이고, 위치 없는 카드는 애초에 지도의 물음이 아니다.
 *
 * 시트를 못 고른 여행(일정표가 아직 없다)에서는 `sheet`·`day`가 빈 목록이고
 * `unscheduled`는 위치 있는 카드 전부다 — 정말로 아무것도 배치되지 않았으니까.
 */
export function scopeCards(
  workspace: Workspace,
  tripId: Id | undefined,
  filter: Pick<MapFilter, 'scope' | 'sheetId'>,
): Card[] {
  const cards = locatedCards(workspace, tripId);
  const { scope, sheetId } = filter;
  if (scope.kind === 'all') return cards;

  if (scope.kind === 'day') {
    const dayOrder = workspace.sheets[sheetId ?? '']?.dayOrder ?? [];
    const inDay = dayCardIdsWindowed(workspace, scope.dayId, dayOrder);
    return cards.filter((card) => inDay.has(card.id));
  }

  const placed = sheetPlacedCardIds(workspace, sheetId);
  return scope.kind === 'sheet'
    ? cards.filter((card) => placed.has(card.id))
    : cards.filter((card) => !placed.has(card.id));
}

/**
 * 최종 답: 범위 ∩ 카테고리.
 *
 * 지도가 실제로 그릴 카드들이다. 순서는 {@link locatedCards}의 보드 순서.
 */
export function visibleCards(
  workspace: Workspace,
  tripId: Id | undefined,
  filter: MapFilter,
): Card[] {
  const muted = new Set(filter.mutedColumns);
  const cards = scopeCards(workspace, tripId, filter);
  return muted.size === 0 ? cards : cards.filter((card) => !muted.has(card.columnId));
}

/** 같은 답을 id 집합으로 — 이미 만들어 둔 핀 목록을 거를 때 쓴다. */
export function visibleCardIds(
  workspace: Workspace,
  tripId: Id | undefined,
  filter: MapFilter,
): Set<Id> {
  return new Set(visibleCards(workspace, tripId, filter).map((card) => card.id));
}

/**
 * 결과가 비었을 때 화면이 할 말 — 왜 비었는지까지 말한다.
 *
 * 「핀이 없어요」 한 줄은 사용자가 방금 무엇을 눌렀는지를 모른 척하는 문장이다.
 * 카테고리를 꺼서 빈 것인지, 그 일자에 아무것도 없어서 빈 것인지를 구분해서
 * 말해야 다음에 무엇을 누를지 알 수 있다.
 */
export function emptyFilterHint(filter: MapFilter, scopeCount: number): string {
  if (scopeCount > 0) return '고른 카테고리에 해당하는 장소가 없어요';
  switch (filter.scope.kind) {
    case 'day':
      return '이 일자에 배치된 장소가 없어요';
    case 'sheet':
      return '이 일정표에 배치된 장소가 없어요';
    case 'unscheduled':
      return '위치가 있는 카드가 모두 일정표에 들어가 있어요';
    default:
      return '보여 줄 장소가 없어요';
  }
}
