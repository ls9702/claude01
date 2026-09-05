import { LINE_HEIGHT, arrowHead, elementBounds, textLines } from '../../draw/geometry';
import { HIGHLIGHT_OPACITY } from '../../draw/tools';
import type { DrawElement } from '../../types/models';

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
export default function DrawElementView({
  element,
  selected = false,
}: {
  element: DrawElement;
  selected?: boolean;
}) {
  const common = {
    'data-testid': 'draw-element',
    'data-kind': element.type,
    'data-element-id': element.id,
    style: { pointerEvents: 'none' as const },
  };

  switch (element.type) {
    case 'stroke': {
      const points: string[] = [];
      for (let i = 0; i + 1 < element.points.length; i += 2) {
        points.push(`${element.points[i]},${element.points[i + 1]}`);
      }
      return (
        <g {...common}>
          <polyline
            points={points.join(' ')}
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
    }

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
      return (
        <g {...common}>
          <line
            x1={element.x1}
            y1={element.y1}
            x2={element.x2}
            y2={element.y2}
            stroke={element.color}
            strokeWidth={element.width}
            strokeLinecap="round"
          />
          {head.length === 2 ? (
            // 촉은 `marker`가 아니라 폴리라인이다 — 그래야 방향이 순수 함수의
            // 답이 되고, 브라우저 없이 시험된다 (`draw/geometry.arrowHead`).
            <polyline
              points={`${head[0].x},${head[0].y} ${element.x2},${element.y2} ${head[1].x},${head[1].y}`}
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
  }
}

/** 선택된 요소를 감싸는 점선 — 채우지 않는다(밑의 그림을 가리지 않게). */
function SelectionRing({ element }: { element: DrawElement }) {
  const box = elementBounds(element);
  return (
    <rect
      data-testid="draw-selection"
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
