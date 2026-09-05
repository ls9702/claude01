/**
 * 드로우 편집 세션 (M52b) — **비영속 모듈 메모리**.
 *
 * 여기 사는 것은 「데이터」가 아니라 「지금 이 방문에서 손이 어디에 있었나」다:
 * 페이지마다의 뷰(중심·배율), 고른 도구·색·굵기, 그리고 실행취소 스택.
 *
 * ## 왜 컴포넌트 상태가 아닌가
 *
 * 탭을 옮기면 `DrawEditor`는 **언마운트된다**. 지도에 다녀오면 배율이 1로,
 * 도구가 펜으로, 실행취소 스택이 빈 채로 돌아왔다 — 그리던 사람에게 그건
 * 「돌아왔다」가 아니라 「처음부터 다시」다. 모듈 메모리에 두면 화면이 사라졌다
 * 돌아와도 그대로다.
 *
 * ## 왜 저장하지 않는가 (idb·localStorage 둘 다 아니다)
 *
 * `stores/memoDraft`(M50)와 **같은 이유**다: 이건 기기의 사정이고, 며칠 뒤에
 * 되살아나면 오히려 놀랍다. 새로고침은 초기화다 — 의도된 것이고, HANDOFF에
 * 적혀 있다. 워크스페이스에 실리지 않으므로 동기화도, 백업도, 병합도 이 파일을
 * 모른다.
 *
 * 반응형(zustand)이 아닌 이유도 같은 결이다: 읽는 곳이 하나(`DrawEditor`의 첫
 * 렌더)뿐이고, 그 뒤로는 컴포넌트의 상태가 화면의 주인이다. 스토어는 그 값을
 * **받아 두었다가 다음 방문에 돌려주는 서랍**이다.
 */

import type { DrawTool } from '../draw/tools';
import {
  DRAW_COLORS,
  DRAW_RECENT_COLORS,
  DRAW_STICKERS,
  DRAW_STICKER_SIZES,
  DRAW_TEXT_SIZES,
  DRAW_WIDTHS,
  normalizeHex,
} from '../draw/tools';
import type { DrawElement, Id } from '../types/models';

/** 화면 왼쪽 위가 가리키는 **로컬 좌표**와 배율. */
export interface DrawViewState {
  x: number;
  y: number;
  scale: number;
}

/** 요소 하나의 변화 — 「이 id가 이랬다가 이렇게 됐다」. `null`은 없음이다. */
export interface DrawOp {
  id: Id;
  before: DrawElement | null;
  after: DrawElement | null;
}

/**
 * 실행취소 **한 걸음** (M53-1) — 요소 변화 여럿 + (있으면) 겹침 순서의 변화.
 *
 * M52a의 걸음은 `DrawOp` 하나였다. 그 모양으로는 「셋을 골라 옮기고 Ctrl+Z」가
 * 세 번 눌러야 되돌아가고, 「넷을 붙여넣고 Ctrl+Z」는 사고다 — 사람이 한 번에 한
 * 일은 한 번에 되돌아가야 한다. 그래서 걸음이 **묶음**이 됐다.
 *
 * `order`가 따로 있는 이유는 z-order가 요소의 필드가 아니라 페이지의 배열
 * (`DrawPage.elementOrder`)이기 때문이다. `DrawOp`의 모양을 건드리지 않고 걸음에
 * 한 칸을 더하는 쪽을 골랐다 — 요소 변화와 순서 변화는 같은 걸음 안에 함께 들 수
 * 있고(붙여넣기는 둘 다 한다), 서로를 흉내 낼 수는 없다.
 */
export interface DrawStep {
  ops: DrawOp[];
  order?: { before: Id[]; after: Id[] };
}

/** 페이지 하나가 기억하는 것. */
interface PageMemory {
  view?: DrawViewState;
  undo: DrawStep[];
  redo: DrawStep[];
}

/** 도구 서랍 — 페이지가 아니라 **사람**의 것이라 페이지를 옮겨도 따라온다. */
export interface DrawToolState {
  tool: DrawTool;
  color: string;
  width: number;
  sticker: string;
  stickerSize: number;
  textSize: number;
  /**
   * 도형의 채우기 색 (M53-2) — `null`이 「채우기 없음」이다.
   *
   * `undefined`가 아니라 `null`인 이유는 `rememberTools`가 `Partial`을 받기
   * 때문이다: `undefined`는 「이 값은 안 바꾼다」와 구별되지 않는다.
   */
  fill: string | null;
  /** 선·도형을 점선으로 (M53-2). */
  dash: boolean;
  /** 화살표의 촉이 붙는 자리 (M53-2). */
  heads: 'end' | 'both';
  /** 격자 스냅이 켜져 있나 (M53-2). */
  snap: boolean;
}

const pages = new Map<Id, PageMemory>();

const defaultTools = (): DrawToolState => ({
  tool: 'pen',
  color: DRAW_COLORS[0].value,
  width: DRAW_WIDTHS[1].value,
  sticker: DRAW_STICKERS[0],
  stickerSize: DRAW_STICKER_SIZES[0].value,
  textSize: DRAW_TEXT_SIZES[0].value,
  fill: null,
  dash: false,
  heads: 'end',
  snap: false,
});

let tools: DrawToolState = defaultTools();

function memoryOf(pageId: Id): PageMemory {
  const current = pages.get(pageId);
  if (current) return current;
  const fresh: PageMemory = { undo: [], redo: [] };
  pages.set(pageId, fresh);
  return fresh;
}

/** 지난 방문의 뷰 — 한 번도 연 적 없으면 `undefined`(그때는 가운데에서 시작). */
export const rememberedView = (pageId: Id): DrawViewState | undefined => memoryOf(pageId).view;

export function rememberView(pageId: Id, view: DrawViewState): void {
  memoryOf(pageId).view = view;
}

/** 이 페이지의 실행취소/다시실행 스택 — **같은 배열을 돌려준다**(참조로 민다). */
export const undoStack = (pageId: Id): DrawStep[] => memoryOf(pageId).undo;
export const redoStack = (pageId: Id): DrawStep[] => memoryOf(pageId).redo;

/* ── 클립보드 (M53-1) ──────────────────────────────── */

/**
 * 복사해 둔 요소들 — **OS 클립보드가 아니라 여기**.
 *
 * 이유 둘. (a) OS 클립보드에 우리 JSON을 넣으면 그것은 다른 앱에 붙는 쓰레기가
 * 된다(카카오톡에 `{"type":"stroke",…}`이 붙는다). (b) `navigator.clipboard.read()`는
 * 모바일 웹뷰에서 자주 없거나 권한을 묻는다 — 「복사」 한 번에 권한 시트가 뜨면
 * 그건 복사가 아니다.
 *
 * **페이지 밖에 사는 덕에 페이지 간 복사가 공짜로 따라온다** — 이 서랍은 어느
 * 페이지의 것도 아니라서, A에서 복사하고 B를 열어 붙여넣으면 그냥 된다.
 * 새로고침에 사라지는 것은 이 파일의 다른 것들과 같은 규칙이다(기기의 사정).
 */
let clipboard: DrawElement[] = [];

/** 붙여넣기 연타의 계단 — 같은 클립보드를 두 번 붙이면 두 칸 내려간다. */
let pasteRun = 0;

export function copyElements(elements: readonly DrawElement[]): void {
  if (elements.length === 0) return;
  clipboard = elements.map((element) => ({ ...element }));
  pasteRun = 0;
}

export const clipboardElements = (): readonly DrawElement[] => clipboard;

/** 다음 붙여넣기가 쓸 계단 번호(1부터) — 부를 때마다 한 칸 내려간다. */
export const nextPasteStep = (): number => (pasteRun += 1);

/* ── 최근 색 (M53-2) ──────────────────────────────── */

/**
 * 방금 쓴 색들 — 새것이 맨 앞, 최대 {@link DRAW_RECENT_COLORS}개.
 *
 * 클립보드와 같은 서랍에 사는 이유도 같다: 이건 데이터가 아니라 **이번 방문의
 * 손버릇**이다. 새로고침에 사라지는 것이 놀랍다는 말이 나오면 그때 `uiPersist`
 * 옆으로 옮기면 된다(HANDOFF §6-16의 그 결정거리).
 */
let recent: string[] = [];

export const recentColors = (): readonly string[] => recent;

/** 같은 색을 두 번 세지 않는다 — 이미 있으면 맨 앞으로 올라올 뿐이다. */
export function pushRecentColor(value: string): void {
  const hex = normalizeHex(value);
  if (!hex) return;
  recent = [hex, ...recent.filter((item) => item !== hex)].slice(0, DRAW_RECENT_COLORS);
}

/** 고른 도구·색·굵기. */
export const rememberedTools = (): DrawToolState => tools;

export function rememberTools(patch: Partial<DrawToolState>): void {
  tools = { ...tools, ...patch };
}

/**
 * 페이지가 사라졌을 때(삭제·여행 전환) 그 서랍도 비운다.
 *
 * 삭제한 페이지의 실행취소 스택이 남아 있으면, 같은 id가 되살아났을 때(삭제
 * 실행취소) 지난 방문의 걸음이 이어 붙는다 — 되살아난 페이지는 새 방문이다.
 */
export function forgetDrawPage(pageId: Id): void {
  pages.delete(pageId);
}

/** 시험과 세션 전환용 — 서랍을 통째로 비운다. */
export function resetDrawSession(): void {
  pages.clear();
  clipboard = [];
  pasteRun = 0;
  recent = [];
  tools = defaultTools();
}
