import { beforeEach, describe, expect, it, vi } from 'vitest';

// vitest runs under `node`, where `localStorage` does not exist — and this
// module reads one at *import* time to seed the store. `vi.hoisted` runs before
// the import graph is evaluated, so the stand-in is already in place by then.
vi.hoisted(() => {
  const memory = new Map<string, string>();
  const stub: Storage = {
    get length() {
      return memory.size;
    },
    clear: () => memory.clear(),
    getItem: (key: string) => memory.get(key) ?? null,
    key: (index: number) => [...memory.keys()][index] ?? null,
    removeItem: (key: string) => {
      memory.delete(key);
    },
    setItem: (key: string, value: string) => {
      memory.set(key, String(value));
    },
  };
  (globalThis as { localStorage?: Storage }).localStorage = stub;
});

import {
  PROFILES,
  PROFILE_IDS,
  getActiveProfileId,
  isProfileId,
  loadProfile,
  otherProfile,
  saveProfile,
  useProfileStore,
} from './profile';

const KEY = 'trip-board/profile';

beforeEach(() => {
  localStorage.clear();
  useProfileStore.setState({ profileId: null });
});

describe('PROFILES', () => {
  it('describes exactly the two people this app is for', () => {
    expect(PROFILE_IDS).toEqual(['song', 'hoyabom']);
    expect(PROFILES.song).toEqual({
      id: 'song',
      label: 'songlee',
      initials: 'S',
      colorToken: 'sky',
    });
    expect(PROFILES.hoyabom).toEqual({
      id: 'hoyabom',
      label: 'hoyabom',
      initials: 'HB',
      colorToken: 'rose',
    });
  });

  it('pairs each profile with the other one', () => {
    expect(otherProfile('song').id).toBe('hoyabom');
    expect(otherProfile('hoyabom').id).toBe('song');
  });
});

describe('isProfileId', () => {
  it('accepts the two known ids', () => {
    expect(isProfileId('song')).toBe(true);
    expect(isProfileId('hoyabom')).toBe(true);
  });

  it('rejects everything else', () => {
    for (const value of ['', 'SONG', 'songlee', 'hoya', null, undefined, 3, {}, ['song']]) {
      expect(isProfileId(value)).toBe(false);
    }
  });
});

describe('loadProfile', () => {
  it('returns null when nothing was ever chosen', () => {
    expect(loadProfile()).toBeNull();
  });

  it('reads back what saveProfile wrote', () => {
    saveProfile('hoyabom');
    expect(localStorage.getItem(KEY)).toBe('"hoyabom"');
    expect(loadProfile()).toBe('hoyabom');
  });

  it('also reads a bare (non-JSON) id — a hand-seeded devtools/e2e entry', () => {
    localStorage.setItem(KEY, 'song');
    expect(loadProfile()).toBe('song');
  });

  it('reads an unknown value as "not chosen yet"', () => {
    for (const raw of ['"nobody"', 'nobody', '42', '{"id":"song"}', '{oops', '']) {
      localStorage.setItem(KEY, raw);
      expect(loadProfile()).toBeNull();
    }
  });
});

describe('useProfileStore', () => {
  it('setProfile persists the choice and exposes it to the store getter', () => {
    useProfileStore.getState().setProfile('song');

    expect(useProfileStore.getState().profileId).toBe('song');
    expect(getActiveProfileId()).toBe('song');
    expect(loadProfile()).toBe('song');
  });

  it('switching replaces the stored choice', () => {
    useProfileStore.getState().setProfile('song');
    useProfileStore.getState().setProfile('hoyabom');

    expect(getActiveProfileId()).toBe('hoyabom');
    expect(loadProfile()).toBe('hoyabom');
  });

  it('reads null while no one has picked', () => {
    expect(getActiveProfileId()).toBeNull();
  });
});
