import { useCallback, useMemo, useState } from 'react';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import {
  isWorkspaceWorthBacking,
  loadBackupState,
  shouldNudgeBackup,
  snoozeBackupNudge,
} from '../../sync/backup';
import SyncSettingsSheet from './SyncSettingsSheet';

/**
 * 백업 넛지 — a small chip beside the sync status that appears when this
 * device has not produced a backup file in a fortnight and there is now
 * something worth losing (M7a).
 *
 * It sits in the tab bar rather than in a view because it is about the
 * workspace, not about whichever tab happens to be open. Tapping it opens the
 * same 동기화 설정 sheet the chip next door opens, where 내보내기 lives; ✕
 * snoozes it for a week so it can never turn into wallpaper.
 *
 * The stamps live in `localStorage` and are read once per mount (plus after a
 * dismissal): nothing here needs to be reactive to the millisecond, and
 * polling the clock to hide a hint chip would be silly.
 */
export default function BackupNudge() {
  const workspace = useWorkspaceStore((s) => s.workspace);
  const [open, setOpen] = useState(false);
  /** Bumped by ✕ and by closing the sheet, to re-read the stored stamps. */
  const [revision, setRevision] = useState(0);

  const worthBacking = useMemo(() => isWorkspaceWorthBacking(workspace), [workspace]);

  // Read straight through on every render rather than memoizing: `revision`
  // exists precisely to force this re-read after ✕ or after 내보내기, and one
  // `localStorage.getItem` of a two-number object costs nothing.
  void revision;
  const visible = shouldNudgeBackup(loadBackupState(), worthBacking);

  const closeSheet = useCallback(() => {
    setOpen(false);
    // 내보내기 inside the sheet stamps `lastBackupAt`; re-read so the chip goes.
    setRevision((value) => value + 1);
  }, []);

  if (!visible) return null;

  return (
    <>
      <div
        data-testid="backup-nudge"
        className={[
          'flex flex-none items-center gap-0.5 rounded-full bg-amber-100 pl-2 pr-1',
          'text-[11px] font-medium text-amber-800 lg:h-9 lg:pl-3 lg:text-xs',
        ].join(' ')}
      >
        <button
          type="button"
          data-testid="backup-nudge-open"
          onClick={() => setOpen(true)}
          title="백업한 지 오래됐어요"
          className="min-w-0 py-1.5 hover:text-amber-900"
        >
          <span aria-hidden="true">📦</span>
          {/* The full sentence needs room; a phone tab bar has none. */}
          <span className="ml-1 hidden lg:inline">백업한 지 오래됐어요</span>
          <span className="sr-only lg:hidden">백업한 지 오래됐어요</span>
        </button>
        <button
          type="button"
          data-testid="backup-nudge-dismiss"
          aria-label="백업 알림 숨기기"
          onClick={() => {
            snoozeBackupNudge();
            setRevision((value) => value + 1);
          }}
          className="rounded-full px-1.5 py-1 leading-none text-amber-600 hover:text-amber-900"
        >
          ✕
        </button>
      </div>

      {open ? <SyncSettingsSheet onClose={closeSheet} /> : null}
    </>
  );
}
