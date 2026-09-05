import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  moveElementPatch,
  normalizeBox,
  pickTopElement,
  snapPoint,
  type Box,
} from '../../draw/geometry';
import { reorderIds, visibleElements, type DrawReorder } from '../../draw/pages';
import {
  DRAW_PASTE_OFFSET,
  handlePoint,
  handlesFor,
  marqueeHits,
  pasteElements,
  pickHandle,
  resizeBox,
  resizeElementPatch,
  unionBounds,
  uniformOnly,
  type HandleId,
} from '../../draw/transform';
import {
  backgroundRect,
  bufferToDataUrl,
  deliverPng,
  exportBounds,
  pngFileName,
  svgToPngBlob,
} from '../../draw/png';
import { finishStroke } from '../../draw/simplify';
import {
  DRAW_BG_MIN_OPACITY,
  DRAW_COLORS,
  DRAW_ERASER_SIZES,
  DRAW_GRID,
  DRAW_IMAGE_FIT,
  DRAW_MAX_SCALE,
  DRAW_MIN_SCALE,
  DRAW_PAGE_SIZE,
  DRAW_PALETTE,
  DRAW_PAPERS,
  DRAW_PAPER_CELL,
  DRAW_STICKERS,
  DRAW_STICKER_SIZES,
  DRAW_TEXT_MAX,
  DRAW_TEXT_SIZES,
  DRAW_TOOLS,
  DRAW_WIDTHS,
  HIGHLIGHT_WIDTH_FACTOR,
  centeredView,
  clampOpacity,
  eraserRadius,
  normalizeHex,
  type DrawTool,
} from '../../draw/tools';
import {
  clipboardElements,
  copyElements,
  nextPasteStep,
  pushRecentColor,
  recentColors,
  redoStack,
  rememberTools,
  rememberView,
  rememberedTools,
  rememberedView,
  undoStack,
  type DrawOp,
  type DrawStep,
} from '../../stores/drawSession';
import { getPhotoBlob, putPhotoBlob, usePhotoUrl, usePhotoUrls } from '../../stores/photoBlobs';
import { useUiStore } from '../../stores/uiStore';
import { useWorkspaceStore, type NewDrawElement } from '../../stores/workspaceStore';
import type { DrawElement, DrawImage, DrawPage, Id } from '../../types/models';
import { newId } from '../../utils/ids';
import { preparePhoto } from '../../utils/photos';
import AnchoredMenu from '../common/AnchoredMenu';
import Icon from '../common/Icon';
import DrawElementView from './DrawElementView';
import Sheet from '../common/Sheet';
import {
  CHIP_BUTTON,
  CHIP_SELECTED,
  POPOVER_CLASS,
  POPOVER_ROW_CLASS,
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
  TEXTAREA_CLASS,
  TOUCH_ICON_BUTTON_CLASS,
} from '../common/formStyles';

/**
 * 드로우 편집기 (M52a, M52b, M53-1) — 한 페이지를 그리는 자리.
 *
 * ## 네 가지 규칙
 *
 * **1. 그리는 동안 스토어를 건드리지 않는다.** 획은 pointerup에서 딱 한 번
 * 저장된다(단순화·양자화를 거쳐 요소 하나로). 그리는 동안 매 프레임 저장하면
 * 워크스페이스가 초당 수십 번 직렬화되고, 폴링으로 들어온 상대의 획이 내 손
 * 밑에서 리렌더를 일으킨다.
 *
 * **2. 스토어 뮤테이션은 언제나 요소 하나다.** 그래서 두 사람이 같은 페이지에
 * 동시에 그려도 병합이 둘 다 남긴다(`sync/merge`). 페이지를 통째로 쓰는
 * 뮤테이션은 이 화면에 **배경 사진 하나뿐**이고, 그것은 제목과 같은 껍데기라
 * 그렇게 갈리는 것이 맞다.
 *
 * **3. 확대·축소는 캔버스 안에서만 일어난다.** 페이지가 확대되는 것이 아니라
 * `viewBox`가 좁아지는 것이다 — M50-fix2가 「페이지 확대 고착」으로 데인 자리라,
 * 두 손가락이 브라우저의 확대에 닿지 않게 캔버스에만 `touch-action: none`을
 * 건다.
 *
 * **4. 방문의 상태는 모듈 메모리에 있다** (M52b). 뷰(중심·배율)·도구·실행취소
 * 스택은 `stores/drawSession`이 들고 있어, 지도에 다녀와도 그리던 그대로다.
 * 새로고침은 초기화다 — 그건 데이터가 아니라 손의 자리다.
 *
 * **5. 손짓은 한 번에 하나다** (M53-1). 그리기·팬·핀치·이동·리사이즈·마퀴가 한
 * 포인터 파이프에 살고, 지금 무엇을 하는 중인지는 {@link Gesture} **하나**가
 * 안다. M52a는 `draft`·`dragging`·`panFrom`·`gesture` 넷을 따로 들고 있었는데,
 * 거기에 리사이즈와 마퀴가 붙는 순간 「팬 중에 리사이즈가 시작되는」 조합이
 * 생긴다. 우선순위는 한 곳(`onPointerDown`)에서만 정해지고, 그중 맨 위는 여전히
 * **두 손가락은 언제나 팬/줌**이다.
 */

/** 뷰: 화면 왼쪽 위가 가리키는 **로컬 좌표**와 배율. */
interface View {
  x: number;
  y: number;
  scale: number;
}

/** 그리는 중인 것. 저장되기 전이라 스토어에 없다. */
type Draft =
  | { kind: 'stroke'; points: number[]; highlight: boolean }
  | { kind: 'shape'; tool: 'line' | 'arrow' | 'rect' | 'ellipse'; x0: number; y0: number; x1: number; y1: number }
  | null;

/**
 * 지금 손이 하고 있는 **한 가지** 일 (M53-1).
 *
 * 판별 유니온인 이유는 이것들이 서로 배타적이기 때문이다: 끌면서 동시에 핀치할
 * 수는 없다. 값은 ref에 산다(매 프레임 바뀌므로) — 화면이 알아야 하는 만큼만
 * {@link Preview}로 상태에 비친다.
 */
type Gesture =
  | { kind: 'draw' }
  | { kind: 'pan'; from: { x: number; y: number } }
  | { kind: 'pinch'; dist: number; midX: number; midY: number }
  | {
      kind: 'move';
      elements: DrawElement[];
      origin: { x: number; y: number };
      dx: number;
      dy: number;
    }
  | {
      kind: 'resize';
      elements: DrawElement[];
      handle: HandleId;
      origin: { x: number; y: number };
      from: Box;
      to: Box;
      uniform: boolean;
    }
  | { kind: 'marquee'; origin: { x: number; y: number }; box: Box; additive: boolean }
  | null;

/**
 * 다음에 그릴 것의 모양 (M53-2) — 색·굵기·채우기·점선·화살촉.
 *
 * 하나로 묶은 이유는 「고른 게 없으면 다음에 그릴 것, 있으면 그것」이라는 규칙이
 * 다섯 개로 늘었기 때문이다: 인자를 다섯 개 늘어놓으면 부르는 자리마다 순서를
 * 틀린다.
 */
interface DraftStyle {
  color: string;
  width: number;
  fill: string | null;
  dash: boolean;
  heads: 'end' | 'both';
}

/** 손짓이 화면에 남기는 자국 — 저장 전의 미리보기. */
type Preview =
  | { kind: 'move'; dx: number; dy: number }
  | { kind: 'resize'; from: Box; to: Box }
  | { kind: 'marquee'; box: Box }
  | null;

/** 선택 상자가 요소에서 떨어져 있는 거리(로컬 px 아님 — 화면 px을 배율로 나눈다). */
const SELECTION_INSET = 6;

/** 핸들의 화면 크기와 맞힘 여유(화면 px) — 손가락은 44px, 눈은 10px이다. */
const HANDLE_SIZE = 10;
const HANDLE_PAD = 24;

const clampScale = (scale: number): number =>
  Math.min(DRAW_MAX_SCALE, Math.max(DRAW_MIN_SCALE, scale));

/** 상자를 사방으로 부풀린다 — 선택 표시는 그림에 닿지 않아야 한다. */
const inflate = (box: Box, by: number): Box => ({
  x: box.x - by,
  y: box.y - by,
  w: box.w + by * 2,
  h: box.h + by * 2,
});

/** 빈 선택 — 새 `Set`을 매번 만들지 않으려고 하나를 돌려 쓴다(읽기만 한다). */
const NO_SELECTION: ReadonlySet<Id> = new Set<Id>();

/**
 * 겹침 순서 버튼 넷 — 아이콘이 아니라 **글자**다.
 *
 * 「맨앞」과 「앞으로」를 24px 선 그림 두 개로 구별시키는 것은 아이콘이 하지 못하는
 * 일이고, 이 줄은 어차피 선택했을 때만 뜬다.
 */
const ORDER_BUTTONS: readonly { where: DrawReorder; label: string }[] = [
  { where: 'front', label: '맨앞' },
  { where: 'forward', label: '앞으로' },
  { where: 'backward', label: '뒤로' },
  { where: 'back', label: '맨뒤' },
];

/** 입력칸에 글을 쓰는 중인가 — 단축키가 물러서야 하는 유일한 조건. */
const isTyping = (target: EventTarget | null): boolean => {
  const node = target as HTMLElement | null;
  const tag = node?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || node?.isContentEditable === true;
};

export default function DrawEditor({ page, onClose }: { page: DrawPage; onClose: () => void }) {
  const addDrawElement = useWorkspaceStore((s) => s.addDrawElement);
  const putDrawElement = useWorkspaceStore((s) => s.putDrawElement);
  const updateDrawElement = useWorkspaceStore((s) => s.updateDrawElement);
  const deleteDrawElement = useWorkspaceStore((s) => s.deleteDrawElement);
  const setDrawElementOrder = useWorkspaceStore((s) => s.setDrawElementOrder);
  const setDrawPageBackground = useWorkspaceStore((s) => s.setDrawPageBackground);
  const setDrawPagePaper = useWorkspaceStore((s) => s.setDrawPagePaper);
  const cards = useWorkspaceStore((s) => s.workspace.cards);
  const focusCard = useUiStore((s) => s.focusCard);
  const setTab = useUiStore((s) => s.setTab);

  // 도구 서랍은 **사람의 것**이라 페이지를 옮겨도, 탭을 옮겨도 따라온다.
  const saved = rememberedTools();
  const [tool, setToolState] = useState<DrawTool>(saved.tool);
  const [color, setColorState] = useState(saved.color);
  const [width, setWidthState] = useState(saved.width);
  const [sticker, setStickerState] = useState(saved.sticker);
  const [stickerSize, setStickerSizeState] = useState(saved.stickerSize);
  const [textSize, setTextSizeState] = useState(saved.textSize);
  const [fill, setFillState] = useState<string | null>(saved.fill);
  const [dash, setDashState] = useState(saved.dash);
  const [heads, setHeadsState] = useState<'end' | 'both'>(saved.heads);
  const [snap, setSnapState] = useState(saved.snap);
  const [pickerOpen, setPickerOpen] = useState(false);
  /** 색 시트가 열렸나 — 획의 색을 고르는 중인가, 채우기를 고르는 중인가 (M53-2). */
  const [colorSheet, setColorSheet] = useState<'stroke' | 'fill' | null>(null);
  const [styleOpen, setStyleOpen] = useState(false);
  const [paperOpen, setPaperOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [linksOpen, setLinksOpen] = useState(false);
  const [backgroundOpen, setBackgroundOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const setTool = useCallback((next: DrawTool) => {
    rememberTools({ tool: next });
    setToolState(next);
  }, []);
  const setColor = useCallback((next: string) => {
    rememberTools({ color: next });
    setColorState(next);
  }, []);
  const setWidth = useCallback((next: number) => {
    rememberTools({ width: next });
    setWidthState(next);
  }, []);
  const setSticker = useCallback((next: string) => {
    rememberTools({ sticker: next });
    setStickerState(next);
  }, []);
  const setStickerSize = useCallback((next: number) => {
    rememberTools({ stickerSize: next });
    setStickerSizeState(next);
  }, []);
  const setTextSize = useCallback((next: number) => {
    rememberTools({ textSize: next });
    setTextSizeState(next);
  }, []);
  const setFill = useCallback((next: string | null) => {
    rememberTools({ fill: next });
    setFillState(next);
  }, []);
  const setDash = useCallback((next: boolean) => {
    rememberTools({ dash: next });
    setDashState(next);
  }, []);
  const setHeads = useCallback((next: 'end' | 'both') => {
    rememberTools({ heads: next });
    setHeadsState(next);
  }, []);
  const setSnap = useCallback((next: boolean) => {
    rememberTools({ snap: next });
    setSnapState(next);
  }, []);

  /**
   * 뷰는 **페이지 id를 달고** 산다.
   *
   * 페이지를 바꾸면 한 렌더 동안은 상태가 아직 옛 페이지의 것이다 — id가 붙어
   * 있으면 그 렌더에서 옛 뷰가 새 페이지의 서랍에 잘못 저장되지 않는다.
   */
  const [viewState, setViewState] = useState<View & { pageId: Id; settled: boolean }>(() => {
    const remembered = rememberedView(page.id);
    return {
      pageId: page.id,
      // **자리 잡은 뷰인가** (M53-fix ①). 첫 렌더의 `{0,0,1}`은 뷰가 아니라 아직
      // 캔버스의 크기를 모르는 자리채움이다. 그것이 서랍에 적히면 크기가 잡힌
      // 뒤의 중앙 정렬이 그 값을 「지난 방문의 뷰」로 읽어, 새 페이지가 영영
      // 4000×4000의 왼쪽 위 구석에서 열린다. 기억은 자리 잡은 뷰만 한다.
      settled: remembered !== undefined,
      ...(remembered ?? { x: 0, y: 0, scale: 1 }),
    };
  });
  const [size, setSize] = useState({ w: 0, h: 0 });
  /**
   * 도구 바가 실제로 차지하는 높이 (M54) — 아래의 자리채움이 이 값을 쓴다.
   *
   * 지금까지는 `7.5rem`이라는 숫자가 박혀 있었고, 그 숫자는 「44px 두 줄」이라는
   * 그때의 사정을 적어 둔 것이었다. 둘째 줄이 접히기 시작하면(M54에서 태블릿
   * 대역이 그렇게 됐다) 그 숫자는 곧 틀린 숫자가 되고, 틀리는 방향이 나쁘다 —
   * 도구 바가 캔버스의 아랫동을 덮는다. 재서 쓰면 다음에 버튼이 하나 더 붙어도
   * 아무도 이 숫자를 고칠 필요가 없다.
   */
  const [toolbarHeight, setToolbarHeight] = useState(0);
  const [draft, setDraft] = useState<Draft>(null);
  /**
   * 고른 것들 (M53-1) — 하나가 아니라 **집합**이다.
   *
   * 「동선 한 덩어리를 통째로 옮긴다」가 이 도구에서 가장 자주 하고 싶은 일이고,
   * 그것을 하려면 선택이 하나여서는 안 된다. 순서는 이 집합이 아니라
   * `elementOrder`가 안다 — 겹침 순서 바꾸기와 붙여넣기가 같은 순서를 봐야 한다.
   */
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<Id>>(NO_SELECTION);
  /** 글자 시트가 열린 자리. `id`가 있으면 **새로 넣는 것이 아니라 고치는 것**이다. */
  const [textAt, setTextAt] = useState<{ x: number; y: number; id?: Id } | null>(null);
  /**
   * 잠긴 것을 **탭했을 때** 뜨는 한 줄 (M53-fix ②) — 폰의 잠금 해제 길.
   *
   * 데스크톱에는 Shift+클릭이 있지만 폰에는 Shift가 없어서, M53-2의 잠금은
   * 「한 번 잠그면 그 기기에서는 영영 못 푸는」 것이 되어 있었다. 잠긴 것 위를
   * 손가락으로 탭하면(끌면 마퀴다) 그 자리에 「🔒 잠김 — 풀기」 한 줄이 뜬다.
   * 요소는 **여전히 안 잡힌다** — 잠금이 하는 일이 바로 그것이므로.
   * `x`/`y`는 캔버스 감싼 상자 기준의 화면 좌표다(요소가 아니라 손가락 자리).
   */
  const [lockedHint, setLockedHint] = useState<{ id: Id; x: number; y: number } | null>(null);
  const [textValue, setTextValue] = useState('');
  /** 시트 안에서 고른 글자 크기 — 고치는 중이면 그 글자의 크기에서 시작한다. */
  const [textDraftSize, setTextDraftSize] = useState(saved.textSize);
  /**
   * 실행취소 스택은 **ref**이고 화면에 보이는 것은 길이 둘뿐이다.
   *
   * 상태 배열에 담고 `setState(fn)` 안에서 스토어를 건드리면 StrictMode의 개발
   * 빌드가 그 함수를 두 번 불러 되돌리기가 두 번 일어난다 — 업데이터는 순수해야
   * 한다는 규칙이 실제로 물리는 드문 자리다.
   *
   * 배열 자신은 `drawSession`의 것이다(같은 참조) — 탭을 다녀와도 이어진다.
   */
  const undoRef = useRef<DrawStep[]>(undoStack(page.id));
  const redoRef = useRef<DrawStep[]>(redoStack(page.id));
  const [stackSizes, setStackSizes] = useState({
    undo: undoRef.current.length,
    redo: redoRef.current.length,
  });
  const [spaceHeld, setSpaceHeld] = useState(false);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const menuRef = useRef<HTMLButtonElement | null>(null);
  const linksRef = useRef<HTMLDivElement | null>(null);
  /** 지금 화면에 닿아 있는 포인터들 — 두 개가 되면 팬/줌이다. */
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  /** 지금 하고 있는 한 가지 손짓 (M53-1) — 넷으로 흩어져 있던 것을 하나로. */
  const gesture = useRef<Gesture>(null);
  /** 그 손짓이 화면에 남기는 자국. 저장은 아직 일어나지 않았다. */
  const [preview, setPreview] = useState<Preview>(null);
  const pageIdRef = useRef(page.id);
  pageIdRef.current = page.id;

  const elements = useMemo(() => visibleElements(page), [page]);

  /**
   * 고른 요소들 — **그리는 순서대로**.
   *
   * 집합이 아니라 배열로 한 번 펴 두는 이유는 붙여넣기·겹침 순서·묶음 리사이즈가
   * 전부 「어느 것이 먼저인가」를 묻기 때문이다. 지운 요소는 여기서 조용히
   * 빠진다(상대가 지운 것을 내가 고르고 있을 수 있다).
   */
  const selection = useMemo(
    () => elements.filter((element) => selectedIds.has(element.id)),
    [elements, selectedIds],
  );
  /**
   * 고른 것 중 **손댈 수 있는** 것들 (M53-2) — 잠긴 것은 빠진다.
   *
   * 잠긴 것을 선택 자체에서 뺄 수는 없다: 그러면 잠금을 풀 손잡이가 사라진다.
   * 그래서 「고른 것」과 「움직일 것」을 나누고, 이동·리사이즈·삭제·스타일은 전부
   * 이쪽을 본다.
   */
  const movable = useMemo(() => selection.filter((element) => !element.locked), [selection]);
  /**
   * 고른 것 중 **사진들** (M53-fix ⑤) — 투명도는 이것들에만 얹는다.
   *
   * 「고른 게 없으면 다음에 그릴 것, 있으면 그것」이라는 규칙에서 투명도만
   * 예외인 이유는 얹을 데가 사진뿐이라서다: 다음에 그릴 획에는 투명도가 없다.
   */
  const selectedImages = useMemo(
    () => movable.filter((element): element is DrawImage => element.type === 'image'),
    [movable],
  );
  /** 슬라이더가 보여 줄 값 — 여럿이면 맨 앞의 것이 대표한다. */
  const imageOpacity = selectedImages.length > 0 ? clampOpacity(selectedImages[0].opacity) : 1;
  /** 탭한 잠긴 요소 — 그 사이에 지워지거나 풀렸으면 한 줄도 함께 사라진다. */
  const lockedHintElement = useMemo(() => {
    if (!lockedHint) return null;
    const element = page.elements[lockedHint.id];
    return element && !element.deletedAt && element.locked ? element : null;
  }, [lockedHint, page.elements]);
  /** 고른 것 전부를 감싸는 상자 — 하나든 여럿이든 같은 규칙이다. */
  const selectionBox = useMemo(() => unionBounds(selection), [selection]);
  const handles = useMemo(
    () => (movable.length > 0 ? handlesFor(selection) : []),
    [movable.length, selection],
  );
  /**
   * 붙인 사진들의 URL (M53-2) — **부모가 한 번 읽어 맵으로 내려 준다**.
   *
   * `DrawElementView`가 훅을 쓰지 않는다는 규칙(그래야 draft 미리보기와 PNG가 같은
   * 함수를 쓴다) 때문에 여기가 그 일을 한다.
   */
  const imagePhotoIds = useMemo(
    () => elements.filter((element) => element.type === 'image').map((element) => element.photoId),
    [elements],
  );
  const imageUrls = usePhotoUrls(imagePhotoIds);
  const backgroundUrl = usePhotoUrl(page.background?.photoId);
  const backgroundOpacity = page.background ? clampOpacity(page.background.opacity) : 1;

  /** 이 페이지를 가리키는 카드들 (M52b) — 헤더의 「연결된 카드 N」. */
  const linkedCards = useMemo(
    () => Object.values(cards).filter((card) => card.drawPageId === page.id),
    [cards, page.id],
  );

  /* ---------------------------------------------------------------- *
   * 뷰 — 크기 추적과 첫 중앙 정렬
   * ---------------------------------------------------------------- */

  useEffect(() => {
    const node = wrapRef.current;
    if (!node) return;
    const measure = () => setSize({ w: node.clientWidth, h: node.clientHeight });
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  /** 도구 바의 키 — 접히면(태블릿 대역) 자리채움도 같이 자란다 (M54). */
  useEffect(() => {
    const node = toolbarRef.current;
    if (!node) return;
    const measure = () => setToolbarHeight(node.offsetHeight);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  /** 이 렌더가 쓰는 뷰 — 상태가 아직 옛 페이지의 것이면 서랍(또는 가운데)을 본다. */
  const view: View =
    viewState.pageId === page.id && viewState.settled
      ? { x: viewState.x, y: viewState.y, scale: viewState.scale }
      : (rememberedView(page.id) ?? centeredView(size.w, size.h));

  const setView = useCallback((next: View | ((current: View) => View)) => {
    setViewState((current) => {
      const base: View =
        current.pageId === pageIdRef.current
          ? current
          : (rememberedView(pageIdRef.current) ?? current);
      const value = typeof next === 'function' ? next(base) : next;
      return { pageId: pageIdRef.current, settled: true, ...value };
    });
  }, []);

  /**
   * 페이지를 열면 한가운데에서 시작한다 — 4000×4000의 왼쪽 위 구석은 아무것도
   * 없다. 지난 방문의 뷰가 서랍에 있으면 **그 자리로** 돌아간다(M52b).
   */
  const centered = useRef<Id | null>(null);
  useEffect(() => {
    if (size.w === 0 || size.h === 0) return;
    if (centered.current === page.id) return;
    centered.current = page.id;
    const remembered = rememberedView(page.id);
    setViewState({ pageId: page.id, settled: true, ...(remembered ?? centeredView(size.w, size.h)) });
  }, [page.id, size.w, size.h]);

  /**
   * 바뀐 뷰를 서랍에 적어 둔다 — 옛 페이지의 뷰도, **자리 잡기 전의 뷰도** 적지
   * 않는다 (M53-fix ①).
   */
  useEffect(() => {
    if (viewState.pageId !== page.id || !viewState.settled) return;
    rememberView(page.id, { x: viewState.x, y: viewState.y, scale: viewState.scale });
  }, [page.id, viewState]);

  // 페이지를 바꾸면 실행취소 스택은 그 페이지의 것으로 갈아 끼운다.
  useEffect(() => {
    undoRef.current = undoStack(page.id);
    redoRef.current = redoStack(page.id);
    setStackSizes({ undo: undoRef.current.length, redo: redoRef.current.length });
    setSelectedIds(NO_SELECTION);
    setLockedHint(null);
  }, [page.id]);

  /** 팝오버는 바깥을 누르면 닫힌다 (카드의 일정 배지와 같은 규칙). */
  useEffect(() => {
    if (!linksOpen) return;
    const onDown = (event: PointerEvent) => {
      if (!linksRef.current?.contains(event.target as Node)) setLinksOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [linksOpen]);

  /** 알림 한 줄은 스스로 사라진다. */
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  const toLocal = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return {
        x: view.x + (clientX - rect.left) / view.scale,
        y: view.y + (clientY - rect.top) / view.scale,
      };
    },
    [view],
  );

  /** 화면의 한 점을 붙들어 둔 채 배율만 바꾼다. */
  const zoomAt = useCallback(
    (clientX: number, clientY: number, factor: number) => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return;
      setView((current) => {
        const scale = clampScale(current.scale * factor);
        if (scale === current.scale) return current;
        const px = clientX - rect.left;
        const py = clientY - rect.top;
        return {
          scale,
          x: current.x + px / current.scale - px / scale,
          y: current.y + py / current.scale - py / scale,
        };
      });
    },
    [setView],
  );

  /**
   * 「가운데」 — 어디로 갔든 **페이지 한가운데·배율 1**로 (M54).
   *
   * 4000×4000은 손가락 몇 번이면 아무것도 없는 벌판으로 나갈 수 있는 넓이고,
   * 거기서는 「내 그림이 어디 있지」를 축소로 되짚는 수밖에 없었다. 새 페이지가
   * 열리는 그 자리(`centeredView`)로 한 번에 돌아오는 문이 하나 있어야 한다 —
   * 계산이 같은 함수여야 「처음 열었을 때와 같은 자리」라는 약속이 지켜진다.
   *
   * 서랍(`rememberView`)을 여기서 직접 건드리지 않는 이유는 확대·팬과 같다:
   * 뷰가 바뀌면 그것을 적는 것은 저 아래의 effect 하나뿐이고, 길이 둘이 되는
   * 순간 어느 쪽이 마지막인지 아무도 모른다.
   */
  const recenter = useCallback(() => {
    setView(centeredView(size.w, size.h));
  }, [setView, size.w, size.h]);

  /* ---------------------------------------------------------------- *
   * 실행취소 — 한 가지 모양의 걸음 하나로 전부를 표현한다
   * ---------------------------------------------------------------- */

  const syncStacks = useCallback(() => {
    setStackSizes({ undo: undoRef.current.length, redo: redoRef.current.length });
  }, []);

  /**
   * 걸음 하나를 스택에 올린다 (M53-1) — **묶음**이라 Ctrl+Z 한 번에 되돌아간다.
   *
   * 빈 걸음은 올리지 않는다: 「선택만 하고 1px도 안 움직인 끌기」가 실행취소
   * 버튼을 켜 두면 사람은 그 버튼이 무엇을 되돌릴지 알 수 없다.
   */
  const record = useCallback(
    (step: DrawStep) => {
      if (step.ops.length === 0 && !step.order) return;
      undoRef.current.push(step);
      // 새 일을 하면 「다시실행」의 미래는 사라진다 — 모든 편집기가 그렇다.
      redoRef.current.length = 0;
      syncStacks();
    },
    [syncStacks],
  );

  const applyStep = useCallback(
    (step: DrawStep, direction: 'undo' | 'redo') => {
      for (const op of step.ops) {
        const target = direction === 'undo' ? op.before : op.after;
        if (target) putDrawElement(page.id, target);
        else deleteDrawElement(page.id, op.id);
      }
      if (step.order) {
        setDrawElementOrder(page.id, direction === 'undo' ? step.order.before : step.order.after);
      }
    },
    [deleteDrawElement, page.id, putDrawElement, setDrawElementOrder],
  );

  const undo = useCallback(() => {
    const step = undoRef.current.pop();
    if (!step) return;
    applyStep(step, 'undo');
    redoRef.current.push(step);
    setSelectedIds(NO_SELECTION);
    syncStacks();
  }, [applyStep, syncStacks]);

  const redo = useCallback(() => {
    const step = redoRef.current.pop();
    if (!step) return;
    applyStep(step, 'redo');
    undoRef.current.push(step);
    setSelectedIds(NO_SELECTION);
    syncStacks();
  }, [applyStep, syncStacks]);

  /** 새 요소를 저장하고 실행취소 한 걸음을 남긴다. */
  const commit = useCallback(
    (element: NewDrawElement): Id | null => {
      const id = addDrawElement(page.id, element);
      if (!id) return null;
      record({ ops: [{ id, before: null, after: { ...element, id, updatedAt: 0 } as DrawElement }] });
      return id;
    },
    [addDrawElement, page.id, record],
  );

  const removeElement = useCallback(
    (element: DrawElement) => {
      deleteDrawElement(page.id, element.id);
      record({ ops: [{ id: element.id, before: element, after: null }] });
      setSelectedIds((current) => {
        if (!current.has(element.id)) return current;
        const next = new Set(current);
        next.delete(element.id);
        return next;
      });
    },
    [deleteDrawElement, page.id, record],
  );

  /** 고른 것 전부를 지운다 — **한 걸음**이다(셋을 지우고 Ctrl+Z 세 번은 사고다). */
  const removeSelection = useCallback(() => {
    // 잠긴 것은 지워지지 않는다 (M53-2) — 「지우기」가 잠금을 이기면 잠금은 없는 것이다.
    if (movable.length === 0) return;
    const ops: DrawOp[] = [];
    for (const element of movable) {
      deleteDrawElement(page.id, element.id);
      ops.push({ id: element.id, before: element, after: null });
    }
    record({ ops });
    setSelectedIds(NO_SELECTION);
  }, [deleteDrawElement, movable, page.id, record]);

  /* ---------------------------------------------------------------- *
   * 고른 것에 하는 일들 (M53-1) — 이동·모양·겹침·복제
   * ---------------------------------------------------------------- */

  /** 고른 것들을 (dx, dy)만큼 — 끌기의 끝과 화살표 키가 **같은 함수**를 쓴다. */
  const moveSelection = useCallback(
    (targets: readonly DrawElement[], dx: number, dy: number) => {
      const ops: DrawOp[] = [];
      for (const element of targets) {
        const patch = moveElementPatch(element, dx, dy);
        updateDrawElement(page.id, element.id, patch);
        ops.push({ id: element.id, before: element, after: { ...element, ...patch } as DrawElement });
      }
      record({ ops });
    },
    [page.id, record, updateDrawElement],
  );

  /**
   * 색·굵기를 고른 것에 (M53-1).
   *
   * 규칙 하나다: **고른 게 없으면 다음에 그릴 것, 있으면 그것**. 두 규칙으로
   * 갈라 두면 「색을 바꿨는데 아무 일도 안 일어났다」와 「색을 바꿨더니 남의 획이
   * 바뀌었다」가 둘 다 생긴다. 얹을 데가 없는 요소(스티커의 색, 글자의 굵기)는
   * 조용히 건너뛴다 — 그것들은 그 필드를 갖고 있지 않다.
   */
  const applyStyle = useCallback(
    (
      kind: 'color' | 'width' | 'fill' | 'dash' | 'heads',
      value: string | number | boolean | null,
    ) => {
      const ops: DrawOp[] = [];
      for (const element of movable) {
        const shape = element.type === 'rect' || element.type === 'ellipse';
        const segment = element.type === 'line' || element.type === 'arrow';
        let patch: Partial<DrawElement> | null = null;
        if (kind === 'color' && element.type !== 'sticker' && element.type !== 'image') {
          patch = { color: value as string } as Partial<DrawElement>;
        } else if (
          kind === 'width' &&
          element.type !== 'sticker' &&
          element.type !== 'text' &&
          element.type !== 'image'
        ) {
          // 형광펜은 저장된 굵기 자체가 배수다(`HIGHLIGHT_WIDTH_FACTOR`) — 그
          // 배수를 잃으면 형광펜이 펜이 된다.
          const factor =
            element.type === 'stroke' && element.kind === 'highlight' ? HIGHLIGHT_WIDTH_FACTOR : 1;
          patch = { width: (value as number) * factor } as Partial<DrawElement>;
        } else if (kind === 'fill' && shape) {
          // 「채우기 없음」은 `null`로 들어와 **필드를 지운다** — `undefined`는
          // 직렬화에서 사라지므로, 저장된 모양이 채우기를 넣은 적 없는 도형과
          // 같아진다.
          patch = { fill: (value as string | null) ?? undefined } as Partial<DrawElement>;
        } else if (kind === 'dash' && (shape || segment)) {
          patch = { dash: (value as boolean) || undefined } as Partial<DrawElement>;
        } else if (kind === 'heads' && element.type === 'arrow') {
          patch = { heads: value === 'both' ? 'both' : undefined } as Partial<DrawElement>;
        }
        if (!patch) continue;
        updateDrawElement(page.id, element.id, patch);
        ops.push({ id: element.id, before: element, after: { ...element, ...patch } as DrawElement });
      }
      record({ ops });
    },
    [movable, page.id, record, updateDrawElement],
  );

  /**
   * 잠그기/풀기 (M53-2, #10) — 고른 것 **전부**를 한 걸음으로.
   *
   * 하나라도 안 잠긴 것이 있으면 「잠근다」이고, 전부 잠겨 있으면 「푼다」다. 두
   * 버튼으로 나누지 않는 이유는 폰의 팝오버 한 줄에 넣을 자리가 없기 때문이고,
   * 이 규칙이면 누른 결과가 언제나 눈에 보인다.
   */
  const toggleLock = useCallback(() => {
    if (selection.length === 0) return;
    const lock = selection.some((element) => !element.locked);
    const ops: DrawOp[] = [];
    for (const element of selection) {
      if (Boolean(element.locked) === lock) continue;
      const patch = { locked: lock || undefined } as Partial<DrawElement>;
      updateDrawElement(page.id, element.id, patch);
      ops.push({ id: element.id, before: element, after: { ...element, ...patch } as DrawElement });
    }
    record({ ops });
    setNotice(lock ? '잠갔어요 — 탭하면 풀 수 있어요' : '잠금을 풀었어요');
  }, [page.id, record, selection, updateDrawElement]);

  /**
   * 잠긴 것 하나를 풀고 곧바로 고른다 (M53-fix ②) — **한 걸음**.
   *
   * 「풀기」를 누른 손이 다음에 하려는 일은 그것을 옮기는 것이므로, 풀린 요소는
   * 이미 손에 잡혀 있어야 한다.
   */
  const unlockElement = useCallback(
    (id: Id) => {
      setLockedHint(null);
      const element = page.elements[id];
      if (!element || element.deletedAt || !element.locked) return;
      const patch = { locked: undefined } as Partial<DrawElement>;
      updateDrawElement(page.id, id, patch);
      record({ ops: [{ id, before: element, after: { ...element, ...patch } as DrawElement }] });
      setSelectedIds(new Set([id]));
      setNotice('잠금을 풀었어요');
    },
    [page.elements, page.id, record, updateDrawElement],
  );

  /**
   * 사진 투명도 (M53-fix ⑤) — 끄는 동안은 미리보기, 손을 떼면 **한 걸음**.
   *
   * `applyStyle`을 그대로 쓰지 않는 이유는 하나다: 슬라이더는 한 번 끄는 동안
   * 수십 번 값을 바꾸고, `applyStyle`은 부를 때마다 실행취소 한 걸음을 남긴다 —
   * 그러면 「진하기를 한 번 조절했다」를 되돌리는 데 Ctrl+Z를 마흔 번 눌러야
   * 한다. 그래서 시작할 때의 모습을 ref에 접어 두고, 끝날 때 그 전후로 한 걸음만
   * 남긴다. 저장은 여전히 손을 떼는 그 한 번이다(획·리사이즈와 같은 규칙).
   */
  const opacityFrom = useRef<readonly DrawImage[] | null>(null);
  const previewImageOpacity = useCallback(
    (value: number) => {
      if (!opacityFrom.current) opacityFrom.current = selectedImages;
      const opacity = clampOpacity(value);
      for (const element of selectedImages) {
        updateDrawElement(page.id, element.id, { opacity } as Partial<DrawElement>);
      }
    },
    [page.id, selectedImages, updateDrawElement],
  );
  const commitImageOpacity = useCallback(() => {
    const before = opacityFrom.current;
    opacityFrom.current = null;
    if (!before) return;
    const ops: DrawOp[] = [];
    for (const element of before) {
      const now = page.elements[element.id];
      if (!now || now.type !== 'image') continue;
      if (clampOpacity(now.opacity) === clampOpacity(element.opacity)) continue;
      ops.push({ id: element.id, before: element, after: now });
    }
    record({ ops });
  }, [page.elements, record]);

  /**
   * 색 하나를 고른 결과 (M53-2) — 「고른 게 없으면 다음에 그릴 것, 있으면 그것」.
   *
   * 도구 바의 여섯 색이 이미 쓰던 규칙 그대로이고, 색 시트도 같은 문을 지난다 —
   * 두 자리가 다른 규칙을 쓰면 「⋯에서 고른 색만 안 칠해진다」가 된다.
   */
  const chooseColor = useCallback(
    (value: string) => {
      const hex = normalizeHex(value);
      if (!hex) return;
      setColor(hex);
      pushRecentColor(hex);
      applyStyle('color', hex);
    },
    [applyStyle, setColor],
  );

  /** 채우기 색 — `null`이 「채우기 없음」이다. */
  const chooseFill = useCallback(
    (value: string | null) => {
      const hex = value === null ? null : normalizeHex(value);
      if (value !== null && !hex) return;
      setFill(hex);
      if (hex) pushRecentColor(hex);
      applyStyle('fill', hex);
    },
    [applyStyle, setFill],
  );

  /** 겹침 순서 — 순서 배열을 통째로 갈아 끼우고 그 전후를 한 걸음으로 남긴다. */
  const changeOrder = useCallback(
    (where: DrawReorder) => {
      if (selection.length === 0) return;
      const before = [...page.elementOrder];
      const after = reorderIds(
        before,
        selection.map((element) => element.id),
        where,
        (id) => Boolean(page.elements[id]) && !page.elements[id].deletedAt,
      );
      if (after.length === before.length && after.every((id, index) => id === before[index])) return;
      setDrawElementOrder(page.id, after);
      record({ ops: [], order: { before, after } });
    },
    [page.elementOrder, page.elements, page.id, record, selection, setDrawElementOrder],
  );

  /** 요소 여럿을 한 번에 만든다(붙여넣기·복제) — 새 id, 한 걸음, 그리고 선택 이동. */
  const addMany = useCallback(
    (drafts: readonly NewDrawElement[], message: string) => {
      const ops: DrawOp[] = [];
      const ids: Id[] = [];
      for (const draftElement of drafts) {
        const id = addDrawElement(page.id, draftElement);
        if (!id) continue;
        ids.push(id);
        ops.push({
          id,
          before: null,
          after: { ...draftElement, id, updatedAt: 0 } as DrawElement,
        });
      }
      if (ops.length === 0) return;
      record({ ops });
      // 붙여넣은 것이 곧바로 손에 잡혀야 한다 — 그러려고 붙여넣었다.
      setSelectedIds(new Set(ids));
      setTool('select');
      setNotice(message);
    },
    [addDrawElement, page.id, record, setTool],
  );

  const copySelection = useCallback(() => {
    if (selection.length === 0) return;
    copyElements(selection);
    setNotice(`${selection.length}개 복사했어요`);
  }, [selection]);

  /**
   * 붙여넣기 — 클립보드는 페이지 밖에 살아서 **다른 페이지에도** 붙는다.
   *
   * 연타하면 계단으로 내려간다(`nextPasteStep`): 같은 자리에 겹쳐 쌓이면 방금
   * 붙인 것이 어느 것인지 알 수 없다.
   */
  const pasteClipboard = useCallback(() => {
    const items = clipboardElements();
    if (items.length === 0) return;
    const offset = DRAW_PASTE_OFFSET * nextPasteStep();
    addMany(pasteElements(items, offset, offset), '붙여넣었어요');
  }, [addMany]);

  /** 복제 — 폰에는 Ctrl이 없다. 이 버튼 하나가 모바일 동등성이다. */
  const duplicateSelection = useCallback(() => {
    if (selection.length === 0) return;
    addMany(pasteElements(selection, DRAW_PASTE_OFFSET, DRAW_PASTE_OFFSET), '복제했어요');
  }, [addMany, selection]);

  /* ---------------------------------------------------------------- *
   * 키보드 — 데스크톱의 손 (M52b)
   * ---------------------------------------------------------------- */

  /**
   * Space는 손 모드, 그 밖은 편집기의 단축키다.
   *
   * **입력칸에 글을 쓰는 중이면 전부 물러선다** — 「1」을 타이핑하다 도구가
   * 바뀌면 그건 단축키가 아니라 사고다. 시트가 열려 있을 때도 마찬가지인데,
   * 시트의 입력칸이 곧 포커스를 가져가므로 같은 규칙 하나로 덮인다.
   */
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (isTyping(event.target)) return;

      if (event.code === 'Space') {
        event.preventDefault();
        setSpaceHeld(true);
        return;
      }

      const meta = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();

      if (meta && key === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (meta && key === 'y') {
        event.preventDefault();
        redo();
        return;
      }
      // 복사·붙여넣기·복제 (M53-1) — OS 클립보드가 아니라 편집기의 서랍이다.
      if (meta && key === 'c') {
        if (selection.length === 0) return;
        event.preventDefault();
        copySelection();
        return;
      }
      if (meta && key === 'v') {
        if (clipboardElements().length === 0) return;
        event.preventDefault();
        pasteClipboard();
        return;
      }
      if (meta && key === 'd') {
        if (selection.length === 0) return;
        event.preventDefault();
        duplicateSelection();
        return;
      }
      if (meta) return;

      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (selection.length === 0) return;
        event.preventDefault();
        removeSelection();
        return;
      }
      if (event.key === 'Escape') {
        if (textAt) {
          setTextAt(null);
          setTextValue('');
        } else if (selectedIds.size > 0) {
          setSelectedIds(NO_SELECTION);
        }
        return;
      }
      // 화살표는 **1px**, Shift를 누르면 10px (M53-1). 마우스로는 닿지 않는
      // 정밀도이고, 마우스가 없는 손에게는 유일한 이동 수단이다.
      if (event.key.startsWith('Arrow')) {
        if (movable.length === 0) return;
        // 스냅이 켜져 있으면 화살표 한 번이 **한 칸**이다 (M53-2) — 1px씩 밀면
        // 격자에서 벗어나고, 그 순간 스냅은 켜져 있으나 마나가 된다.
        const step = snap ? DRAW_GRID : event.shiftKey ? 10 : 1;
        const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
        const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
        if (dx === 0 && dy === 0) return;
        event.preventDefault();
        moveSelection(movable, dx, dy);
        return;
      }
      // 「0」은 도구가 아니라 **자리**다 (M54) — 도구 번호는 1부터라 0은 비어
      // 있었고, 「가운데로」는 손이 어디에 있든 눌리는 키여야 한다.
      if (event.key === '0') {
        event.preventDefault();
        recenter();
        return;
      }
      // 숫자 하나가 도구 하나 — 도구 바의 순서 그대로다(1=손, 2=펜 …).
      if (/^[1-9]$/.test(event.key)) {
        const spec = DRAW_TOOLS[Number(event.key) - 1];
        if (!spec) return;
        event.preventDefault();
        setTool(spec.id);
        if (spec.id !== 'select') setSelectedIds(NO_SELECTION);
      }
    };
    const up = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return;
      setSpaceHeld(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [
    copySelection,
    duplicateSelection,
    movable,
    moveSelection,
    pasteClipboard,
    recenter,
    redo,
    removeSelection,
    selectedIds,
    selection,
    setTool,
    snap,
    textAt,
    undo,
  ]);

  /* ---------------------------------------------------------------- *
   * 포인터 — 한 손가락은 도구, 두 손가락은 언제나 팬/줌
   * ---------------------------------------------------------------- */

  const handToolActive = tool === 'hand' || spaceHeld;

  /** 선택 표시가 실제로 앉는 상자 — 그림에서 조금 떨어져 있다. */
  const selectionFrame = selectionBox
    ? inflate(selectionBox, SELECTION_INSET / view.scale)
    : null;

  /**
   * 핸들의 맞힘 여유 — 화면에서 24px, **단 상자의 짧은 변의 3분의 1을 넘지 않는다**.
   *
   * 뒤의 단서가 없으면 48px짜리 스티커는 네 모서리의 여유가 서로 만나 한가운데까지
   * 덮고, 그 순간 스티커는 **옮길 수 없는 물건**이 된다(어디를 짚어도 리사이즈다).
   * 작은 것일수록 「가운데는 이동」이 지켜져야 한다.
   */
  const handlePad = (frame: Box): number =>
    Math.min(HANDLE_PAD / view.scale, Math.max(6 / view.scale, Math.min(frame.w, frame.h) / 3));

  /** 손짓 하나를 끝낸다 — 화면의 자국도 함께 지운다. */
  const clearGesture = (): void => {
    gesture.current = null;
    setPreview(null);
  };

  /** 선택 집합을 하나 토글 — Shift+클릭의 규칙. */
  const toggleSelected = (id: Id): void => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /**
   * `select` 도구의 pointerdown — 우선순위가 여기 한 곳에 있다.
   *
   * ① 핸들 → ② 고른 것 위 → ③ 다른 요소 위 → ④ 빈 곳(마퀴).
   * 핸들이 맨 위인 이유는 그것이 **선택 상자의 일부**라서다: 상자의 모서리를
   * 짚었는데 밑의 그림이 잡히면 리사이즈라는 손짓 자체가 성립하지 않는다.
   */
  const beginSelectGesture = (local: { x: number; y: number }, shift: boolean): void => {
    if (selectionFrame && selectionBox && movable.length > 0) {
      const handle = pickHandle(
        selectionFrame,
        local.x,
        local.y,
        handlePad(selectionFrame),
        handles,
      );
      if (handle) {
        gesture.current = {
          kind: 'resize',
          elements: movable,
          handle,
          origin: local,
          from: selectionBox,
          to: selectionBox,
          uniform: selection.some(uniformOnly),
        };
        setPreview({ kind: 'resize', from: selectionBox, to: selectionBox });
        return;
      }
    }

    // 잠긴 것은 없는 것처럼 통과한다 — **Shift+클릭일 때만** 보인다 (M53-2).
    // 그 한 가지 예외가 없으면 잠근 것을 다시 풀 길이 사라진다.
    const hit = pickTopElement(
      page.elements,
      page.elementOrder,
      local.x,
      local.y,
      eraserPad(),
      shift,
    );

    if (!hit) {
      // 빈 곳 끌기 = 마퀴. **`select` 도구에서만** 그렇다 — 다른 도구에서 이걸
      // 하면 손 도구의 팬이 죽는다(M51의 교훈: 폰에서만 드러난다).
      if (!shift) setSelectedIds(NO_SELECTION);
      const box = { x: local.x, y: local.y, w: 0, h: 0 };
      gesture.current = { kind: 'marquee', origin: local, box, additive: shift };
      setPreview({ kind: 'marquee', box });
      return;
    }

    if (shift) {
      // Shift+클릭은 고르고 마는 것이지 옮기는 것이 아니다.
      toggleSelected(hit.id);
      return;
    }

    // 이미 고른 것을 짚었으면 **묶음 전체**가 따라온다. 아니면 그것 하나만.
    const already = selectedIds.has(hit.id);
    const movers = (already ? movable : [hit]).filter((element) => !element.locked);
    if (!already) setSelectedIds(new Set([hit.id]));
    if (movers.length === 0) return;
    gesture.current = { kind: 'move', elements: movers, origin: local, dx: 0, dy: 0 };
    setPreview({ kind: 'move', dx: 0, dy: 0 });
  };

  const onPointerDown = (event: React.PointerEvent<SVGSVGElement>): void => {
    // 오른쪽·가운데 버튼으로는 그리지 않는다 (M52a-fix ⑤). 마우스에서만 묻는
    // 조건인 이유는 **손가락 둘**이 곧 팬/줌이기 때문이다: 두 번째 손가락은
    // `isPrimary`가 false이고, 그것까지 막으면 확대가 사라진다.
    if (event.button !== 0) return;
    if (event.pointerType === 'mouse' && !event.isPrimary) return;

    (event.target as Element).setPointerCapture?.(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    // 잠김 한 줄은 다음 손짓이 시작되는 순간 사라진다 (M53-fix ②).
    if (lockedHint) setLockedHint(null);

    if (pointers.current.size === 2) {
      // **두 손가락은 언제나 팬/줌이다** (M52a) — 상태 머신의 최상위 가로채기.
      // 두 번째 손가락이 닿는 순간 하던 것은 없던 일이 된다: 확대하려던 손이
      // 페이지에 줄 하나를 긋고 끝나면 그것은 확대가 아니고, 리사이즈 핸들을
      // 잡은 채 두 손가락이 되면 그림이 손가락을 따라 늘어나 버린다.
      setDraft(null);
      clearGesture();
      const [a, b] = [...pointers.current.values()];
      gesture.current = {
        kind: 'pinch',
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        midX: (a.x + b.x) / 2,
        midY: (a.y + b.y) / 2,
      };
      return;
    }
    if (pointers.current.size > 2) return;

    const local = toLocal(event.clientX, event.clientY);

    if (handToolActive) {
      gesture.current = { kind: 'pan', from: { x: event.clientX, y: event.clientY } };
      return;
    }

    switch (tool) {
      case 'pen':
      case 'highlight':
        gesture.current = { kind: 'draw' };
        setDraft({ kind: 'stroke', points: [local.x, local.y], highlight: tool === 'highlight' });
        return;
      case 'line':
      case 'arrow':
      case 'rect':
      case 'ellipse': {
        // 도형만 격자에 붙는다 (M53-2) — 손글씨는 붙이면 손글씨가 아니게 된다.
        const start = snapLocal(local);
        gesture.current = { kind: 'draw' };
        setDraft({ kind: 'shape', tool, x0: start.x, y0: start.y, x1: start.x, y1: start.y });
        return;
      }
      case 'eraser': {
        const hit = pickTopElement(page.elements, page.elementOrder, local.x, local.y, eraserPad());
        if (hit) removeElement(hit);
        return;
      }
      case 'select':
        beginSelectGesture(local, event.shiftKey);
        return;
      case 'text': {
        // **뒤따르는 합성 click을 막는다** (M53-fix ③). 손가락으로 캔버스를
        // 누르면 브라우저는 pointerdown 다음에 호환용 click을 하나 더 쏘는데,
        // 그 사이에 시트가 열려 버리므로 그 click이 방금 마운트된
        // `sheet-overlay`(=닫기) 위에 떨어진다 — 사용자에게는 「글자 도구가 아무
        // 반응이 없다」로 보인다. pointerdown에서 기본 동작을 막으면 그 합성
        // click 자체가 생기지 않는다(Sheet 쪽의 300ms 가드는 그 다음 그물이다).
        event.preventDefault();
        const at = snapLocal(local);
        setTextValue('');
        setTextDraftSize(textSize);
        setTextAt({ x: Math.round(at.x), y: Math.round(at.y) });
        return;
      }
      case 'sticker': {
        const at = snapLocal(local);
        commit({
          type: 'sticker',
          x: Math.round(at.x),
          y: Math.round(at.y),
          emoji: sticker,
          size: stickerSize,
        });
        return;
      }
      default:
        return;
    }
  };

  const onPointerMove = (event: React.PointerEvent<SVGSVGElement>): void => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      const previous = gesture.current?.kind === 'pinch' ? gesture.current : null;
      gesture.current = { kind: 'pinch', dist, midX, midY };
      if (!previous || previous.dist === 0) return;

      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return;
      setView((current) => {
        const scale = clampScale(current.scale * (dist / previous.dist));
        // 직전 가운데점 밑에 있던 로컬 좌표가 지금 가운데점 밑으로 오게 —
        // 벌리기(줌)와 밀기(팬)가 한 계산 안에서 함께 일어난다.
        const anchorX = current.x + (previous.midX - rect.left) / current.scale;
        const anchorY = current.y + (previous.midY - rect.top) / current.scale;
        return {
          scale,
          x: anchorX - (midX - rect.left) / scale,
          y: anchorY - (midY - rect.top) / scale,
        };
      });
      return;
    }

    const active = gesture.current;

    if (active?.kind === 'pan') {
      const from = active.from;
      active.from = { x: event.clientX, y: event.clientY };
      setView((current) => ({
        ...current,
        x: current.x - (event.clientX - from.x) / current.scale,
        y: current.y - (event.clientY - from.y) / current.scale,
      }));
      return;
    }

    const local = toLocal(event.clientX, event.clientY);

    if (active?.kind === 'move') {
      // 스냅은 **움직인 거리**에 건다 (M53-2): 요소의 좌표에 걸면 격자에서 벗어나
      // 있던 그림이 첫 픽셀에 튄다. 거리로 걸면 「지금 자리에서 한 칸씩」이다.
      const delta = snapLocal({ x: local.x - active.origin.x, y: local.y - active.origin.y });
      active.dx = delta.x;
      active.dy = delta.y;
      setPreview({ kind: 'move', dx: active.dx, dy: active.dy });
      return;
    }

    if (active?.kind === 'resize') {
      const delta = snapLocal({ x: local.x - active.origin.x, y: local.y - active.origin.y });
      const to = resizeBox(
        active.from,
        active.handle,
        delta.x,
        delta.y,
        active.uniform,
      );
      active.to = to;
      setPreview({ kind: 'resize', from: active.from, to });
      return;
    }

    if (active?.kind === 'marquee') {
      const box = normalizeBox(active.origin.x, active.origin.y, local.x, local.y);
      active.box = box;
      setPreview({ kind: 'marquee', box });
      return;
    }

    if (tool === 'eraser' && event.buttons !== 0) {
      const hit = pickTopElement(page.elements, page.elementOrder, local.x, local.y, eraserPad());
      if (hit) removeElement(hit);
      return;
    }

    setDraft((current) => {
      if (!current) return current;
      if (current.kind === 'stroke') {
        return { ...current, points: [...current.points, local.x, local.y] };
      }
      const end = snapLocal(local);
      return { ...current, x1: end.x, y1: end.y };
    });
  };

  const endPointer = (event: React.PointerEvent<SVGSVGElement>): void => {
    pointers.current.delete(event.pointerId);
    const active = gesture.current;

    // 핀치의 끝: 손가락 하나가 떨어져도 남은 하나가 그리기 시작하지는 않는다
    // (그 손가락의 pointerdown은 이미 지나갔다).
    if (active?.kind === 'pinch') {
      if (pointers.current.size < 2) gesture.current = null;
      return;
    }
    if (active?.kind === 'pan') {
      if (pointers.current.size === 0) gesture.current = null;
      return;
    }

    // **저장은 여기 한 번**이다 (M52a의 규칙 그대로): 끄는 동안 스토어는 손대지
    // 않았고, 손을 떼는 지금 한 걸음으로 들어간다.
    if (active?.kind === 'move') {
      clearGesture();
      // 1px도 안 움직였으면 그것은 이동이 아니라 선택이다.
      if (Math.abs(active.dx) >= 1 || Math.abs(active.dy) >= 1) {
        moveSelection(active.elements, active.dx, active.dy);
      }
      return;
    }

    if (active?.kind === 'resize') {
      const { from, to, elements: targets } = active;
      clearGesture();
      if (to.x !== from.x || to.y !== from.y || to.w !== from.w || to.h !== from.h) {
        const ops: DrawOp[] = [];
        for (const element of targets) {
          const patch = resizeElementPatch(element, from, to);
          if (Object.keys(patch).length === 0) continue;
          updateDrawElement(page.id, element.id, patch);
          ops.push({
            id: element.id,
            before: element,
            after: { ...element, ...patch } as DrawElement,
          });
        }
        record({ ops });
      }
      return;
    }

    if (active?.kind === 'marquee') {
      const { box, additive, origin } = active;
      clearGesture();
      // 탭 한 번(상자가 0)은 마퀴가 아니라 「빈 곳을 눌렀다」다 — pointerdown이
      // 이미 선택을 비웠다.
      if (box.w < 1 && box.h < 1) {
        // 다만 그 「빈 곳」 밑에 **잠긴 것**이 있으면 왜 안 잡히는지와 푸는 길을
        // 한 줄로 말한다 (M53-fix ②). 손가락일 때만인 이유는 마우스에는 이미
        // Shift+클릭이라는 길이 있고, 그 길을 쓰는 손 앞에 팝오버를 띄우면
        // 다음 클릭이 그 팝오버에 떨어지기 때문이다.
        if (event.pointerType !== 'mouse') {
          const under = pickTopElement(
            page.elements,
            page.elementOrder,
            origin.x,
            origin.y,
            eraserPad(),
            true,
          );
          const rect = wrapRef.current?.getBoundingClientRect();
          if (under?.locked && rect) {
            setLockedHint({
              id: under.id,
              x: event.clientX - rect.left,
              y: event.clientY - rect.top,
            });
          }
        }
        return;
      }
      const hits = marqueeHits(page.elements, page.elementOrder, box);
      setSelectedIds((current) => {
        const next = additive ? new Set(current) : new Set<Id>();
        for (const id of hits) next.add(id);
        return next;
      });
      return;
    }

    gesture.current = null;
    const current = draft;
    setDraft(null);
    if (!current) return;

    if (current.kind === 'stroke') {
      // **여기가 저장이 일어나는 유일한 곳이다** — 단순화·양자화를 지나 요소 하나.
      const points = finishStroke(current.points);
      if (points.length < 4) return;
      commit({
        type: 'stroke',
        points,
        color,
        width: current.highlight ? width * HIGHLIGHT_WIDTH_FACTOR : width,
        kind: current.highlight ? 'highlight' : 'pen',
      });
      return;
    }

    const shape = draftElement(current, draftStyle);
    if (shape) commit(shape);
  };

  const onWheel = (event: React.WheelEvent<SVGSVGElement>): void => {
    // 트랙패드의 두 손가락 밀기는 가로 성분(`deltaX`)을 남긴다 — 그 손짓은
    // 팬이다. 휠 하나뿐인 마우스는 `deltaX`가 언제나 0이므로 줌이다. 핀치
    // 제스처는 브라우저가 `ctrlKey`를 실어 보낸다.
    if (event.ctrlKey || event.metaKey) {
      zoomAt(event.clientX, event.clientY, event.deltaY < 0 ? 1.1 : 1 / 1.1);
      return;
    }
    if (event.deltaX !== 0 || event.shiftKey) {
      setView((current) => ({
        ...current,
        x: current.x + (event.shiftKey && event.deltaX === 0 ? event.deltaY : event.deltaX) / current.scale,
        y: current.y + (event.shiftKey && event.deltaX === 0 ? 0 : event.deltaY) / current.scale,
      }));
      return;
    }
    zoomAt(event.clientX, event.clientY, event.deltaY < 0 ? 1.1 : 1 / 1.1);
  };

  /**
   * 지우개·선택의 여유(로컬 px) — 화면에서 늘 같은 굵기로 느껴지게 배율을 나눈다.
   *
   * 지우개일 때는 **굵기 선택이 곧 지우개 크기**다 (M53-2, #11): 폰에서 획 하나를
   * 정확히 짚는 것이 실제로 어려운 자리라, 「크게」면 지나가기만 해도 지워진다.
   * 다른 도구에서는 예전의 10px 그대로다 — 선택의 여유까지 커지면 옆의 것이 잡힌다.
   */
  const eraserPad = (): number => (tool === 'eraser' ? eraserRadius(width) : 10) / view.scale;

  /** 격자에 붙인 점 (M53-2, #5) — 스냅이 꺼져 있으면 그대로 돌려준다. */
  const snapLocal = (point: { x: number; y: number }): { x: number; y: number } =>
    snapPoint(point.x, point.y, DRAW_GRID, snap);

  const submitText = (): void => {
    // 상한은 화면이 아니라 **저장 직전**에 건다 (M52a-fix ⑨): 500자를 넘는 글자
    // 하나는 페이지를 가로지르는 한 줄이 되고, 그것을 지우려면 그 줄을 찾아
    // 짚어야 한다.
    const value = textValue.trim().slice(0, DRAW_TEXT_MAX);
    const at = textAt;
    const size = textDraftSize;
    setTextAt(null);
    setTextValue('');
    if (!at) return;

    // 고치는 중이었다 (M53-1) — 글자를 다 지우고 넣으면 그건 「지운다」는 뜻이다.
    if (at.id) {
      const element = page.elements[at.id];
      if (!element || element.deletedAt || element.type !== 'text') return;
      if (value === '') {
        removeElement(element);
        return;
      }
      if (value === element.text && size === element.size) return;
      const patch = { text: value, size } as Partial<DrawElement>;
      updateDrawElement(page.id, at.id, patch);
      record({
        ops: [{ id: at.id, before: element, after: { ...element, ...patch } as DrawElement }],
      });
      return;
    }

    if (value === '') return;
    // 새로 넣은 크기는 서랍이 기억한다 — 다음 글자도 그 크기다.
    setTextSize(size);
    commit({ type: 'text', x: at.x, y: at.y, text: value, color, size });
  };

  /**
   * 글자를 더블탭하면 그 글자를 고친다 (M53-1).
   *
   * 새로 넣는 시트를 값만 채워 다시 여는 것이라 화면이 하나 더 늘지 않는다 —
   * 「넣기」와 「고치기」가 같은 자리에서 같은 모양이어야 손이 헷갈리지 않는다.
   */
  const onDoubleClick = (event: React.MouseEvent<SVGSVGElement>): void => {
    if (tool !== 'select') return;
    const local = toLocal(event.clientX, event.clientY);
    const hit = pickTopElement(page.elements, page.elementOrder, local.x, local.y, eraserPad());
    if (!hit || hit.type !== 'text') return;
    event.preventDefault();
    clearGesture();
    setSelectedIds(new Set([hit.id]));
    setTextValue(hit.text);
    setTextDraftSize(hit.size);
    setTextAt({ x: hit.x, y: hit.y, id: hit.id });
  };

  /* ---------------------------------------------------------------- *
   * 붙인 사진 (M53-2, B2)
   * ---------------------------------------------------------------- */

  /**
   * 사진 한 장을 **요소로** 놓는다 — 붙여넣기·드롭·도구 바 버튼이 같은 문을 지난다.
   *
   * 바이트는 배경·카드 사진과 **완전히 같은 길**이다(`preparePhoto` → 새 id로
   * `putPhotoBlob` → 그다음에 메타데이터). 중간에 죽으면 주인 없는 블롭 하나가
   * 남고 GC가 쓸어 간다 — 그 반대(가리키는데 바이트가 없다)는 깨진 화면이라
   * 일어나면 안 된다.
   *
   * 놓이는 크기는 **보이는 화면의 60%**다(`DRAW_IMAGE_FIT`). `preparePhoto`가 주는
   * 긴 변 1600px을 그대로 놓으면 사진 한 장이 화면을 다 덮고, 그러면 사람은 자기가
   * 무엇을 붙였는지 볼 수 없다. 확대해서 보고 있었으면 그만큼 작게 들어간다 —
   * 「지금 보이는 것」이 기준이라 손이 예측할 수 있다.
   */
  const insertImage = async (
    file: File | undefined,
    at?: { x: number; y: number },
  ): Promise<void> => {
    if (!file || !file.type.startsWith('image/')) return;
    setBusy('사진을 넣는 중…');
    try {
      const prepared = await preparePhoto(file);
      const photoId = newId();
      await putPhotoBlob(photoId, prepared.buf);

      const visibleW = size.w > 0 ? size.w / view.scale : DRAW_PAGE_SIZE / 2;
      const visibleH = size.h > 0 ? size.h / view.scale : DRAW_PAGE_SIZE / 2;
      const fit = Math.min(1, (visibleW * DRAW_IMAGE_FIT) / Math.max(1, prepared.w));
      const w = Math.max(16, Math.round(prepared.w * fit));
      const h = Math.max(16, Math.round(prepared.h * fit));
      const center = at ?? { x: view.x + visibleW / 2, y: view.y + visibleH / 2 };

      const id = commit({
        type: 'image',
        x: Math.round(center.x - w / 2),
        y: Math.round(center.y - h / 2),
        w,
        h,
        photoId,
      });
      if (id) {
        // 붙인 것이 곧바로 손에 잡혀야 한다 — 그러려고 붙였다(붙여넣기와 같은 결).
        setSelectedIds(new Set([id]));
        setTool('select');
      }
      setNotice('사진을 넣었어요');
    } catch {
      setNotice('사진을 읽지 못했어요');
    } finally {
      setBusy(null);
    }
  };

  /**
   * 캔버스 위에 파일을 떨어뜨리면 그 자리에 (M53-2).
   *
   * `dragover`에서 `preventDefault`를 하지 않으면 브라우저가 그 파일을 **탭에서
   * 열어 버린다** — 그리던 페이지가 사진 한 장으로 바뀐다.
   */
  const onDrop = (event: React.DragEvent<HTMLDivElement>): void => {
    const file = [...(event.dataTransfer?.files ?? [])].find((item) =>
      item.type.startsWith('image/'),
    );
    if (!file) return;
    event.preventDefault();
    void insertImage(file, toLocal(event.clientX, event.clientY));
  };

  /* ---------------------------------------------------------------- *
   * 배경 사진 (M52b)
   * ---------------------------------------------------------------- */

  /**
   * 고른 사진 하나를 배경으로.
   *
   * 카드 사진(M10)과 **완전히 같은 길**이다: 압축 → 새 id로 바이트 저장 →
   * 그다음에 메타데이터(여기서는 `DrawPage.background`). 중간에 죽으면 주인
   * 없는 블롭 하나가 남고 GC가 쓸어 간다 — 그 반대(가리키는데 바이트가 없다)는
   * 깨진 화면이라 일어나면 안 된다.
   */
  const pickBackground = async (file: File | undefined): Promise<void> => {
    if (!file || !file.type.startsWith('image/')) return;
    setBusy('사진을 준비하는 중…');
    try {
      const prepared = await preparePhoto(file);
      const id = newId();
      await putPhotoBlob(id, prepared.buf);
      setDrawPageBackground(page.id, { photoId: id, opacity: backgroundOpacity });
      setBackgroundOpen(false);
      setNotice('배경을 깔았어요');
    } catch {
      setNotice('사진을 읽지 못했어요');
    } finally {
      setBusy(null);
    }
  };

  /**
   * 붙여넣기 (데스크톱) — 배경 시트가 열려 있으면 **배경**, 아니면 **요소**로.
   *
   * M52b는 배경 시트가 열렸을 때만 들었다. 이제 편집기가 열려 있는 동안 언제나
   * 듣되, 두 뜻을 시트의 열림으로 가른다 — 배경을 고르러 들어온 사람에게
   * Ctrl+V가 요소를 놓으면 그건 다른 일을 한 것이다.
   *
   * **`items[].getAsFile()` 폴백**이 있는 이유는 브라우저마다 다르기 때문이다:
   * 어떤 브라우저는 스크린샷 붙여넣기를 `clipboardData.files`에 담고, 어떤 것은
   * `items`에만 담는다(사파리·일부 웹뷰). `files`만 보던 M52b의 코드는 후자에서
   * 아무 일도 하지 않았다.
   *
   * 글을 쓰는 중이면 물러선다 — 글자 시트에서 Ctrl+V는 글자 붙여넣기다.
   */
  useEffect(() => {
    const onPaste = (event: ClipboardEvent): void => {
      if (isTyping(event.target)) return;
      const data = event.clipboardData;
      const file =
        [...(data?.files ?? [])].find((item) => item.type.startsWith('image/')) ??
        [...(data?.items ?? [])]
          .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
          .map((item) => item.getAsFile())
          .find((item): item is File => Boolean(item));
      if (!file) return;
      event.preventDefault();
      if (backgroundOpen) void pickBackground(file);
      else void insertImage(file);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  });

  const removeBackground = (): void => {
    // 바이트는 **직접 지우지 않는다** — 복제한 페이지가 같은 사진을 쓰고 있을 수
    // 있다(불변 블롭이라 공유가 안전한 이유이기도 하다). 아무도 가리키지 않게
    // 되면 `photoGc`가 30초 뒤에 쓸어 간다 — 카드 사진을 뗄 때와 같은 길이다.
    setDrawPageBackground(page.id, undefined);
    setBackgroundOpen(false);
    setNotice('배경을 뺐어요');
  };

  /* ---------------------------------------------------------------- *
   * PNG (M52b)
   * ---------------------------------------------------------------- */

  const savePng = async (): Promise<void> => {
    const svg = svgRef.current;
    if (!svg) return;
    setMenuOpen(false);
    setBusy('그림을 만드는 중…');
    try {
      // 배경도 붙인 사진도 **같은 맵의 한 항목**이다 (M53-2) — 파일 만들기에
      // 특수 경우가 없다는 것이 이 회차가 `png.ts`에서 한 유일한 일이다.
      const imageDataUrls: Record<Id, string> = {};
      const wanted = new Set<Id>(imagePhotoIds);
      if (page.background?.photoId) wanted.add(page.background.photoId);
      for (const id of wanted) {
        const buf = await getPhotoBlob(id);
        if (buf) imageDataUrls[id] = bufferToDataUrl(buf);
      }

      let bgBox = null as ReturnType<typeof backgroundRect> | null;
      const backgroundDataUrl = page.background?.photoId
        ? imageDataUrls[page.background.photoId]
        : undefined;
      if (backgroundDataUrl) {
        // 파일에 담을 넓이를 알려면 사진의 원래 비율이 필요하다 — 화면에서는
        // `preserveAspectRatio`가 대신 답해 주던 질문이다.
        const measured = await measure(backgroundDataUrl);
        bgBox = backgroundRect(measured.w, measured.h);
      }
      // 붙인 사진은 `elementBounds`를 지나 자동으로 경계에 든다.
      const bounds = exportBounds(page, bgBox);
      const blob = await svgToPngBlob(svg, bounds, { imageDataUrls });
      const how = await deliverPng(blob, pngFileName(page.title));
      setNotice(how === 'share' ? '공유 시트를 열었어요' : '그림을 저장했어요');
    } catch {
      setNotice('그림을 만들지 못했어요');
    } finally {
      setBusy(null);
    }
  };

  /**
   * 그리는 동안 요소가 보여야 하는 모습 — 저장 전의 미리보기.
   *
   * 스토어에는 아직 아무것도 안 갔다(규칙 1). 이동이 쓰던 그 방식 그대로,
   * 순수 함수가 준 패치를 렌더 순간에만 얹는다.
   */
  const previewElement = (element: DrawElement): DrawElement => {
    // 잠긴 것은 손짓을 따라가지 않는다 (M53-2) — 저장도 안 되므로, 미리보기에서만
    // 움직이면 손을 뗀 순간 제자리로 튀어 돌아온다.
    if (!preview || element.locked || !selectedIds.has(element.id)) return element;
    if (preview.kind === 'move') {
      return { ...element, ...moveElementPatch(element, preview.dx, preview.dy) } as DrawElement;
    }
    if (preview.kind === 'resize') {
      return { ...element, ...resizeElementPatch(element, preview.from, preview.to) } as DrawElement;
    }
    return element;
  };

  /** 다음에 그릴 것의 모양 — 도구 바와 스타일 시트가 함께 정한다. */
  const draftStyle: DraftStyle = { color, width, fill, dash, heads };

  /** 굵기 세 단 — 지우개에서는 같은 값이 「지우개 크기」로 읽힌다 (M53-2, #11). */
  const widthSteps =
    tool === 'eraser'
      ? DRAW_ERASER_SIZES.map((step) => ({ value: step.width, label: step.label }))
      : DRAW_WIDTHS.map((step) => ({ value: step.value, label: step.label }));

  /** 손짓이 진행 중이면 선택 상자도 함께 움직인다. */
  const liveFrame: Box | null =
    preview?.kind === 'resize'
      ? inflate(preview.to, SELECTION_INSET / view.scale)
      : preview?.kind === 'move' && selectionFrame
        ? { ...selectionFrame, x: selectionFrame.x + preview.dx, y: selectionFrame.y + preview.dy }
        : selectionFrame;

  const viewBox =
    size.w > 0
      ? `${view.x} ${view.y} ${size.w / view.scale} ${size.h / view.scale}`
      : `0 0 ${DRAW_PAGE_SIZE} ${DRAW_PAGE_SIZE}`;

  return (
    <section
      data-testid="draw-editor"
      data-page-id={page.id}
      className="flex min-h-0 flex-1 flex-col"
    >
      <header className="flex shrink-0 items-center gap-1 px-3 pb-2 pt-3">
        <button
          type="button"
          data-testid="draw-back"
          aria-label="페이지 목록으로"
          title="페이지 목록으로"
          onClick={onClose}
          className={TOUCH_ICON_BUTTON_CLASS}
        >
          <Icon name="chevron-left" size={20} />
        </button>
        <h1 data-testid="draw-page-title" className="min-w-0 flex-1 truncate text-title text-ink">
          {page.title}
        </h1>

        {/* 연결된 카드 (M52b) — 이 페이지가 어느 아이디어의 것인지, 페이지 쪽에서도
            보이게. 팝오버 한 줄을 누르면 그 카드가 보드에서 열린다. */}
        {linkedCards.length > 0 ? (
          <div ref={linksRef} className="relative shrink-0">
            <button
              type="button"
              data-testid="draw-links"
              data-count={linkedCards.length}
              aria-label={`연결된 카드 ${linkedCards.length}`}
              title={`연결된 카드 ${linkedCards.length}`}
              aria-expanded={linksOpen}
              onClick={() => setLinksOpen((open) => !open)}
              className="inline-flex h-9 shrink-0 items-center gap-1 rounded-full bg-sunken px-2 text-micro tabular-nums text-ink-muted"
            >
              <span aria-hidden="true">🎨</span>
              {linkedCards.length}
            </button>
            {linksOpen ? (
              <div data-testid="draw-links-popover" className={`${POPOVER_CLASS} right-0 top-full`}>
                {linkedCards.map((card) => (
                  <button
                    key={card.id}
                    type="button"
                    data-testid="draw-link-card"
                    data-card-id={card.id}
                    onClick={() => {
                      setLinksOpen(false);
                      focusCard(card.id);
                      setTab('board');
                    }}
                    className={POPOVER_ROW_CLASS}
                  >
                    <Icon name="board" size={16} />
                    <span className="min-w-0 flex-1 truncate text-left">{card.title}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        <button
          type="button"
          data-testid="draw-undo"
          aria-label="실행취소"
          title="실행취소 (Ctrl+Z)"
          disabled={stackSizes.undo === 0}
          onClick={undo}
          className={TOUCH_ICON_BUTTON_CLASS}
        >
          <Icon name="undo" size={20} />
        </button>
        <button
          type="button"
          data-testid="draw-redo"
          aria-label="다시실행"
          title="다시실행 (Ctrl+Shift+Z)"
          disabled={stackSizes.redo === 0}
          onClick={redo}
          className={TOUCH_ICON_BUTTON_CLASS}
        >
          <Icon name="redo" size={20} />
        </button>
        <button
          type="button"
          ref={menuRef}
          data-testid="draw-menu"
          aria-label="페이지 메뉴"
          title="페이지 메뉴"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
          className={TOUCH_ICON_BUTTON_CLASS}
        >
          <Icon name="more" size={20} />
        </button>
      </header>

      {menuOpen ? (
        <AnchoredMenu anchor={menuRef.current} testId="draw-menu-panel" onClose={() => setMenuOpen(false)}>
          <button
            type="button"
            data-testid="draw-background-open"
            onClick={() => {
              setMenuOpen(false);
              setBackgroundOpen(true);
            }}
            className={POPOVER_ROW_CLASS}
          >
            <Icon name="camera" size={16} />
            배경 사진
          </button>
          <button
            type="button"
            data-testid="draw-paper-open"
            onClick={() => {
              setMenuOpen(false);
              setPaperOpen(true);
            }}
            className={POPOVER_ROW_CLASS}
          >
            <Icon name="board" size={16} />
            종이
          </button>
          <button
            type="button"
            data-testid="draw-png"
            onClick={() => void savePng()}
            className={POPOVER_ROW_CLASS}
          >
            <Icon name="upload" size={16} />
            PNG로 저장
          </button>
        </AnchoredMenu>
      ) : null}

      {busy || notice ? (
        <p
          data-testid="draw-notice"
          className="mx-3 mb-1 rounded-md bg-sunken px-3 py-1 text-micro font-normal text-ink-muted"
        >
          {busy ?? notice}
        </p>
      ) : null}

      <div
        ref={wrapRef}
        // 캔버스 위에 사진을 떨어뜨리면 그 자리에 놓인다 (M53-2). `dragover`에서
        // 막지 않으면 브라우저가 그 파일을 탭에서 열어 버린다 — 그리던 것이 사진
        // 한 장으로 바뀐다.
        onDragOver={(event) => event.preventDefault()}
        onDrop={onDrop}
        className="relative min-h-0 flex-1 overflow-hidden border-y border-line"
      >
        <svg
          ref={svgRef}
          data-testid="draw-canvas"
          data-scale={view.scale.toFixed(3)}
          data-tool={handToolActive ? 'hand' : tool}
          data-background={page.background ? 'true' : 'false'}
          viewBox={viewBox}
          preserveAspectRatio="none"
          width="100%"
          height="100%"
          // 캔버스에만 건다 (M52a). 여기만 브라우저의 스크롤·확대를 가져가고,
          // 화면의 나머지는 M50-fix2 이후의 평범한 페이지 그대로다.
          style={{ touchAction: 'none', display: 'block' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endPointer}
          onPointerCancel={endPointer}
          onDoubleClick={onDoubleClick}
          onWheel={onWheel}
        >
          {/* 페이지 자신 — 4000×4000의 흰 바닥. */}
          <rect
            data-testid="draw-page-bg"
            x={0}
            y={0}
            width={DRAW_PAGE_SIZE}
            height={DRAW_PAGE_SIZE}
            fill="var(--color-surface)"
            stroke="var(--color-line)"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
          {/* 배경 사진 (M52b) — **요소보다 먼저** 그린다(맨 아래 층). 페이지
              한가운데에 원본 비율로 들어간다: 늘려 채우면 사람 얼굴이 퍼지고,
              왼쪽 위 구석에 두면 페이지를 열자마자 그것을 찾으러 가야 한다.
              그 두 가지를 `preserveAspectRatio` 한 줄이 답한다. */}
          {/* 종이 무늬 (M53-2, #5) — 그림이 아니라 **종이**다. 요소로 두면 지우개에
              지워지고 마퀴에 잡히고 PNG의 경계 계산에 끼어든다. 무늬의 색이 CSS
              변수가 아니라 날 값인 이유는 `png.ts`의 그것과 같다: 떨어져 나온
              SVG는 문서의 스타일시트를 모른다. */}
          {page.paper && page.paper !== 'plain' ? (
            <>
              <defs>
                <pattern
                  id={`draw-paper-${page.id}`}
                  x={0}
                  y={0}
                  width={DRAW_PAPER_CELL}
                  height={DRAW_PAPER_CELL}
                  patternUnits="userSpaceOnUse"
                >
                  {page.paper === 'grid' ? (
                    <path
                      d={`M ${DRAW_PAPER_CELL} 0 L 0 0 0 ${DRAW_PAPER_CELL}`}
                      fill="none"
                      stroke="#dcd7cf"
                      strokeWidth={1}
                    />
                  ) : (
                    <circle cx={0} cy={0} r={1.6} fill="#c9c3ba" />
                  )}
                </pattern>
              </defs>
              <rect
                data-testid="draw-paper"
                data-paper={page.paper}
                x={0}
                y={0}
                width={DRAW_PAGE_SIZE}
                height={DRAW_PAGE_SIZE}
                fill={`url(#draw-paper-${page.id})`}
                style={{ pointerEvents: 'none' }}
              />
            </>
          ) : null}
          {backgroundUrl ? (
            <image
              data-testid="draw-background"
              // 배경도 「사진 하나」다 (M53-2) — PNG는 이 속성 하나로 배경과 붙인
              // 사진을 똑같이 다룬다.
              data-photo-id={page.background?.photoId}
              href={backgroundUrl}
              x={0}
              y={0}
              width={DRAW_PAGE_SIZE}
              height={DRAW_PAGE_SIZE}
              preserveAspectRatio="xMidYMid meet"
              opacity={backgroundOpacity}
              style={{ pointerEvents: 'none' }}
            />
          ) : null}
          {elements.map((element) => (
            <DrawElementView
              key={element.id}
              element={previewElement(element)}
              selected={selectedIds.has(element.id)}
              imageUrls={imageUrls}
            />
          ))}
          {draft ? <DraftPreview draft={draft} style={draftStyle} /> : null}

          {/* 선택의 손잡이들 (M53-1) — 요소의 `<g>` 안이 아니라 **오버레이**다.
              `DrawElementView`는 아무 이벤트도 듣지 않는 순수 프레젠테이션이라는
              규칙을 지키기 위해서고, 그래서 핸들 맞힘도 SVG가 아니라 순수
              함수(`pickHandle`)가 답한다. `data-draw-chrome`이 달려 있으므로 PNG는
              이것들을 자동으로 걷어 간다. */}
          {liveFrame && selection.length > 0 ? (
            <g data-draw-chrome="handles" style={{ pointerEvents: 'none' }}>
              {selection.length > 1 ? (
                <rect
                  data-testid="draw-selection-box"
                  x={liveFrame.x}
                  y={liveFrame.y}
                  width={liveFrame.w}
                  height={liveFrame.h}
                  fill="none"
                  stroke="#2f74d0"
                  strokeWidth={1}
                  strokeDasharray="8 6"
                  vectorEffect="non-scaling-stroke"
                />
              ) : null}
              {handles.map((id) => {
                const point = handlePoint(liveFrame, id);
                const side = HANDLE_SIZE / view.scale;
                return (
                  <rect
                    key={id}
                    data-testid="draw-handle"
                    data-handle={id}
                    x={point.x - side / 2}
                    y={point.y - side / 2}
                    width={side}
                    height={side}
                    fill="#ffffff"
                    stroke="#2f74d0"
                    strokeWidth={1.5}
                    vectorEffect="non-scaling-stroke"
                  />
                );
              })}
            </g>
          ) : null}

          {preview?.kind === 'marquee' ? (
            <rect
              data-testid="draw-marquee"
              data-draw-chrome="marquee"
              x={preview.box.x}
              y={preview.box.y}
              width={preview.box.w}
              height={preview.box.h}
              fill="#2f74d0"
              fillOpacity={0.08}
              stroke="#2f74d0"
              strokeWidth={1}
              strokeDasharray="6 4"
              vectorEffect="non-scaling-stroke"
              style={{ pointerEvents: 'none' }}
            />
          ) : null}
        </svg>

        {/* 고른 것에 하는 일들. 폰에는 Ctrl이 없으므로 **여기 있는 것이 곧 손잡이의
            전부**다 — 단축키는 데스크톱의 지름길일 뿐이다. */}
        {selection.length > 0 ? (
          <div
            data-testid="draw-selection-bar"
            data-count={selection.length}
            // 캔버스를 덜 가리려고 내용만큼만 넓다 — 폰에서는 두 줄로 접힌다.
            className="absolute left-2 top-2 flex max-w-[calc(100%-1rem)] flex-wrap items-center gap-1 rounded-2xl border border-line bg-surface/95 px-2 py-1 shadow-float"
          >
            <span className="px-1 text-micro tabular-nums text-ink-muted">
              {selection.length}개 선택됨
            </span>
            <button
              type="button"
              data-testid="draw-duplicate-selected"
              onClick={duplicateSelection}
              className={TOUCH_ICON_BUTTON_CLASS}
              aria-label="선택한 것 복제"
              title="복제 (Ctrl+D)"
            >
              <Icon name="copy" size={16} />
            </button>
            {ORDER_BUTTONS.map((spec) => (
              <button
                key={spec.where}
                type="button"
                data-testid="draw-order"
                data-where={spec.where}
                onClick={() => changeOrder(spec.where)}
                className={`${CHIP_BUTTON} h-9 shrink-0`}
                aria-label={spec.label}
                title={spec.label}
              >
                {spec.label}
              </button>
            ))}
            {/* 사진의 진하기 (M53-fix ⑤) — 슬라이더는 스타일 시트에 있고, 여기
                한 줄이 그 문이다. 사진을 골랐을 때만 뜬다: 다른 요소에는 얹을
                자리가 없다. */}
            {selectedImages.length > 0 ? (
              <button
                type="button"
                data-testid="draw-image-opacity-open"
                onClick={() => setStyleOpen(true)}
                className={`${CHIP_BUTTON} h-9 shrink-0`}
                title="사진 진하기"
              >
                진하기
              </button>
            ) : null}
            {/* 잠금 (M53-2, #10) — 큰 사진을 종이처럼 쓰려면 그것이 손에 안 잡혀야
                한다. 잠긴 것은 탭(폰) 또는 Shift+클릭(마우스)으로 다시 고른다. */}
            <button
              type="button"
              data-testid="draw-lock-selected"
              data-locked={selection.every((element) => element.locked) ? 'true' : 'false'}
              onClick={toggleLock}
              className={`${CHIP_BUTTON} h-9 shrink-0`}
              aria-label={selection.every((element) => element.locked) ? '잠금 해제' : '잠그기'}
              title={selection.every((element) => element.locked) ? '잠금 해제' : '잠그기'}
            >
              {selection.every((element) => element.locked) ? '잠금 해제' : '잠그기'}
            </button>
            <button
              type="button"
              data-testid="draw-delete-selected"
              onClick={removeSelection}
              className={TOUCH_ICON_BUTTON_CLASS}
              aria-label="선택한 것 삭제"
              title="선택한 것 삭제 (Delete)"
            >
              <Icon name="trash" size={16} />
            </button>
          </div>
        ) : null}

        {/* 잠긴 것을 탭했다 (M53-fix ②) — 「눌러도 아무 일이 없다」 대신 왜
            안 잡히는지와 푸는 길을 한 줄로 말한다. 이 한 줄이 폰의 Shift+클릭이다.
            손가락 자리에서 살짝 위로 비켜 뜨고(누른 곳을 가리지 않는다) 캔버스
            안에 갇힌다. */}
        {lockedHint && lockedHintElement ? (
          <div
            data-testid="draw-locked-hint"
            data-element-id={lockedHintElement.id}
            style={{
              left: Math.max(8, Math.min(lockedHint.x - 48, Math.max(8, size.w - 168))),
              top: Math.max(8, Math.min(lockedHint.y - 56, Math.max(8, size.h - 56))),
            }}
            className="absolute z-10 flex items-center gap-1 rounded-2xl border border-line bg-surface/95 px-2 py-1 shadow-float"
          >
            <span className="px-1 text-micro text-ink-muted">
              <span aria-hidden="true">🔒 </span>잠김
            </span>
            <button
              type="button"
              data-testid="draw-locked-unlock"
              onClick={() => unlockElement(lockedHintElement.id)}
              className={`${CHIP_BUTTON} h-9 shrink-0`}
            >
              풀기
            </button>
          </div>
        ) : null}

        {/* 눈이 아니라 **귀**를 위한 한 줄 (M53-1) — 선택은 화면에서 점선 하나로만
            보이고, 그 점선은 읽어 주지 않는다. */}
        <p data-testid="draw-selection-status" aria-live="polite" className="sr-only">
          {lockedHintElement
            ? '잠긴 요소예요 — 풀기 버튼으로 풀 수 있어요'
            : selection.length === 0
              ? '선택 없음'
              : `${selection.length}개 선택됨`}
        </p>
      </div>

      {/* 도구 바. 폰에서는 탭 바 **바로 위**에 뜬다 — `.tb-vp-bottom`이 가시
          뷰포트에 못 박고, `--tb-vp-bottom-offset`이 탭 바 높이만큼 더 올린다
          (M51의 그 규칙 그대로). 두 줄 다 가로 스크롤이라 320px에서도 페이지가
          가로로 밀리지 않는다. */}
      <div
        ref={toolbarRef}
        data-testid="draw-toolbar"
        style={
          {
            '--tb-vp-bottom-offset': 'calc(3.5rem + env(safe-area-inset-bottom))',
          } as React.CSSProperties
        }
        className="tb-vp-bottom fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-30 border-t border-line bg-surface lg:static lg:z-auto lg:border-t-0"
      >
        {/* 둘째 줄이 이 상자보다 넓어 「확대(+)」가 잘려 있었다 (M53-fix ④):
            내용 864px(폰·태블릿 크기)·792px(데스크톱 크기) 대 상자 752px.
            768px부터는 상자가 창을 다 쓰고(그 대역의 도구 바는 화면 아래에
            붙은 띠라 넓어도 어색하지 않다), 데스크톱에서는 다시 좁힌다.
            M54에서 「가운데」 버튼 하나가 늘어 내용이 912px이 되면서 그 대역도
            더는 한 줄에 담기지 않으므로, **768px부터 둘째 줄이 접힌다**
            (접히면 아래의 자리채움이 잰 높이만큼 함께 자란다). 폰(<768)은
            예전 그대로 가로 스크롤이다 — 390px에서 접으면 도구 바가 화면의
            절반을 먹는다. */}
        <div className="mx-auto flex max-w-3xl flex-col gap-1 px-2 py-2 md:max-w-none lg:max-w-3xl">
          <div className="flex items-center gap-1 overflow-x-auto">
            {DRAW_TOOLS.map((spec, index) => (
              <button
                key={spec.id}
                type="button"
                data-testid="draw-tool"
                data-tool={spec.id}
                data-active={spec.id === tool}
                aria-label={spec.label}
                // 데스크톱의 손에는 이름과 단축키가 보여야 한다 (M52b) — 아이콘
                // 열한 개 중 무엇이 형광펜인지는 눌러 보기 전에는 모른다.
                title={index < 9 ? `${spec.label} (${index + 1})` : spec.label}
                aria-pressed={spec.id === tool}
                onClick={() => {
                  setTool(spec.id);
                  if (spec.id !== 'select') setSelectedIds(NO_SELECTION);
                  if (spec.id === 'sticker') setPickerOpen(true);
                }}
                className={`${TOUCH_ICON_BUTTON_CLASS} ${
                  spec.id === tool ? 'bg-inverse text-surface hover:bg-inverse hover:text-surface' : ''
                }`}
              >
                <Icon name={spec.icon} size={20} />
              </button>
            ))}
          </div>

          <div
            data-testid="draw-toolbar-styles"
            className="flex items-center gap-1 overflow-x-auto md:flex-wrap"
          >
            {DRAW_COLORS.map((swatch) => (
              <button
                key={swatch.value}
                type="button"
                data-testid="draw-color"
                data-color={swatch.value}
                data-active={swatch.value === color}
                aria-label={swatch.label}
                title={swatch.label}
                aria-pressed={swatch.value === color}
                // 고른 게 있으면 **그것에** 칠한다 (M53-1) — 없으면 다음에 그릴 것.
                onClick={() => chooseColor(swatch.value)}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-full lg:h-9 lg:w-9"
              >
                <span
                  aria-hidden="true"
                  className={`block h-7 w-7 rounded-full border-2 lg:h-6 lg:w-6 ${
                    swatch.value === color ? 'border-ink' : 'border-line'
                  }`}
                  style={{ backgroundColor: swatch.value }}
                />
              </button>
            ))}
            {/* 여섯 색 뒤의 「⋯」 (M53-2) — 41색 팔레트·최근 색·커스텀이 든 서랍.
                여섯은 그대로 남는다: 근육 기억은 팔레트보다 오래간다. */}
            <button
              type="button"
              data-testid="draw-color-more"
              aria-label="색 더 고르기"
              title="색 더 고르기"
              onClick={() => setColorSheet('stroke')}
              className={`${CHIP_BUTTON} h-11 w-11 shrink-0 justify-center lg:h-9 lg:w-9`}
            >
              <Icon name="palette" size={16} />
            </button>
            <span aria-hidden="true" className="mx-1 h-6 w-px shrink-0 bg-line" />
            {/* 굵기 세 단 — **지우개일 때는 크기 세 단**으로 읽힌다 (M53-2, #11).
                값은 하나뿐이라, 「굵게」로 그리다 지우개로 바꾸면 굵게 지워진다. */}
            {widthSteps.map((step) => (
              <button
                key={step.value}
                type="button"
                data-testid={tool === 'eraser' ? 'draw-eraser-size' : 'draw-width'}
                data-width={step.value}
                data-active={step.value === width}
                aria-label={tool === 'eraser' ? `지우개 ${step.label}` : step.label}
                title={tool === 'eraser' ? `지우개 ${step.label}` : step.label}
                aria-pressed={step.value === width}
                onClick={() => {
                  setWidth(step.value);
                  if (tool !== 'eraser') applyStyle('width', step.value);
                }}
                className={`${step.value === width ? CHIP_SELECTED : CHIP_BUTTON} h-11 shrink-0 lg:h-9`}
              >
                {step.label}
              </button>
            ))}
            <span aria-hidden="true" className="mx-1 h-6 w-px shrink-0 bg-line" />
            {/* 채우기·점선·양쪽 화살표 (M53-2, #2·#4) — 색과 같은 규칙 하나를 쓴다. */}
            <button
              type="button"
              data-testid="draw-style-open"
              title="채우기·선 모양"
              onClick={() => setStyleOpen(true)}
              className={`${CHIP_BUTTON} h-11 shrink-0 lg:h-9`}
            >
              스타일
            </button>
            <button
              type="button"
              data-testid="draw-sticker-open"
              title="스티커"
              onClick={() => setPickerOpen(true)}
              className={`${CHIP_BUTTON} h-11 shrink-0 lg:h-9`}
            >
              <span aria-hidden="true">{sticker}</span>
              스티커
            </button>
            {/* 사진 붙이기 (M53-2, B2) — `<label>`이 감싼 숨은 input, 모든 모바일
                웹뷰에서 동작하는 그 한 가지 모양(M10). 붙여넣기·드롭과 **같은 문**을
                지난다. */}
            <label
              data-testid="draw-image-add"
              data-busy={busy ? 'true' : 'false'}
              title="사진 붙이기"
              className={`${CHIP_BUTTON} h-11 shrink-0 cursor-pointer lg:h-9`}
            >
              <Icon name="camera" size={16} />
              사진
              <input
                data-testid="draw-image-input"
                type="file"
                accept="image/*"
                hidden
                disabled={Boolean(busy)}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  void insertImage(file);
                }}
              />
            </label>
            {/* 격자 스냅 (M53-2, #5) — 종이는 페이지의 것이고 스냅은 손의 것이라
                한쪽은 껍데기 필드, 한쪽은 세션 서랍에 산다. */}
            <button
              type="button"
              data-testid="draw-snap"
              data-active={snap}
              aria-pressed={snap}
              title={`격자에 맞추기 (${DRAW_GRID}px)`}
              onClick={() => setSnap(!snap)}
              className={`${snap ? CHIP_SELECTED : CHIP_BUTTON} h-11 shrink-0 lg:h-9`}
            >
              스냅
            </button>
            {/* 축소·확대는 **한 덩어리로** 접힌다 (M53-fix ④) — 줄이 바뀌면서 둘이
                갈라지면 「+」가 저 혼자 다음 줄에 남는다. */}
            <span className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                data-testid="draw-zoom-out"
                aria-label="축소"
                title="축소"
                onClick={() => zoomAt(centerX(), centerY(), 1 / 1.25)}
                className={TOUCH_ICON_BUTTON_CLASS}
              >
                <Icon name="minus" size={16} />
              </button>
              <button
                type="button"
                data-testid="draw-zoom-in"
                aria-label="확대"
                title="확대"
                onClick={() => zoomAt(centerX(), centerY(), 1.25)}
                className={TOUCH_ICON_BUTTON_CLASS}
              >
                <Icon name="plus" size={16} />
              </button>
              {/* 「가운데」도 이 덩어리 안이다 (M54) — 셋은 같은 질문(「지금 어디를
                  보고 있나」)에 답하는 버튼이라, 줄이 바뀌며 갈라지면 사람은
                  나머지 하나를 도구 바의 다른 끝에서 찾게 된다. */}
              <button
                type="button"
                data-testid="draw-recenter"
                aria-label="가운데로 (배율 1)"
                title="가운데로 (배율 1) — 키보드 0"
                onClick={recenter}
                className={TOUCH_ICON_BUTTON_CLASS}
              >
                <Icon name="locate" size={16} />
              </button>
            </span>
          </div>
        </div>
      </div>
      {/* 폰에서 도구 바가 캔버스를 가리지 않도록 **잰 높이만큼** 자리를 비운다
          (M54). 클래스의 7.5rem은 아직 재기 전 한 프레임의 값이다 — 두 줄이던
          시절의 그 숫자라, 재고 나면 곧 제 높이로 바뀐다. */}
      <div
        aria-hidden="true"
        style={toolbarHeight > 0 ? { height: toolbarHeight } : undefined}
        className="h-[7.5rem] shrink-0 lg:hidden"
      />

      {pickerOpen ? (
        <Sheet
          title="스티커"
          testId="draw-sticker-sheet"
          onClose={() => setPickerOpen(false)}
          footer={
            <button
              type="button"
              onClick={() => setPickerOpen(false)}
              className={`${PRIMARY_BUTTON_CLASS} w-full`}
            >
              닫기
            </button>
          }
        >
          <div className="grid grid-cols-6 gap-2">
            {DRAW_STICKERS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                data-testid="draw-sticker-option"
                data-emoji={emoji}
                onClick={() => {
                  setSticker(emoji);
                  setTool('sticker');
                  setPickerOpen(false);
                }}
                className={`grid h-11 place-items-center rounded-md border text-[1.5rem] ${
                  emoji === sticker ? 'border-ink bg-sunken' : 'border-line'
                }`}
              >
                {emoji}
              </button>
            ))}
          </div>
          <div className="mt-4 flex items-center gap-2">
            {DRAW_STICKER_SIZES.map((step) => (
              <button
                key={step.value}
                type="button"
                data-testid="draw-sticker-size"
                data-size={step.value}
                onClick={() => setStickerSize(step.value)}
                className={step.value === stickerSize ? CHIP_SELECTED : CHIP_BUTTON}
              >
                {step.label}
              </button>
            ))}
          </div>
        </Sheet>
      ) : null}

      {/* 색 시트 (M53-2, C) — 팔레트 41 · 최근 색 · 커스텀. 획의 색과 채우기 색이
          **같은 시트**를 쓴다: 두 벌을 만들면 다음 회차에 한쪽만 늘어난다. */}
      {colorSheet ? (
        <Sheet
          title={colorSheet === 'fill' ? '채우기 색' : '색'}
          testId="draw-color-sheet"
          onClose={() => setColorSheet(null)}
          footer={
            <button
              type="button"
              onClick={() => setColorSheet(null)}
              className={`${PRIMARY_BUTTON_CLASS} w-full`}
            >
              닫기
            </button>
          }
        >
          {colorSheet === 'fill' ? (
            <button
              type="button"
              data-testid="draw-fill-none"
              onClick={() => chooseFill(null)}
              className={`${fill === null ? CHIP_SELECTED : CHIP_BUTTON} mb-3 w-full`}
            >
              채우기 없음
            </button>
          ) : null}

          {recentColors().length > 0 ? (
            <>
              <p className="text-label font-medium text-ink-muted">최근 색</p>
              <div className="mb-3 mt-2 flex flex-wrap gap-2">
                {recentColors().map((value) => (
                  <ColorDot
                    key={`recent-${value}`}
                    testId="draw-recent-color"
                    value={value}
                    active={value === (colorSheet === 'fill' ? fill : color)}
                    onPick={() => {
                      if (colorSheet === 'fill') chooseFill(value);
                      else chooseColor(value);
                    }}
                  />
                ))}
              </div>
            </>
          ) : null}

          <p className="text-label font-medium text-ink-muted">팔레트</p>
          <div className="mt-2 grid grid-cols-8 gap-2">
            {DRAW_PALETTE.map((swatch) => (
              <ColorDot
                key={swatch.value}
                testId="draw-palette-color"
                value={swatch.value}
                label={swatch.label}
                active={swatch.value === (colorSheet === 'fill' ? fill : color)}
                onPick={() => {
                  if (colorSheet === 'fill') chooseFill(swatch.value);
                  else chooseColor(swatch.value);
                }}
              />
            ))}
          </div>

          {/* 커스텀 색은 네이티브 입력 하나다 — 모바일에서도 동작하고, 우리가
              색 고르기 UI를 발명하지 않는다. 값은 `normalizeHex`를 지나 소문자
              `#rrggbb`로 저장된다(대소문자 두 벌이면 「최근 색」이 같은 색을 둘로
              센다). */}
          <label className="mt-4 flex items-center gap-2 text-label font-normal text-ink-muted">
            직접 고르기
            <input
              data-testid="draw-custom-color"
              type="color"
              value={(colorSheet === 'fill' ? fill : color) ?? '#ffffff'}
              onChange={(event) => {
                if (colorSheet === 'fill') chooseFill(event.target.value);
                else chooseColor(event.target.value);
              }}
              className="h-11 w-16 rounded-md border border-line bg-surface"
            />
          </label>
        </Sheet>
      ) : null}

      {/* 스타일 시트 (M53-2, #2·#4) — 채우기·점선·양쪽 화살표. 「고른 게 없으면
          다음에 그릴 것, 있으면 그것」이라는 한 규칙이 여기서도 그대로다. */}
      {styleOpen ? (
        <Sheet
          title="채우기 · 선 모양"
          testId="draw-style-sheet"
          onClose={() => setStyleOpen(false)}
          footer={
            <button
              type="button"
              onClick={() => setStyleOpen(false)}
              className={`${PRIMARY_BUTTON_CLASS} w-full`}
            >
              닫기
            </button>
          }
        >
          {/* 붙인 사진의 진하기 (M53-fix ⑤). 종이처럼 깔아 두려면 사진이 흐려져야
              하는데, M53-2는 배경(껍데기)에만 그 손잡이를 주고 요소에는 안 줬다.
              배경과 **같은 문**(`clampOpacity`, 0.2~1)을 쓴다 — 아래 한계가 0인
              슬라이더는 「사진이 사라졌다」로 끝난다. */}
          {selectedImages.length > 0 ? (
            <div className="mb-4">
              <label
                className="block text-label font-medium text-ink-muted"
                htmlFor="draw-image-opacity"
              >
                사진 진하기 ({selectedImages.length}장)
              </label>
              <input
                id="draw-image-opacity"
                data-testid="draw-image-opacity"
                type="range"
                min={DRAW_BG_MIN_OPACITY}
                max={1}
                step={0.05}
                value={imageOpacity}
                onChange={(event) => previewImageOpacity(Number(event.target.value))}
                // 실행취소 한 걸음은 **손을 뗄 때** 남는다 — 끄는 동안의 수십 번은
                // 미리보기일 뿐이다. 키보드로 옮길 수도 있으므로 셋 다 듣는다.
                onPointerUp={commitImageOpacity}
                onPointerCancel={commitImageOpacity}
                onKeyUp={commitImageOpacity}
                onBlur={commitImageOpacity}
                className="mt-2 h-11 w-full"
              />
              <p data-testid="draw-image-opacity-value" className="text-micro font-normal text-ink-faint">
                {Math.round(imageOpacity * 100)}%
              </p>
            </div>
          ) : null}

          <p className="text-label font-medium text-ink-muted">채우기 (사각형·타원)</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-testid="draw-fill-none"
              onClick={() => chooseFill(null)}
              className={fill === null ? CHIP_SELECTED : CHIP_BUTTON}
            >
              없음
            </button>
            {DRAW_COLORS.map((swatch) => (
              <ColorDot
                key={`fill-${swatch.value}`}
                testId="draw-fill-color"
                value={swatch.value}
                label={swatch.label}
                active={swatch.value === fill}
                onPick={() => chooseFill(swatch.value)}
              />
            ))}
            <button
              type="button"
              data-testid="draw-fill-more"
              aria-label="채우기 색 더 고르기"
              // 시트 둘을 겹쳐 쌓지 않는다 — 폰에서 그것은 「닫기」를 두 번 눌러야
              // 하는 화면이고, 뒤의 시트는 앞의 시트에 가려 보이지도 않는다.
              onClick={() => {
                setStyleOpen(false);
                setColorSheet('fill');
              }}
              className={`${CHIP_BUTTON} h-11 w-11 justify-center`}
            >
              <Icon name="palette" size={16} />
            </button>
          </div>

          <p className="mt-4 text-label font-medium text-ink-muted">선</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-testid="draw-dash"
              data-active={dash}
              aria-pressed={dash}
              onClick={() => {
                setDash(!dash);
                applyStyle('dash', !dash);
              }}
              className={dash ? CHIP_SELECTED : CHIP_BUTTON}
            >
              점선
            </button>
            <button
              type="button"
              data-testid="draw-heads"
              data-active={heads === 'both'}
              aria-pressed={heads === 'both'}
              onClick={() => {
                const next = heads === 'both' ? 'end' : 'both';
                setHeads(next);
                applyStyle('heads', next);
              }}
              className={heads === 'both' ? CHIP_SELECTED : CHIP_BUTTON}
            >
              양쪽 화살표
            </button>
          </div>
          <p className="mt-2 text-micro font-normal text-ink-faint">
            고른 것이 있으면 그것에, 없으면 다음에 그릴 것에 적용돼요.
          </p>
        </Sheet>
      ) : null}

      {/* 종이 (M53-2, #5) — 페이지의 껍데기라 제목·배경과 같은 층에서 갈린다. */}
      {paperOpen ? (
        <Sheet
          title="종이"
          testId="draw-paper-sheet"
          onClose={() => setPaperOpen(false)}
          footer={
            <button
              type="button"
              onClick={() => setPaperOpen(false)}
              className={`${PRIMARY_BUTTON_CLASS} w-full`}
            >
              닫기
            </button>
          }
        >
          <div className="flex items-center gap-2">
            {DRAW_PAPERS.map((spec) => (
              <button
                key={spec.value}
                type="button"
                data-testid="draw-paper-option"
                data-paper={spec.value}
                data-active={(page.paper ?? 'plain') === spec.value}
                onClick={() => setDrawPagePaper(page.id, spec.value)}
                className={(page.paper ?? 'plain') === spec.value ? CHIP_SELECTED : CHIP_BUTTON}
              >
                {spec.label}
              </button>
            ))}
          </div>
          <p className="mt-3 text-micro font-normal text-ink-faint">
            무늬는 페이지에 저장돼요(두 사람에게 같이 보입니다). 도구 바의 「스냅」은
            이 기기의 손버릇이라 따로예요 — {DRAW_GRID}px 격자에 맞춰 그려집니다.
          </p>
        </Sheet>
      ) : null}

      {backgroundOpen ? (
        <Sheet
          title="배경 사진"
          testId="draw-bg-sheet"
          onClose={() => setBackgroundOpen(false)}
          footer={
            <div className="flex gap-2">
              {page.background ? (
                <button
                  type="button"
                  data-testid="draw-bg-remove"
                  onClick={removeBackground}
                  className={`${SECONDARY_BUTTON_CLASS} flex-1`}
                >
                  <Icon name="close" size={16} />
                  제거
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setBackgroundOpen(false)}
                className={`${PRIMARY_BUTTON_CLASS} flex-1`}
              >
                닫기
              </button>
            </div>
          }
        >
          <p className="text-label font-normal text-ink-muted">
            관광지 사진을 깔고 그 위에 낙서하세요. 붙여넣기(Ctrl+V)도 돼요.
          </p>

          {/* `<label>`이 감싼 숨은 input — 모든 모바일 웹뷰에서 동작하는 한 가지
              모양이다(M10의 그 규칙). `multiple`이 없는 이유는 배경이 하나이기
              때문이다. */}
          <label
            data-testid="draw-bg-add"
            data-busy={busy ? 'true' : 'false'}
            className="mt-3 flex h-11 cursor-pointer items-center justify-center gap-1 rounded-md border border-dashed border-line text-label font-normal text-ink-muted hover:border-line-strong hover:bg-sunken"
          >
            <Icon name="plus" size={16} />
            {page.background ? '사진 바꾸기' : '사진 고르기'}
            <input
              data-testid="draw-bg-input"
              type="file"
              accept="image/*"
              hidden
              disabled={Boolean(busy)}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                void pickBackground(file);
              }}
            />
          </label>

          {page.background ? (
            <div className="mt-4">
              <label className="block text-label font-medium text-ink-muted" htmlFor="draw-bg-opacity">
                진하기
              </label>
              <input
                id="draw-bg-opacity"
                data-testid="draw-bg-opacity"
                type="range"
                min={DRAW_BG_MIN_OPACITY}
                max={1}
                step={0.05}
                value={backgroundOpacity}
                onChange={(event) =>
                  setDrawPageBackground(page.id, {
                    photoId: page.background!.photoId,
                    opacity: Number(event.target.value),
                  })
                }
                className="mt-2 h-11 w-full"
              />
              <p className="text-micro font-normal text-ink-faint">
                {Math.round(backgroundOpacity * 100)}%
              </p>
            </div>
          ) : null}
        </Sheet>
      ) : null}

      {textAt ? (
        <Sheet
          title={textAt.id ? '글자 고치기' : '글자 넣기'}
          testId="draw-text-sheet"
          onClose={() => setTextAt(null)}
          footer={
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setTextAt(null)}
                className={`${SECONDARY_BUTTON_CLASS} flex-1`}
              >
                취소
              </button>
              <button
                type="button"
                data-testid="draw-text-submit"
                onClick={submitText}
                className={`${PRIMARY_BUTTON_CLASS} flex-1`}
              >
                넣기
              </button>
            </div>
          }
        >
          {/* `textarea`인 이유는 줄바꿈이 실제로 저장·렌더되기 때문이다 (M52b).
              Enter는 그대로 「넣기」이고(가장 흔한 손짓), 줄을 바꾸려면
              Shift+Enter다 — 메신저들이 쓰는 그 규칙. */}
          <textarea
            data-testid="draw-text-input"
            autoFocus
            rows={2}
            maxLength={DRAW_TEXT_MAX}
            value={textValue}
            onChange={(event) => setTextValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.shiftKey) return;
              if (event.nativeEvent.isComposing) return;
              event.preventDefault();
              submitText();
            }}
            placeholder="여기 어때?"
            className={`${TEXTAREA_CLASS} mt-0`}
          />
          <div className="mt-3 flex items-center gap-2">
            {DRAW_TEXT_SIZES.map((step) => (
              <button
                key={step.value}
                type="button"
                data-testid="draw-text-size"
                data-size={step.value}
                onClick={() => setTextDraftSize(step.value)}
                className={step.value === textDraftSize ? CHIP_SELECTED : CHIP_BUTTON}
              >
                {step.label}
              </button>
            ))}
          </div>
        </Sheet>
      ) : null}
    </section>
  );

  function centerX(): number {
    const rect = svgRef.current?.getBoundingClientRect();
    return rect ? rect.left + rect.width / 2 : 0;
  }
  function centerY(): number {
    const rect = svgRef.current?.getBoundingClientRect();
    return rect ? rect.top + rect.height / 2 : 0;
  }
}

/**
 * 색 하나의 동그라미 — 도구 바의 여섯과 **같은 모양**이다 (M53-2).
 *
 * 시트와 도구 바가 다르게 생기면 사람은 그 둘이 다른 물건이라고 읽는다.
 */
function ColorDot({
  testId,
  value,
  label,
  active,
  onPick,
}: {
  testId: string;
  value: string;
  label?: string;
  active: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      data-color={value}
      data-active={active}
      aria-label={label ?? value}
      title={label ?? value}
      aria-pressed={active}
      onClick={onPick}
      className="grid h-11 w-11 shrink-0 place-items-center rounded-full"
    >
      <span
        aria-hidden="true"
        className={`block h-7 w-7 rounded-full border-2 ${active ? 'border-ink' : 'border-line'}`}
        style={{ backgroundColor: value }}
      />
    </button>
  );
}

/** data URI 하나의 원래 크기 — 배경을 파일에 담을 때만 필요하다. */
function measure(dataUrl: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve({ w: image.naturalWidth || 1, h: image.naturalHeight || 1 });
    image.onerror = () => resolve({ w: 1, h: 1 });
    image.src = dataUrl;
  });
}

/** 그리는 중인 것을 저장될 요소와 **같은 컴포넌트**로 그린다. */
function DraftPreview({ draft, style }: { draft: NonNullable<Draft>; style: DraftStyle }) {
  if (draft.kind === 'stroke') {
    return (
      <DrawElementView
        element={{
          id: 'draft',
          updatedAt: 0,
          type: 'stroke',
          points: draft.points,
          color: style.color,
          width: draft.highlight ? style.width * HIGHLIGHT_WIDTH_FACTOR : style.width,
          kind: draft.highlight ? 'highlight' : 'pen',
        }}
      />
    );
  }
  const element = draftElement(draft, style);
  if (!element) return null;
  return <DrawElementView element={{ ...element, id: 'draft', updatedAt: 0 } as DrawElement} />;
}

/**
 * 끌기 두 점 → 저장할 도형. 너무 작은 것은 만들지 않는다(탭 한 번이 점 하나짜리
 * 사각형을 남기면 지우려고 또 탭해야 한다).
 */
function draftElement(draft: NonNullable<Draft>, style: DraftStyle): NewDrawElement | null {
  if (draft.kind !== 'shape') return null;
  const { tool, x0, y0, x1, y1 } = draft;
  const { color, width, fill, dash, heads } = style;

  if (tool === 'line' || tool === 'arrow') {
    if (Math.hypot(x1 - x0, y1 - y0) < 4) return null;
    return {
      type: tool,
      x1: Math.round(x0),
      y1: Math.round(y0),
      x2: Math.round(x1),
      y2: Math.round(y1),
      color,
      width,
      // 기본값은 **필드를 만들지 않는다** (M53-2): 없는 것이 곧 실선·끝촉이라,
      // 저장된 모양이 이 회차를 모르던 데이터와 같다.
      ...(dash ? { dash: true } : {}),
      ...(tool === 'arrow' && heads === 'both' ? { heads: 'both' as const } : {}),
    };
  }

  const box = normalizeBox(x0, y0, x1, y1);
  if (box.w < 4 && box.h < 4) return null;
  return {
    type: tool,
    x: Math.round(box.x),
    y: Math.round(box.y),
    w: Math.round(box.w),
    h: Math.round(box.h),
    color,
    width,
    ...(fill ? { fill } : {}),
    ...(dash ? { dash: true } : {}),
  };
}
