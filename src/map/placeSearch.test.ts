import { describe, expect, it, vi } from 'vitest';
import { AiError } from '../ai/aiClient';
import type { PlaceCandidate } from '../ai/aiPlaces';
import type { GeoPoint } from '../types/models';
import { SEARCH_ERROR_MESSAGE } from '../utils/geo';
import {
  FALLBACK_NOTES,
  fallbackReasonFor,
  osmCandidate,
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

/** Deps with AI on and both halves answering, unless a test says otherwise. */
function deps(overrides: Partial<SmartSearchDeps> = {}): Partial<SmartSearchDeps> {
  return {
    isAiEnabled: () => true,
    aiSearch: vi.fn(async () => [AI_HIT]),
    osmSearch: vi.fn(async () => [OSM_HIT]),
    ...overrides,
  };
}

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
