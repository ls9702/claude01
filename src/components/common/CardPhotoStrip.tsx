import { useEffect, useRef, useState } from 'react';
import { deletePhotoBlobs, putPhotoBlob, usePhotoUrl } from '../../stores/photoBlobs';
import { MAX_PHOTOS_PER_CARD, useWorkspaceStore } from '../../stores/workspaceStore';
import type { Id } from '../../types/models';
import { newId } from '../../utils/ids';
import { preparePhoto } from '../../utils/photos';
import Icon from './Icon';
import PhotoLightbox from './PhotoLightbox';
import { SECTION_TITLE_CLASS } from './formStyles';

/** Korean copy the strip can put under itself. Frozen by the e2e suite. */
const FULL_MESSAGE = `사진은 카드당 ${MAX_PHOTOS_PER_CARD}장까지예요`;
const SAVE_FAILED_MESSAGE = '사진을 저장하지 못했어요';
const READ_FAILED_MESSAGE = '사진을 읽지 못했어요';

interface ThumbProps {
  id: Id;
  onOpen: () => void;
}

/** One 80×80 thumbnail. A missing blob is a sunken tile, not a broken image. */
function Thumb({ id, onOpen }: ThumbProps) {
  const url = usePhotoUrl(id);

  return (
    <button
      type="button"
      data-testid="card-photo-thumb"
      data-photo-id={id}
      data-loaded={url ? 'true' : 'false'}
      aria-label="사진 크게 보기"
      onClick={onOpen}
      className="h-20 w-20 shrink-0 overflow-hidden rounded-md bg-sunken outline-none transition-shadow duration-[140ms] ease-quick focus-visible:ring-2 focus-visible:ring-line-strong"
    >
      {url ? (
        <img src={url} alt="" className="h-full w-full object-cover" />
      ) : (
        <span className="grid h-full w-full place-items-center text-ink-faint">
          <Icon name="camera" size={20} />
        </span>
      )}
    </button>
  );
}

/**
 * 사진 (M10) — the card's photo strip.
 *
 * Written like {@link CardLedger}: it talks to the store **directly** the
 * moment a file is picked, instead of collecting form state for a 저장 button.
 * A photo snapped on the spot must survive the sheet being flicked away, and
 * the bytes have already been written by then anyway.
 *
 * The order of an add is what keeps the two stores honest: compress → write the
 * bytes under a fresh id → *then* commit the metadata. A crash in the middle
 * leaves an orphan blob, which the GC sweeps; the reverse (metadata pointing at
 * nothing) is the state that would show a permanent broken tile, and it cannot
 * happen. If `addPhoto` declines — the card filled up in the meantime — the
 * blob just written is rolled back.
 *
 * Files are processed **one at a time**: a decoded 12MP bitmap is tens of
 * megabytes, and five at once is how a mobile tab gets killed.
 */
export default function CardPhotoStrip({ cardId }: { cardId: Id }) {
  const photos = useWorkspaceStore((s) => s.workspace.cards[cardId]?.photos);
  const addPhoto = useWorkspaceStore((s) => s.addPhoto);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<number | null>(null);
  /** Guards `setState` after the sheet was dismissed mid-compression. */
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const count = photos?.length ?? 0;
  const full = count >= MAX_PHOTOS_PER_CARD;
  const message = error ?? (full ? FULL_MESSAGE : null);

  /**
   * Adds every picked file, sequentially, stopping at the cap.
   *
   * `useWorkspaceStore.getState()` is read fresh inside the loop rather than
   * from the render's `count`: each iteration awaits, and the number of photos
   * on the card has moved by the time the next one starts.
   */
  const addFiles = async (files: File[]): Promise<void> => {
    if (files.length === 0) return;
    setBusy(true);
    setError(null);

    let problem: string | null = null;
    for (const file of files) {
      const existing =
        useWorkspaceStore.getState().workspace.cards[cardId]?.photos?.length ?? 0;
      if (existing >= MAX_PHOTOS_PER_CARD) {
        problem = FULL_MESSAGE;
        break;
      }
      if (!file.type.startsWith('image/')) continue;

      let prepared;
      try {
        prepared = await preparePhoto(file);
      } catch {
        problem = READ_FAILED_MESSAGE;
        continue;
      }

      const id = newId();
      try {
        await putPhotoBlob(id, prepared.buf);
      } catch {
        problem = SAVE_FAILED_MESSAGE;
        continue;
      }

      const added = addPhoto(cardId, {
        id,
        w: prepared.w,
        h: prepared.h,
        bytes: prepared.bytes,
      });
      if (!added) {
        // The card filled up (or vanished) while we were compressing — take
        // the bytes back out rather than leaving the GC to find them.
        void deletePhotoBlobs([id]);
        problem = FULL_MESSAGE;
        break;
      }
    }

    if (!live.current) return;
    setBusy(false);
    setError(problem);
  };

  /**
   * 붙여넣기 (desktop). A screenshot in the clipboard is the fastest way onto a
   * card on a laptop, and there is no other route to it — the file picker
   * cannot see the clipboard.
   */
  useEffect(() => {
    const onPaste = (event: ClipboardEvent): void => {
      const files = [...(event.clipboardData?.files ?? [])].filter((file) =>
        file.type.startsWith('image/'),
      );
      if (files.length === 0) return;
      event.preventDefault();
      void addFiles(files);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
    // Re-bound whenever the handler's closure would go stale.
  });

  return (
    <section data-testid="card-photos">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className={SECTION_TITLE_CLASS}>사진</h3>
        <span
          data-testid="card-photo-count"
          data-count={count}
          className="text-label tabular-nums text-ink-muted"
        >
          {count}/{MAX_PHOTOS_PER_CARD}
        </span>
      </div>

      <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
        {(photos ?? []).map((photo, index) => (
          <Thumb key={photo.id} id={photo.id} onOpen={() => setLightbox(index)} />
        ))}

        {/* A `<label>` wrapping a hidden input, not a button that clicks one:
            it is the one form that works in every mobile WebView.

            Deliberately **no** `capture` attribute — it would pin the picker to
            the camera and take 앨범 away on some Androids, and "the photo I
            already took" is the common case on a trip. */}
        <label
          data-testid="card-photo-add"
          data-busy={busy ? 'true' : 'false'}
          aria-disabled={busy || full}
          className={[
            'grid h-20 w-20 shrink-0 cursor-pointer place-items-center gap-1 rounded-md',
            'border border-dashed border-line text-micro font-normal',
            busy || full
              ? 'cursor-not-allowed text-ink-faint'
              : 'text-ink-muted hover:border-line-strong hover:bg-sunken',
          ].join(' ')}
        >
          {busy ? (
            '추가 중…'
          ) : (
            <>
              <Icon name="plus" size={20} />
              사진
            </>
          )}
          <input
            data-testid="card-photo-input"
            type="file"
            accept="image/*"
            multiple
            hidden
            disabled={busy || full}
            onChange={(event) => {
              const files = [...(event.target.files ?? [])];
              // Cleared at once so picking the same file twice fires `change`.
              event.target.value = '';
              void addFiles(files);
            }}
          />
        </label>
      </div>

      {/* Says why the tile is dead *before* it is pressed, and reports the one
          thing that can go wrong after (a write that IndexedDB refused). */}
      {message ? (
        <p data-testid="card-photo-error" className="mt-2 text-micro font-normal text-danger">
          {message}
        </p>
      ) : null}

      {lightbox !== null ? (
        <PhotoLightbox
          cardId={cardId}
          startIndex={lightbox}
          onClose={() => setLightbox(null)}
        />
      ) : null}
    </section>
  );
}
