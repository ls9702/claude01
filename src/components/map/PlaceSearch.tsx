import { useEffect, useMemo, useRef, useState } from 'react';
import { useAiEnabled } from '../../ai/aiSettings';
import { toGeoPoint, type PlaceCandidate } from '../../ai/aiPlaces';
import { parseCoordInput, SHORT_LINK_HINT } from '../../map/coordInput';
import { searchPlacesRefined, type PlaceSource } from '../../map/placeSearch';
import type { GeoPoint } from '../../types/models';
import { SEARCH_COOLDOWN_MS, SEARCH_ERROR_MESSAGE, formatLatLng, pinAddress } from '../../utils/geo';
import { INLINE_INPUT_CLASS, PRIMARY_BUTTON_CLASS } from '../common/formStyles';
import MapModal from './MapModal';

interface PlaceSearchProps {
  /** Pre-fills the box — the card's title is usually what you want to look up. */
  initialQuery?: string;
  /**
   * The trip's 목적지 address (M12), handed to the AI half as context (M28).
   *
   * 「글리코상」 is only findable if the model knows we are talking about 오사카;
   * the OSM half never sees it, because Nominatim has no such parameter.
   */
  destination?: string;
  onPick: (point: GeoPoint) => void;
  onClose: () => void;
}

type Status = 'idle' | 'loading' | 'done';

/**
 * 장소 검색 — AI 먼저, 안 되면 OpenStreetMap (M28).
 *
 * M35에서 AI 결과 줄은 좌표를 한 번 더 OSM에 맞춰 조인 뒤에 나온다. 조여진 줄에는
 * 「✓ 지도 확인됨」이 조용히 붙는다 — 그 줄의 좌표가 모델의 기억이 아니라 지도가
 * 아는 자리라는 뜻이다.
 *
 * 규칙은 전부 `map/placeSearch.searchPlacesRefined`에 있고, 이 파일은 그 결과를
 * 그리기만 한다. 화면에서 달라진 것은 두 가지다: 결과 줄이 현지 표기(通天閣)를
 * 같이 보여 주고, OSM으로 내려간 경우에만 한 줄로 그 사실을 알린다.
 *
 * 여전히 **submit-only**다: OSM 경로는 M3 그대로 초당 1건 정책 아래 있고, AI
 * 경로는 한 번에 2~4초·분당 20건짜리 퓨즈 아래 있다. 둘 다 타이핑마다 부를
 * 것이 못 된다. 검색 버튼은 요청 후 {@link SEARCH_COOLDOWN_MS} 동안 잠긴다.
 *
 * M37에서 **엔진을 통째로 건너뛰는 길** 하나가 생겼다(`map/coordInput.ts`): 입력이
 * 좌표이거나 구글 지도 링크이면 이미 답이 손에 있다는 뜻이므로, 아무에게도 묻지
 * 않고 그 자리를 줄 하나로 내놓는다. 이름으로 다시 찾는 것은 틀릴 기회를 한 번 더
 * 주는 것이다. 이 길은 요청을 하나도 쓰지 않아서 타이핑마다 판정해도 안전하다.
 */
export default function PlaceSearch({
  initialQuery = '',
  destination,
  onPick,
  onClose,
}: PlaceSearchProps) {
  const aiOn = useAiEnabled();
  const [query, setQuery] = useState(initialQuery);
  const [status, setStatus] = useState<Status>('idle');
  const [results, setResults] = useState<PlaceCandidate[]>([]);
  const [source, setSource] = useState<PlaceSource>('osm');
  /** 한 줄 안내 — AI가 답을 못 줘서 OSM으로 내려갔을 때만. */
  const [note, setNote] = useState<string | null>(null);
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
  /**
   * 지금 입력이 좌표(또는 펼칠 수 없는 단축 링크)인가 (M37).
   *
   * 순수 함수 한 번이라 타이핑마다 돌아도 공짜다. 값이 있으면 이 화면은 검색
   * 화면이 아니라 **확인 화면**이 된다: 검색 버튼은 잠기고, 지난 검색의 결과·안내는
   * 물러나고, 붙여넣은 그 자리 한 줄만 남는다.
   */
  const coord = useMemo(() => parseCoordInput(query), [query]);
  const direct = coord !== null;
  const canSearch = trimmed.length > 0 && !busy && !cooling && !direct;

  const submit = async () => {
    if (!canSearch) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setStatus('loading');
    setError(null);
    setNote(null);

    // Start the cooldown with the request, not with its answer.
    setCooling(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      if (aliveRef.current) setCooling(false);
    }, SEARCH_COOLDOWN_MS);

    try {
      const found = await searchPlacesRefined(trimmed, {
        destination,
        signal: controller.signal,
      });
      if (!aliveRef.current || controller.signal.aborted) return;
      setResults(found.results);
      setSource(found.source);
      setNote(found.note ?? null);
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

        <p data-testid="place-search-hint" className="text-micro font-normal text-ink-faint">
          {aiOn
            ? 'AI가 먼저 찾고, 못 찾으면 OpenStreetMap(Nominatim)에서 찾아요. 검색 버튼을 눌러야 요청해요.'
            : 'OpenStreetMap(Nominatim)에서 찾아요. 검색 버튼을 눌러야 요청해요.'}
        </p>
        {/* 있는 줄을 고치지 않고 한 줄을 더한다 (M37) — 이건 다른 이야기다. */}
        <p
          data-testid="place-search-paste-hint"
          className="text-micro font-normal text-ink-faint"
        >
          구글 지도의 주소나 「위도, 경도」를 붙여넣으면 그 자리를 그대로 써요.
        </p>
      </form>

      {/* 붙여넣은 좌표 한 줄 (M37). 요청은 하나도 나가지 않았다 — 이 줄의 자리는
          사용자가 가져온 것이고, 우리가 할 일은 그대로 꽂아 주는 것뿐이다. */}
      {coord?.kind === 'coords' ? (
        <button
          type="button"
          data-testid="place-search-coord"
          data-lat={coord.lat}
          data-lng={coord.lng}
          onClick={() => {
            onPick({ lat: coord.lat, lng: coord.lng, address: pinAddress(coord.lat, coord.lng) });
            onClose();
          }}
          className="mt-3 w-full rounded-md border border-line bg-surface px-3 py-3 text-left transition-colors duration-[140ms] ease-quick hover:border-line-strong hover:bg-sunken"
        >
          <span className="block text-label text-ink">좌표로 지정</span>
          <span className="mt-1 block text-micro font-normal tabular-nums text-ink-faint">
            {formatLatLng(coord.lat, coord.lng)}
          </span>
        </button>
      ) : null}

      {/* 단축 링크는 여기서 펼칠 수 없다. 조용히 못 찾는 대신 그렇게 말한다. */}
      {coord?.kind === 'short-link' ? (
        <p
          data-testid="place-search-shortlink"
          className="mt-3 rounded-md bg-sunken px-3 py-2 text-label font-normal text-ink-muted"
        >
          {SHORT_LINK_HINT}
        </p>
      ) : null}

      {/* AI 경로는 2~4초 걸린다. 버튼 하나만 바뀌면 멈춘 것처럼 보인다. */}
      {busy && !direct ? (
        <p
          data-testid="place-search-busy"
          className="mt-3 rounded-md bg-sunken px-3 py-2 text-label font-normal text-ink-muted"
        >
          {aiOn ? 'AI에게 물어보는 중이에요… 몇 초 걸려요' : '찾는 중이에요…'}
        </p>
      ) : null}

      {error && !direct ? (
        <p
          data-testid="place-search-error"
          role="alert"
          className="mt-3 rounded-md bg-danger-wash px-3 py-2 text-label font-normal text-danger"
        >
          {error}
        </p>
      ) : null}

      {note && !error && !direct ? (
        <p
          data-testid="place-search-note"
          className="mt-3 text-micro font-normal text-ink-faint"
        >
          {note}
        </p>
      ) : null}

      {status === 'done' && !error && results.length === 0 && !direct ? (
        <p
          data-testid="place-search-empty"
          className="mt-3 rounded-md bg-sunken px-3 py-2 text-label font-normal text-ink-faint"
        >
          검색 결과가 없어요. 다른 이름으로 찾아보세요.
        </p>
      ) : null}

      {results.length > 0 && !direct ? (
        <ul
          data-testid="place-search-results"
          data-source={source}
          className="mt-3 space-y-2"
        >
          {results.map((place, index) => (
            <li key={`${place.lat},${place.lng},${index}`}>
              <button
                type="button"
                data-testid="place-search-result"
                data-index={index}
                data-lat={place.lat}
                data-lng={place.lng}
                // 좌표를 OSM에 맞춰 조인 줄인지 (M35). 조이지 못한 줄은 모델의
                // 기억 그대로라 한 블록쯤 어긋나 있을 수 있다.
                data-refined={place.refined ? 'true' : 'false'}
                // 이름으로 조였는지 주소로 조였는지 (M37). 화면에는 어느 쪽도
                // 「✓ 지도 확인됨」 한 마디로만 보인다.
                data-refined-by={place.refinedBy}
                onClick={() => {
                  // 화면에만 쓰는 현지 표기·지역은 여기서 떨어져 나간다 —
                  // 워크스페이스에 들어가는 것은 언제나 {lat,lng,address}뿐.
                  onPick(toGeoPoint(place));
                  onClose();
                }}
                className="w-full rounded-md border border-line bg-surface px-3 py-3 text-left transition-colors duration-[140ms] ease-quick hover:border-line-strong hover:bg-sunken"
              >
                <span className="block text-label text-ink">{place.name}</span>
                {place.localName ? (
                  <span
                    data-testid="place-search-local"
                    className="mt-0.5 block break-words text-label font-normal text-ink-muted"
                  >
                    {place.localName}
                  </span>
                ) : null}
                <span className="mt-1 block text-micro font-normal text-ink-faint">
                  {/* 조용한 표시 하나 (M35). 자랑이 아니라 근거다 — 이 줄의
                      좌표는 모델의 기억이 아니라 지도가 아는 자리다. */}
                  {place.refined ? (
                    <span data-testid="place-search-refined">✓ 지도 확인됨 · </span>
                  ) : null}
                  {place.locality ? (
                    <span data-testid="place-search-locality">{place.locality} · </span>
                  ) : null}
                  <span className="tabular-nums">
                    {place.lat.toFixed(4)}, {place.lng.toFixed(4)}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </MapModal>
  );
}
