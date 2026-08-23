import { useState } from 'react';
import { SYNC_STATUS_LABELS, useSyncStore, type SyncStatus } from '../../stores/syncStore';
import SyncSettingsSheet from './SyncSettingsSheet';

/** Dot colour per status. `syncing` also pulses. */
const DOT_CLASS: Record<SyncStatus, string> = {
  off: 'bg-stone-300',
  idle: 'bg-emerald-500',
  syncing: 'bg-amber-400 animate-pulse',
  offline: 'bg-stone-400',
  error: 'bg-rose-500',
};

/**
 * The sync indicator that lives in the tab bar: a coloured dot plus its Korean
 * label, and the only way into {@link SyncSettingsSheet}.
 *
 * Shaped like a tab (dot above label on mobile, inline on desktop) so it reads
 * as part of the bar rather than something bolted on. It is always visible —
 * `끔` is a perfectly normal state for this app, not a warning.
 */
export default function SyncStatusChip() {
  const status = useSyncStore((s) => s.status);
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        data-testid="sync-chip"
        data-status={status}
        onClick={() => setOpen(true)}
        aria-label={`동기화 ${SYNC_STATUS_LABELS[status]}`}
        title={`동기화 ${SYNC_STATUS_LABELS[status]}`}
        className={[
          'flex flex-none flex-col items-center justify-center gap-0.5 px-3 py-2',
          'text-xs font-medium text-stone-400 transition-colors hover:text-stone-600',
          'lg:ml-auto lg:h-9 lg:flex-row lg:gap-1.5 lg:rounded-full lg:px-3 lg:text-sm',
          'lg:hover:bg-stone-100',
        ].join(' ')}
      >
        <span
          aria-hidden="true"
          data-testid="sync-dot"
          className={`h-2 w-2 rounded-full ${DOT_CLASS[status]}`}
        />
        <span data-testid="sync-label">{SYNC_STATUS_LABELS[status]}</span>
      </button>

      {open ? <SyncSettingsSheet onClose={() => setOpen(false)} /> : null}
    </>
  );
}
