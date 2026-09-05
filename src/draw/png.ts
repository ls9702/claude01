/**
 * 페이지를 그림 파일로 (M52b) — SVG → canvas → PNG.
 *
 * 「그린 것을 남에게 보여 준다」는 이 도구의 마지막 한 걸음이다. 카카오톡에
 * 붙이는 것은 링크가 아니라 그림이고, 앱을 깔지 않은 사람에게 `#/draw/<id>`는
 * 아무것도 아니다.
 *
 * ## 왜 라이브 SVG를 베끼나
 *
 * 요소를 다시 그리는 두 번째 렌더러를 만들지 않는다 — 그 순간 화면과 파일이
 * 서로 다른 그림이 될 길이 생긴다(획 끝 모양 하나, 화살촉 각도 하나). 캔버스는
 * 이미 **모든 요소**를 DOM에 들고 있으므로(`viewBox` 밖의 것도 그대로 있다),
 * 그것을 복제해 `viewBox`만 바꿔 끼우면 화면과 같은 그림이 나온다.
 *
 * ## 복제본이 손봐야 하는 세 가지
 *
 * 1. **CSS 변수**(`var(--color-surface)`)는 `<img>` 안에서 풀리지 않는다 —
 *    떨어져 나온 SVG는 문서의 스타일시트를 모른다. 종이 색을 날 값으로 박는다.
 * 2. **blob: URL**도 `<img>` 안에서는 막힌다(불투명 출처). 사진(배경이든 붙인
 *    요소든)은 바이트를 data URI로 실어 보낸다 — `[data-photo-id]` 하나로.
 * 3. **화면의 표식**(선택 테두리·리사이즈 핸들·마퀴)은 화면의 것이지 그림의 것이
 *    아니다 — `[data-draw-chrome]`이 달린 것은 전부 걷어 낸다.
 *
 * 순수한 부분(경계 계산·파일 이름)은 브라우저 없이 시험된다.
 */

import type { DrawPage } from '../types/models';
import { elementBounds, type Box } from './geometry';
import { visibleElements } from './pages';
import { DRAW_PAGE_SIZE } from './tools';

/** 내보낸 그림의 배율 — 2x. 폰에서 크게 봐도 획이 뭉개지지 않는 최소치. */
export const PNG_SCALE = 2;

/**
 * 내보낸 그림의 긴 변 상한(px).
 *
 * 배경 사진을 깐 페이지는 경계가 곧 페이지 전체(4000×4000)라, 2x를 그대로 곱하면
 * 8160×8160짜리 2.8MB 파일이 나온다(실측) — 대화방에 붙이라고 만든 물건이 대화방에
 * 못 붙는다. 게다가 배경 사진 자신이 긴 변 1600px로 압축돼 있어(`utils/photos`)
 * 그 위는 늘리기일 뿐이다. 그래서 배율은 「2x, 단 긴 변이 여기를 넘지 않게」다.
 */
export const PNG_MAX_EDGE = 3000;

/** 그림 둘레의 여백(로컬 px) — 획이 종이 끝에 붙어 잘린 것처럼 보이지 않게. */
export const PNG_MARGIN = 40;

/** 아무것도 없는 페이지가 받는 기본 크기 — 빈 종이도 파일은 나와야 한다. */
export const PNG_EMPTY_SIZE = { w: 1200, h: 900 };

/**
 * 배경 사진이 페이지 위에 놓이는 자리 — **가운데, 원본 비율**.
 *
 * 페이지는 4000×4000 정사각인데 사진은 그렇지 않다. 늘려서 채우면(cover) 사람의
 * 얼굴이 옆으로 퍼지므로 넣어서 맞춘다(contain). 가운데인 이유는 페이지를 열면
 * 화면이 한가운데에서 시작하기 때문이다 — 왼쪽 위 구석에 두면 배경을 깔자마자
 * 그것을 찾으러 스크롤해야 한다.
 */
export function backgroundRect(w: number, h: number, pageSize: number = DRAW_PAGE_SIZE): Box {
  const safeW = Number.isFinite(w) && w > 0 ? w : 1;
  const safeH = Number.isFinite(h) && h > 0 ? h : 1;
  const scale = Math.min(pageSize / safeW, pageSize / safeH);
  const width = safeW * scale;
  const height = safeH * scale;
  return {
    x: Math.round((pageSize - width) / 2),
    y: Math.round((pageSize - height) / 2),
    w: Math.round(width),
    h: Math.round(height),
  };
}

/**
 * 내보낼 영역 — 요소들과 배경을 다 감싸는 상자에 여백을 더한 것.
 *
 * 4000×4000을 통째로 내보내지 않는 이유는 그것이 대부분 빈 종이이기 때문이다:
 * 2x면 8000×8000짜리 파일이 되고, 그 안에서 실제로 그린 것은 한구석이다.
 */
export function exportBounds(
  page: DrawPage,
  background?: Box | null,
  margin: number = PNG_MARGIN,
): Box {
  const boxes: Box[] = visibleElements(page).map(elementBounds);
  if (background) boxes.push(background);

  if (boxes.length === 0) {
    return {
      x: Math.round(DRAW_PAGE_SIZE / 2 - PNG_EMPTY_SIZE.w / 2),
      y: Math.round(DRAW_PAGE_SIZE / 2 - PNG_EMPTY_SIZE.h / 2),
      w: PNG_EMPTY_SIZE.w,
      h: PNG_EMPTY_SIZE.h,
    };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const box of boxes) {
    if (box.x < minX) minX = box.x;
    if (box.y < minY) minY = box.y;
    if (box.x + box.w > maxX) maxX = box.x + box.w;
    if (box.y + box.h > maxY) maxY = box.y + box.h;
  }

  return {
    x: Math.round(minX - margin),
    y: Math.round(minY - margin),
    w: Math.max(1, Math.round(maxX - minX + margin * 2)),
    h: Math.max(1, Math.round(maxY - minY + margin * 2)),
  };
}

/**
 * 이 경계를 담을 배율 — 기본 2x, 긴 변이 {@link PNG_MAX_EDGE}를 넘으면 그만큼 줄인다.
 *
 * 작은 그림은 2x 그대로다(획이 뭉개지지 않아야 한다). 줄이기만 하고 늘리지 않는다.
 */
export function exportScale(bounds: Box, base: number = PNG_SCALE): number {
  const longest = Math.max(bounds.w, bounds.h);
  if (longest <= 0) return base;
  return Math.min(base, PNG_MAX_EDGE / longest);
}

/** 파일 이름에 쓸 수 없는 글자를 걷어낸다 — 빈 이름은 「드로우」가 된다. */
export function pngFileName(title: string): string {
  const illegal = /["*/:<>?\\|]/g;
  const control = /[\u0000-\u001f\u007f]/g;
  const safe = title
    .replace(illegal, '')
    .replace(control, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  return `${safe === '' ? '드로우' : safe}.png`;
}

/* ------------------------------------------------------------------ *
 * DOM half — vitest의 node 환경에서는 닿지 않는다
 * ------------------------------------------------------------------ */

/** 종이 색. `var(--color-surface)`의 라이트 테마 값 — 떨어져 나온 SVG는 변수를 모른다. */
const PAPER = '#fdfcfa';

/** 글자 요소가 파일 안에서도 같은 얼굴이도록. */
const FONT_STACK =
  "system-ui, -apple-system, 'Apple SD Gothic Neo', 'Noto Sans KR', 'Malgun Gothic', sans-serif";

/** `ArrayBuffer` → `data:` URI. 큰 파일에서도 스택을 넘지 않게 조각내 돈다. */
export function bufferToDataUrl(buf: ArrayBuffer, mime = 'image/jpeg'): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

export interface PngOptions {
  /**
   * `photoId → data URI` (M53-2) — 복제본의 `<image data-photo-id>`에 꽂는다.
   *
   * M52b는 `backgroundDataUrl` 하나였다. 붙인 사진 요소가 생기면서 그 모양으로는
   * 「배경은 특수 경우, 요소는 또 다른 경우」가 되는데, **배경을 이 맵의 한
   * 항목으로 만들면 특수 경우가 사라진다** — 파일 만들기가 아는 것은 이제
   * 「`data-photo-id`가 달린 것들」 하나뿐이다.
   *
   * 맵에 없는 id는 그 자리에서 **지운다**: blob: URL은 떨어져 나온 SVG 안에서
   * 막히므로, 남겨 두면 파일에 깨진 그림 표시가 찍힌다.
   */
  imageDataUrls?: Record<string, string>;
  scale?: number;
}

/**
 * 캔버스 `<svg>` 하나를 PNG 블롭으로.
 *
 * `<img>`가 SVG를 다 읽을 때까지 기다렸다가 캔버스에 그린다 — `decode()`가 있으면
 * 그것을 쓰고, 없으면 `onload`를 기다린다(사진 디코딩과 같은 규칙, `utils/photos`).
 */
export async function svgToPngBlob(
  svg: SVGSVGElement,
  bounds: Box,
  options: PngOptions = {},
): Promise<Blob> {
  const scale = options.scale ?? exportScale(bounds);
  const clone = svg.cloneNode(true) as SVGSVGElement;

  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  clone.setAttribute('viewBox', `${bounds.x} ${bounds.y} ${bounds.w} ${bounds.h}`);
  clone.setAttribute('width', String(bounds.w));
  clone.setAttribute('height', String(bounds.h));
  clone.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  clone.setAttribute('font-family', FONT_STACK);

  // ① 종이. 화면에서는 CSS 변수지만 파일 안에서는 날 값이어야 한다.
  const paper = clone.querySelector('[data-testid="draw-page-bg"]');
  if (paper) {
    paper.setAttribute('fill', PAPER);
    paper.setAttribute('stroke', 'none');
  }
  // ② 사진들 — blob: URL은 떨어져 나온 SVG 안에서 막힌다. 배경이든 붙인
  //    사진이든 **같은 규칙 하나**로 바이트를 갈아 끼운다 (M53-2).
  const urls = options.imageDataUrls ?? {};
  for (const node of clone.querySelectorAll('[data-photo-id]')) {
    const id = node.getAttribute('data-photo-id') ?? '';
    const dataUrl = urls[id];
    if (dataUrl) {
      node.setAttribute('href', dataUrl);
      node.removeAttribute('xlink:href');
    } else {
      node.remove();
    }
  }
  // ③ 화면의 표식들은 그림이 아니다 — **속성 하나로** 걷는다 (M53-1).
  //    testid를 하나씩 세던 자리였는데, 선택 테두리에 이어 핸들·마퀴가 생기면서
  //    「빠뜨리면 파일에 파란 점 여덟 개가 찍힌다」가 됐다. 표식 쪽이 스스로
  //    `data-draw-chrome`을 달게 하면 다음에 무엇이 늘어도 자동으로 빠진다.
  for (const node of clone.querySelectorAll('[data-draw-chrome]')) node.remove();

  const markup = new XMLSerializer().serializeToString(clone);
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;

  const image2 = new Image();
  image2.src = url;
  if (typeof image2.decode === 'function') {
    await image2.decode();
  } else {
    await new Promise<void>((resolve, reject) => {
      image2.onload = () => resolve();
      image2.onerror = () => reject(new Error('그림을 만들지 못했어요'));
    });
  }

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bounds.w * scale));
  canvas.height = Math.max(1, Math.round(bounds.h * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('그림을 만들지 못했어요');
  // 종이를 먼저 칠한다 — PNG의 투명 배경 위에 검은 획만 남으면 다크 모드
  // 메신저에서 그림이 통째로 사라진다.
  context.fillStyle = PAPER;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image2, 0, 0, canvas.width, canvas.height);

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('그림을 만들지 못했어요'))),
      'image/png',
    );
  });
}

/**
 * 만든 그림을 사람에게 건넨다 — 폰에서는 공유 시트, 그 밖에서는 내려받기.
 *
 * 폰에서 내려받기가 나쁜 답인 이유는 「다운로드 폴더에 들어갔다」가 끝이기
 * 때문이다: 공유 시트는 바로 대화방으로 보낸다. `canShare`를 먼저 묻는 이유는
 * 파일 공유를 지원하지 않는 브라우저가 `share()`에서 던지기 때문이고, 그때는
 * 조용히 내려받기로 내려온다.
 *
 * @returns 공유 시트로 보냈으면 `'share'`, 파일로 내렸으면 `'download'`.
 */
export async function deliverPng(blob: Blob, fileName: string): Promise<'share' | 'download'> {
  const file = new File([blob], fileName, { type: 'image/png' });
  const shareData = { files: [file], title: fileName };
  const nav = navigator as Navigator & {
    canShare?: (data: unknown) => boolean;
    share?: (data: unknown) => Promise<void>;
  };
  if (typeof nav.share === 'function' && nav.canShare?.(shareData)) {
    try {
      await nav.share(shareData);
      return 'share';
    } catch (err) {
      // 사람이 공유 시트를 닫은 것(AbortError)은 실패가 아니다 — 파일을 몰래
      // 내려받아 놓으면 「취소했는데 왜 저장됐지」가 된다.
      if ((err as Error)?.name === 'AbortError') return 'share';
    }
  }

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // 클릭이 시작한 저장이 끝날 때까지 URL이 살아 있어야 한다.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'download';
}
