/**
 * 드로우 페이지의 이름 규칙 (M52a) — 순수 함수뿐.
 *
 * 스토어 밖에 있는 이유는 `utils/sheetName`이 스토어 밖에 있는 이유와 같다:
 * 이건 데이터가 아니라 **문구**고, 혼자 시험될 수 있어야 한다.
 */

import type { DrawPage, Id, Workspace } from '../types/models';
import { copySheetName } from '../utils/sheetName';

/** 이름 없는 페이지가 받는 말 — 스토어와 화면이 같은 상수를 쓴다. */
export const DRAW_PAGE_FALLBACK = '새 페이지';

/**
 * 페이지 이름의 상한 (M52a-fix ⑨).
 *
 * 목록 한 줄은 이름 하나를 위한 자리이고, 200자짜리 이름은 그 줄을 통째로 먹은 뒤
 * 편집기 헤더에서도 잘린다. 자르는 자리를 화면이 아니라 **저장 직전**에 두는 이유는
 * 두 화면이 서로 다른 길이로 자르면 같은 페이지가 두 이름을 갖기 때문이다.
 */
export const DRAW_TITLE_MAX = 60;

/**
 * 저장될 이름 — 앞뒤 공백을 걷고 {@link DRAW_TITLE_MAX}에서 자른다.
 *
 * 빈 문자열이 나오면 그것은 「이름을 지웠다」가 아니라 「아무 말도 하지 않았다」이고,
 * 부르는 쪽이 원래 이름(또는 기본 이름)을 그대로 지킨다.
 */
export const clampPageTitle = (title: string | undefined): string =>
  (title ?? '').trim().slice(0, DRAW_TITLE_MAX);

/** 기본 제목의 꼬리: `페이지 3`. */
const NUMBERED = /^페이지\s+(\d+)$/;

/**
 * 새 페이지가 받을 제목 — 「페이지 N」.
 *
 * N은 **개수 + 1**이 아니라 「이미 있는 번호 중 가장 큰 것 + 1」이다. 페이지 셋을
 * 만들고 둘째를 지운 뒤 새로 만들면 개수 기준으로는 「페이지 3」이 되어 살아 있는
 * 「페이지 3」과 이름이 겹친다.
 */
export function nextPageTitle(existing: readonly string[]): string {
  let highest = 0;
  for (const title of existing) {
    const match = NUMBERED.exec(title.trim());
    if (!match) continue;
    const n = Number(match[1]);
    if (Number.isFinite(n) && n > highest) highest = n;
  }
  return `페이지 ${highest + 1}`;
}

/** 복제본이 받을 제목 — 시트 복제(M40)와 **같은** 규칙을 그대로 쓴다. */
export const copyPageTitle = (name: string, existing: readonly string[]): string =>
  copySheetName(name, existing, DRAW_PAGE_FALLBACK);

/**
 * 한 여행의 페이지들을 화면 순서대로 (지운 것은 빼고).
 *
 * `drawPageOrder`가 먼저이고, 그 배열이 모르는 페이지는 **오래된 것부터** 뒤에
 * 붙는다 — 병합이 순서 배열을 재조정하는 규칙(`sync/merge`)과 같은 답을 내도록
 * 일부러 같은 정렬이다. 다른 기기가 만든 페이지가 순서 배열보다 먼저 도착하는
 * 찰나에도 화면이 그것을 잃지 않는다.
 */
export function tripPages(workspace: Workspace, tripId: Id | undefined): DrawPage[] {
  if (!tripId) return [];
  const all = Object.values(workspace.drawPages ?? {}).filter(
    (page) => page.tripId === tripId && !page.deletedAt,
  );
  const byId = new Map(all.map((page) => [page.id, page]));

  const ordered: DrawPage[] = [];
  const seen = new Set<Id>();
  for (const id of workspace.trips[tripId]?.drawPageOrder ?? []) {
    const page = byId.get(id);
    if (!page || seen.has(id)) continue;
    seen.add(id);
    ordered.push(page);
  }

  const rest = all
    .filter((page) => !seen.has(page.id))
    .sort((a, b) => (a.createdAt !== b.createdAt ? a.createdAt - b.createdAt : a.id < b.id ? -1 : 1));

  return [...ordered, ...rest];
}

/** 화면에 실제로 그려지는 요소들 — 순서대로, 지운 것은 빼고. */
export const visibleElements = (page: DrawPage) =>
  page.elementOrder
    .map((id) => page.elements[id])
    .filter((element) => Boolean(element) && !element.deletedAt);

/** 겹침 순서를 바꾸는 네 가지 손짓. */
export type DrawReorder = 'front' | 'back' | 'forward' | 'backward';

/**
 * 겹침 순서를 다시 쓴다 (M53-1) — 「맨 앞으로」·「한 칸 뒤로」.
 *
 * 배열의 **뒤가 위**다(`DrawPage.elementOrder`). 그래서 「앞으로」는 뒤로 가는
 * 것이고, 이 이름의 어긋남은 여기 한 곳에 가둔다.
 *
 * 한 칸 옮기기가 단순한 자리 맞바꾸기가 아닌 이유는 둘이다. (a) 여럿을 골랐으면
 * **고른 것끼리는 서로를 밀지 않는다** — 셋을 한 칸 올리면 셋이 함께 한 칸
 * 올라가야지 앞의 하나만 올라가면 안 된다. (b) 지운 요소는 배열에 남아 있지만
 * 화면에 없다 — 그것과 자리를 바꾸면 사람 눈에는 아무 일도 일어나지 않는다.
 * 그래서 「보이는, 고르지 않은 이웃」을 찾아 그 너머로 넘는다.
 */
export function reorderIds(
  order: readonly Id[],
  ids: Iterable<Id>,
  where: DrawReorder,
  visible: (id: Id) => boolean = () => true,
): Id[] {
  const chosen = new Set(ids);
  const picked = order.filter((id) => chosen.has(id));
  if (picked.length === 0) return [...order];

  if (where === 'front') return [...order.filter((id) => !chosen.has(id)), ...picked];
  if (where === 'back') return [...picked, ...order.filter((id) => !chosen.has(id))];

  const list = [...order];
  if (where === 'forward') {
    // 오른쪽(위)부터 옮긴다 — 왼쪽부터 옮기면 앞의 것이 뒤의 것을 타고 넘는다.
    for (let i = list.length - 1; i >= 0; i -= 1) {
      if (!chosen.has(list[i])) continue;
      let j = i + 1;
      while (j < list.length && (chosen.has(list[j]) || !visible(list[j]))) j += 1;
      if (j >= list.length) continue;
      const [moved] = list.splice(i, 1);
      list.splice(j, 0, moved);
    }
    return list;
  }

  for (let i = 0; i < list.length; i += 1) {
    if (!chosen.has(list[i])) continue;
    let j = i - 1;
    while (j >= 0 && (chosen.has(list[j]) || !visible(list[j]))) j -= 1;
    if (j < 0) continue;
    const [moved] = list.splice(i, 1);
    list.splice(j, 0, moved);
  }
  return list;
}

/**
 * 목록이 보여 주는 「수정 시각」 (M52a-fix ①) — 껍데기와 요소 중 가장 늦은 것.
 *
 * 요소를 하나 그려도 페이지의 `updatedAt`은 더 이상 움직이지 않는다(그 도장이
 * 움직이면 껍데기 LWW가 상대의 이름 변경을 덮는다 — `stores/workspaceStore`의
 * `putPageBody` 참조). 그래서 「마지막으로 손댄 때」는 저장된 값 하나가 아니라
 * **계산되는 값**이다. 지운 요소도 센다: 지우는 것도 손대는 것이다.
 */
export function pageTouchedAt(page: DrawPage): number {
  let latest = page.updatedAt;
  for (const element of Object.values(page.elements)) {
    if (element.updatedAt > latest) latest = element.updatedAt;
  }
  return latest;
}

/** 세어서 보여주는 「요소 N개」의 N. */
export const liveElementCount = (page: DrawPage): number =>
  Object.values(page.elements).filter((element) => !element.deletedAt).length;
