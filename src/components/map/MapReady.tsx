import { useEffect } from 'react';
import { useMap } from 'react-leaflet';

interface MapReadyProps {
  /**
   * Called with the map's pixel size once it has settled, and again on every
   * resize. A `0 × 0` size means the container was not laid out yet.
   */
  onSize: (size: { x: number; y: number }) => void;
}

/**
 * Keeps Leaflet's idea of the viewport in sync with the real container.
 *
 * The app shell mounts **only the active tab's view**, so the map is created
 * fresh on every visit to 지도 — often before the browser has laid the panel
 * out. Leaflet measures its container once at construction time and would
 * otherwise keep a stale (frequently `0 × 0`) size, which shows up as a grey
 * panel with a single row of tiles.
 *
 * Two safety nets, because either one alone has a hole: an
 * `invalidateSize()` on the first animation frame *after* the first paint
 * (covers the mount race) and a `ResizeObserver` on the container (covers tab
 * switches, rotation, and the desktop breakpoint). Renders nothing.
 */
export default function MapReady({ onSize }: MapReadyProps) {
  const map = useMap();

  useEffect(() => {
    const container = map.getContainer();

    const settle = () => {
      map.invalidateSize({ animate: false });
      const size = map.getSize();
      onSize({ x: size.x, y: size.y });
    };

    // After the first paint — the container has real dimensions by then.
    const frame = requestAnimationFrame(settle);

    // Fires immediately on observe, then on every layout change.
    const observer = new ResizeObserver(settle);
    observer.observe(container);

    window.addEventListener('orientationchange', settle);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('orientationchange', settle);
    };
  }, [map, onSize]);

  return null;
}
