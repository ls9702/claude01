import { useState } from 'react';
import { SYNC_STATUS_LABELS, useSyncStore, type SyncStatus } from '../../stores/syncStore';
import SyncSettingsSheet from './SyncSettingsSheet';
import { CHIP_BASE, withoutHeight, withoutPadX } from './formStyles';

/**
 * 상단 바의 동기화 칩 — 36px 높이의 누를 수 있는 칩.
 *
 * `${CHIP_BASE} h-9 px-3`으로 덧쓰면 CHIP_BASE의 `h-6 px-2`와 한 문자열 안에서
 * 충돌한다(지금은 우연히 h-9가 이기지만, 그건 CSS 출력 순서일 뿐이다). 값을
 * 덧쓰지 않고 걷어낸 뒤 넣는다.
 */
const CHIP_SYNC = `${withoutPadX(withoutHeight(CHIP_BASE))} h-9 px-3`;

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
            : `${CHIP_SYNC} bg-sunken text-ink-muted hover:bg-line`
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
