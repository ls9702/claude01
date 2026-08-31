/**
 * 지도의 ⭐ 레이어가 무엇을 세울지 정하는 **순수 규칙** (M49).
 *
 * 입력은 워크스페이스 하나와 여행 id 하나뿐이고, 출력은 핀이 될 줄들과 「핀이 될
 * 수 없는 것이 몇 개인가」다. 구글도, Leaflet도, `localStorage`도 모른다 —
 * 그래야 「배치하지 않은 카드도 뜨는가」·「위치 없는 카드는 어떻게 되는가」를
 * 브라우저 없이 증명할 수 있다 (`map/filter.ts`와 같은 이유).
 *
 * ## 배치 여부를 보지 않는다
 *
 * M27의 범위 필터(전체/일정 전체/일자별/미확정)는 **카드 핀**의 규칙이다. 이
 * 레이어는 그 규칙을 통과하지 않는다: 맛집 목록은 「아직 어느 날에도 안 넣은
 * 후보」가 대부분이고, 그것들을 지도에서 보려고 만든 층이기 때문이다. 그래서
 * 맛집 칸의 위치 있는 카드는 **전부** 선다.
 */

import type { BoardColumn, Card, Id, Workspace } from '../types/models';
import { userGenreEmoji, userGenreOf, type UserGourmetGenre } from './userGenres';

/** 지도에 설 수 있는 우리 맛집 한 곳. */
export interface UserGourmetSpot {
  /** 카드 id — 이 한 곳의 유일한 이름이자 팝업이 여는 카드다. */
  cardId: Id;
  columnId: Id;
  title: string;
  /** 고른 갈래, 안 골랐거나 모르는 값이면 `null`. */
  genre: UserGourmetGenre | null;
  /** 핀 위에 설 글자 — 갈래가 없으면 🍽️. */
  emoji: string;
  /** 카드 메모 한 줄 (팝업에서 두 줄까지 보여 준다). */
  memo?: string;
  lat: number;
  lng: number;
  address?: string;
}

/** 이 여행의 맛집 칸들, 보드 순서대로. */
export function userGourmetColumns(
  workspace: Workspace,
  tripId: Id | undefined,
): BoardColumn[] {
  const trip = tripId ? workspace.trips[tripId] : undefined;
  if (!trip) return [];
  return trip.columnOrder
    .map((columnId) => workspace.columns[columnId])
    .filter((column): column is BoardColumn => Boolean(column) && column.gourmet === true);
}

/** 쓸 만한 좌표인가 — 지도 탭의 카드 핀과 같은 판정. */
function hasPoint(card: Card): boolean {
  const point = card.location;
  return Boolean(point) && Number.isFinite(point!.lat) && Number.isFinite(point!.lng);
}

/** 레이어가 그릴 것과, 그리지 못한 것의 수. */
export interface UserGourmetSet {
  spots: UserGourmetSpot[];
  /** 맛집 칸에 있지만 **위치가 없어** 핀이 될 수 없는 카드 수. */
  missing: number;
}

/**
 * 이 여행의 맛집 칸 카드 전부를 핀이 될 줄로 접는다.
 *
 * 순서는 보드 순서(칸 순서 → `cardOrder`)다. 지도에서는 순서가 보이지 않지만
 * 패널의 개수와 핀이 나는 순서는 그 순서를 따르므로, 두 기기가 같은 목록을
 * 다르게 그리는 일이 없다.
 */
export function userGourmetSpots(
  workspace: Workspace,
  tripId: Id | undefined,
): UserGourmetSet {
  const spots: UserGourmetSpot[] = [];
  let missing = 0;

  for (const column of userGourmetColumns(workspace, tripId)) {
    for (const cardId of column.cardOrder) {
      const card = workspace.cards[cardId];
      if (!card) continue;
      if (!hasPoint(card)) {
        // 핀을 못 세우는 것은 잘못이 아니라 사실이다 — 패널이 한 줄로 말한다.
        missing += 1;
        continue;
      }
      const point = card.location!;
      spots.push({
        cardId: card.id,
        columnId: column.id,
        title: card.title,
        genre: userGenreOf(card.gourmetGenre),
        emoji: userGenreEmoji(card.gourmetGenre),
        ...(card.memo ? { memo: card.memo } : {}),
        lat: point.lat,
        lng: point.lng,
        ...(point.address ? { address: point.address } : {}),
      });
    }
  }

  return { spots, missing };
}

/**
 * 장르 칩의 선택 — 기기별로 기억되는 값 (`stores/userGourmetPref.ts`).
 *
 * `genres`가 **비어 있으면 전부**다. M43의 `activeGenres`와 같은 규칙이고, 같은
 * 이유로 그렇다: 칩을 하나도 안 고른 상태를 「아무것도 안 보임」으로 읽으면 처음
 * 켠 사람이 빈 지도를 본다.
 */
export interface UserGourmetFilter {
  genres: readonly UserGourmetGenre[];
  /** 장르를 안 고른 곳도 보여 줄 것인가. */
  includeNone: boolean;
}

/** 아무것도 고르지 않은 상태 — 전부 보인다. */
export const DEFAULT_USER_GOURMET_FILTER: UserGourmetFilter = {
  genres: [],
  includeNone: true,
};

/** 한 곳이 지금의 필터를 통과하는가 (순수). */
export function passesUserFilter(
  spot: Pick<UserGourmetSpot, 'genre'>,
  filter: UserGourmetFilter,
): boolean {
  if (spot.genre === null) return filter.includeNone;
  if (filter.genres.length === 0) return true;
  return filter.genres.includes(spot.genre);
}

/**
 * 필터를 통과한 것들만, 들어온 순서 그대로.
 *
 * 「갈래를 든 무엇이든」으로 열어 둔 이유는 이 함수가 정말로 갈래 하나만 읽기
 * 때문이다 — 그래서 시험도 `{ genre }` 한 칸짜리로 쓸 수 있고, 화면은 통째의
 * {@link UserGourmetSpot}을 그대로 돌려받는다.
 */
export function visibleUserSpots<T extends Pick<UserGourmetSpot, 'genre'>>(
  spots: readonly T[],
  filter: UserGourmetFilter,
): T[] {
  return spots.filter((spot) => passesUserFilter(spot, filter));
}

/** 각 갈래가 몇 곳인가 — 칩 옆의 수. `null` 키는 「장르 없음」이다. */
export function userGenreCounts(
  spots: readonly Pick<UserGourmetSpot, 'genre'>[],
): Map<UserGourmetGenre | null, number> {
  const counts = new Map<UserGourmetGenre | null, number>();
  for (const spot of spots) counts.set(spot.genre, (counts.get(spot.genre) ?? 0) + 1);
  return counts;
}

/**
 * 핀이 하나도 없을 때 하는 말.
 *
 * 세 가지 빈손을 구별한다 — 맛집 칸이 비었나, 위치를 아직 안 넣었나, 칩이 다
 * 걸러 냈나. 「없어요」 한 마디는 셋 다에 맞지만 셋 다에 쓸모없다.
 */
export function emptyUserGourmetHint(
  total: number,
  missing: number,
  visible: number,
): string {
  if (total === 0 && missing === 0) {
    return '「맛집」 칸에 카드를 만들면 여기에 떠요';
  }
  if (total === 0) return '맛집 카드에 위치를 넣으면 지도에 떠요';
  if (visible === 0) return '고른 장르에 해당하는 곳이 없어요';
  return '';
}

/** 「위치 없는 3곳」 — 0이면 빈 문자열이라 화면이 그 줄을 아예 안 그린다. */
export function missingLocationLine(missing: number): string {
  return missing > 0 ? `위치 없는 ${missing}곳` : '';
}
