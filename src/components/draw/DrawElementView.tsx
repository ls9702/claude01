import { memo } from 'react';
import {
  LINE_HEIGHT,
  arrowHead,
  dashArray,
  elementBounds,
  strokePath,
  textLines,
} from '../../draw/geometry';
import { HIGHLIGHT_OPACITY, clampOpacity } from '../../draw/tools';
import type { DrawElement, Id } from '../../types/models';

/**
 * 요소 하나를 SVG로 (M52a).
 *
 * 이 컴포넌트는 **아무 이벤트도 듣지 않는다** (`pointerEvents: 'none'`). 맞힘
 * 판정은 캔버스가 `draw/geometry`의 순수 함수로 직접 하는데, 그 이유는 지우개와
 * 선택이 「가까이 지나가면 맞은 것」이어야 하기 때문이다 — SVG의 히트 테스트는
 * 획의 픽셀 위에 정확히 놓였을 때만 맞았다고 답하고, 굵기 2px짜리 선을 손가락으로
 * 정확히 짚으라는 것은 폰에서 불가능한 요구다.
 *
 * 그리는 중인 미리보기도 같은 컴포넌트를 쓴다 — 저장된 획과 그리는 중인 획이
 * 다르게 보이면 손이 예측할 수 없다.
 */
function DrawElementView({
  element,
  selected = false,
  imageUrls,
}: {
  element: DrawElement;
  selected?: boolean;
  /**
   * `photoId → object URL` (M53-2) — **부모가 만들어 내려 준다**.
   *
   * 이 컴포넌트가 `usePhotoUrl`을 직접 부르지 않는 이유는 위의 규칙 하나 때문이다:
   * 훅이 없는 순수 프레젠테이션이라 draft 미리보기·PNG·목록이 같은 함수를 쓴다.
   * 훅을 들이면 요소 하나가 곧 구독 하나가 되어, 획 300개짜리 페이지가 리렌더마다
   * 300번 상태를 만든다.
   */
  imageUrls?: Record<Id, string>;
}) {
  const common = {
    'data-testid': 'draw-element',
    'data-kind': element.type,
    'data-element-id': element.id,
    // 잠긴 것은 화면에서 달라 보이지 않는다 — 다르게 보이면 그림이 아니라 UI가
    // 된다. 그래도 「왜 안 잡히지」의 답은 DOM에 있어야 한다.
    'data-locked': element.locked ? 'true' : 'false',
    style: { pointerEvents: 'none' as const },
  };

  switch (element.type) {
    case 'stroke':
      // 손글씨는 꺾인 선이 아니라 **매끄러운 곡선**으로 그린다 (M53-2, #7).
      // 바뀌는 것은 이 한 줄뿐이다 — 저장되는 점 배열도, 맞힘 판정도, PNG가
      // 보는 값도 그대로다. 그래서 이 변경은 이미 그린 그림에도 소급된다.
      return (
        <g {...common}>
          <path
            d={strokePath(element.points)}
            fill="none"
            stroke={element.color}
            strokeWidth={element.width}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={element.kind === 'highlight' ? HIGHLIGHT_OPACITY : 1}
          />
          {selected ? <SelectionRing element={element} /> : null}
        </g>
      );

    case 'rect':
      return (
        <g {...common}>
          <rect
            x={element.x}
            y={element.y}
            width={element.w}
            height={element.h}
            fill={element.fill ?? 'none'}
            stroke={element.color}
            strokeWidth={element.width}
            strokeDasharray={dashArray(element.width, element.dash)}
            strokeLinejoin="round"
          />
          {selected ? <SelectionRing element={element} /> : null}
        </g>
      );

    case 'ellipse':
      return (
        <g {...common}>
          <ellipse
            cx={element.x + element.w / 2}
            cy={element.y + element.h / 2}
            rx={element.w / 2}
            ry={element.h / 2}
            fill={element.fill ?? 'none'}
            stroke={element.color}
            strokeWidth={element.width}
            strokeDasharray={dashArray(element.width, element.dash)}
          />
          {selected ? <SelectionRing element={element} /> : null}
        </g>
      );

    case 'line':
    case 'arrow': {
      const head =
        element.type === 'arrow'
          ? arrowHead(element.x1, element.y1, element.x2, element.y2, element.width)
          : [];
      // 「가는 길과 오는 길」 (M53-2, #4) — 시작점의 촉은 **방향만 뒤집은** 같은
      // 함수다. 두 번째 규칙을 만들지 않는 것이 이 필드가 싼 이유다.
      const tail =
        element.type === 'arrow' && element.heads === 'both'
          ? arrowHead(element.x2, element.y2, element.x1, element.y1, element.width)
          : [];
      return (
        <g {...common}>
          <line
            x1={element.x1}
            y1={element.y1}
            x2={element.x2}
            y2={element.y2}
            stroke={element.color}
            strokeWidth={element.width}
            strokeDasharray={dashArray(element.width, element.dash)}
            strokeLinecap="round"
          />
          {head.length === 2 ? (
            // 촉은 `marker`가 아니라 폴리라인이다 — 그래야 방향이 순수 함수의
            // 답이 되고, 브라우저 없이 시험된다 (`draw/geometry.arrowHead`).
            // **촉은 점선이 되지 않는다**: 점선 화살표의 촉까지 끊기면 그것은
            // 촉으로 보이지 않는다.
            <polyline
              data-head="end"
              points={`${head[0].x},${head[0].y} ${element.x2},${element.y2} ${head[1].x},${head[1].y}`}
              fill="none"
              stroke={element.color}
              strokeWidth={element.width}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : null}
          {tail.length === 2 ? (
            <polyline
              data-head="start"
              points={`${tail[0].x},${tail[0].y} ${element.x1},${element.y1} ${tail[1].x},${tail[1].y}`}
              fill="none"
              stroke={element.color}
              strokeWidth={element.width}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : null}
          {selected ? <SelectionRing element={element} /> : null}
        </g>
      );
    }

    case 'text': {
      // 여러 줄은 `tspan` 여럿이다 (M52a-fix ⑨). SVG의 `<text>`는 `\n`을 공백
      // 하나로 뭉개므로, 붙여넣은 두 줄짜리 메모가 한 줄로 이어져 페이지 밖까지
      // 뻗던 자리다. 줄 간격은 맞힘 판정과 **같은 상수**를 쓴다.
      const lines = textLines(element.text);
      return (
        <g {...common}>
          <text
            x={element.x}
            y={element.y}
            fill={element.color}
            fontSize={element.size}
            fontWeight={600}
          >
            {lines.map((line, index) => (
              <tspan
                key={index}
                x={element.x}
                dy={index === 0 ? 0 : element.size * LINE_HEIGHT}
                // 빈 줄도 자리를 차지해야 다음 줄이 제자리에 온다.
                xmlSpace="preserve"
              >
                {line === '' ? ' ' : line}
              </tspan>
            ))}
          </text>
          {selected ? <SelectionRing element={element} /> : null}
        </g>
      );
    }

    case 'sticker':
      return (
        <g {...common}>
          <text
            x={element.x}
            y={element.y}
            fontSize={element.size}
            textAnchor="middle"
            dominantBaseline="central"
          >
            {element.emoji}
          </text>
          {selected ? <SelectionRing element={element} /> : null}
        </g>
      );

    case 'image': {
      // 붙인 사진 (M53-2). `preserveAspectRatio="none"`인 이유는 **상자가 곧
      // 그림**이어야 하기 때문이다: 비율을 지키게 두면 비균등으로 늘렸을 때
      // 선택 테두리 안에 여백이 생기고, 사람은 「닿지 않는 곳」을 짚게 된다.
      // 처음 놓일 때 원본 비율로 들어가므로(`DrawEditor`) 손대지 않으면 안 찌그러진다.
      const href = imageUrls?.[element.photoId];
      return (
        <g {...common}>
          {href ? (
            <image
              data-testid="draw-image"
              // PNG는 이 속성을 보고 바이트를 갈아 끼운다 (`draw/png`) — 배경도
              // 같은 속성을 달아서, 파일 만들기에는 특수 경우가 없다.
              data-photo-id={element.photoId}
              href={href}
              x={element.x}
              y={element.y}
              width={element.w}
              height={element.h}
              preserveAspectRatio="none"
              opacity={clampOpacity(element.opacity)}
            />
          ) : (
            // 바이트가 아직(또는 영영) 없을 때 — 자리는 지킨다. 빈 곳으로 두면
            // 「사진이 사라졌다」와 「아직 받는 중이다」가 같은 화면이 된다.
            <rect
              data-testid="draw-image-missing"
              x={element.x}
              y={element.y}
              width={element.w}
              height={element.h}
              fill="none"
              stroke="#c9c3ba"
              strokeWidth={2}
              strokeDasharray="10 8"
              vectorEffect="non-scaling-stroke"
            />
          )}
          {selected ? <SelectionRing element={element} /> : null}
        </g>
      );
    }

    default:
      // 모르는 타입은 **그리지 않는다** (M53-1). 다음 회차가 요소 타입을 하나
      // 늘리므로, 그 요소가 든 워크스페이스가 옛 빌드에 닿았을 때의 최선의 결말을
      // 여기서 미리 정해 둔다: 화면이 죽는 대신 그 요소 하나가 안 보인다.
      return null;
  }
}

/**
 * **바뀐 요소만 다시 그린다** (M53-2).
 *
 * 캔버스는 그리는 중에 매 프레임 리렌더된다(미리보기 획이 상태이므로). 그때마다
 * 요소 300개가 전부 다시 그려지면, 손글씨가 매끄러운 곡선이 된 만큼(#7) 프레임이
 * 늘어진다 — 실측으로 300획×60점의 path 문자열을 만드는 데만 한 프레임에
 * 9.6ms(폰에서는 그 몇 배)다.
 *
 * 여기서 얕은 비교가 실제로 통하는 이유는 위의 규칙 때문이다: 이 컴포넌트는 훅도
 * 이벤트도 없는 순수 프레젠테이션이고, 요소 객체는 스토어가 그것을 고칠 때만 새
 * 참조가 된다(미리보기의 `previewElement`도 손대지 않은 요소는 **같은 객체**를
 * 돌려준다). 그래서 「바뀐 것만 다시 그린다」가 정확히 성립한다.
 */
export default memo(DrawElementView);

/** 선택된 요소를 감싸는 점선 — 채우지 않는다(밑의 그림을 가리지 않게). */
function SelectionRing({ element }: { element: DrawElement }) {
  const box = elementBounds(element);
  return (
    <rect
      data-testid="draw-selection"
      // 화면의 표식이지 그림이 아니다 — PNG는 이 속성을 보고 걷어 간다 (M53-1).
      data-draw-chrome="selection"
      x={box.x - 6}
      y={box.y - 6}
      width={box.w + 12}
      height={box.h + 12}
      fill="none"
      stroke="#2f74d0"
      strokeWidth={2}
      strokeDasharray="8 6"
      vectorEffect="non-scaling-stroke"
    />
  );
}
