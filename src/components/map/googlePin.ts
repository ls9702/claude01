/**
 * 구글 지도 위의 카테고리 핀 — DOM 요소 하나 (M41).
 *
 * Leaflet은 HTML **문자열**을 받고(`divIcon`), AdvancedMarkerElement는 진짜
 * **요소**를 받는다. 그래서 `mapBase.cardPinIcon`을 그대로 쓸 수는 없지만,
 * 나오는 그림은 같아야 한다 — 같은 여행의 같은 맛집이 시트를 바꿨다고 다른
 * 모양으로 서면 그건 두 개의 지도가 아니라 두 개의 앱이다. 색·크기·물방울
 * 실루엣·이모지 반대회전까지 M3의 그 핀을 그대로 옮긴다.
 *
 * 요소를 우리가 만든다는 점이 하나 더 좋다: 클릭 핸들러를 구글의 이벤트 시스템을
 * 거치지 않고 직접 붙일 수 있어서, 핀을 눌렀을 때 카드 팝업이 뜨는 길이 짧다.
 */

import { colorHex } from '../../utils/colors';

/** M3의 핀과 같은 지름. */
const PIN_PX = 30;

export interface GooglePinOptions {
  color: string;
  icon: string;
  cardId: string;
  columnId: string;
  /** 다른 날의 장소 — 사라지지 않고 물러난다 (M15 §3와 같은 규칙). */
  dimmed?: boolean;
  testId?: string;
}

/** 카테고리 색 물방울 + 이모지. 붙이는 쪽이 지도에 얹는다. */
export function createPinElement({
  color,
  icon,
  cardId,
  columnId,
  dimmed = false,
  testId = 'gmap-marker',
}: GooglePinOptions): HTMLElement {
  const pin = document.createElement('div');
  pin.setAttribute('data-testid', testId);
  pin.setAttribute('data-card-id', cardId);
  pin.setAttribute('data-column-id', columnId);
  pin.setAttribute('data-dimmed', dimmed ? 'true' : 'false');
  pin.style.cssText = [
    `width:${PIN_PX}px`,
    `height:${PIN_PX}px`,
    `background:${colorHex(color)}`,
    'border:2px solid #fff',
    dimmed ? 'opacity:0.35' : '',
    'border-radius:50% 50% 50% 0',
    'transform:rotate(-45deg)',
    'box-shadow:0 2px 6px rgba(28,25,23,0.35)',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'cursor:pointer',
  ]
    .filter(Boolean)
    .join(';');

  const glyph = document.createElement('span');
  glyph.style.cssText = 'transform:rotate(45deg);font-size:15px;line-height:1';
  glyph.textContent = icon;
  pin.appendChild(glyph);

  return pin;
}

/** 보정 팝업의 두 점 (M41) — 기존은 물러나고 제안이 앞에 선다. */
export function createDotElement(
  variant: 'existing' | 'suggested',
  testId: string,
): HTMLElement {
  const dot = document.createElement('div');
  dot.setAttribute('data-testid', testId);
  dot.setAttribute('data-variant', variant);
  const existing = variant === 'existing';
  dot.style.cssText = [
    'width:18px',
    'height:18px',
    'border-radius:9999px',
    `background:${existing ? '#a8a29e' : '#1c1917'}`,
    'border:3px solid #fff',
    `opacity:${existing ? '0.75' : '1'}`,
    'box-shadow:0 2px 6px rgba(28,25,23,0.35)',
  ].join(';');
  return dot;
}
