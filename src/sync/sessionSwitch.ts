/**
 * 세션 전환 (M46) — moving this device from one server workspace to another.
 *
 * The administrator flips one pointer on the NAS and every open tab, on every
 * phone, has to follow. This is the client half of that, and it has exactly one
 * job: **swap namespaces without merging and without losing anything.**
 *
 * What happens, in order:
 *
 * 1. The workspace currently in memory is already persisted under the *old*
 *    session's IndexedDB key (that is what `zustand/persist` has been doing all
 *    along), so simply pointing `persist` at the new key leaves the old data
 *    exactly where it was. Switching back later finds it again.
 * 2. The new namespace is read. If this device has been in that session before,
 *    its stored copy is rehydrated; if not, the store is replaced with an
 *    **empty** workspace.
 * 3. The version counter is reset, so the next pull treats the new session's
 *    server copy as something it has never seen.
 *
 * Step 2 is the one that matters. Leaving the old session's trips in memory and
 * letting the ordinary pull merge them against the new session's server copy
 * would fold two groups' trips into one workspace — an LWW merge nobody can
 * undo. Hence `emptyWorkspace()` rather than "keep what we have", and hence
 * `setState` rather than `replaceWorkspace`: the latter marks the store dirty,
 * which would schedule a push of that empty workspace over whatever the new
 * session already has.
 */

import { useServerStateStore } from '../stores/serverState';
import { idbStorage } from '../stores/persistMiddleware';
import { useSyncStore } from '../stores/syncStore';
import { useUiStore } from '../stores/uiStore';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { emptyWorkspace } from '../types/models';
import { resetPhotoMisses } from './photoSync';
import {
  isValidSessionId,
  loadServerSession,
  saveServerSession,
  workspaceStorageKey,
} from './session';

/**
 * Moves this device into `nextId`. Resolves `true` when it actually moved.
 *
 * A no-op — and cheap enough to call on every poll — when the id is the one we
 * are already in, or is not a valid session id at all (a garbled response must
 * never be able to strand a device in a namespace that does not exist).
 */
export async function adoptServerSession(nextId: string | null | undefined): Promise<boolean> {
  if (!isValidSessionId(nextId)) return false;
  if (nextId === loadServerSession()) return false;

  const workspace = useWorkspaceStore;
  const key = workspaceStorageKey(nextId);

  // From here on, every persist write lands in the new namespace. The old one
  // keeps the bytes it already has — that is the "유실 0" half of the promise.
  workspace.persist.setOptions({ name: key });
  saveServerSession(nextId);
  useServerStateStore.setState({ session: nextId });

  // Asked directly rather than inferred from `rehydrate()`: zustand's rehydrate
  // leaves the current state alone when there is nothing stored, and "leaves it
  // alone" is precisely the outcome that would carry the old session's trips
  // into the new one.
  let stored: string | null = null;
  try {
    stored = await idbStorage.getItem(key);
  } catch {
    stored = null;
  }

  if (stored) {
    await workspace.persist.rehydrate();
  } else {
    workspace.setState({ workspace: emptyWorkspace(), dirty: false, hydrated: true });
  }

  // A trip id from the old session names nothing here, and a view holding one
  // renders an empty screen with no way back to the list.
  useUiStore.getState().setActiveTrip(undefined);

  // The new session's counter starts unknown, so the next pull adopts whatever
  // is there instead of believing it is already up to date.
  useSyncStore.getState().setServerVersion(0);
  // "This id is not on the server" was a claim about the *old* session's photo
  // folder; the new one has its own.
  resetPhotoMisses();

  return true;
}
