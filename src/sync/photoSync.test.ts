import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The bookkeeping half of 사진 자동 동기화 (M20).
 *
 * What is worth testing here is not `fetch` — that is one `await` and a status
 * check — but the two pieces of memory the uploader runs on, because both are
 * read from storage that other versions of the app also write to, and both are
 * only ever noticed when they are wrong: a corrupt uploaded-set silently
 * re-uploads every photo, a leaky miss-memo silently hammers the NAS on every
 * repaint.
 */

// Neither store can reach IndexedDB under vitest's node environment.
vi.mock('../stores/persistMiddleware', () => {
  const memory = new Map<string, string>();
  return {
    idbStorage: {
      getItem: async (key: string) => memory.get(key) ?? null,
      setItem: async (key: string, value: string) => {
        memory.set(key, value);
      },
      removeItem: async (key: string) => {
        memory.delete(key);
      },
    },
  };
});

vi.mock('../stores/photoBlobs', () => ({
  getPhotoBlob: async () => undefined,
  setRemotePhotoSource: () => {},
}));

/** A `localStorage` good enough for the module under test. */
const memory = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => {
    memory.set(key, value);
  },
  removeItem: (key: string) => {
    memory.delete(key);
  },
  clear: () => memory.clear(),
  key: () => null,
  length: 0,
} satisfies Storage);

const {
  UPLOADED_KEY,
  hasMissedPhoto,
  loadUploadedIds,
  markUploaded,
  parseUploadedMap,
  pruneUploadedIds,
  rememberPhotoMiss,
  resetPhotoMisses,
  saveUploadedIds,
} = await import('./photoSync');

const NAS = 'https://nas.example/travel/api';
const OTHER = 'https://other.example/api';

const raw = (): string | null => memory.get(UPLOADED_KEY) ?? null;

beforeEach(() => {
  memory.clear();
  resetPhotoMisses();
});

describe('parseUploadedMap', () => {
  it('keeps a well-formed map', () => {
    expect(parseUploadedMap(JSON.stringify({ [NAS]: ['a', 'b'] }))).toEqual({ [NAS]: ['a', 'b'] });
  });

  it('treats missing, empty and unparseable values as "nothing uploaded"', () => {
    expect(parseUploadedMap(null)).toEqual({});
    expect(parseUploadedMap('')).toEqual({});
    expect(parseUploadedMap('{ not json')).toEqual({});
  });

  it('rejects shapes that are not an object of arrays', () => {
    expect(parseUploadedMap('[]')).toEqual({});
    expect(parseUploadedMap('"a string"')).toEqual({});
    expect(parseUploadedMap('null')).toEqual({});
    expect(parseUploadedMap(JSON.stringify({ [NAS]: 'a,b' }))).toEqual({});
  });

  it('drops non-string and empty entries rather than the whole server', () => {
    expect(parseUploadedMap(JSON.stringify({ [NAS]: ['a', 3, null, '', 'b'] }))).toEqual({
      [NAS]: ['a', 'b'],
    });
  });

  it('deduplicates', () => {
    expect(parseUploadedMap(JSON.stringify({ [NAS]: ['a', 'a', 'b'] }))).toEqual({
      [NAS]: ['a', 'b'],
    });
  });

  it('omits a server whose list survives empty', () => {
    expect(parseUploadedMap(JSON.stringify({ [NAS]: [], [OTHER]: ['x'] }))).toEqual({
      [OTHER]: ['x'],
    });
  });
});

describe('the uploaded-set', () => {
  it('starts empty and round-trips', () => {
    expect(loadUploadedIds(NAS).size).toBe(0);
    saveUploadedIds(NAS, ['p1', 'p2']);
    expect([...loadUploadedIds(NAS)].sort()).toEqual(['p1', 'p2']);
  });

  it('is keyed per server — an address change re-uploads everything', () => {
    saveUploadedIds(NAS, ['p1', 'p2']);
    expect(loadUploadedIds(OTHER).size).toBe(0);

    markUploaded(OTHER, 'p1');
    expect([...loadUploadedIds(NAS)].sort()).toEqual(['p1', 'p2']);
    expect([...loadUploadedIds(OTHER)]).toEqual(['p1']);
  });

  it('ignores a trailing slash, which is the same server typed twice', () => {
    markUploaded(`${NAS}/`, 'p1');
    expect([...loadUploadedIds(NAS)]).toEqual(['p1']);
  });

  it('never records an id twice', () => {
    markUploaded(NAS, 'p1');
    markUploaded(NAS, 'p1');
    expect([...loadUploadedIds(NAS)]).toEqual(['p1']);
  });

  it('prunes only what it was asked to, and only for that server', () => {
    saveUploadedIds(NAS, ['p1', 'p2', 'p3']);
    saveUploadedIds(OTHER, ['p1']);

    pruneUploadedIds(NAS, ['p2', 'unknown']);
    expect([...loadUploadedIds(NAS)].sort()).toEqual(['p1', 'p3']);
    expect([...loadUploadedIds(OTHER)]).toEqual(['p1']);
  });

  it('drops a server entirely once its last id is pruned', () => {
    saveUploadedIds(NAS, ['p1']);
    pruneUploadedIds(NAS, ['p1']);
    expect(loadUploadedIds(NAS).size).toBe(0);
    expect(raw()).toBe('{}');
  });

  it('pruning an unknown server or an empty list writes nothing', () => {
    saveUploadedIds(NAS, ['p1']);
    const before = raw();
    pruneUploadedIds(OTHER, ['p1']);
    pruneUploadedIds(NAS, []);
    expect(raw()).toBe(before);
  });

  it('recovers from a corrupt value instead of throwing on the sync path', () => {
    memory.set(UPLOADED_KEY, '{{{');
    expect(loadUploadedIds(NAS).size).toBe(0);
    markUploaded(NAS, 'p1');
    expect([...loadUploadedIds(NAS)]).toEqual(['p1']);
  });
});

describe('the miss memo', () => {
  it('remembers a 404 so a thumbnail asks once, not once per repaint', () => {
    expect(hasMissedPhoto('gone')).toBe(false);
    rememberPhotoMiss('gone');
    expect(hasMissedPhoto('gone')).toBe(true);
    expect(hasMissedPhoto('other')).toBe(false);
  });

  it('is cleared wholesale — a reload is when we try again', () => {
    rememberPhotoMiss('gone');
    resetPhotoMisses();
    expect(hasMissedPhoto('gone')).toBe(false);
  });
});
