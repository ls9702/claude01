/**
 * 안 읽음 계산 (M24) — 메모 탭 배지와 카드 NEW 표시의 유일한 근거.
 *
 * 「안 읽음」은 **기기**가 아니라 **사람**의 상태다. 내 폰에서 읽은 대화가
 * 맥북에서도 읽은 것이 되어야 하고, 그러려면 읽은 지점이 두 기기 사이를
 * 오가는 유일한 것 — 워크스페이스 — 안에 있어야 한다. 그래서 새 필드를 만드는
 * 대신 M13이 이미 갖고 있는 {@link Workspace.seenBy}를 **이름공간을 붙여**
 * 재사용한다:
 *
 *   - `memo:<tripId>:<profileId>` — 그 사람이 이 여행 메모에서 본 마지막 줄의 `createdAt`
 *   - `card:<cardId>:<profileId>` — 그 사람이 이 카드에서 본 마지막 코멘트의 `at`
 *
 * M13이 쓰던 평범한 키(`song`, `hoyabom`)와는 접두사 `memo:`/`card:`가
 * 갈라준다. 프로필 id에도 nanoid에도 `:`는 없으므로 두 이름공간이 서로를,
 * 또는 M13의 키를 덮어쓸 수 있는 경우는 없다. `sync/merge`의 `mergeSeenBy`는
 * 키마다 **큰 값이 이긴다**로 접으므로 스키마도 병합도 손대지 않는다
 * (schemaVersion은 그대로 1).
 *
 * **지워진 카드·여행의 키는 영원히 남는다 — 받아들인 비용이다.** `mergeSeenBy`에는
 * 톰스톤이 없어서, 한쪽에서 키를 지워도 다른 기기의 사본이 다음 병합에서
 * 그대로 되살린다. 즉 청소는 트래픽만 쓰고 아무것도 못 지운다. 키 하나는
 * 40바이트 남짓이고 카드는 사람이 손으로 만드는 만큼만 생긴다.
 *
 * 순수 함수만 있고 React도 스토어도 모른다 — 배지가 언제 뜨는지는 브라우저
 * 없이 증명할 수 있어야 하는 종류의 규칙이기 때문이다.
 */

import { isRemoved } from '../memo/thread';
import type { Card, Id, MemoMessage, Millis, Workspace } from '../types/models';

/** 이 사람이 이 여행 메모에서 어디까지 읽었는지. */
export const memoReadKey = (tripId: Id, profileId: string): string =>
  `memo:${tripId}:${profileId}`;

/** 이 사람이 이 카드 코멘트에서 어디까지 읽었는지. */
export const cardReadKey = (cardId: Id, profileId: string): string =>
  `card:${cardId}:${profileId}`;

/** `seenBy`에서 키 하나를 읽는다. 없거나 수상하면 0 — 즉 「아무것도 안 읽음」. */
function stampOf(seenBy: Record<string, Millis> | undefined, key: string): Millis {
  const at = seenBy?.[key];
  return typeof at === 'number' && Number.isFinite(at) ? at : 0;
}

/**
 * 이 메시지가 **나에게** 안 읽은 줄인가.
 *
 * `by`가 없거나 모르는 값이면 「상대의 것」으로 친다 — 말풍선을 좌우로 가르는
 * 규칙(`own = by === profileId`)과 정확히 같은 판단이다. 내 것이 아닌 줄에
 * 배지가 뜨는 편이, 상대가 프로필을 고르기 전에 쓴 줄이 조용히 사라지는
 * 편보다 낫다.
 */
function isUnread(memo: MemoMessage, stamp: Millis, profileId: string): boolean {
  if (isRemoved(memo)) return false;
  if (memo.by === profileId) return false;
  return memo.createdAt > stamp;
}

/** 여행별 안 읽은 메모 수와 그 합. */
export interface UnreadMemos {
  /** tripId → 안 읽은 메시지 수. 0인 여행은 키 자체가 없다. */
  byTrip: Record<Id, number>;
  /** 탭 배지에 찍히는 수. */
  total: number;
}

/**
 * 이 사람이 아직 안 읽은 메모를 여행별로 센다.
 *
 * 워크스페이스에 없는 여행(이미 지운 여행)의 메시지는 세지 않는다: 열 수 없는
 * 대화의 배지는 끌 방법이 없다.
 *
 * 읽은 기록이 아예 없는 여행의 기준선은 **0**이다. 그래서 이 기능이 처음
 * 배포되는 날, 그때까지 쌓인 대화는 한 번은 「안 읽음」으로 보인다. 의도한
 * 것이다 — 대안은 첫 실행 때 전부 읽음으로 찍는 것인데, 그건 정말 안 읽은
 * 줄까지 조용히 삼킨다. 한 번 열면 사라지는 배지가 더 정직하다.
 */
export function unreadMemos(workspace: Workspace, profileId: string | null): UnreadMemos {
  const byTrip: Record<Id, number> = {};
  let total = 0;
  if (!profileId) return { byTrip, total };

  /** 여행마다 한 번만 읽는다 — 메시지 수만큼 키를 조립할 이유가 없다. */
  const stamps = new Map<Id, Millis>();

  for (const memo of Object.values(workspace.memos ?? {})) {
    if (!workspace.trips[memo.tripId]) continue;

    let stamp = stamps.get(memo.tripId);
    if (stamp === undefined) {
      stamp = stampOf(workspace.seenBy, memoReadKey(memo.tripId, profileId));
      stamps.set(memo.tripId, stamp);
    }

    if (!isUnread(memo, stamp, profileId)) continue;
    byTrip[memo.tripId] = (byTrip[memo.tripId] ?? 0) + 1;
    total += 1;
  }

  return { byTrip, total };
}

/**
 * 「읽음」으로 찍을 값 — 스레드에서 가장 큰 `createdAt` (빈 스레드는 0).
 *
 * `Date.now()`가 아니라 **메시지의 시각**을 쓴다. 두 사람의 기기 시계는
 * 어긋나 있고, 상대 폰이 3분 빠르면 상대가 방금 보낸 줄의 `createdAt`은 내
 * `Date.now()`보다 미래다 — 내 시각으로 찍었다면 그 줄은 읽었는데도 계속
 * 안 읽음으로 남는다. 스레드가 스스로 말하는 시각으로 찍으면 시계 차이는
 * 계산에서 완전히 빠진다.
 *
 * 삭제된 줄도 센다: 스텁이라도 스레드 안에 있고, 그걸 다시 안 읽음으로
 * 만들 이유는 없다.
 */
export function latestSeenStamp(thread: readonly MemoMessage[]): Millis {
  let latest = 0;
  for (const memo of thread) {
    if (memo.createdAt > latest) latest = memo.createdAt;
  }
  return latest;
}

/**
 * 「여기까지 읽었어요」 줄이 들어갈 자리 — 첫 안 읽은 메시지의 인덱스.
 *
 * 안 읽은 줄이 없으면 `-1`. 스레드는 이미 `threadOf`가 정렬해 준 것이어야
 * 한다(오래된 것부터).
 */
export function firstUnreadIndex(
  thread: readonly MemoMessage[],
  stamp: Millis,
  profileId: string | null,
): number {
  if (!profileId) return -1;
  for (let index = 0; index < thread.length; index += 1) {
    if (isUnread(thread[index], stamp, profileId)) return index;
  }
  return -1;
}

/**
 * 이 카드에서 「읽음」으로 찍을 값 — 가장 나중 코멘트의 `at` (없으면 0).
 *
 * 코멘트의 시각 필드는 `createdAt`이 아니라 {@link CardComment.at}이다.
 * {@link latestSeenStamp}와 같은 이유로 이것도 기기 시계가 아니라 코멘트가
 * 들고 있는 시각이다.
 */
export function latestCommentStamp(card: Card | undefined): Millis {
  let latest = 0;
  for (const comment of card?.comments ?? []) {
    if (comment.at > latest) latest = comment.at;
  }
  return latest;
}

/**
 * 이 카드에 내가 아직 못 본 **상대의** 코멘트가 있는가.
 *
 * 안 읽은 메모와 같은 판단이다: 내가 쓴 것이 아니고(`by`가 없으면 상대의 것),
 * 내가 이 카드를 마지막으로 연 지점보다 나중인 코멘트. 개수는 세지 않는다 —
 * 보드 카드가 답할 질문은 「열어볼 이유가 생겼는가」 하나뿐이다.
 */
export function hasUnreadComments(
  card: Card,
  stamp: Millis,
  profileId: string | null,
): boolean {
  if (!profileId) return false;
  for (const comment of card.comments ?? []) {
    if (comment.by === profileId) continue;
    if (comment.at > stamp) return true;
  }
  return false;
}

/**
 * {@link hasUnreadComments}를 카드 목록에 한 번에 적용한다 — 보드 한 컬럼치.
 *
 * 카드마다 키를 조립해 `seenBy`를 찾는 일을 호출부(보드)가 매 렌더 반복하지
 * 않도록 여기서 한 번에 돈다. 안 읽은 카드만 키로 담아서, 보드는 `Set`에
 * 있는지만 물어보면 된다.
 */
export function cardsWithUnreadComments(
  cards: readonly Card[],
  workspace: Workspace,
  profileId: string | null,
): Set<Id> {
  const out = new Set<Id>();
  if (!profileId) return out;
  for (const card of cards) {
    const stamp = stampOf(workspace.seenBy, cardReadKey(card.id, profileId));
    if (hasUnreadComments(card, stamp, profileId)) out.add(card.id);
  }
  return out;
}
