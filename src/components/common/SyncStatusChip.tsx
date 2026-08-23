import { useState } from 'react';
import { SYNC_STATUS_LABELS, useSyncStore, type SyncStatus } from '../../stores/syncStore';
import SyncSettingsSheet from './SyncSettingsSheet';
import { CHIP_BASE } from './formStyles';

/** Dot colour per status — one job each (M9 §4.8-4). `syncing` also pulses. */
export const SYNC_DOT_CLASS: Record<SyncStatus, string> = {
  off: 'bg-line-strong',
  idle: 'bg-ok',
  syncing: 'bg-warn animate-pulse',
  offline: 'bg-ink-faint',
  error: 'bg-danger',
};

/**
 * The sync indicator, and the only way into {@link SyncSettingsSheet}.
 *
 * On desktop it is a neutral chip in the top bar's utility zone: dot + Korean
 * label. On a phone the label is dropped and only the 8px dot survives, tucked
 * into the screen's own header — `끔` is a perfectly normal state for this app
 * and normality should not cost pixels (M9 §3.3).
 */
export default function SyncStatusChip({ variant = 'chip' }: { variant?: 'chip' | 'dot' }) {
  const status = useSyncStore((s) => s.status);
  const [open, setOpen] = useState(false);

  const dot = variant === 'dot';

  return (
    <>
      <button
        type="button"
        data-testid="sync-chip"
        data-status={status}
        onClick={() => setOpen(true)}
        aria-label={`동기화 ${SYNC_STATUS_LABELS[status]}`}
        title={`동기화 ${SYNC_STATUS_LABELS[status]}`}
        className={
          dot
            ? 'grid h-9 w-9 shrink-0 place-items-center rounded-full transition-colors duration-[140ms] ease-quick hover:bg-sunken'
            : `${CHIP_BASE} h-9 px-3 bg-sunken text-ink-muted hover:bg-line`
        }
      >
        <span
          aria-hidden="true"
          data-testid="sync-dot"
          className={`h-2 w-2 rounded-full ${SYNC_DOT_CLASS[status]}`}
        />
        <span data-testid="sync-label" className={dot ? 'sr-only' : undefined}>
          {SYNC_STATUS_LABELS[status]}
        </span>
      </button>

      {open ? <SyncSettingsSheet onClose={() => setOpen(false)} /> : null}
    </>
  );
}
