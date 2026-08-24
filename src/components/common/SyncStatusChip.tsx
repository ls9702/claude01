import { useState } from 'react';
import { useCurrentProfile } from '../../profile/profile';
import { SYNC_STATUS_LABELS, useSyncStore, type SyncStatus } from '../../stores/syncStore';
import Avatar from './Avatar';
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
  const profile = useCurrentProfile();
  const [open, setOpen] = useState(false);

  const dot = variant === 'dot';

  return (
    <>
      {/* 이 기기는 누구인가 (M13) — 동기화 표시 바로 옆, 같은 시트로 들어간다.
          탭 바가 아니라 이 컴포넌트에 붙는 이유: 데스크톱 상단 바와 네 화면의
          모바일 헤더가 이미 전부 이 칩을 걸고 있고, 설정으로 가는 길도 이 칩
          하나뿐이기 때문이다. 탭은 여전히 정확히 4개다. */}
      {profile ? (
        <button
          type="button"
          data-testid="profile-chip"
          data-profile={profile.id}
          onClick={() => setOpen(true)}
          aria-label={`프로필 ${profile.label}`}
          title={`프로필 ${profile.label}`}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full transition-colors duration-[140ms] ease-quick hover:bg-sunken"
        >
          <Avatar id={profile.id} size="sm" />
        </button>
      ) : null}

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
