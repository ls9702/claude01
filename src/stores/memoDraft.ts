/**
 * 쓰다 만 메모 한 통 — 탭을 다녀와도 그대로 (M50, 헌터B #4).
 *
 * `MemoComposer`는 메모 탭에서만 마운트된다. 그래서 초안(`text`)과 붙여 둔
 * 사진(`staged`)이 컴포넌트의 `useState`에 살면, 지도에서 주소 하나 확인하고
 * 돌아온 사이에 통째로 사라진다 — 사진은 이미 블롭 저장소에 **바이트까지 다
 * 쓰인 뒤**라 더 나쁘다: 화면에서는 없어졌는데 스윕이 돌 때까지 자리를 잡고
 * 있고, 사람은 같은 사진을 다시 고른다.
 *
 * 그래서 초안을 컴포넌트 밖, 여행별로 하나씩 둔다.
 *
 * ## 왜 영속이 아닌가
 *
 * 이것은 **보내지 않은 말**이다. 워크스페이스에 넣으면 상대 기기로 동기화되어
 * 「쓰다 만 문장」이 남에게 보이고, `localStorage`에 넣으면 며칠 뒤 앱을 열었을
 * 때 맥락을 잃은 반 토막이 입력칸에 앉아 있다. 이 값이 살아야 하는 시간은
 * 「이 앱을 켜 둔 동안 탭을 오가는 사이」뿐이고, 그 수명에 정확히 맞는 그릇이
 * 메모리다. 새로고침하면 사라지는 것이 옳다.
 *
 * `photoGc`가 버려진 바이트를 쓸어 가는 규칙은 그대로다 — 초안이 사라져도(새로
 * 고침) 그 사진들은 아무도 참조하지 않는 바이트가 되어 평소의 스윕에 걸린다.
 */

import type { CardPhoto, Id } from '../types/models';

/** 한 여행에 딸린, 아직 보내지 않은 한 통. */
export interface MemoDraft {
  text: string;
  staged: CardPhoto[];
}

const EMPTY: MemoDraft = { text: '', staged: [] };

/** 여행 id → 초안. 모듈이 사는 동안만 산다. */
const drafts = new Map<Id, MemoDraft>();

/** 이 여행의 초안. 없으면 빈 것 — 호출자는 그대로 상태의 초기값으로 쓴다. */
export function loadMemoDraft(tripId: Id): MemoDraft {
  return drafts.get(tripId) ?? EMPTY;
}

/**
 * 초안을 갈무리한다. 비어 있으면 **자리째 지운다** — 「빈 초안」과 「초안 없음」이
 * 두 가지 모양을 갖지 않게, 그리고 여행을 스무 번 드나든 뒤에도 지도가 커지지
 * 않게 (`updateEntryNote`가 빈 메모를 키째 지우는 것과 같은 손질).
 */
export function saveMemoDraft(tripId: Id, draft: MemoDraft): void {
  if (draft.text === '' && draft.staged.length === 0) {
    drafts.delete(tripId);
    return;
  }
  drafts.set(tripId, draft);
}

/** 보냈다 — 이 여행의 초안은 이제 없다. */
export function clearMemoDraft(tripId: Id): void {
  drafts.delete(tripId);
}

/** 테스트가 모듈 상태를 비우는 문. */
export function resetMemoDrafts(): void {
  drafts.clear();
}
