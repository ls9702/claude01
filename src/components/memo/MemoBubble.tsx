import { useState } from 'react';
import { PROFILES, isProfileId } from '../../profile/profile';
import { usePhotoUrl } from '../../stores/photoBlobs';
import { memoClock, isRemoved } from '../../memo/thread';
import type { CardPhoto, MemoMessage } from '../../types/models';
import AnchoredMenu from '../common/AnchoredMenu';
import Avatar from '../common/Avatar';
import Icon from '../common/Icon';
import PhotoLightbox from '../common/PhotoLightbox';
import { POPOVER_ROW_DANGER_CLASS } from '../common/formStyles';

/** Frozen copy the e2e suite reads. */
export const REMOVED_TEXT = '삭제된 메시지예요';

interface MemoBubbleProps {
  memo: MemoMessage;
  /** True when the device's own profile wrote it — right side, no avatar. */
  own: boolean;
  onDelete: (memo: MemoMessage) => void;
}

/**
 * One photo in a bubble. Sized in fixed steps rather than by the photo's own
 * aspect ratio, for a reason the thread depends on: the scroller is pinned to
 * the bottom, and a tile that grows when its bytes arrive would shove the
 * newest line off the screen under the reader's thumb.
 */
function PhotoTile({ photo, alone, onOpen }: { photo: CardPhoto; alone: boolean; onOpen: () => void }) {
  const url = usePhotoUrl(photo.id);
  const size = alone ? 'h-44 w-44' : 'h-28 w-28';

  return (
    <button
      type="button"
      data-testid="memo-photo"
      data-photo-id={photo.id}
      data-loaded={url ? 'true' : 'false'}
      aria-label="사진 크게 보기"
      onClick={onOpen}
      className={`${size} shrink-0 overflow-hidden rounded-md bg-sunken outline-none transition-shadow duration-[140ms] ease-quick focus-visible:ring-2 focus-visible:ring-line-strong`}
    >
      {url ? (
        <img src={url} alt="" className="h-full w-full object-cover" />
      ) : (
        // Not an error state: the bytes may still be on the other phone, and
        // `usePhotoUrl` is already fetching them (M20).
        <span className="grid h-full w-full place-items-center text-ink-faint">
          <Icon name="camera" size={20} />
        </span>
      )}
    </button>
  );
}

/**
 * 카카오톡식 말풍선 한 줄 (M21).
 *
 * The layout is the whole design: **mine** goes right, in the app's inverse
 * fill, with no avatar and no name — I know who I am. **Theirs** goes left,
 * behind their 18px avatar and their name, on a plain surface. A message whose
 * `by` this build does not recognise (written before profiles, or by some
 * future third person) is treated as theirs but wears no badge, exactly as
 * `CardLedger` does with an unknown author.
 *
 * The 더보기 menu only exists on one's own live message: deleting someone
 * else's line is not a thing this app offers, and a removed one has nothing
 * left to delete.
 */
export default function MemoBubble({ memo, own, onDelete }: MemoBubbleProps) {
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [lightbox, setLightbox] = useState<number | null>(null);

  const removed = isRemoved(memo);
  const photos = memo.photos ?? [];
  const authorLabel = isProfileId(memo.by) ? PROFILES[memo.by].label : null;

  const bubbleClass = [
    'w-fit max-w-[16rem] rounded-lg px-3 py-2 text-label font-normal sm:max-w-md',
    removed
      ? 'border border-dashed border-line bg-transparent text-ink-faint'
      : own
        ? 'bg-inverse text-surface'
        : 'bg-surface text-ink shadow-raise',
  ].join(' ');

  return (
    <div
      data-testid="memo-msg"
      data-memo-id={memo.id}
      data-own={own ? 'true' : 'false'}
      data-removed={removed ? 'true' : undefined}
      className={`flex items-end gap-1.5 ${own ? 'justify-end' : 'justify-start'}`}
    >
      {own ? null : isProfileId(memo.by) ? (
        <Avatar id={memo.by} size="sm" className="mb-5" />
      ) : (
        // Keeps the bubbles of a nameless message on the same left rail as
        // everyone else's, without inventing a third identity for it.
        <span aria-hidden="true" className="w-[18px] shrink-0" />
      )}

      <div className={`flex min-w-0 flex-col ${own ? 'items-end' : 'items-start'}`}>
        {own || !authorLabel ? null : (
          <span data-testid="memo-msg-author" className="mb-1 text-micro text-ink-muted">
            {authorLabel}
          </span>
        )}

        {/* Bubble, timestamp and ⋯ on one baseline. Reversed for my own line so
            the stamp always sits on the *inside* edge, the way a chat reads. */}
        <div className={`flex items-end gap-1 ${own ? 'flex-row-reverse' : ''}`}>
          <div className={bubbleClass}>
            {removed ? (
              REMOVED_TEXT
            ) : (
              <>
                {photos.length > 0 ? (
                  <div
                    className={`flex flex-wrap gap-1 ${memo.text ? 'mb-2' : ''} ${
                      photos.length > 1 ? 'max-w-[14.5rem]' : ''
                    }`}
                  >
                    {photos.map((photo, index) => (
                      <PhotoTile
                        key={photo.id}
                        photo={photo}
                        alone={photos.length === 1}
                        onOpen={() => setLightbox(index)}
                      />
                    ))}
                  </div>
                ) : null}
                {memo.text ? (
                  <p className="whitespace-pre-wrap break-words">{memo.text}</p>
                ) : null}
              </>
            )}
          </div>

          {/* A deleted line keeps no stamp: there is nothing left it dates. */}
          {removed ? null : (
            <span
              data-testid="memo-msg-time"
              className="shrink-0 pb-0.5 text-micro font-normal tabular-nums text-ink-faint"
            >
              {memoClock(memo.createdAt)}
            </span>
          )}

          {own && !removed ? (
            <button
              type="button"
              ref={setMenuAnchor}
              data-testid="memo-msg-menu"
              data-memo-id={memo.id}
              aria-label="메시지 메뉴 (삭제)"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
              // 44px on a phone, M9's smaller square on a mouse-driven desktop.
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-ink-faint transition-colors duration-[140ms] ease-quick hover:bg-sunken hover:text-ink lg:h-8 lg:w-8"
            >
              <Icon name="more" size={16} />
            </button>
          ) : null}
        </div>
      </div>

      {menuOpen ? (
        <AnchoredMenu
          anchor={menuAnchor}
          testId="memo-msg-menu-panel"
          onClose={() => setMenuOpen(false)}
        >
          <button
            type="button"
            data-testid="memo-msg-delete"
            onClick={() => {
              setMenuOpen(false);
              onDelete(memo);
            }}
            className={POPOVER_ROW_DANGER_CLASS}
          >
            <Icon name="trash" size={16} />
            메시지 삭제
          </button>
        </AnchoredMenu>
      ) : null}

      {lightbox !== null ? (
        <PhotoLightbox
          memoId={memo.id}
          startIndex={lightbox}
          onClose={() => setLightbox(null)}
        />
      ) : null}
    </div>
  );
}
