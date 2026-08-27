import { useCallback, useState } from 'react';
import { MapContainer, Marker } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import type { GeoPoint, Id } from '../../types/models';
import { formatLatLng } from '../../utils/geo';
import Icon from '../common/Icon';
import { SECONDARY_BUTTON_CLASS } from '../common/formStyles';
import MapModal from './MapModal';
import MapReady from './MapReady';
import { OsmTiles, cardPinIcon } from './mapBase';

interface LocationPreviewProps {
  /** 보여 줄 자리. 위치가 없는 카드에서는 이 시트를 열 수 없다. */
  point: GeoPoint;
  /** 핀 색·아이콘 — 지도 탭의 그 카테고리 핀과 같은 모양이어야 한다. */
  color: string;
  icon: string;
  /** 핀의 신원. 새 카드에는 아직 id가 없어서 호출부가 임시 값을 준다. */
  cardId: Id;
  columnId: Id;
  onClose: () => void;
}

/** 한 장소만 보는 배율 — 건물과 그 앞 골목이 같이 보이는 정도. */
const PREVIEW_ZOOM = 16;

/**
 * 「위치 확인」 — 카드 안에서 핀이 실제로 어디에 꽂혔는지 보는 창 (M35).
 *
 * 사용자의 신고는 짧았다: *「카드에서 위치를 설정했을 때 확인할 방법이 없음」*.
 * 그전까지 카드가 보여 주던 것은 주소 한 줄뿐이라, 그 줄이 맞는지 확인하려면
 * 저장하고 → 지도 탭으로 가서 → 핀을 찾아야 했다. 여기서 끝나게 한다.
 *
 * **읽기 전용**이다. 고치는 길은 이미 두 개(검색·지도에서 선택) 있고, 보러 온
 * 창에서 손이 미끄러져 위치가 바뀌면 그게 더 나쁜 버그다. 그래서 확대·이동은
 * 되지만 무엇을 눌러도 좌표는 변하지 않는다.
 *
 * 「Google 지도에서 열기」가 밖으로 나가는 유일한 링크다. 사용자가 어긋남을 잡아낸
 * 방법이 정확히 그것(구글 지도와 대조)이었으므로, 그 대조를 한 번의 탭으로 만든다.
 *
 * 지도가 시트 안에 있다는 사실은 {@link MapReady}가 이미 해결한 문제다 — 열리는
 * 순간에는 패널이 아직 배치 전이라 Leaflet이 `0 × 0`을 기억한다. `PinPicker`와
 * 같은 방식으로 첫 프레임과 `ResizeObserver`에서 `invalidateSize()`를 부른다.
 */
export default function LocationPreview({
  point,
  color,
  icon,
  cardId,
  columnId,
  onClose,
}: LocationPreviewProps) {
  const [size, setSize] = useState({ x: 0, y: 0 });
  const onSize = useCallback((next: { x: number; y: number }) => {
    setSize((current) => (current.x === next.x && current.y === next.y ? current : next));
  }, []);

  const center: [number, number] = [point.lat, point.lng];
  const coords = formatLatLng(point.lat, point.lng);
  const gmapsUrl = `https://www.google.com/maps/search/?api=1&query=${point.lat},${point.lng}`;

  return (
    <MapModal title="위치 확인" onClose={onClose} testId="location-preview">
      <div
        data-testid="location-preview-map"
        data-ready={size.x > 0 && size.y > 0}
        data-lat={point.lat}
        data-lng={point.lng}
        className="isolate mt-1 h-[40vh] max-h-96 min-h-40 w-full overflow-hidden rounded-md border border-line"
      >
        <MapContainer
          center={center}
          zoom={PREVIEW_ZOOM}
          // 시트 안의 작은 지도다. 휠까지 먹으면 시트를 스크롤할 수 없다 —
          // 확대는 왼쪽 위 ＋/− 버튼이 맡는다.
          scrollWheelZoom={false}
          className="h-full w-full"
        >
          <OsmTiles />
          <MapReady onSize={onSize} />
          <Marker
            position={center}
            icon={cardPinIcon(color, icon, cardId, columnId, false, 'location-preview-pin')}
          />
        </MapContainer>
      </div>

      <p
        data-testid="location-preview-address"
        className="mt-3 break-words rounded-md bg-sunken px-3 py-2 text-label font-normal text-ink"
      >
        {point.address ?? coords}
      </p>
      <p className="mt-1 text-micro font-normal tabular-nums text-ink-faint">{coords}</p>

      <a
        data-testid="location-preview-gmaps"
        href={gmapsUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={`${SECONDARY_BUTTON_CLASS} mt-3 w-full`}
      >
        <Icon name="link" size={16} />
        Google 지도에서 열기
      </a>

      <p className="mt-3 text-micro font-normal text-ink-faint">
        보기 전용이에요. 위치를 바꾸려면 「검색」이나 「지도에서 선택」을 쓰세요.
      </p>
    </MapModal>
  );
}
