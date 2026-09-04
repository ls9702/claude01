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

/** 세어서 보여주는 「요소 N개」의 N. */
export const liveElementCount = (page: DrawPage): number =>
  Object.values(page.elements).filter((element) => !element.deletedAt).length;
