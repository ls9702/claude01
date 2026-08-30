/**
 * Who is holding the phone (M13).
 *
 * This app has exactly **two** users and no accounts: no password, no token,
 * no server-side identity. The device simply remembers which of the two people
 * picked it on first open, and every card, comment and receipt written from
 * here is stamped with that choice.
 *
 * The choice lives in `localStorage` for the same reasons the sync settings and
 * the AI toggle do: it is **per-device**, it must never travel to the server
 * inside the workspace blob, and the app has to keep working where
 * `localStorage` does not exist at all (Node/vitest) or is blocked (private
 * mode). A device that cannot remember simply asks again next time — the app
 * still works, the stamps are just missing.
 *
 * Nothing here is a security boundary. Either person can switch to the other in
 * 설정; the profile answers "누가 썼지?", not "may you?".
 *
 * ## 세션마다 다른 두 사람 (M47)
 *
 * One address now serves several groups (M46), and the second group is not
 * songlee and hoyabom. So the administrator may override how each of the two is
 * **drawn** — a display name and an emoji avatar, per session, delivered on the
 * `?meta=1` probe like everything else about the server.
 *
 * What is deliberately *not* overridable is the pair of **ids**. `song` and
 * `hoyabom` are written into every card, comment, receipt and read-marker ever
 * created; renaming them would rewrite history and break `seenBy`'s namespaced
 * keys. A different group is two people wearing different names, not two
 * different records. And with no overrides at all — every existing install —
 * {@link resolveProfile} returns {@link PROFILES} unchanged, byte for byte.
 */

import { create } from 'zustand';
import { useServerStateStore } from '../stores/serverState';
import type { ProfileOverrides } from '../sync/api';

/** The two — and only two — people this app is for. */
export type ProfileId = 'song' | 'hoyabom';

/** Everything the UI needs to draw one person. */
export interface ProfileDef {
  id: ProfileId;
  /** Display name, shown in the picker and in 설정. */
  label: string;
  /** What goes inside the avatar circle. One or two letters, never more. */
  initials: string;
  /** A token from `utils/colors` — the avatar's fill. */
  colorToken: string;
  /**
   * An emoji the administrator chose, drawn instead of {@link initials} (M47).
   *
   * Absent by default, which is what keeps every existing screen identical:
   * the avatar falls back to the initials it has always shown.
   */
  avatar?: string;
}

export const PROFILES: Record<ProfileId, ProfileDef> = {
  song: { id: 'song', label: 'songlee', initials: 'S', colorToken: 'sky' },
  hoyabom: { id: 'hoyabom', label: 'hoyabom', initials: 'HB', colorToken: 'rose' },
};

/** Both ids in picker order. */
export const PROFILE_IDS = ['song', 'hoyabom'] as const;

/** Where the device's choice is kept. */
const PROFILE_KEY = 'trip-board/profile';

/**
 * How long a 마지막 접속 stamp is considered fresh (M13).
 *
 * `markSeen` writes into the workspace, which means it makes the store dirty
 * and rides the next sync. Stamping on every tab focus would turn "누가 봤는지"
 * into a background traffic generator, so callers only re-stamp once the last
 * record is older than this.
 */
export const SEEN_THROTTLE_MS = 10 * 60 * 1000;

/** Narrows anything at all to one of the two ids. */
export function isProfileId(value: unknown): value is ProfileId {
  return value === 'song' || value === 'hoyabom';
}

/** `localStorage`, or `null` where it is missing or blocked. */
function storage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

/**
 * The remembered profile, or `null` when there is none to be had.
 *
 * Deliberately reads **both** shapes: the JSON string {@link saveProfile}
 * writes (`"song"`) and a bare `song` someone (a test harness, a hand-edited
 * devtools entry) may have put there. Anything else — an old id, a number, a
 * truncated write — reads as "not chosen yet", which lands on the picker rather
 * than on a stamp nobody recognises.
 */
export function loadProfile(): ProfileId | null {
  const store = storage();
  if (!store) return null;
  let raw: string | null;
  try {
    raw = store.getItem(PROFILE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (isProfileId(parsed)) return parsed;
  } catch {
    /* not JSON — fall through to the bare-string reading */
  }
  return isProfileId(raw) ? raw : null;
}

/** Remembers the choice. Failing to write is never fatal. */
export function saveProfile(id: ProfileId): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(PROFILE_KEY, JSON.stringify(id));
  } catch {
    /* quota / private mode — the picker just asks again next time */
  }
}

export interface ProfileState {
  /** `null` until someone has picked — that is what raises the picker. */
  profileId: ProfileId | null;
  /** Picks (or switches to) a profile and remembers it on this device. */
  setProfile: (id: ProfileId) => void;
}

export const useProfileStore = create<ProfileState>()((set) => ({
  profileId: loadProfile(),
  setProfile: (id) => {
    saveProfile(id);
    set({ profileId: id });
  },
}));

/**
 * The active profile as a store read, for modules that must not subscribe.
 *
 * `stores/workspaceStore` stamps every new card/comment/expense with this. It
 * is a plain getter rather than a hook precisely so the store stays a store:
 * mutations read the id at the moment they run and never re-render on it.
 */
export const getActiveProfileId = (): ProfileId | null => useProfileStore.getState().profileId;

/** The active profile's definition, or `null` before anyone has picked. */
export function useCurrentProfile(): ProfileDef | null {
  const id = useProfileStore((s) => s.profileId);
  const overrides = useServerStateStore((s) => s.profiles);
  return id ? resolveProfile(id, overrides) : null;
}

/** The one this device is *not*. Used by 설정 to show "누가 봤는지". */
export const otherProfile = (id: ProfileId): ProfileDef =>
  PROFILES[id === 'song' ? 'hoyabom' : 'song'];

/** The id this device is *not*. */
export const otherProfileId = (id: ProfileId): ProfileId => (id === 'song' ? 'hoyabom' : 'song');

/* ------------------------------------------------------------------ *
 * 세션별 표시 (M47)
 * ------------------------------------------------------------------ */

/**
 * The definition to draw, with the session's overrides folded in.
 *
 * Pure, and pure on purpose: this is the one rule the whole feature rests on —
 * *no overrides means the built-in definition, unchanged* — and it should be
 * provable without mounting anything. A blank label or a blank emoji is not an
 * override; it is a field somebody cleared, and the default is what belongs
 * there.
 */
export function resolveProfile(id: ProfileId, overrides?: ProfileOverrides | null): ProfileDef {
  const base = PROFILES[id];
  const patch = overrides?.[id];
  if (!patch) return base;

  const label = typeof patch.label === 'string' ? patch.label.trim() : '';
  const avatar = typeof patch.avatar === 'string' ? patch.avatar.trim() : '';
  if (label === '' && avatar === '') return base;

  return {
    ...base,
    ...(label ? { label } : {}),
    ...(avatar ? { avatar } : {}),
  };
}

/** {@link resolveProfile} against whatever the server last said (M47). */
export function useProfileDef(id: ProfileId): ProfileDef {
  const overrides = useServerStateStore((s) => s.profiles);
  return resolveProfile(id, overrides);
}

/** Every profile in picker order, as this session draws them. */
export function useProfileDefs(): ProfileDef[] {
  const overrides = useServerStateStore((s) => s.profiles);
  return PROFILE_IDS.map((id) => resolveProfile(id, overrides));
}

/** The resolved definition for a profile id, for modules that must not subscribe. */
export const profileDef = (id: ProfileId): ProfileDef =>
  resolveProfile(id, useServerStateStore.getState().profiles);
