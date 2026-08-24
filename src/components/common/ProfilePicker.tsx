import { createPortal } from 'react-dom';
import { PROFILES, PROFILE_IDS, useProfileStore, type ProfileId } from '../../profile/profile';
import Avatar from './Avatar';
import { SECONDARY_BUTTON_CLASS } from './formStyles';

interface ProfilePickerProps {
  /**
   * Present only in the 전환 variant. Its absence is what makes the first-run
   * picker a wall rather than a dialog: there is no 취소, no ✕ and no overlay
   * to tap through, because "neither of us" is not one of the answers.
   */
  onCancel?: () => void;
  /** Fired after a choice was made and stored. */
  onChosen?: (id: ProfileId) => void;
}

/**
 * 누구세요? — the full-screen "which of the two of you is this?" (M13).
 *
 * Mounted by `AppShell` *after* the hydration gate when the device has no
 * profile yet, and again by 설정 when someone taps 전환. The same component
 * both times: switching later should look exactly like choosing the first
 * time, and one of them owning a 취소 button is the entire difference.
 *
 * Portalled onto `document.body` so it is above the tab bar (z-40) and above an
 * open sheet (z-50) — the 전환 variant is opened *from* a sheet, and a `fixed`
 * child of a panel that animates with a transform would be clipped into it.
 */
export default function ProfilePicker({ onCancel, onChosen }: ProfilePickerProps) {
  const setProfile = useProfileStore((s) => s.setProfile);

  const choose = (id: ProfileId): void => {
    setProfile(id);
    onChosen?.(id);
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="프로필 선택"
      data-testid="profile-picker"
      className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-8 bg-surface px-6"
    >
      <div className="text-center">
        <h1 className="shrink-0 whitespace-nowrap text-display text-ink">누구세요?</h1>
        <p className="mt-2 text-label font-normal text-ink-muted">
          이 기기에서 사용할 프로필을 선택하세요
        </p>
      </div>

      <div className="flex w-full max-w-sm flex-col gap-3 sm:flex-row sm:justify-center">
        {PROFILE_IDS.map((id) => (
          <button
            key={id}
            type="button"
            data-testid="profile-option"
            data-profile={id}
            onClick={() => choose(id)}
            className={[
              'flex flex-1 flex-col items-center gap-3 rounded-lg border border-line bg-surface',
              'px-6 py-8 shadow-raise transition-colors duration-[140ms] ease-quick',
              'outline-none hover:border-line-strong hover:bg-sunken',
              'focus-visible:ring-2 focus-visible:ring-line-strong',
            ].join(' ')}
          >
            <Avatar id={id} size="lg" />
            <span className="text-title text-ink">{PROFILES[id].label}</span>
          </button>
        ))}
      </div>

      {onCancel ? (
        <button
          type="button"
          data-testid="profile-picker-cancel"
          onClick={onCancel}
          className={SECONDARY_BUTTON_CLASS}
        >
          취소
        </button>
      ) : (
        <p className="text-micro font-normal text-ink-faint">
          나중에 설정에서 바꿀 수 있어요.
        </p>
      )}
    </div>,
    document.body,
  );
}
