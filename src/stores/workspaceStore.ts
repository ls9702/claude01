import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { emptyWorkspace, type Workspace } from '../types/models';
import { idbStorage } from './persistMiddleware';

export interface WorkspaceState {
  /** The single persisted blob of app data. */
  workspace: Workspace;
  /** True when there are local changes not yet pushed to a remote (M4). */
  dirty: boolean;
  /** False until IndexedDB rehydration has finished. Not persisted. */
  hydrated: boolean;
  /**
   * Generic mutation helper. Applies `fn` to a shallow copy of the workspace
   * and marks the store dirty. Concrete mutations (createTrip, moveCard, …)
   * land in M1 and are all expected to funnel through here.
   */
  mutate: (fn: (ws: Workspace) => void) => void;
  /** Replace the whole workspace (import / sync merge result). */
  replaceWorkspace: (ws: Workspace) => void;
  setDirty: (dirty: boolean) => void;
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set) => ({
      workspace: emptyWorkspace(),
      dirty: false,
      hydrated: false,

      mutate: (fn) =>
        set((state) => {
          const next: Workspace = { ...state.workspace };
          fn(next);
          return { workspace: next, dirty: true };
        }),

      replaceWorkspace: (ws) => set({ workspace: ws, dirty: true }),

      setDirty: (dirty) => set({ dirty }),
    }),
    {
      name: 'trip-board/workspace',
      version: 1,
      storage: createJSONStorage(() => idbStorage),
      // `hydrated` and the actions are derived/ephemeral — only persist data.
      partialize: (state) => ({ workspace: state.workspace, dirty: state.dirty }),
      onRehydrateStorage: () => (_state, error) => {
        if (error) console.warn('[workspaceStore] rehydrate failed', error);
        // Mark hydrated either way so the app never gets stuck on the splash.
        useWorkspaceStore.setState({ hydrated: true });
      },
    },
  ),
);
