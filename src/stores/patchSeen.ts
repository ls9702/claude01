/**
 * 「새 소식을 어디까지 봤는가」를 이 기기에 기억한다 (M40).
 *
 * `mapFilterPref`(M27)·`mapRoutePref`(M15)와 같은 자리에 있는 이유도 같다: 이건
 * 여행 데이터가 아니라 **이 기기의 사정**이다. 폰에서 패치노트를 읽었다고 노트북의
 * 배지까지 꺼지면 그건 동기화가 아니라, 노트북 앞의 사람이 새 소식을 영영 못 보는
 * 것이다. 워크스페이스에 넣으면 두 사람이 서로의 배지를 꺼 버리게 된다.
 *
 * 저장하는 값은 마지막으로 본 회차 id 하나뿐이다. 무엇이 들어와 있어도 읽을 때
 * 문자열 하나 또는 `null`로 정규화한다 — 손으로 고친 값이나 옛 형식 때문에 배지가
 * 영영 켜져 있거나 영영 꺼져 있으면 안 된다.
 */

import { LATEST_PATCH_ID } from '../patchNotes';

/** 이 기기가 마지막으로 본 회차 id가 앉는 자리. */
export const PATCH_SEEN_KEY = 'trip-board/patch-seen';

/** `localStorage`, 없거나 막혀 있으면 `null`. */
function storage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

/**
 * 저장된 값을 회차 id 하나로 만든다.
 *
 * 비었거나, 문자열이 아니거나, 공백뿐이면 「아무것도 안 봤다」(`null`)로 친다 —
 * 그 답은 배지를 **켜는** 쪽이다. 못 읽었을 때 조용히 새 소식을 감추는 것보다,
 * 한 번 더 보여 주는 쪽이 덜 나쁘다.
 */
export function normalizePatchSeen(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** 이 기기가 마지막으로 본 회차 id. 본 적 없거나 읽을 수 없으면 `null`. */
export function loadPatchSeen(): string | null {
  const store = storage();
  if (!store) return null;
  try {
    return normalizePatchSeen(store.getItem(PATCH_SEEN_KEY));
  } catch {
    return null;
  }
}

/** 「여기까지 봤다」를 적는다. 못 써도 치명적이지 않다 — 편의 표시다. */
export function savePatchSeen(id: string): void {
  const value = normalizePatchSeen(id);
  if (!value) return;
  const store = storage();
  if (!store) return;
  try {
    store.setItem(PATCH_SEEN_KEY, value);
  } catch {
    /* quota / private mode */
  }
}

/**
 * 배지를 띄울 것인가 — 마지막으로 본 id가 최신 회차와 **다르면** 띄운다.
 *
 * 「크다/작다」가 아니라 「다르다」인 이유: id는 순서일 뿐 크기가 아니고, 회차를
 * 되돌리거나 기기에 옛 값이 남아 있을 때 부등호는 조용히 틀린 답을 낸다. 다르면
 * 보여 주고, 열면 최신 id를 적는다 — 그게 전부다.
 */
export function hasUnseenPatch(seen: string | null, latest: string = LATEST_PATCH_ID): boolean {
  return normalizePatchSeen(seen) !== latest;
}
