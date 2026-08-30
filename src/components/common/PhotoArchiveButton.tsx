import { useRef, useState, type ChangeEvent } from 'react';
import { uploadArchiveFile, ArchiveError } from '../../archive/archiveApi';
import {
  isArchivableName,
  safeArchiveName,
  summarizeArchive,
  type ArchiveResult,
} from '../../archive/archiveFiles';
import { isConfigured } from '../../sync/settings';
import Icon from './Icon';
import Sheet from './Sheet';
import { PRIMARY_BUTTON_CLASS } from './formStyles';

/**
 * 📤 사진 보관 (M46) — the originals go to the NAS, untouched.
 *
 * Deliberately not part of the plan. Nothing in the workspace points at these
 * files, no sync reads them back, and deleting one changes nothing in the app.
 * It is a trip-long "put this somewhere safe" button that happens to live in
 * the trip planner, because that is the app already open on the phone at the
 * moment the photo is worth keeping.
 *
 * The uploads are **sequential**, for the same reason `photoSync` uploads card
 * photos one at a time: these are tens of megabytes each going up a home
 * uplink, and a dozen in parallel is how the workspace push behind them starves.
 * The progress line is therefore honest about which one is in the air.
 *
 * A file that is not a photo is skipped rather than refused — picking twenty
 * things out of a camera roll and having the whole batch rejected because one
 * of them was a screen recording is not a useful answer.
 */

/** The sheet: pick, watch, read the result. */
function PhotoArchiveSheet({ onClose }: { onClose: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  /** `{done, total}` while uploading — what "3/12" is made of. */
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [results, setResults] = useState<ArchiveResult[]>([]);

  const handlePick = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const files = [...(event.target.files ?? [])];
    // Cleared immediately so picking the same photos twice fires `change` again.
    event.target.value = '';
    if (files.length === 0) return;

    setBusy(true);
    setResults([]);
    setProgress({ done: 0, total: files.length });

    const collected: ArchiveResult[] = [];
    for (const file of files) {
      if (!isArchivableName(file.name)) {
        collected.push({ name: file.name, outcome: 'skipped', detail: '사진 파일이 아니에요' });
      } else {
        // The name the row shows is the name the NAS will use — a 사진.jpg that
        // arrives as `_.jpg` should say so here, not be discovered in File
        // Station a week later.
        const name = safeArchiveName(file.name) ?? file.name;
        try {
          const result = await uploadArchiveFile(file);
          collected.push({ name, outcome: 'ok', detail: result.path });
        } catch (err) {
          collected.push({
            name,
            outcome: 'failed',
            detail: err instanceof ArchiveError ? err.message : '보관에 실패했어요',
          });
        }
      }
      // Rebuilt on every file rather than at the end: a twenty-photo batch is a
      // minute of staring at a screen, and the rows arriving one by one is the
      // difference between "working" and "frozen".
      setResults([...collected]);
      setProgress({ done: collected.length, total: files.length });
    }

    setBusy(false);
  };

  return (
    <Sheet
      title="사진 보관"
      testId="photo-archive"
      onClose={onClose}
      footer={
        <button
          type="button"
          data-testid="photo-archive-pick"
          onClick={() => input.current?.click()}
          disabled={busy}
          className={`${PRIMARY_BUTTON_CLASS} w-full`}
        >
          <Icon name="camera" size={16} />
          사진 고르기
        </button>
      }
    >
      <div className="space-y-4">
        <p className="text-label font-normal text-ink-muted">
          고른 사진을 원본 그대로 NAS에 보관해요. 계획이나 카드에는 나타나지 않고, 여행이 끝난
          뒤에도 NAS 폴더에 그대로 남아요.
        </p>

        <input
          ref={input}
          data-testid="photo-archive-input"
          type="file"
          accept="image/*"
          multiple
          onChange={(event) => void handlePick(event)}
          className="hidden"
        />

        {progress ? (
          <p
            data-testid="photo-archive-progress"
            data-done={progress.done}
            data-total={progress.total}
            className="text-label font-semibold tabular-nums text-ink"
          >
            {busy ? `보관하는 중 ${progress.done}/${progress.total}` : summarizeArchive(results)}
          </p>
        ) : null}

        {results.length > 0 ? (
          <ul className="space-y-1">
            {results.map((result, index) => (
              <li
                key={`${result.name}-${index}`}
                data-testid="photo-archive-row"
                data-outcome={result.outcome}
                className="flex items-baseline gap-2 border-b border-line py-2 text-micro font-normal"
              >
                <Icon
                  name={result.outcome === 'ok' ? 'check' : 'alert'}
                  size={16}
                  className={`shrink-0 ${result.outcome === 'ok' ? 'text-ok' : 'text-ink-faint'}`}
                />
                <span className="min-w-0 flex-1 truncate text-ink">{result.name}</span>
                <span className="shrink-0 text-ink-faint">{result.detail}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Sheet>
  );
}

/**
 * The button. Hidden entirely on a device with no server to file to — the same
 * feature detection every other server-dependent affordance in this app uses,
 * so the GitHub Pages build is unchanged.
 */
export default function PhotoArchiveButton() {
  const [open, setOpen] = useState(false);
  if (!isConfigured()) return null;

  return (
    <>
      <button
        type="button"
        data-testid="photo-archive-open"
        onClick={() => setOpen(true)}
        aria-label="사진 보관"
        title="사진 보관"
        className="relative grid h-9 w-9 shrink-0 place-items-center rounded-full text-ink-muted transition-colors duration-[140ms] ease-quick hover:bg-sunken hover:text-ink"
      >
        <Icon name="upload" size={20} />
      </button>

      {open ? <PhotoArchiveSheet onClose={() => setOpen(false)} /> : null}
    </>
  );
}
