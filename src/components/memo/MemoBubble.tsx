import { useEffect, useRef, useState } from 'react';
import { isProfileId, useProfileDef } from '../../profile/profile';
import { usePhotoUrl } from '../../stores/photoBlobs';
import { memoClock, isRemoved } from '../../memo/thread';
import type { CardPhoto, MemoMessage } from '../../types/models';
import AnchoredMenu from '../common/AnchoredMenu';
import Avatar from '../common/Avatar';
import Icon from '../common/Icon';
import PhotoLightbox from '../common/PhotoLightbox';
import { POPOVER_ROW_CLASS, POPOVER_ROW_DANGER_CLASS } from '../common/formStyles';
import { copyText } from '../../utils/clipboard';

/** Frozen copy the e2e suite reads. */
export const REMOVED_TEXT = '삭제된 메시지예요';
export const COPIED_TEXT = '복사했어요';
export const COPY_FAILED_TEXT = '복사하지 못했어요';

/**
 * How long a finger has to rest on one's own bubble before the delete menu
 * opens (M23). Longer than a tap, shorter than dnd-kit's 250ms would feel
 * here — 500ms is what messengers have trained thumbs to expect.
 */
export const LONG_PRESS_MS = 500;

/** 「복사했어요」가 떠 있는 시간 (M55) — 읽을 만큼, 방해하지 않을 만큼. */
export const COPIED_MS = 1600;

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
 * left to delete. It opens two ways (M23): the ⋯ button, and — because that is
 * what a decade of messengers has taught every thumb — **길게 누르기** on the
 * bubble itself. The long press is a timer on the touch events plus a
 * `contextmenu` handler (Android fires one mid-press; on a mouse it doubles as
 * right-click), and one's own live bubble is `select-none` so the browser's
 * text-selection callout does not fight the menu for the same gesture.
 */
export default function MemoBubble({ memo, own, onDelete }: MemoBubbleProps) {
  /** The element the menu hangs off — doubles as the open flag. */
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const menuOpen = menuAnchor !== null;

  const removed = isRemoved(memo);
  const photos = memo.photos ?? [];
  const author = useProfileDef(isProfileId(memo.by) ? memo.by : 'song');
  const authorLabel = isProfileId(memo.by) ? author.label : null;
  /** 지울 수 있는 것은 **내** 살아 있는 메시지뿐이다. */
  const deletable = own && !removed;
  /**
   * 복사할 수 있는 것은 글이 있는 살아 있는 메시지 — **누구의 것이든** (M55).
   *
   * M23~M54까지 메뉴는 내 말풍선에만 있었다(지울 것이 그것뿐이라). 복사는
   * 반대다: 옮겨 적고 싶은 것은 대개 상대가 보낸 주소·가게 이름이다. 그래서
   * 메뉴 자체는 글이 있는 모든 줄에 열리고, 그 안의 줄이 사람에 따라 다르다.
   * 사진만 있는 줄은 복사할 글이 없으니 내 것일 때만(삭제) 메뉴가 선다.
   */
  const copyable = !removed && Boolean(memo.text);
  const hasMenu = deletable || copyable;

  /** 방금 복사가 됐는가 — 잠깐 「복사했어요」를 띄우고 스스로 내려간다. */
  const [copied, setCopied] = useState<'ok' | 'fail' | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
    },
    [],
  );
  const copyMessage = async (): Promise<void> => {
    const ok = await copyText(memo.text ?? '');
    setCopied(ok ? 'ok' : 'fail');
    if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => {
      copiedTimer.current = null;
      setCopied(null);
    }, COPIED_MS);
  };

  /**
   * 이번 누름이 **길게 눌러 메뉴를 연** 누름인가 (M50, 헌터M2 #2).
   *
   * 손을 떼면 브라우저는 길게 눌렀든 짧게 눌렀든 `click`을 하나 낸다. 사진
   * 타일 위에서 길게 누르면 타이머가 메뉴를 열고, 뒤이어 도착한 그 `click`이
   * 라이트박스까지 열어 「삭제할까요」 메뉴와 전체화면 사진이 동시에 떴다.
   *
   * 그래서 메뉴를 연 누름은 자기 뒤에 오는 클릭 하나를 삼킨다. 다음 누름이
   * 시작될 때 깃발이 내려가므로, 짧은 탭은 지금까지처럼 사진을 연다.
   */
  const longPressed = useRef(false);

  const cancelPress = (): void => {
    if (pressTimer.current === null) return;
    clearTimeout(pressTimer.current);
    pressTimer.current = null;
  };
  const startPress = (): void => {
    cancelPress();
    longPressed.current = false;
    pressTimer.current = setTimeout(() => {
      pressTimer.current = null;
      longPressed.current = true;
      setMenuAnchor(bubbleRef.current);
    }, LONG_PRESS_MS);
  };
  // A bubble unmounted mid-press (the message just synced away) must not fire.
  useEffect(() => cancelPress, []);

  const bubbleClass = [
    'w-fit max-w-[16rem] rounded-lg px-3 py-2 text-label font-normal sm:max-w-md',
    // 메뉴가 있는 말풍선은 `select-none`이다 — 길게 누르면 브라우저의 글자
    // 선택이 아니라 **우리 메뉴**가 떠야 하니까(M55부터는 상대의 말풍선도).
    hasMenu ? 'select-none' : '',
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
          <div
            ref={bubbleRef}
            data-testid="memo-bubble"
            className={bubbleClass}
            {...(hasMenu
              ? {
                  onTouchStart: startPress,
                  onTouchMove: cancelPress,
                  onTouchEnd: cancelPress,
                  onTouchCancel: cancelPress,
                  onContextMenu: (event) => {
                    event.preventDefault();
                    cancelPress();
                    setMenuAnchor(bubbleRef.current);
                  },
                }
              : {})}
          >
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
                        // 메뉴를 연 롱프레스가 남긴 클릭은 여기서 멈춘다.
                        onOpen={() => {
                          if (longPressed.current) {
                            longPressed.current = false;
                            return;
                          }
                          setLightbox(index);
                        }}
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

          {hasMenu ? (
            <button
              type="button"
              ref={buttonRef}
              data-testid="memo-msg-menu"
              data-memo-id={memo.id}
              aria-label={deletable ? '메시지 메뉴 (복사·삭제)' : '메시지 메뉴 (복사)'}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuAnchor((open) => (open ? null : buttonRef.current))}
              // 44px on a phone, M9's smaller square on a mouse-driven desktop.
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-ink-faint transition-colors duration-[140ms] ease-quick hover:bg-sunken hover:text-ink lg:h-8 lg:w-8"
            >
              <Icon name="more" size={16} />
            </button>
          ) : null}
        </div>

        {/* 복사 결과 — 시간 도장 아래 한 줄, 잠깐 (M55). 토스트로 띄우지 않는
            이유는 어느 줄을 복사했는지가 그 줄 곁에 있어야 보이기 때문이다. */}
        {copied ? (
          <span
            role="status"
            data-testid="memo-copied"
            data-result={copied}
            className={`mt-1 text-micro ${copied === 'ok' ? 'text-ink-muted' : 'text-danger'}`}
          >
            {copied === 'ok' ? COPIED_TEXT : COPY_FAILED_TEXT}
          </span>
        ) : null}
      </div>

      {menuOpen ? (
        <AnchoredMenu
          anchor={menuAnchor}
          testId="memo-msg-menu-panel"
          onClose={() => setMenuAnchor(null)}
        >
          {copyable ? (
            <button
              type="button"
              data-testid="memo-msg-copy"
              onClick={() => {
                setMenuAnchor(null);
                void copyMessage();
              }}
              className={POPOVER_ROW_CLASS}
            >
              <Icon name="copy" size={16} />
              메시지 복사
            </button>
          ) : null}
          {deletable ? (
            <button
              type="button"
              data-testid="memo-msg-delete"
              onClick={() => {
                setMenuAnchor(null);
                onDelete(memo);
              }}
              className={POPOVER_ROW_DANGER_CLASS}
            >
              <Icon name="trash" size={16} />
              메시지 삭제
            </button>
          ) : null}
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
