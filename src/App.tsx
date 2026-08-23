import { useEffect } from 'react';
import AppShell from './components/layout/AppShell';

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
  useEffect(() => {
    requestPersistentStorage();
  }, []);

  return <AppShell />;
}
