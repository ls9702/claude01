import { useCallback, useMemo, useState } from 'react';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import {
  backupNudgeText,
  isWorkspaceWorthBacking,
  loadBackupState,
  shouldNudgeBackup,
  snoozeBackupNudge,
} from '../../sync/backup';
import Icon from './Icon';
import SyncSettingsSheet from './SyncSettingsSheet';
import { BTN_SIZE_SM, SECONDARY_BUTTON_CLASS, withBtnSize } from './formStyles';

/**
 * 백업 넛지 — the hint that appears when this device has not produced a backup
 * file in a fortnight and there is now something worth losing (M7a).
 *
 * Two shapes, one instance (M9 §3.3 / §3.5): a compact chip in the desktop top
 * bar's utility zone, and a **one-line** warn banner on a phone. The banner is
 * mounted by each view *below* its own h1 — a hint about last month's backup
 * does not outrank the name of the screen you are on — and it is one `h-11`
 * row, the same height as every other control in the app. Tapping it opens the
 * same 동기화 설정 sheet the chip next door opens, where 내보내기 lives; ✕
 * snoozes it for a week so it can never turn into wallpaper.
 *
 * The stamps live in `localStorage` and are read once per mount (plus after a
 * dismissal): nothing here needs to be reactive to the millisecond.
 */
export default function BackupNudge({
  variant = 'chip',
  className = '',
}: {
  variant?: 'chip' | 'banner';
  /** Margins the mounting view wants around the banner. Presentational only. */
  className?: string;
}) {
  const workspace = useWorkspaceStore((s) => s.workspace);
  const [open, setOpen] = useState(false);
  /** Bumped by ✕ and by closing the sheet, to re-read the stored stamps. */
  const [revision, setRevision] = useState(0);

  const worthBacking = useMemo(() => isWorkspaceWorthBacking(workspace), [workspace]);

  // Read straight through on every render rather than memoizing: `revision`
  // exists precisely to force this re-read after ✕ or after 내보내기.
  void revision;
  const state = loadBackupState();
  const visible = shouldNudgeBackup(state, worthBacking);
  // 「오래됐어요」 vs 「아직 한 적이 없어요」 — the same chip, two different
  // facts, and it used to tell only one of them (B20).
  const message = backupNudgeText(state.lastBackupAt);

  const closeSheet = useCallback(() => {
    setOpen(false);
    // 내보내기 inside the sheet stamps `lastBackupAt`; re-read so the hint goes.
    setRevision((value) => value + 1);
  }, []);

  const dismiss = () => {
    snoozeBackupNudge();
    setRevision((value) => value + 1);
  };

  if (!visible) return null;

  const banner = variant === 'banner';

  return (
    <>
      <div
        role="status"
        data-testid="backup-nudge"
        className={[
          banner
            ? 'flex h-11 shrink-0 items-center gap-2 rounded-md border border-warn/35 bg-warn-wash pl-3 pr-1 text-label text-warn-ink'
            : 'flex h-9 flex-none items-center gap-1 rounded-full border border-warn/35 bg-warn-wash pl-3 pr-1 text-micro text-warn-ink',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <Icon name="package" size={16} className="text-warn" />
        <button
          type="button"
          data-testid="backup-nudge-open"
          onClick={() => setOpen(true)}
          title={message}
          className={
            banner
              ? // M19 — 배너는 44px인데 그 안의 글자 버튼은 19px이었다. 높이를
                // 채워 배너 어디를 눌러도 백업 시트가 열리게 한다.
                'h-full min-w-0 flex-1 truncate text-left hover:underline'
              : 'min-w-0 truncate py-1 hover:underline'
          }
        >
          {message}
        </button>
        {banner ? (
          <button
            type="button"
            data-testid="backup-nudge-export"
            onClick={() => setOpen(true)}
            className={`${withBtnSize(SECONDARY_BUTTON_CLASS, BTN_SIZE_SM)} shrink-0`}
          >
            내보내기
          </button>
        ) : null}
        <button
          type="button"
          data-testid="backup-nudge-dismiss"
          aria-label="백업 알림 숨기기"
          onClick={dismiss}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-warn/70 transition-colors duration-[140ms] ease-quick hover:bg-warn/10 hover:text-warn-ink"
        >
          <Icon name="close" size={16} />
        </button>
      </div>

      {open ? <SyncSettingsSheet onClose={closeSheet} /> : null}
    </>
  );
}
