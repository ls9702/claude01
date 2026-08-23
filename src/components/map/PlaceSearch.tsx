import { useEffect, useRef, useState } from 'react';
import type { GeoPoint } from '../../types/models';
import { SEARCH_COOLDOWN_MS, SEARCH_ERROR_MESSAGE, searchPlaces } from '../../utils/geo';
import { INLINE_INPUT_CLASS, PRIMARY_BUTTON_CLASS } from '../common/formStyles';
import MapModal from './MapModal';

interface PlaceSearchProps {
  /** Pre-fills the box — the card's title is usually what you want to look up. */
  initialQuery?: string;
  onPick: (point: GeoPoint) => void;
  onClose: () => void;
}

type Status = 'idle' | 'loading' | 'done';

/**
 * Nominatim place search.
 *
 * Deliberately **submit-only**: no typeahead, no search-as-you-type. OSM's
 * usage policy caps this free endpoint at roughly one request per second, so
 * the 검색 button also stays disabled for {@link SEARCH_COOLDOWN_MS} after each
 * request. Picking a result hands a {@link GeoPoint} back and closes.
 */
export default function PlaceSearch({ initialQuery = '', onPick, onClose }: PlaceSearchProps) {
  const [query, setQuery] = useState(initialQuery);
  const [status, setStatus] = useState<Status>('idle');
  const [results, setResults] = useState<GeoPoint[]>([]);
  const [error, setError] = useState<string | null>(null);
  /** True while the post-request cooldown is running. */
  const [cooling, setCooling] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      abortRef.current?.abort();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const trimmed = query.trim();
  const busy = status === 'loading';
  const canSearch = trimmed.length > 0 && !busy && !cooling;

  const submit = async () => {
    if (!canSearch) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setStatus('loading');
    setError(null);

    // Start the cooldown with the request, not with its answer.
    setCooling(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      if (aliveRef.current) setCooling(false);
    }, SEARCH_COOLDOWN_MS);

    try {
      const found = await searchPlaces(trimmed, controller.signal);
      if (!aliveRef.current || controller.signal.aborted) return;
      setResults(found);
      setStatus('done');
    } catch (failure) {
      if (!aliveRef.current || controller.signal.aborted) return;
      setResults([]);
      setError(failure instanceof Error ? failure.message : SEARCH_ERROR_MESSAGE);
      setStatus('done');
    }
  };

  return (
    <MapModal title="장소 검색" onClose={onClose} testId="place-search">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        className="space-y-3"
      >
        <div className="flex items-end gap-2 pt-2">
          <input
            data-testid="place-search-input"
            aria-label="장소 이름"
            value={query}
            autoFocus
            onChange={(event) => setQuery(event.target.value)}
            placeholder="예) 시부야 스크램블 교차로"
            className={`${INLINE_INPUT_CLASS} min-w-0 flex-1`}
          />
          <button
            type="submit"
            data-testid="place-search-submit"
            disabled={!canSearch}
            className={`${PRIMARY_BUTTON_CLASS} shrink-0`}
          >
            {busy ? '검색 중…' : '검색'}
          </button>
        </div>

        <p className="text-micro font-normal text-ink-faint">
          OpenStreetMap(Nominatim)에서 찾아요. 검색 버튼을 눌러야 요청해요.
        </p>
      </form>

      {error ? (
        <p
          data-testid="place-search-error"
          role="alert"
          className="mt-3 rounded-md bg-danger-wash px-3 py-2 text-label font-normal text-danger"
        >
          {error}
        </p>
      ) : null}

      {status === 'done' && !error && results.length === 0 ? (
        <p
          data-testid="place-search-empty"
          className="mt-3 rounded-md bg-sunken px-3 py-2 text-label font-normal text-ink-faint"
        >
          검색 결과가 없어요. 다른 이름으로 찾아보세요.
        </p>
      ) : null}

      {results.length > 0 ? (
        <ul data-testid="place-search-results" className="mt-3 space-y-2">
          {results.map((place, index) => (
            <li key={`${place.lat},${place.lng},${index}`}>
              <button
                type="button"
                data-testid="place-search-result"
                data-index={index}
                data-lat={place.lat}
                data-lng={place.lng}
                onClick={() => {
                  onPick(place);
                  onClose();
                }}
                className="w-full rounded-md border border-line bg-surface px-3 py-3 text-left transition-colors duration-[140ms] ease-quick hover:border-line-strong hover:bg-sunken"
              >
                <span className="block text-label text-ink">{place.address}</span>
                <span className="mt-1 block text-micro font-normal tabular-nums text-ink-faint">
                  {place.lat.toFixed(4)}, {place.lng.toFixed(4)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </MapModal>
  );
}
