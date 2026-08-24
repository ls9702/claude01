import { useState } from 'react';
import { useAiEnabled } from '../../ai/aiSettings';
import { useUiStore } from '../../stores/uiStore';
import Icon from '../common/Icon';
import AiAskSheet from './AiAskSheet';

/**
 * The ✨ next to the sync chip — the one AI entry point that is not about the
 * screen you are on (M11).
 *
 * Renders nothing at all unless {@link useAiEnabled}. That is the whole guard:
 * a GitHub Pages build, a device with sync off, or a NAS without a Gemini key
 * never sees an AI control, so nobody is offered a feature that cannot run.
 *
 * Same shape as `SyncStatusChip`'s dot variant so the two sit as a pair.
 */
export default function AiAskButton() {
  const enabled = useAiEnabled();
  const tripId = useUiStore((s) => s.activeTripId);
  const [open, setOpen] = useState(false);

  if (!enabled) return null;

  return (
    <>
      <button
        type="button"
        data-testid="ai-ask-open"
        onClick={() => setOpen(true)}
        aria-label="AI에게 묻기"
        title="AI에게 묻기"
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-ink-muted transition-colors duration-[140ms] ease-quick hover:bg-sunken hover:text-ink"
      >
        <Icon name="sparkle" size={20} />
      </button>

      {open ? <AiAskSheet tripId={tripId} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
