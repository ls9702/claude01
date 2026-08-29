import { describe, expect, it, vi } from 'vitest';
import { AiError } from '../ai/aiClient';
import type { PlaceCandidate } from '../ai/aiPlaces';
import type { GeoPoint } from '../types/models';
import { SEARCH_ERROR_MESSAGE } from '../utils/geo';
import {
  FALLBACK_NOTES,
  GOOGLE_FALLBACK_NOTES,
  fallbackReasonFor,
  osmCandidate,
  searchPlacesRefined,
  searchPlacesSmart,
  type SmartSearchDeps,
} from './placeSearch';

const AI_HIT: PlaceCandidate = {
  name: '통천각',
  localName: '通天閣',
  locality: '오사카',
  lat: 34.6525,
  lng: 135.5063,
};

const OSM_HIT: GeoPoint = { lat: 35.6595, lng: 139.7005, address: '시부야 스크램블 교차로, 도쿄' };

/** 구글이 답하는 줄 하나 (M44) — 좌표가 원본이라 `refined`를 달고 온다. */
const GOOGLE_HIT: PlaceCandidate = {
  name: '마루하치 슈퍼 난바점',
  lat: 34.6641,
  lng: 135.5017,
  address: '일본 오사카부 오사카시 나니와구',
  locality: '일본 오사카부 오사카시 나니와구',
  refined: true,
  refinedBy: 'google',
};

/**
 * Deps with AI on and both halves answering, unless a test says otherwise.
 *
 * M44 — 구글은 **꺼진 채로** 시작한다. 이 파일의 시험 대부분은 M28~M37의 두
 * 계단에 대한 것이고, 키가 없는 기기(Pages·부트스트랩 없는 배포)가 여전히 그
 * 두 계단만 쓴다는 사실이 곧 이 기본값이다.
 */
function deps(overrides: Partial<SmartSearchDeps> = {}): Partial<SmartSearchDeps> {
  return {
    hasGoogle: () => false,
    googleSearch: vi.fn(async () => [GOOGLE_HIT]),
    isAiEnabled: () => true,
    aiSearch: vi.fn(async () => [AI_HIT]),
    osmSearch: vi.fn(async () => [OSM_HIT]),
    // 주소 되묻기(M37)의 기본값은 「모르겠다」다 — 이 파일의 관심사는 경로 선택이고,
    // 그 계단 자체는 `refine.test.ts`가 시험한다.
    aiAddress: vi.fn(async () => null),
    ...overrides,
  };
}

describe('searchPlacesSmart — 구글 우선 (M44)', () => {
  it('키가 있으면 구글에게 먼저 묻고, 답이 오면 AI도 OSM도 부르지 않는다', async () => {
    const googleSearch = vi.fn(async () => [GOOGLE_HIT]);
    const aiSearch = vi.fn(async () => [AI_HIT]);
    const osmSearch = vi.fn(async () => [OSM_HIT]);

    const result = await searchPlacesSmart('마루하치 슈퍼 난바점', {
      deps: deps({ hasGoogle: () => true, googleSearch, aiSearch, osmSearch }),
    });

    expect(result.source).toBe('google');
    expect(result.results).toEqual([GOOGLE_HIT]);
    expect(result.note).toBeUndefined();
    expect(aiSearch).not.toHaveBeenCalled();
    expect(osmSearch).not.toHaveBeenCalled();
  });

  it('여행 목적지 좌표를 구글에게 기울임으로 넘긴다', async () => {
    const googleSearch = vi.fn(async () => [GOOGLE_HIT]);
    const bias: GeoPoint = { lat: 34.6937, lng: 135.5023 };
    await searchPlacesSmart('난바', {
      bias,
      deps: deps({ hasGoogle: () => true, googleSearch }),
    });
    expect(googleSearch).toHaveBeenCalledWith('난바', bias);
  });

  it('키가 없으면 구글을 부르지도 않고 M28의 길을 그대로 간다', async () => {
    const googleSearch = vi.fn(async () => [GOOGLE_HIT]);
    const result = await searchPlacesSmart('츠텐카쿠', { deps: deps({ googleSearch }) });

    expect(googleSearch).not.toHaveBeenCalled();
    expect(result.source).toBe('ai');
    expect(result.googleReason).toBe('google-off');
    // 평소 상태를 매번 사과하지 않는다.
    expect(result.note).toBeUndefined();
  });

  it('구글이 못 찾으면 AI로 내려가고, 그 사실을 한 줄로 말한다', async () => {
    const aiSearch = vi.fn(async () => [AI_HIT]);
    const result = await searchPlacesSmart('없는 가게', {
      deps: deps({ hasGoogle: () => true, googleSearch: async () => [], aiSearch }),
    });

    expect(aiSearch).toHaveBeenCalled();
    expect(result.source).toBe('ai');
    expect(result.googleReason).toBe('google-empty');
    expect(result.note).toBe(GOOGLE_FALLBACK_NOTES['google-empty']);
  });

  it('구글을 못 부르면(키 오류·차단·오프라인) 조용히 다음 계단으로 간다', async () => {
    const result = await searchPlacesSmart('츠텐카쿠', {
      deps: deps({
        hasGoogle: () => true,
        googleSearch: async () => {
          throw new Error('script blocked');
        },
      }),
    });

    expect(result.source).toBe('ai');
    expect(result.googleReason).toBe('google-error');
    expect(result.note).toBe(GOOGLE_FALLBACK_NOTES['google-error']);
  });

  it('구글도 AI도 답하지 못하면 OSM까지 내려가고, 그 줄의 안내는 AI 쪽 이유다', async () => {
    const result = await searchPlacesSmart('없는 가게', {
      deps: deps({
        hasGoogle: () => true,
        googleSearch: async () => [],
        aiSearch: async () => [],
      }),
    });

    expect(result.source).toBe('osm');
    expect(result.googleReason).toBe('google-empty');
    // 한 줄에 두 개의 사과를 담지 않는다 — 지금 보고 있는 것이 어디 결과인지가 먼저다.
    expect(result.note).toBe(FALLBACK_NOTES['ai-empty']);
  });

  it('취소는 구글 계단에서도 그대로 밖으로 나간다', async () => {
    const aiSearch = vi.fn(async () => [AI_HIT]);
    await expect(
      searchPlacesSmart('츠텐카쿠', {
        deps: deps({
          hasGoogle: () => true,
          googleSearch: async () => {
            throw new DOMException('aborted', 'AbortError');
          },
          aiSearch,
        }),
      }),
    ).rejects.toThrow(DOMException);
    expect(aiSearch).not.toHaveBeenCalled();
  });

  it('구글 결과는 좌표를 다시 조이지 않는다 — 원본을 사본으로 바꾸지 않는다', async () => {
    const osmSearch = vi.fn(async () => [OSM_HIT]);
    const aiAddress = vi.fn(async () => '大阪市浪速区');
    const result = await searchPlacesRefined('마루하치 슈퍼 난바점', {
      deps: deps({ hasGoogle: () => true, osmSearch, aiAddress }),
    });

    expect(result.source).toBe('google');
    expect(result.results).toEqual([GOOGLE_HIT]);
    expect(osmSearch).not.toHaveBeenCalled();
    expect(aiAddress).not.toHaveBeenCalled();
  });
});

describe('searchPlacesSmart — AI 우선', () => {
  it('returns the AI candidates and never touches Nominatim', async () => {
    const osmSearch = vi.fn(async () => [OSM_HIT]);
    const result = await searchPlacesSmart('츠텐카쿠', { deps: deps({ osmSearch }) });

    expect(result.source).toBe('ai');
    expect(result.results).toEqual([AI_HIT]);
    expect(result.note).toBeUndefined();
    expect(osmSearch).not.toHaveBeenCalled();
  });

  it('hands the trip destination to the AI half', async () => {
    const aiSearch = vi.fn(async () => [AI_HIT]);
    await searchPlacesSmart('글리코상', {
      destination: '오사카시, 오사카부, 일본',
      deps: deps({ aiSearch }),
    });
    expect(aiSearch).toHaveBeenCalledWith('글리코상', '오사카시, 오사카부, 일본');
  });

  it('trims the query before either half sees it', async () => {
    const aiSearch = vi.fn(async () => [AI_HIT]);
    await searchPlacesSmart('  츠텐카쿠  ', { deps: deps({ aiSearch }) });
    expect(aiSearch).toHaveBeenCalledWith('츠텐카쿠', undefined);
  });

  it('does nothing at all for an empty query', async () => {
    const aiSearch = vi.fn(async () => [AI_HIT]);
    const osmSearch = vi.fn(async () => [OSM_HIT]);
    const result = await searchPlacesSmart('   ', { deps: deps({ aiSearch, osmSearch }) });

    expect(result).toEqual({ results: [], source: 'osm' });
    expect(aiSearch).not.toHaveBeenCalled();
    expect(osmSearch).not.toHaveBeenCalled();
  });
});

describe('searchPlacesSmart — 대체 규칙', () => {
  it('goes straight to OSM, silently, when AI is off', async () => {
    const aiSearch = vi.fn(async () => [AI_HIT]);
    const result = await searchPlacesSmart('시부야', {
      deps: deps({ isAiEnabled: () => false, aiSearch }),
    });

    expect(aiSearch).not.toHaveBeenCalled();
    expect(result.source).toBe('osm');
    expect(result.reason).toBe('ai-off');
    // 평소 상태를 매번 사과하지 않는다.
    expect(result.note).toBeUndefined();
    expect(result.results).toEqual([osmCandidate(OSM_HIT)]);
  });

  it('falls back with a note when the AI call errors', async () => {
    const result = await searchPlacesSmart('츠텐카쿠', {
      deps: deps({
        aiSearch: async () => {
          throw new AiError('server');
        },
      }),
    });

    expect(result.source).toBe('osm');
    expect(result.reason).toBe('ai-error');
    expect(result.note).toBe(FALLBACK_NOTES['ai-error']);
    expect(result.results).toEqual([osmCandidate(OSM_HIT)]);
  });

  it('names the 429 fuse as its own reason', async () => {
    const result = await searchPlacesSmart('츠텐카쿠', {
      deps: deps({
        aiSearch: async () => {
          throw new AiError('rate', undefined, 429);
        },
      }),
    });

    expect(result.reason).toBe('ai-rate');
    expect(result.note).toBe('AI 요청이 많아서 OpenStreetMap 결과예요');
  });

  it('treats a non-AiError throw as an ordinary AI failure', async () => {
    const result = await searchPlacesSmart('츠텐카쿠', {
      deps: deps({
        aiSearch: async () => {
          throw new TypeError('boom');
        },
      }),
    });
    expect(result.reason).toBe('ai-error');
  });

  it('falls back when the AI answers with no usable candidate', async () => {
    const osmSearch = vi.fn(async () => [OSM_HIT]);
    const result = await searchPlacesSmart('없는 가게', {
      deps: deps({ aiSearch: async () => [], osmSearch }),
    });

    expect(osmSearch).toHaveBeenCalledWith('없는 가게', undefined);
    expect(result.source).toBe('osm');
    expect(result.reason).toBe('ai-empty');
    expect(result.note).toBe('AI가 찾지 못해서 OpenStreetMap 결과예요');
  });

  it('still reports an empty OSM answer as empty, note and all', async () => {
    const result = await searchPlacesSmart('없는 가게', {
      deps: deps({ aiSearch: async () => [], osmSearch: async () => [] }),
    });

    expect(result.results).toEqual([]);
    expect(result.source).toBe('osm');
    expect(result.note).toBe(FALLBACK_NOTES['ai-empty']);
  });

  it('lets an OSM failure through — that one is a real error', async () => {
    await expect(
      searchPlacesSmart('시부야', {
        deps: deps({
          isAiEnabled: () => false,
          osmSearch: async () => {
            throw new Error(SEARCH_ERROR_MESSAGE);
          },
        }),
      }),
    ).rejects.toThrow(SEARCH_ERROR_MESSAGE);
  });

  it('does not send a fallback request after the user aborted', async () => {
    const osmSearch = vi.fn(async () => [OSM_HIT]);
    await expect(
      searchPlacesSmart('츠텐카쿠', {
        deps: deps({
          aiSearch: async () => {
            throw new DOMException('aborted', 'AbortError');
          },
          osmSearch,
        }),
      }),
    ).rejects.toThrow(DOMException);
    expect(osmSearch).not.toHaveBeenCalled();
  });

  it('passes the abort signal through to the OSM half', async () => {
    const osmSearch = vi.fn(async () => [OSM_HIT]);
    const signal = new AbortController().signal;
    await searchPlacesSmart('시부야', {
      signal,
      deps: deps({ isAiEnabled: () => false, osmSearch }),
    });
    expect(osmSearch).toHaveBeenCalledWith('시부야', signal);
  });
});

describe('fallbackReasonFor', () => {
  it('separates the fuse from everything else', () => {
    expect(fallbackReasonFor(new AiError('rate', undefined, 429))).toBe('ai-rate');
    expect(fallbackReasonFor(new AiError('network'))).toBe('ai-error');
    expect(fallbackReasonFor(new AiError('parse'))).toBe('ai-error');
    expect(fallbackReasonFor(new Error('nope'))).toBe('ai-error');
    expect(fallbackReasonFor(undefined)).toBe('ai-error');
  });
});

describe('searchPlacesRefined — AI 좌표 조이기 (M35)', () => {
  /** 통천각에서 30m — 반경 안. */
  const NEAR: GeoPoint = { lat: 34.6527, lng: 135.5064, address: '通天閣, 오사카' };

  it('snaps AI coordinates onto the nearby OSM hit', async () => {
    const result = await searchPlacesRefined('츠텐카쿠', {
      deps: deps({ osmSearch: vi.fn(async () => [NEAR]) }),
    });

    expect(result.source).toBe('ai');
    expect(result.results[0].lat).toBe(NEAR.lat);
    expect(result.results[0].refined).toBe(true);
    // 줄에 보이는 이름은 사용자가 찾은 그 이름 그대로다.
    expect(result.results[0].name).toBe('통천각');
  });

  it('keeps the AI coordinates when the OSM hit is a city away', async () => {
    const result = await searchPlacesRefined('츠텐카쿠', { deps: deps() });

    expect(result.results).toEqual([AI_HIT]);
    expect(result.results[0].refined).toBeUndefined();
  });

  it('keeps the AI coordinates, and the results, when the refine call fails', async () => {
    const result = await searchPlacesRefined('츠텐카쿠', {
      deps: deps({
        osmSearch: async () => {
          throw new Error(SEARCH_ERROR_MESSAGE);
        },
      }),
    });

    expect(result.source).toBe('ai');
    expect(result.results).toEqual([AI_HIT]);
  });

  it('leaves the OSM path alone — those coordinates are already OSM', async () => {
    const osmSearch = vi.fn(async () => [OSM_HIT]);
    const result = await searchPlacesRefined('시부야', {
      deps: deps({ isAiEnabled: () => false, osmSearch }),
    });

    expect(result.source).toBe('osm');
    expect(osmSearch).toHaveBeenCalledTimes(1);
    expect(result.results).toEqual([osmCandidate(OSM_HIT)]);
  });

  it('hands the abort signal to the refine requests too', async () => {
    const osmSearch = vi.fn(async () => [NEAR]);
    const signal = new AbortController().signal;
    await searchPlacesRefined('츠텐카쿠', { signal, deps: deps({ osmSearch }) });
    expect(osmSearch).toHaveBeenCalledWith('通天閣', signal);
  });

  /* 주소 경유 계단이 이 화면까지 이어져 있는가 (M37). */

  it('falls through to the address ask when the name finds nothing', async () => {
    const address = '大阪府大阪市中央区難波1-4-16';
    const aiAddress = vi.fn(async () => address);
    const osmSearch = vi.fn(async (query: string) =>
      query === address ? [{ lat: 34.6527, lng: 135.5064, address }] : [],
    );

    const result = await searchPlacesRefined('잇푸도 난바점', {
      deps: deps({ osmSearch, aiAddress }),
    });

    expect(aiAddress).toHaveBeenCalledWith(AI_HIT);
    expect(result.source).toBe('ai');
    expect(result.results[0].lat).toBe(34.6527);
    expect(result.results[0].refined).toBe(true);
    expect(result.results[0].refinedBy).toBe('address');
  });

  it('never asks for an address on the OSM path — those coordinates are already OSM', async () => {
    const aiAddress = vi.fn(async () => '大阪市中央区難波1-4-16');
    await searchPlacesRefined('시부야', {
      deps: deps({ isAiEnabled: () => false, aiAddress }),
    });
    expect(aiAddress).not.toHaveBeenCalled();
  });
});

describe('osmCandidate', () => {
  it('shows the Nominatim address as the row title, with no local name', () => {
    expect(osmCandidate(OSM_HIT)).toEqual({
      lat: 35.6595,
      lng: 139.7005,
      address: '시부야 스크램블 교차로, 도쿄',
      name: '시부야 스크램블 교차로, 도쿄',
    });
  });

  it('falls back to the raw coordinates when a row has no address', () => {
    expect(osmCandidate({ lat: 1, lng: 2 }).name).toBe('1, 2');
  });
});
