/**
 * 큐레이션 한 집당 구글에 **딱 한 번** 묻기 위한 기기 캐시 (M43).
 *
 * `data/gourmet.ts`는 좌표를 들고 있지 않다. 그래서 레이어를 처음 켜는 순간
 * 목록의 집마다 Places Text Search를 한 번씩 부르는데 — 그 값이 이 기기에
 * 남지 않으면 사용자가 버튼을 누를 때마다 마흔 번씩 다시 나간다. 그건 요금
 * 이전에 성의의 문제다.
 *
 * 그래서 답을 `localStorage`에 적는다. 크기는 한 집당 200바이트가 채 안 되고
 * (좌표·주소·평점 몇 개), 오십 집이라도 10KB다 — idb를 꺼낼 크기가 아니다.
 *
 * ## 키에 판 번호가 들어간다
 *
 * 키는 `<판>:<엔트리 id>`다. 캐시가 담는 모양이 바뀌면 {@link GOURMET_CACHE_VERSION}
 * 을 올리고, 그 순간 옛 판의 줄들은 **읽히지 않는다**(그리고 다음 저장에서
 * 치워진다). 마이그레이션 코드를 쓰지 않는 이유는 이 값이 캐시이기 때문이다 —
 * 잃어도 다시 물으면 그만이다.
 *
 * ## 방어적으로 읽는다
 *
 * 사람이 손으로 고쳤든, 옛 판이 남았든, JSON이 깨졌든 답은 하나다: 그 줄은
 * 없는 것으로 친다. 캐시 한 줄 때문에 지도가 서지 못하는 일은 없어야 한다.
 */

/** `localStorage`의 자리. */
export const GOURMET_CACHE_KEY = 'trip-board/gourmet-cache';

/**
 * 담는 모양의 판 번호. 아래 {@link GourmetResolved}의 필드가 바뀌면 올린다.
 *
 * 1 — lat·lng·address·googleRating·googleRatingCount·reservable·placeId·cachedAt
 */
export const GOURMET_CACHE_VERSION = 1;

/** 한 집을 구글에 물어 얻은 답. */
export interface GourmetResolved {
  lat: number;
  lng: number;
  address?: string;
  /** 조회 시점의 구글 평점 — 4.3 문턱을 판정하는 값. */
  googleRating?: number;
  googleRatingCount?: number;
  /** 구글이 아는 예약 가능 여부. 대개 모른다. */
  reservable?: boolean;
  /** 「구글 지도에서 보기」가 그 가게 페이지를 바로 여는 열쇠. */
  placeId?: string;
  /** 언제 물었나 — `Date.toISOString()`. */
  cachedAt: string;
}

/** `<판>:<엔트리 id>`. */
export const cacheKeyFor = (entryId: string): string => `${GOURMET_CACHE_VERSION}:${entryId}`;

/** 지금 판의 줄인가. */
const currentVersionKey = (key: string): boolean => key.startsWith(`${GOURMET_CACHE_VERSION}:`);

/** `localStorage`, 없거나 막혀 있으면 `null`. */
function storage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

/** 유한한 숫자만. 아니면 `undefined`. */
const finite = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/** 무엇이 들어와도 한 줄이 되거나 `null`이 된다. */
export function normalizeResolved(value: unknown): GourmetResolved | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;

  const lat = finite(raw.lat);
  const lng = finite(raw.lng);
  // 좌표가 없는 줄은 캐시로서 아무 쓸모가 없다 — 이 캐시가 있는 이유가 좌표다.
  if (lat === undefined || lng === undefined) return null;

  const address =
    typeof raw.address === 'string' && raw.address.trim().length > 0
      ? raw.address.trim()
      : undefined;
  const placeId =
    typeof raw.placeId === 'string' && raw.placeId.trim().length > 0
      ? raw.placeId.trim()
      : undefined;
  const cachedAt = typeof raw.cachedAt === 'string' && raw.cachedAt ? raw.cachedAt : '';
  const reservable = typeof raw.reservable === 'boolean' ? raw.reservable : undefined;

  return {
    lat,
    lng,
    ...(address ? { address } : {}),
    ...(finite(raw.googleRating) !== undefined ? { googleRating: finite(raw.googleRating)! } : {}),
    ...(finite(raw.googleRatingCount) !== undefined
      ? { googleRatingCount: finite(raw.googleRatingCount)! }
      : {}),
    ...(reservable !== undefined ? { reservable } : {}),
    ...(placeId ? { placeId } : {}),
    cachedAt,
  };
}

/** 지금 판의 줄 전부 — 엔트리 id → 답. 읽을 수 없으면 빈 객체. */
export function loadGourmetCache(): Record<string, GourmetResolved> {
  const store = storage();
  if (!store) return {};
  try {
    const raw = store.getItem(GOURMET_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

    const out: Record<string, GourmetResolved> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!currentVersionKey(key)) continue;
      const entry = normalizeResolved(value);
      if (entry) out[key.slice(`${GOURMET_CACHE_VERSION}:`.length)] = entry;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * 한 집의 답을 적는다. 옛 판의 줄들은 이때 함께 치운다.
 *
 * 못 써도 치명적이지 않다 — 그 기기는 켤 때마다 다시 물을 뿐이다.
 */
export function saveGourmetResolved(entryId: string, resolved: GourmetResolved): void {
  const store = storage();
  if (!store) return;
  try {
    const raw = store.getItem(GOURMET_CACHE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : {};
    const base =
      parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};

    const next: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(base)) {
      if (currentVersionKey(key)) next[key] = value;
    }
    next[cacheKeyFor(entryId)] = resolved;
    store.setItem(GOURMET_CACHE_KEY, JSON.stringify(next));
  } catch {
    /* quota / private mode */
  }
}

/** 캐시를 통째로 버린다 — 테스트와 「다시 조사」용. */
export function clearGourmetCache(): void {
  try {
    storage()?.removeItem(GOURMET_CACHE_KEY);
  } catch {
    /* private mode */
  }
}
