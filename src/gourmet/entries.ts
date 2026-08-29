/**
 * 「지금 조회할 큐레이션 목록」 — 이음매 하나 (M43).
 *
 * 화면은 `data/gourmet.ts`의 배열을 **직접** 읽지 않고 이 함수를 통해 읽는다.
 * 이유는 `map/googleLoader.ts`의 `__tripBoardFakeGoogle`, `map/googleRoutes.ts`의
 * `__tripBoardFakeRoutes`와 같다: e2e가 그 자리에 자기 것을 놓을 수 있어야 한다.
 *
 * 그런데 여기서의 이유는 하나 더 무겁다. 큐레이션 배열은 **조사 때마다 통째로
 * 갈리는 데이터**다(11줄로 태어나 127줄이 됐다). 스펙이 그 배열의 id를 직접
 * 적으면, 조사 한 번에 스펙 여섯 개가 깨진다 — 그리고 그건 기능이 망가졌다는
 * 뜻이 아니라 **스펙이 데이터를 검사하고 있었다**는 뜻이다. 스펙이 확인해야 하는
 * 것은 「이 목록을 순차로 조회하고, 캐시하고, 4.3 미만을 감춘다」는 배선이지
 * 「이치란이 목록에 있다」가 아니다.
 *
 * 그래서 스펙은 자기만의 작은 목록을 심고, 앱은 심어진 것이 있으면 그것을 쓴다.
 * 번들에 들어가는 것은 아래 세 줄뿐이다.
 *
 * 호출 **시점에** 읽는다 — 모듈이 평가되는 시각과 `addInitScript`가 도는 시각의
 * 순서에 기대지 않기 위해서다(로더와 같은 이유).
 */

import { GOURMET_ENTRIES, type GourmetEntry } from '../data/gourmet';

interface GourmetEntriesWindow {
  __tripBoardGourmetEntries?: unknown;
}

/**
 * 이번 활성화가 조회할 목록.
 *
 * 이 함수 하나가 조회(무엇을 구글에 묻나)와 화면(무엇이 핀·칩에 걸리나) 둘 다를
 * 덮는다 — 큐레이션 핀은 전부 이 목록을 해석한 결과에서만 나오기 때문이다.
 */
export function gourmetEntries(): readonly GourmetEntry[] {
  const seeded = (globalThis as unknown as GourmetEntriesWindow).__tripBoardGourmetEntries;
  return Array.isArray(seeded) ? (seeded as GourmetEntry[]) : GOURMET_ENTRIES;
}
