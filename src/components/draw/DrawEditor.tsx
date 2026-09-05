import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { moveElementPatch, normalizeBox, pickTopElement } from '../../draw/geometry';
import { visibleElements } from '../../draw/pages';
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
  DRAW_MAX_SCALE,
  DRAW_MIN_SCALE,
  DRAW_PAGE_SIZE,
  DRAW_STICKERS,
  DRAW_STICKER_SIZES,
  DRAW_TEXT_MAX,
  DRAW_TEXT_SIZES,
  DRAW_TOOLS,
  DRAW_WIDTHS,
  HIGHLIGHT_WIDTH_FACTOR,
  clampOpacity,
  type DrawTool,
} from '../../draw/tools';
import {
  redoStack,
  rememberTools,
  rememberView,
  rememberedTools,
  rememberedView,
  undoStack,
  type DrawOp,
} from '../../stores/drawSession';
import { getPhotoBlob, putPhotoBlob, usePhotoUrl } from '../../stores/photoBlobs';
import { useUiStore } from '../../stores/uiStore';
import { useWorkspaceStore, type NewDrawElement } from '../../stores/workspaceStore';
import type { DrawElement, DrawPage, Id } from '../../types/models';
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
 * 드로우 편집기 (M52a, M52b) — 한 페이지를 그리는 자리.
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

const clampScale = (scale: number): number =>
  Math.min(DRAW_MAX_SCALE, Math.max(DRAW_MIN_SCALE, scale));

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
  const setDrawPageBackground = useWorkspaceStore((s) => s.setDrawPageBackground);
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
  const [pickerOpen, setPickerOpen] = useState(false);
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

  /**
   * 뷰는 **페이지 id를 달고** 산다.
   *
   * 페이지를 바꾸면 한 렌더 동안은 상태가 아직 옛 페이지의 것이다 — id가 붙어
   * 있으면 그 렌더에서 옛 뷰가 새 페이지의 서랍에 잘못 저장되지 않는다.
   */
  const [viewState, setViewState] = useState<View & { pageId: Id }>(() => ({
    pageId: page.id,
    ...(rememberedView(page.id) ?? { x: 0, y: 0, scale: 1 }),
  }));
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [draft, setDraft] = useState<Draft>(null);
  const [selectedId, setSelectedId] = useState<Id | null>(null);
  const [textAt, setTextAt] = useState<{ x: number; y: number } | null>(null);
  const [textValue, setTextValue] = useState('');
  /**
   * 실행취소 스택은 **ref**이고 화면에 보이는 것은 길이 둘뿐이다.
   *
   * 상태 배열에 담고 `setState(fn)` 안에서 스토어를 건드리면 StrictMode의 개발
   * 빌드가 그 함수를 두 번 불러 되돌리기가 두 번 일어난다 — 업데이터는 순수해야
   * 한다는 규칙이 실제로 물리는 드문 자리다.
   *
   * 배열 자신은 `drawSession`의 것이다(같은 참조) — 탭을 다녀와도 이어진다.
   */
  const undoRef = useRef<DrawOp[]>(undoStack(page.id));
  const redoRef = useRef<DrawOp[]>(redoStack(page.id));
  const [stackSizes, setStackSizes] = useState({
    undo: undoRef.current.length,
    redo: redoRef.current.length,
  });
  const [spaceHeld, setSpaceHeld] = useState(false);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const menuRef = useRef<HTMLButtonElement | null>(null);
  const linksRef = useRef<HTMLDivElement | null>(null);
  /** 지금 화면에 닿아 있는 포인터들 — 두 개가 되면 팬/줌이다. */
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  /** 직전 프레임의 두 손가락 상태(거리·가운데점). */
  const gesture = useRef<{ dist: number; midX: number; midY: number } | null>(null);
  /** 한 손가락 팬의 직전 위치. */
  const panFrom = useRef<{ x: number; y: number } | null>(null);
  /** 선택 이동 중인 요소와 시작 지점. */
  const dragging = useRef<{ element: DrawElement; x: number; y: number; dx: number; dy: number } | null>(null);
  const [dragOffset, setDragOffset] = useState<{ dx: number; dy: number } | null>(null);
  const pageIdRef = useRef(page.id);
  pageIdRef.current = page.id;

  const elements = useMemo(() => visibleElements(page), [page]);
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

  /** 이 렌더가 쓰는 뷰 — 상태가 아직 옛 페이지의 것이면 서랍(또는 가운데)을 본다. */
  const view: View =
    viewState.pageId === page.id
      ? { x: viewState.x, y: viewState.y, scale: viewState.scale }
      : (rememberedView(page.id) ?? {
          x: DRAW_PAGE_SIZE / 2 - size.w / 2,
          y: DRAW_PAGE_SIZE / 2 - size.h / 2,
          scale: 1,
        });

  const setView = useCallback((next: View | ((current: View) => View)) => {
    setViewState((current) => {
      const base: View =
        current.pageId === pageIdRef.current
          ? current
          : (rememberedView(pageIdRef.current) ?? current);
      const value = typeof next === 'function' ? next(base) : next;
      return { pageId: pageIdRef.current, ...value };
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
    setViewState({
      pageId: page.id,
      ...(remembered ?? {
        x: DRAW_PAGE_SIZE / 2 - size.w / 2,
        y: DRAW_PAGE_SIZE / 2 - size.h / 2,
        scale: 1,
      }),
    });
  }, [page.id, size.w, size.h]);

  /** 바뀐 뷰를 서랍에 적어 둔다 — 옛 페이지의 뷰는 적지 않는다. */
  useEffect(() => {
    if (viewState.pageId !== page.id) return;
    rememberView(page.id, { x: viewState.x, y: viewState.y, scale: viewState.scale });
  }, [page.id, viewState]);

  // 페이지를 바꾸면 실행취소 스택은 그 페이지의 것으로 갈아 끼운다.
  useEffect(() => {
    undoRef.current = undoStack(page.id);
    redoRef.current = redoStack(page.id);
    setStackSizes({ undo: undoRef.current.length, redo: redoRef.current.length });
    setSelectedId(null);
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

  /* ---------------------------------------------------------------- *
   * 실행취소 — 한 가지 모양의 걸음 하나로 전부를 표현한다
   * ---------------------------------------------------------------- */

  const syncStacks = useCallback(() => {
    setStackSizes({ undo: undoRef.current.length, redo: redoRef.current.length });
  }, []);

  const record = useCallback(
    (op: DrawOp) => {
      undoRef.current.push(op);
      // 새 일을 하면 「다시실행」의 미래는 사라진다 — 모든 편집기가 그렇다.
      redoRef.current.length = 0;
      syncStacks();
    },
    [syncStacks],
  );

  const apply = useCallback(
    (id: Id, target: DrawElement | null) => {
      if (target) putDrawElement(page.id, target);
      else deleteDrawElement(page.id, id);
    },
    [deleteDrawElement, page.id, putDrawElement],
  );

  const undo = useCallback(() => {
    const op = undoRef.current.pop();
    if (!op) return;
    apply(op.id, op.before);
    redoRef.current.push(op);
    setSelectedId(null);
    syncStacks();
  }, [apply, syncStacks]);

  const redo = useCallback(() => {
    const op = redoRef.current.pop();
    if (!op) return;
    apply(op.id, op.after);
    undoRef.current.push(op);
    setSelectedId(null);
    syncStacks();
  }, [apply, syncStacks]);

  /** 새 요소를 저장하고 실행취소 한 걸음을 남긴다. */
  const commit = useCallback(
    (element: NewDrawElement) => {
      const id = addDrawElement(page.id, element);
      if (!id) return;
      record({ id, before: null, after: { ...element, id, updatedAt: 0 } as DrawElement });
    },
    [addDrawElement, page.id, record],
  );

  const removeElement = useCallback(
    (element: DrawElement) => {
      deleteDrawElement(page.id, element.id);
      record({ id: element.id, before: element, after: null });
      setSelectedId((current) => (current === element.id ? null : current));
    },
    [deleteDrawElement, page.id, record],
  );

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
      if (meta) return;

      if (event.key === 'Delete' || event.key === 'Backspace') {
        const element = selectedId ? page.elements[selectedId] : undefined;
        if (element && !element.deletedAt) {
          event.preventDefault();
          removeElement(element);
        }
        return;
      }
      if (event.key === 'Escape') {
        if (textAt) {
          setTextAt(null);
          setTextValue('');
        } else if (selectedId) {
          setSelectedId(null);
        }
        return;
      }
      // 숫자 하나가 도구 하나 — 도구 바의 순서 그대로다.
      if (/^[1-9]$/.test(event.key)) {
        const spec = DRAW_TOOLS[Number(event.key) - 1];
        if (!spec) return;
        event.preventDefault();
        setTool(spec.id);
        if (spec.id !== 'select') setSelectedId(null);
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
  }, [page.elements, redo, removeElement, selectedId, setTool, textAt, undo]);

  /* ---------------------------------------------------------------- *
   * 포인터 — 한 손가락은 도구, 두 손가락은 언제나 팬/줌
   * ---------------------------------------------------------------- */

  const handToolActive = tool === 'hand' || spaceHeld;

  const onPointerDown = (event: React.PointerEvent<SVGSVGElement>): void => {
    // 오른쪽·가운데 버튼으로는 그리지 않는다 (M52a-fix ⑤). 마우스에서만 묻는
    // 조건인 이유는 **손가락 둘**이 곧 팬/줌이기 때문이다: 두 번째 손가락은
    // `isPrimary`가 false이고, 그것까지 막으면 확대가 사라진다.
    if (event.button !== 0) return;
    if (event.pointerType === 'mouse' && !event.isPrimary) return;

    (event.target as Element).setPointerCapture?.(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.current.size === 2) {
      // 두 번째 손가락이 닿는 순간 그리던 것은 없던 일이 된다 — 확대하려던
      // 손이 페이지에 줄을 하나 긋고 끝나면 그것은 확대가 아니다.
      setDraft(null);
      dragging.current = null;
      setDragOffset(null);
      const [a, b] = [...pointers.current.values()];
      gesture.current = {
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        midX: (a.x + b.x) / 2,
        midY: (a.y + b.y) / 2,
      };
      return;
    }
    if (pointers.current.size > 2) return;

    const local = toLocal(event.clientX, event.clientY);

    if (handToolActive) {
      panFrom.current = { x: event.clientX, y: event.clientY };
      return;
    }

    switch (tool) {
      case 'pen':
      case 'highlight':
        setDraft({ kind: 'stroke', points: [local.x, local.y], highlight: tool === 'highlight' });
        return;
      case 'line':
      case 'arrow':
      case 'rect':
      case 'ellipse':
        setDraft({ kind: 'shape', tool, x0: local.x, y0: local.y, x1: local.x, y1: local.y });
        return;
      case 'eraser': {
        const hit = pickTopElement(page.elements, page.elementOrder, local.x, local.y, eraserPad());
        if (hit) removeElement(hit);
        return;
      }
      case 'select': {
        const hit = pickTopElement(page.elements, page.elementOrder, local.x, local.y, eraserPad());
        setSelectedId(hit?.id ?? null);
        if (hit) {
          dragging.current = { element: hit, x: local.x, y: local.y, dx: 0, dy: 0 };
          setDragOffset({ dx: 0, dy: 0 });
        }
        return;
      }
      case 'text':
        setTextValue('');
        setTextAt({ x: Math.round(local.x), y: Math.round(local.y) });
        return;
      case 'sticker':
        commit({
          type: 'sticker',
          x: Math.round(local.x),
          y: Math.round(local.y),
          emoji: sticker,
          size: stickerSize,
        });
        return;
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
      const previous = gesture.current;
      gesture.current = { dist, midX, midY };
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

    if (panFrom.current) {
      const from = panFrom.current;
      panFrom.current = { x: event.clientX, y: event.clientY };
      setView((current) => ({
        ...current,
        x: current.x - (event.clientX - from.x) / current.scale,
        y: current.y - (event.clientY - from.y) / current.scale,
      }));
      return;
    }

    const local = toLocal(event.clientX, event.clientY);

    if (dragging.current) {
      const move = dragging.current;
      move.dx = local.x - move.x;
      move.dy = local.y - move.y;
      setDragOffset({ dx: move.dx, dy: move.dy });
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
      return { ...current, x1: local.x, y1: local.y };
    });
  };

  const endPointer = (event: React.PointerEvent<SVGSVGElement>): void => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) gesture.current = null;
    if (pointers.current.size === 0) panFrom.current = null;

    const move = dragging.current;
    if (move) {
      dragging.current = null;
      setDragOffset(null);
      // 1px도 안 움직였으면 그것은 이동이 아니라 선택이다.
      if (Math.abs(move.dx) >= 1 || Math.abs(move.dy) >= 1) {
        const patch = moveElementPatch(move.element, move.dx, move.dy);
        updateDrawElement(page.id, move.element.id, patch);
        record({
          id: move.element.id,
          before: move.element,
          after: { ...move.element, ...patch } as DrawElement,
        });
      }
    }

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

    const shape = draftElement(current, color, width);
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

  /** 지우개·선택의 여유(로컬 px) — 화면에서 늘 같은 굵기로 느껴지게 배율을 나눈다. */
  const eraserPad = (): number => 10 / view.scale;

  const submitText = (): void => {
    // 상한은 화면이 아니라 **저장 직전**에 건다 (M52a-fix ⑨): 500자를 넘는 글자
    // 하나는 페이지를 가로지르는 한 줄이 되고, 그것을 지우려면 그 줄을 찾아
    // 짚어야 한다.
    const value = textValue.trim().slice(0, DRAW_TEXT_MAX);
    const at = textAt;
    setTextAt(null);
    setTextValue('');
    if (!at || value === '') return;
    commit({ type: 'text', x: at.x, y: at.y, text: value, color, size: textSize });
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

  /** 붙여넣기로도 깔린다 (데스크톱) — 배경 시트가 열려 있을 때만 듣는다. */
  useEffect(() => {
    if (!backgroundOpen) return;
    const onPaste = (event: ClipboardEvent): void => {
      const file = [...(event.clipboardData?.files ?? [])].find((item) =>
        item.type.startsWith('image/'),
      );
      if (!file) return;
      event.preventDefault();
      void pickBackground(file);
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
      let backgroundDataUrl: string | undefined;
      let bgBox = null as ReturnType<typeof backgroundRect> | null;
      const photoId = page.background?.photoId;
      if (photoId) {
        const buf = await getPhotoBlob(photoId);
        if (buf) {
          backgroundDataUrl = bufferToDataUrl(buf);
          // 파일에 담을 넓이를 알려면 사진의 원래 비율이 필요하다 — 화면에서는
          // `preserveAspectRatio`가 대신 답해 주던 질문이다.
          const measured = await measure(backgroundDataUrl);
          bgBox = backgroundRect(measured.w, measured.h);
        }
      }
      const bounds = exportBounds(page, bgBox);
      const blob = await svgToPngBlob(svg, bounds, { backgroundDataUrl });
      const how = await deliverPng(blob, pngFileName(page.title));
      setNotice(how === 'share' ? '공유 시트를 열었어요' : '그림을 저장했어요');
    } catch {
      setNotice('그림을 만들지 못했어요');
    } finally {
      setBusy(null);
    }
  };

  const selected = selectedId ? page.elements[selectedId] : undefined;
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

      <div ref={wrapRef} className="relative min-h-0 flex-1 overflow-hidden border-y border-line">
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
          {backgroundUrl ? (
            <image
              data-testid="draw-background"
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
          {elements.map((element) => {
            const moving = dragOffset && dragging.current?.element.id === element.id;
            const shown = moving
              ? ({
                  ...element,
                  ...moveElementPatch(element, dragOffset.dx, dragOffset.dy),
                } as DrawElement)
              : element;
            return (
              <DrawElementView
                key={element.id}
                element={shown}
                selected={element.id === selectedId}
              />
            );
          })}
          {draft ? <DraftPreview draft={draft} color={color} width={width} /> : null}
        </svg>

        {selected ? (
          <div className="absolute left-2 top-2 flex items-center gap-2 rounded-full border border-line bg-surface/95 px-2 py-1 shadow-float">
            <span className="px-1 text-micro text-ink-muted">선택됨</span>
            <button
              type="button"
              data-testid="draw-delete-selected"
              onClick={() => removeElement(selected)}
              className={TOUCH_ICON_BUTTON_CLASS}
              aria-label="선택한 것 삭제"
              title="선택한 것 삭제 (Delete)"
            >
              <Icon name="trash" size={16} />
            </button>
          </div>
        ) : null}
      </div>

      {/* 도구 바. 폰에서는 탭 바 **바로 위**에 뜬다 — `.tb-vp-bottom`이 가시
          뷰포트에 못 박고, `--tb-vp-bottom-offset`이 탭 바 높이만큼 더 올린다
          (M51의 그 규칙 그대로). 두 줄 다 가로 스크롤이라 320px에서도 페이지가
          가로로 밀리지 않는다. */}
      <div
        data-testid="draw-toolbar"
        style={
          {
            '--tb-vp-bottom-offset': 'calc(3.5rem + env(safe-area-inset-bottom))',
          } as React.CSSProperties
        }
        className="tb-vp-bottom fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-30 border-t border-line bg-surface lg:static lg:z-auto lg:border-t-0"
      >
        <div className="mx-auto flex max-w-3xl flex-col gap-1 px-2 py-2">
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
                  if (spec.id !== 'select') setSelectedId(null);
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

          <div className="flex items-center gap-1 overflow-x-auto">
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
                onClick={() => setColor(swatch.value)}
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
            <span aria-hidden="true" className="mx-1 h-6 w-px shrink-0 bg-line" />
            {DRAW_WIDTHS.map((step) => (
              <button
                key={step.value}
                type="button"
                data-testid="draw-width"
                data-width={step.value}
                data-active={step.value === width}
                aria-label={step.label}
                title={step.label}
                aria-pressed={step.value === width}
                onClick={() => setWidth(step.value)}
                className={`${step.value === width ? CHIP_SELECTED : CHIP_BUTTON} h-11 shrink-0 lg:h-9`}
              >
                {step.label}
              </button>
            ))}
            <span aria-hidden="true" className="mx-1 h-6 w-px shrink-0 bg-line" />
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
          </div>
        </div>
      </div>
      {/* 폰에서 도구 바가 캔버스를 가리지 않도록 그 높이만큼 자리를 비운다
          (44px 두 줄 + 패딩 — M52b에서 터치 타깃이 커진 만큼 함께 자랐다). */}
      <div aria-hidden="true" className="h-[7.5rem] shrink-0 lg:hidden" />

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
          title="글자 넣기"
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
                onClick={() => setTextSize(step.value)}
                className={step.value === textSize ? CHIP_SELECTED : CHIP_BUTTON}
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
function DraftPreview({
  draft,
  color,
  width,
}: {
  draft: NonNullable<Draft>;
  color: string;
  width: number;
}) {
  if (draft.kind === 'stroke') {
    return (
      <DrawElementView
        element={{
          id: 'draft',
          updatedAt: 0,
          type: 'stroke',
          points: draft.points,
          color,
          width: draft.highlight ? width * HIGHLIGHT_WIDTH_FACTOR : width,
          kind: draft.highlight ? 'highlight' : 'pen',
        }}
      />
    );
  }
  const element = draftElement(draft, color, width);
  if (!element) return null;
  return <DrawElementView element={{ ...element, id: 'draft', updatedAt: 0 } as DrawElement} />;
}

/**
 * 끌기 두 점 → 저장할 도형. 너무 작은 것은 만들지 않는다(탭 한 번이 점 하나짜리
 * 사각형을 남기면 지우려고 또 탭해야 한다).
 */
function draftElement(
  draft: NonNullable<Draft>,
  color: string,
  width: number,
): NewDrawElement | null {
  if (draft.kind !== 'shape') return null;
  const { tool, x0, y0, x1, y1 } = draft;

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
  };
}
