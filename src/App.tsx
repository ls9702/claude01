import { useEffect } from 'react';
import AppShell from './components/layout/AppShell';
import UpdateToast from './components/common/UpdateToast';
import { pruneActiveIds } from './stores/uiStore';
import { useWorkspaceStore } from './stores/workspaceStore';
import { initSyncEngine } from './sync/syncEngine';

/**
 * Ask the browser to make our IndexedDB storage persistent so the workspace
 * is not evicted under storage pressure. Fire-and-forget: unsupported in some
 * browsers and rejected without a prompt in others — never block startup.
 */
function requestPersistentStorage(): void {
  try {
    void navigator.storage?.persist?.()?.catch(() => {});
  } catch {
    /* ignore */
  }
}

export default function App() {
  const hydrated = useWorkspaceStore((s) => s.hydrated);

  useEffect(() => {
    requestPersistentStorage();
  }, []);

  // Sync only after rehydration: starting earlier would merge the server copy
  // into an empty workspace and push the result, wiping the device clean.
  useEffect(() => {
    if (!hydrated) return;
    // Same reason, one line up: the remembered 활성 여행 can only be checked
    // against a workspace that has actually loaded (B15).
    pruneActiveIds(useWorkspaceStore.getState().workspace);
    return initSyncEngine();
  }, [hydrated]);

  return (
    <>
      <AppShell />
      <UpdateToast />
    </>
  );
}
