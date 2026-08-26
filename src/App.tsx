import { useEffect } from 'react';
import AppShell from './components/layout/AppShell';
import UpdateToast from './components/common/UpdateToast';
import { refreshAiCapability } from './ai/aiClient';
import { SEEN_THROTTLE_MS, useProfileStore } from './profile/profile';
import { schedulePhotoGc } from './stores/photoGc';
import { pruneActiveIds } from './stores/uiStore';
import { useWorkspaceStore } from './stores/workspaceStore';
import { adoptTodoColumns } from './todo/migrate';
import { applyBootstrapConfig } from './sync/bootstrap';
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
  const profileId = useProfileStore((s) => s.profileId);

  useEffect(() => {
    requestPersistentStorage();
  }, []);

  /**
   * "누가 봤는지" — stamp this profile's last-seen once the workspace is real
   * and someone has said who they are (M13).
   *
   * The throttle lives **here**, not in `markSeen`: the stamp is stored inside
   * the workspace, so writing it makes the blob dirty and books a sync. Once
   * every 10 minutes is plenty to answer "when was the other one last on
   * this?"; once per tab focus would mean every alt-tab pushes to the NAS.
   */
  useEffect(() => {
    if (!hydrated || !profileId) return;

    const touch = (): void => {
      const { workspace, markSeen } = useWorkspaceStore.getState();
      const last = workspace.seenBy?.[profileId];
      if (typeof last === 'number' && Date.now() - last < SEEN_THROTTLE_MS) return;
      markSeen(profileId);
    };

    touch();
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') touch();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [hydrated, profileId]);

  // Sync only after rehydration: starting earlier would merge the server copy
  // into an empty workspace and push the result, wiping the device clean.
  useEffect(() => {
    if (!hydrated) return;
    // Same reason, one line up: the remembered 활성 여행 can only be checked
    // against a workspace that has actually loaded (B15).
    pruneActiveIds(useWorkspaceStore.getState().workspace);
    // Same reason a third time (M29): 「할일」이라는 이름은 하이드레이션이
    // 끝나야 존재한다. 더하기만 하고 멱등이라 매 실행 첫 로드에 그냥 돌려도
    // 두 번째부터는 아무 일이 없다.
    adoptTodoColumns();
    // Same reason again: a sweep against an empty workspace would find every
    // photo unreferenced. Booked, not run — the first pass only marks
    // candidates (blobs a crash left behind mid-add), and the sweeper books
    // its own follow-up to collect them once the grace period is up (M10).
    schedulePhotoGc();
    // Zero-config bootstrap first (M14): a NAS deployment may ship a
    // bootstrap-config.json that configures sync + AI for a fresh device.
    // Only THEN ping for AI capability (M11), so the very first load of a
    // fresh device ends with the correct statuses. Neither ever throws, and
    // GitHub Pages (no file, nothing configured) is untouched by both.
    void applyBootstrapConfig().finally(() => {
      void refreshAiCapability();
    });
    return initSyncEngine();
  }, [hydrated]);

  return (
    <>
      <AppShell />
      <UpdateToast />
    </>
  );
}
