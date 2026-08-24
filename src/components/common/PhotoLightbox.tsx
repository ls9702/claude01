import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePhotoUrl } from '../../stores/photoBlobs';
import { schedulePhotoGc } from '../../stores/photoGc';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import type { Id } from '../../types/models';
import ConfirmDialog from './ConfirmDialog';
import Icon from './Icon';

/** How far a finger must travel before a drag counts as a swipe. */
const SWIPE_PX = 40;

interface PhotoLightboxProps {
  cardId: Id;
  /** Which photo to open on. Clamped, so a stale index is harmless. */
  startIndex: number;
  onClose: () => void;
}

/** One `<img>` plus its loading/missing states — the lightbox's whole body. */
function LightboxImage({ id }: { id: Id }) {
  const url = usePhotoUrl(id);

  if (!url) {
    return (
      <div
        data-testid="photo-lightbox-missing"
        className="grid h-40 w-64 place-items-center rounded-lg bg-ink/20 text-label font-normal text-surface/70"
      >
        사진을 찾을 수 없어요
      </div>
    );
  }

  return (
    <img
      src={url}
      alt=""
      data-testid="photo-lightbox-image"
      data-photo-id={id}
      className="max-h-full max-w-full object-contain"
    />
  );
}

/**
 * 사진 크게 보기 (M10) — one photo at a time, on near-black.
 *
 * Its own portal at `z-[60]` rather than a `Sheet`: it opens *from* a sheet and
 * has to sit on top of one, and a photo wants the whole screen and none of the
 * chrome. Everything a finger or a keyboard would reach for works — arrows,
 * Escape, and a horizontal swipe.
 *
 * Deleting here asks first, unlike every other delete in the app, and for the
 * opposite reason: 카드/여행 삭제 is offered back by a 실행 취소 toast, but the
 * bytes behind a photo are swept for good. A question now beats a regret later.
 */
export default function PhotoLightbox({ cardId, startIndex, onClose }: PhotoLightboxProps) {
  const photos = useWorkspaceStore((s) => s.workspace.cards[cardId]?.photos);
  const removePhoto = useWorkspaceStore((s) => s.removePhoto);
  const [index, setIndex] = useState(startIndex);
  const [asking, setAsking] = useState(false);
  /** Where the current pointer gesture started, or `null` between gestures. */
  const swipeStart = useRef<number | null>(null);

  const count = photos?.length ?? 0;
  // A delete (here or on another device mid-sync) can shrink the list under us.
  const safeIndex = count > 0 ? Math.min(Math.max(index, 0), count - 1) : 0;
  const current = photos?.[safeIndex];

  const step = (delta: number): void => {
    if (count <= 1) return;
    // Wraps: with a handful of photos, "next" at the end meaning "first" is
    // less surprising than a dead button.
    setIndex((value) => (((value + delta) % count) + count) % count);
  };

  /** The last photo closed the lightbox — there is nothing left to look at. */
  useEffect(() => {
    if (count === 0) onClose();
  }, [count, onClose]);

  useEffect(() => {
    if (index !== safeIndex) setIndex(safeIndex);
  }, [index, safeIndex]);

  /** Warm the neighbours so a swipe does not land on an empty frame. */
  const nextId = count > 1 ? photos?.[(safeIndex + 1) % count]?.id : undefined;
  const prevId = count > 1 ? photos?.[(safeIndex - 1 + count) % count]?.id : undefined;
  usePhotoUrl(nextId ?? null);
  usePhotoUrl(prevId ?? null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      // While the confirm dialog is up it owns Escape and the arrows.
      if (asking) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        step(1);
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        step(-1);
      }
    };
    window.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
    // `step` closes over `count`, which is why it is not a dependency: the
    // listener is re-attached whenever either of those actually changes.
  }, [asking, count, onClose]);

  const confirmDelete = (): void => {
    const photoId = current?.id;
    setAsking(false);
    if (!photoId) return;
    removePhoto(cardId, photoId);
    // The bytes stay put for now — the sweep collects them once the grace
    // period has passed and nothing has picked the id back up.
    schedulePhotoGc();
    // Stepping back keeps the *neighbour* on screen rather than jumping to
    // whatever slid into this slot.
    setIndex((value) => Math.max(0, Math.min(value, count - 2)));
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="사진 보기"
      data-testid="photo-lightbox"
      data-index={safeIndex}
      // z-60: above the sheet it was opened from, level with the map modal.
      className="fixed inset-0 z-60 flex flex-col bg-[#0b0b0c]/98"
      onPointerDown={(event) => {
        swipeStart.current = event.clientX;
      }}
      onPointerUp={(event) => {
        const from = swipeStart.current;
        swipeStart.current = null;
        if (from === null) return;
        const dx = event.clientX - from;
        if (Math.abs(dx) < SWIPE_PX) return;
        step(dx < 0 ? 1 : -1);
      }}
      onPointerCancel={() => {
        swipeStart.current = null;
      }}
    >
      <header className="flex shrink-0 items-center justify-between gap-3 px-4 pt-[calc(0.75rem+env(safe-area-inset-top))] pb-3">
        <span
          data-testid="photo-lightbox-counter"
          data-count={count}
          className="text-label font-semibold tabular-nums text-surface"
        >
          {count > 0 ? `${safeIndex + 1} / ${count}` : '0 / 0'}
        </span>
        <button
          type="button"
          data-testid="photo-lightbox-close"
          aria-label="닫기"
          onClick={onClose}
          className="-mr-1 grid h-11 w-11 shrink-0 place-items-center rounded-full text-surface/80 transition-colors duration-[140ms] ease-quick hover:bg-surface/10 hover:text-surface"
        >
          <Icon name="close" size={24} />
        </button>
      </header>

      <div className="relative flex min-h-0 flex-1 items-center justify-center px-2">
        {current ? <LightboxImage id={current.id} /> : null}

        {count > 1 ? (
          <>
            <button
              type="button"
              data-testid="photo-lightbox-prev"
              aria-label="이전 사진"
              onClick={(event) => {
                event.stopPropagation();
                step(-1);
              }}
              className="absolute left-2 grid h-11 w-11 place-items-center rounded-full bg-ink/40 text-surface transition-colors duration-[140ms] ease-quick hover:bg-ink/60"
            >
              <Icon name="chevron-left" size={24} />
            </button>
            <button
              type="button"
              data-testid="photo-lightbox-next"
              aria-label="다음 사진"
              onClick={(event) => {
                event.stopPropagation();
                step(1);
              }}
              className="absolute right-2 grid h-11 w-11 place-items-center rounded-full bg-ink/40 text-surface transition-colors duration-[140ms] ease-quick hover:bg-ink/60"
            >
              <Icon name="chevron-right" size={24} />
            </button>
          </>
        ) : null}
      </div>

      <footer className="flex shrink-0 items-center justify-center px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3">
        <button
          type="button"
          data-testid="photo-lightbox-delete"
          onClick={(event) => {
            event.stopPropagation();
            setAsking(true);
          }}
          className="inline-flex h-11 items-center justify-center gap-1 rounded-md px-4 text-body font-semibold text-danger transition-colors duration-[140ms] ease-quick hover:bg-surface/10"
        >
          <Icon name="trash" size={20} />
          삭제
        </button>
      </footer>

      {asking ? (
        <ConfirmDialog
          title="사진을 삭제할까요?"
          description="사진은 되돌릴 수 없어요."
          confirmLabel="삭제"
          onConfirm={confirmDelete}
          onCancel={() => setAsking(false)}
          testId="photo-delete-confirm"
        />
      ) : null}
    </div>,
    document.body,
  );
}
