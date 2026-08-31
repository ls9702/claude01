import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useIsDesktop } from '../../hooks/useMediaQuery';
import { clearMemoDraft, loadMemoDraft, saveMemoDraft } from '../../stores/memoDraft';
import { deletePhotoBlobs, putPhotoBlob, usePhotoUrl } from '../../stores/photoBlobs';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { flushPush } from '../../sync/syncEngine';
import type { CardPhoto, Id } from '../../types/models';
import { newId } from '../../utils/ids';
import { preparePhoto } from '../../utils/photos';
import Icon from '../common/Icon';
import {
  PRIMARY_BUTTON_CLASS,
  SQUARE_BUTTON_CLASS,
  TEXTAREA_CLASS,
  withoutMarginTop,
} from '../common/formStyles';

/**
 * How many photos may ride one message.
 *
 * A UI limit, not a store rule (`addMemoMessage` takes what it is given): a
 * bubble stops reading as a bubble somewhere past a couple of rows of tiles,
 * and a chat line is a remark, not an album. The per-card cap stays its own
 * number for its own reason.
 */
export const MAX_PHOTOS_PER_MESSAGE = 6;

const FULL_MESSAGE = `사진은 한 번에 ${MAX_PHOTOS_PER_MESSAGE}장까지예요`;
const SAVE_FAILED_MESSAGE = '사진을 저장하지 못했어요';
const READ_FAILED_MESSAGE = '사진을 읽지 못했어요';

/** Tallest the input grows before it starts scrolling inside itself. */
const MAX_INPUT_PX = 128;

/** A staged photo: bytes already written, metadata not yet committed. */
function StagedThumb({ photo, onRemove }: { photo: CardPhoto; onRemove: () => void }) {
  const url = usePhotoUrl(photo.id);

  return (
    <span
      data-testid="memo-staged-photo"
      data-photo-id={photo.id}
      className="relative block h-14 w-14 shrink-0 overflow-hidden rounded-md bg-sunken"
    >
      {url ? <img src={url} alt="" className="h-full w-full object-cover" /> : null}
      <button
        type="button"
        data-testid="memo-staged-remove"
        aria-label="첨부 취소"
        onClick={onRemove}
        className="absolute right-0 top-0 grid h-6 w-6 place-items-center rounded-bl-md bg-ink/60 text-surface transition-colors duration-[140ms] ease-quick hover:bg-ink/80"
      >
        <Icon name="close" size={16} />
      </button>
    </span>
  );
}

/**
 * 메모 입력 줄 (M21) — 사진 첨부 · 입력 · 보내기, pinned under the thread.
 *
 * Photos are **staged**, not sent on pick, so one message can carry a picture
 * and the sentence about it. What is not staged is the *bytes*: those go into
 * the blob store the moment the file is chosen, under an id this component
 * generates, exactly as `CardPhotoStrip` does it — compress → write bytes →
 * only then commit metadata. The order is what guarantees metadata never
 * points at pixels that are not there; the reverse (bytes nobody references)
 * is the harmless side, and `photoGc` sweeps it, which is also what happens to
 * a staged photo the user never sends.
 *
 * Files are processed one at a time — a decoded 12MP bitmap is tens of
 * megabytes, and five at once is how a mobile tab gets killed.
 */
export default function MemoComposer({ tripId, onSent }: { tripId: Id; onSent: () => void }) {
  const addMemoMessage = useWorkspaceStore((s) => s.addMemoMessage);
  const isDesktop = useIsDesktop();

  /**
   * 초안은 컴포넌트보다 오래 산다 (M50, `stores/memoDraft.ts`).
   *
   * 이 컴포넌트는 메모 탭에서만 마운트되므로, 상태로만 들고 있으면 탭을 한 번
   * 다녀오는 것이 곧 「쓰던 것 버리기」였다 — 붙여 둔 사진까지 함께.
   */
  const [text, setText] = useState(() => loadMemoDraft(tripId).text);
  const [staged, setStaged] = useState<CardPhoto[]>(() => loadMemoDraft(tripId).staged);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  /** Guards `setState` after the tab was switched mid-compression. */
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  /**
   * 바뀔 때마다 갈무리해 둔다 (M50).
   *
   * 언마운트 때 한 번만 쓰면 안 된다: 그 시점의 클로저가 낡아 있을 수 있고,
   * 무엇보다 탭 전환은 언마운트를 **동기적으로** 부르지 않는 경로(라우팅
   * 애니메이션)도 지난다. 매 변화를 적어 두면 어느 길로 사라져도 마지막
   * 상태가 남아 있다.
   */
  useEffect(() => {
    saveMemoDraft(tripId, { text, staged });
  }, [tripId, text, staged]);

  /** 여행을 바꾸면 그 여행의 초안으로 갈아탄다 — 남의 통을 이어 쓰지 않는다. */
  const loadedTrip = useRef(tripId);
  if (loadedTrip.current !== tripId) {
    loadedTrip.current = tripId;
    const next = loadMemoDraft(tripId);
    setText(next.text);
    setStaged(next.staged);
  }

  /** One line by default, growing with the message, capped so the thread stays. */
  const grow = (): void => {
    const node = inputRef.current;
    if (!node) return;
    node.style.height = 'auto';
    node.style.height = `${Math.min(node.scrollHeight, MAX_INPUT_PX)}px`;
  };

  const full = staged.length >= MAX_PHOTOS_PER_MESSAGE;
  const canSend = !busy && (text.trim() !== '' || staged.length > 0);

  const addFiles = async (files: File[]): Promise<void> => {
    if (files.length === 0) return;
    setBusy(true);
    setError(null);

    const added: CardPhoto[] = [];
    let problem: string | null = null;

    for (const file of files) {
      if (staged.length + added.length >= MAX_PHOTOS_PER_MESSAGE) {
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
      added.push({
        id,
        w: prepared.w,
        h: prepared.h,
        bytes: prepared.bytes,
        // Overwritten by nothing: this is when the picture was taken *into*
        // the app, and the message keeps its own `createdAt` separately.
        createdAt: Date.now(),
      });
    }

    if (!live.current) {
      // Nobody is left to send them — hand the bytes back rather than leaving
      // the sweeper to find them.
      if (added.length > 0) void deletePhotoBlobs(added.map((photo) => photo.id));
      return;
    }
    if (added.length > 0) setStaged((current) => [...current, ...added]);
    setBusy(false);
    setError(problem);
  };

  /**
   * 붙여넣기 (desktop, M26) — a screenshot in the clipboard lands as a staged
   * photo, exactly as `CardPhotoStrip` does it. Bound on `window` (the file
   * picker cannot see the clipboard, and the user's focus may be anywhere in
   * the view), only while the composer is mounted — which is only ever the
   * 메모 tab. A text paste has no files and passes through untouched.
   */
  useEffect(() => {
    const onPaste = (event: ClipboardEvent): void => {
      if (busy) return;
      const files = [...(event.clipboardData?.files ?? [])].filter((file) =>
        file.type.startsWith('image/'),
      );
      if (files.length === 0) return;
      event.preventDefault();
      void addFiles(files);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
    // Re-bound whenever the handler's closure would go stale (same call as
    // CardPhotoStrip — `addFiles` reads `staged`).
  });

  const unstage = (photoId: Id): void => {
    setStaged((current) => current.filter((photo) => photo.id !== photoId));
    // Never committed anywhere, so the bytes go straight back out.
    void deletePhotoBlobs([photoId]);
    setError(null);
  };

  const send = (): void => {
    if (!canSend) return;
    const photos = staged;
    const sent = addMemoMessage(tripId, { text, photos });
    if (!sent) {
      // The trip vanished (deleted on the other device, mid-sync) — roll the
      // staged bytes back instead of orphaning them.
      if (photos.length > 0) void deletePhotoBlobs(photos.map((photo) => photo.id));
      setError('메시지를 보내지 못했어요');
      return;
    }
    setText('');
    setStaged([]);
    setError(null);
    // 보냈으므로 초안도 없다 — 위 이펙트가 곧 같은 일을 하지만, 보내기와 비우기
    // 사이에 다른 렌더가 끼어들 자리를 두지 않는다.
    clearMemoDraft(tripId);
    // Past the store's door, the message is ordinary workspace data and would
    // ride the 4초 debounce like any edit. A chat cannot afford that: 보내기 is
    // a finished thought and the other person is waiting for it, so the push is
    // asked for now (M22). The store stays transport-ignorant — this is the UI
    // saying "that one was urgent", which only the UI knows.
    void flushPush();
    // The height was grown to fit a message that is no longer there.
    requestAnimationFrame(grow);
    onSent();
  };

  /**
   * Enter sends **on a desktop only**, where the keyboard has a Shift to hold
   * for a newline. On a phone the on-screen return key is the only way to get
   * a second line, and stealing it would make multi-line messages impossible.
   *
   * An Enter that lands **while the IME is still composing** is not a send
   * (M23). 한글 is typed syllable by syllable, and committing the one under
   * construction fires a keydown of its own — honouring it sent the message
   * *minus* its last syllable, which then arrived alone as a second bubble
   * ("…있어요" + "오"). `isComposing` is the standards answer; `keyCode 229`
   * catches the browsers that report composition that way instead.
   */
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (!isDesktop || event.key !== 'Enter' || event.shiftKey) return;
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    send();
  };

  return (
    <div
      data-testid="memo-composer"
      className="shrink-0 border-t border-line bg-surface px-4 pb-3 pt-2"
    >
      {staged.length > 0 ? (
        <div className="mb-2 flex gap-2 overflow-x-auto pb-1">
          {staged.map((photo) => (
            <StagedThumb key={photo.id} photo={photo} onRemove={() => unstage(photo.id)} />
          ))}
        </div>
      ) : null}

      <div className="flex items-end gap-2">
        {/* A `<label>` wrapping a hidden input, not a button that clicks one:
            the one form that works in every mobile WebView. No `capture`
            attribute, deliberately — it would pin the picker to the camera and
            take 앨범 away on some Androids (same call as `CardPhotoStrip`). */}
        <label
          data-testid="memo-photo-add"
          data-busy={busy ? 'true' : 'false'}
          aria-disabled={busy || full}
          title="사진 첨부"
          className={`${SQUARE_BUTTON_CLASS} ${
            busy || full ? 'cursor-not-allowed text-ink-faint' : 'cursor-pointer'
          }`}
        >
          <Icon name="camera" size={20} label="사진 첨부" />
          <input
            data-testid="memo-photo-input"
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

        <textarea
          ref={inputRef}
          data-testid="memo-input"
          aria-label="메시지"
          rows={1}
          value={text}
          placeholder="메시지 입력"
          onChange={(event) => {
            setText(event.target.value);
            grow();
          }}
          onKeyDown={onKeyDown}
          className={`${withoutMarginTop(TEXTAREA_CLASS)} min-h-11 min-w-0 flex-1`}
        />

        <button
          type="button"
          data-testid="memo-send"
          onClick={send}
          disabled={!canSend}
          className={`${PRIMARY_BUTTON_CLASS} shrink-0`}
        >
          보내기
        </button>
      </div>

      {error ? (
        <p data-testid="memo-composer-error" className="mt-2 text-micro font-normal text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
