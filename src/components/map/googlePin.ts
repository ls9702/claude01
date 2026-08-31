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
import { MY_LOCATION_HEX } from '../../map/geolocate';

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

/**
 * 「내 위치」 파란 점 (M42) — Leaflet 쪽 `mapBase.myLocationIcon`의 쌍둥이.
 *
 * 같은 지름, 같은 파랑, 같은 흰 테두리. 두 지도에서 「나」가 다르게 생기면 그건
 * 이 앱이 두 개라는 뜻이다.
 */
export function createMyLocationElement(testId = 'gmap-my-location'): HTMLElement {
  const dot = document.createElement('div');
  dot.setAttribute('data-testid', testId);
  dot.style.cssText = [
    'width:18px',
    'height:18px',
    'border-radius:9999px',
    `background:${MY_LOCATION_HEX}`,
    'border:3px solid #fff',
    'box-shadow:0 1px 6px rgba(28,25,23,0.45)',
  ].join(';');
  return dot;
}

/**
 * 경로 다리 가운데에 앉는 「23분」 칩 (M42).
 *
 * 지도 위의 활자는 타일 위에 얹히므로 배경이 필요하다 — 흰 알약에 짙은 글씨,
 * 앱의 다른 칩들과 같은 인상이되 손가락으로 누를 것이 아니므로 더 작다.
 */
export function createDurationChipElement(label: string, testId = 'gmap-route-duration'): HTMLElement {
  const chip = document.createElement('div');
  chip.setAttribute('data-testid', testId);
  chip.setAttribute('data-duration', label);
  chip.style.cssText = [
    'padding:1px 6px',
    'border-radius:9999px',
    'background:#fff',
    'color:#1c1917',
    'font-size:11px',
    'line-height:1.5',
    'font-weight:600',
    'white-space:nowrap',
    'font-variant-numeric:tabular-nums',
    'box-shadow:0 1px 4px rgba(28,25,23,0.35)',
  ].join(';');
  chip.textContent = label;
  return chip;
}

/**
 * 「주변 맛집」 핀 (M43 → M45) — 카드 핀과 **한눈에 다르게** 생겼다.
 *
 * 이 레이어는 일정 위에 얹히는 참고 자료지 일정 자체가 아니다. 그래서 카드
 * 핀(30px 물방울, 카테고리 색)과 모양이 다르다 — 둥글고, 흰 바탕이고, 아래에
 * 이름표가 붙는다. 지도를 보다가 「내가 넣은 곳」과 「추천받은 곳」을 헷갈리면
 * 그 순간 이 기능은 방해가 된다.
 *
 * 큐레이션은 금색 테두리를 두른다(⭐ 링): 우리가 조사한 집과 구글이 방금 준
 * 집은 아는 것의 양이 다르고, 그 차이가 눌러 보기 전에 보여야 한다.
 *
 * ## M45 — 안 보이던 핀
 *
 * 실사용 신고: 「맛집 핀이 작아서 안 보인다」. 24px 흰 원에 13px 이모지는 밝은
 * 지도 타일 위에서 배경으로 녹아 버렸다(특히 낮 시간대의 오사카 시가지 타일).
 * 세 가지를 고친다.
 *
 * 1. **크기** — 24 → 32px, 이모지 13 → 17px.
 * 2. **대비** — 테두리를 잉크색 2px로 올리고 그림자를 짙게. 흰 원이 타일 위에
 *    「떠 있는」 것으로 보여야 배경과 구별된다.
 * 3. **이름표** — 핀 **아래**에 「AI추천」 알약 하나. 지도 위의 활자는 타일 위에
 *    얹히므로 배경이 필요하다(M42의 「23분」 칩이 이미 그렇게 산다). 큐레이션도
 *    라이브도 같은 말을 쓴다: 사용자에게 이 층은 「누가 추천해 준 곳」 하나이고,
 *    출처의 차이는 이미 금색 링과 팝업이 말한다.
 *
 * 요소가 둘이 되면서 바깥에 세로 묶음 하나가 생겼다. 데이터 속성과 클릭은 전부
 * **그 묶음**이 든다 — 스펙이 읽는 `[data-spot-key]`도, 앱이 다는 클릭 리스너도
 * 지금까지와 같은 하나의 요소다.
 */
const GOURMET_PIN_PX = 32;

/** 큐레이션 링의 금색. */
const CURATED_RING_HEX = '#b45309';

/** 라이브 결과의 테두리 — 옅은 회색이던 자리 (M45: 잉크색으로). */
const LIVE_RING_HEX = '#57534e';

/** 이름표에 적히는 말. 두 출처가 같은 말을 쓴다. */
export const GOURMET_PIN_LABEL = 'AI추천';

export interface GourmetPinOptions {
  /** 핀 위에 설 글자 — 갈래 이모지. */
  emoji: string;
  /** 이 한 곳의 유일한 이름 (`curated:…` / `google:…`). */
  spotKey: string;
  source: 'curated' | 'google';
  /** 갈래. 못 읽은 구글 결과는 `other`. */
  genre: string;
  testId?: string;
}

export function createGourmetPinElement({
  emoji,
  spotKey,
  source,
  genre,
  testId = 'gourmet-pin',
}: GourmetPinOptions): HTMLElement {
  const curated = source === 'curated';

  // 바깥 묶음 — 원과 이름표가 세로로 선다. 데이터도 클릭도 이 요소의 것이다.
  const pin = document.createElement('div');
  pin.setAttribute('data-testid', testId);
  pin.setAttribute('data-spot-key', spotKey);
  pin.setAttribute('data-source', source);
  pin.setAttribute('data-genre', genre);
  pin.style.cssText = [
    'display:flex',
    'flex-direction:column',
    'align-items:center',
    'gap:2px',
    'cursor:pointer',
    // 이름표가 옆 핀 위로 넘칠 수 있어야 한다 — 잘리면 「AI추…」가 된다.
    'white-space:nowrap',
  ].join(';');

  const disc = document.createElement('div');
  disc.setAttribute('data-testid', `${testId}-disc`);
  disc.style.cssText = [
    `width:${GOURMET_PIN_PX}px`,
    `height:${GOURMET_PIN_PX}px`,
    'background:#fff',
    `border:2px solid ${curated ? CURATED_RING_HEX : LIVE_RING_HEX}`,
    'border-radius:9999px',
    'box-shadow:0 2px 6px rgba(28,25,23,0.45)',
    'display:flex',
    'align-items:center',
    'justify-content:center',
  ].join(';');

  const glyph = document.createElement('span');
  glyph.style.cssText = 'font-size:17px;line-height:1';
  glyph.textContent = emoji;
  disc.appendChild(glyph);
  pin.appendChild(disc);

  const label = document.createElement('span');
  label.setAttribute('data-testid', `${testId}-label`);
  label.style.cssText = [
    'padding:0 5px',
    'border-radius:9999px',
    'background:#fff',
    `color:${curated ? CURATED_RING_HEX : '#1c1917'}`,
    'font-size:10px',
    'line-height:15px',
    'font-weight:700',
    'letter-spacing:-0.01em',
    'box-shadow:0 1px 3px rgba(28,25,23,0.4)',
  ].join(';');
  label.textContent = GOURMET_PIN_LABEL;
  pin.appendChild(label);

  return pin;
}

/**
 * 「우리 맛집」 핀 (M49) — AI 추천 핀과 **같은 크기, 다른 링**.
 *
 * 같은 32px 흰 원에 같은 자리의 이름표를 쓴다: 둘 다 「지도 위에 얹힌 참고 층」
 * 이라 카드 핀(30px 물방울)과 갈라져야 하는 쪽은 같다. 대신 링이 다르다 —
 * AI 추천은 금색(큐레이션)·잉크(구글)이고, 우리 목록은 **초록**이다. 그리고
 * 이름표가 「내 맛집」이라고 말한다.
 *
 * 색으로만 가르지 않는 것이 요점이다(M15 §3의 그 규칙): 링이 안 보이는 눈에도
 * 이름표 두 글자가 어느 층인지 말한다.
 */

/** 우리 목록의 링 — 카테고리 팔레트의 emerald와 같은 계열의 짙은 초록. */
const USER_GOURMET_RING_HEX = '#047857';

/** 이름표에 적히는 말. */
export const USER_GOURMET_PIN_LABEL = '내 맛집';

export interface UserGourmetPinOptions {
  /** 핀 위에 설 글자 — 장르 이모지, 안 골랐으면 🍽️. */
  emoji: string;
  /** 이 한 곳의 카드 id. */
  cardId: string;
  /** 갈래 이름, 안 골랐으면 `none`. */
  genre: string;
  testId?: string;
}

export function createUserGourmetPinElement({
  emoji,
  cardId,
  genre,
  testId = 'usergourmet-pin',
}: UserGourmetPinOptions): HTMLElement {
  const pin = document.createElement('div');
  pin.setAttribute('data-testid', testId);
  pin.setAttribute('data-card-id', cardId);
  pin.setAttribute('data-genre', genre);
  pin.style.cssText = [
    'display:flex',
    'flex-direction:column',
    'align-items:center',
    'gap:2px',
    'cursor:pointer',
    'white-space:nowrap',
  ].join(';');

  const disc = document.createElement('div');
  disc.setAttribute('data-testid', `${testId}-disc`);
  disc.style.cssText = [
    `width:${GOURMET_PIN_PX}px`,
    `height:${GOURMET_PIN_PX}px`,
    'background:#fff',
    `border:2px solid ${USER_GOURMET_RING_HEX}`,
    'border-radius:9999px',
    'box-shadow:0 2px 6px rgba(28,25,23,0.45)',
    'display:flex',
    'align-items:center',
    'justify-content:center',
  ].join(';');

  const glyph = document.createElement('span');
  glyph.style.cssText = 'font-size:17px;line-height:1';
  glyph.textContent = emoji;
  disc.appendChild(glyph);
  pin.appendChild(disc);

  const label = document.createElement('span');
  label.setAttribute('data-testid', 'usergourmet-pin-label');
  label.style.cssText = [
    'padding:0 5px',
    'border-radius:9999px',
    'background:#fff',
    `color:${USER_GOURMET_RING_HEX}`,
    'font-size:10px',
    'line-height:15px',
    'font-weight:700',
    'letter-spacing:-0.01em',
    'box-shadow:0 1px 3px rgba(28,25,23,0.4)',
  ].join(';');
  label.textContent = USER_GOURMET_PIN_LABEL;
  pin.appendChild(label);

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
