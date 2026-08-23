import { useCallback, useEffect, useState } from 'react';
import { MapContainer, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import type { GeoPoint } from '../../types/models';
import { formatLatLng, pinAddress } from '../../utils/geo';
import Icon from '../common/Icon';
import { PRIMARY_BUTTON_CLASS, SECONDARY_BUTTON_CLASS } from '../common/formStyles';
import MapModal from './MapModal';
import MapReady from './MapReady';
import { OsmTiles, SEOUL_CENTER, SEOUL_ZOOM } from './mapBase';

interface PinPickerProps {
  /** The card's current location, if any — where the picker opens. */
  initial?: GeoPoint;
  onPick: (point: GeoPoint) => void;
  onClose: () => void;
}

/** Zoom used when the card already has a location to fine-tune. */
const REFINE_ZOOM = 16;

interface CenterProbeProps {
  onMove: (lat: number, lng: number) => void;
}

/** Reports the map's center while it is being panned. */
function CenterProbe({ onMove }: CenterProbeProps) {
  const map = useMap();

  useEffect(() => {
    const emit = () => {
      const center = map.getCenter();
      onMove(center.lat, center.lng);
    };
    emit();
    map.on('move', emit);
    map.on('zoom', emit);
    return () => {
      map.off('move', emit);
      map.off('zoom', emit);
    };
  }, [map, onMove]);

  return null;
}

/**
 * Drops a pin by hand: a crosshair nailed to the middle of the screen while the
 * map slides underneath it.
 *
 * The chosen point is labelled with its own coordinates rather than a
 * reverse-geocoded address — one more Nominatim round trip per pin is not worth
 * it, and "35.6595, 139.7005" is honest about what the user actually picked.
 */
export default function PinPicker({ initial, onPick, onClose }: PinPickerProps) {
  const start: [number, number] = initial ? [initial.lat, initial.lng] : SEOUL_CENTER;
  const [center, setCenter] = useState<{ lat: number; lng: number }>({
    lat: start[0],
    lng: start[1],
  });
  const [size, setSize] = useState({ x: 0, y: 0 });

  const onMove = useCallback((lat: number, lng: number) => setCenter({ lat, lng }), []);
  const onSize = useCallback((next: { x: number; y: number }) => {
    setSize((current) => (current.x === next.x && current.y === next.y ? current : next));
  }, []);

  const confirm = () =>
    onPick({ lat: center.lat, lng: center.lng, address: pinAddress(center.lat, center.lng) });

  return (
    <MapModal
      title="지도에서 선택"
      onClose={onClose}
      variant="full"
      testId="pin-picker"
      footer={
        <div className="flex items-center gap-2">
          <span
            data-testid="pin-picker-center"
            data-lat={center.lat}
            data-lng={center.lng}
            className="flex min-w-0 flex-1 items-center gap-1 truncate text-label font-normal tabular-nums text-ink-muted"
          >
            <Icon name="pin" size={16} />
            {formatLatLng(center.lat, center.lng)}
          </span>
          <button
            type="button"
            data-testid="pin-picker-cancel"
            onClick={onClose}
            className={SECONDARY_BUTTON_CLASS}
          >
            취소
          </button>
          <button
            type="button"
            data-testid="pin-picker-confirm"
            onClick={confirm}
            className={PRIMARY_BUTTON_CLASS}
          >
            이 위치로 설정
          </button>
        </div>
      }
    >
      <div
        data-testid="pin-picker-map"
        data-ready={size.x > 0 && size.y > 0}
        className="absolute inset-0 isolate"
      >
        <MapContainer
          center={start}
          zoom={initial ? REFINE_ZOOM : SEOUL_ZOOM}
          scrollWheelZoom
          className="h-full w-full"
        >
          <OsmTiles />
          <MapReady onSize={onSize} />
          <CenterProbe onMove={onMove} />
        </MapContainer>

        {/* The pin never moves; the map does. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-[500] flex items-center justify-center"
        >
          <span className="-mt-6" style={{ fontSize: 32, lineHeight: 1 }}>
            📍
          </span>
        </div>

        <p className="pointer-events-none absolute inset-x-0 top-3 z-[500] text-center text-micro font-normal text-ink">
          <span className="rounded-full bg-surface/90 px-3 py-1 shadow-raise">
            지도를 움직여 원하는 위치를 가운데에 두세요
          </span>
        </p>
      </div>
    </MapModal>
  );
}
