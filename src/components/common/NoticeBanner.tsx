import { useState } from 'react';
import { useServerStateStore } from '../../stores/serverState';
import { loadDismissedNotice, saveDismissedNotice, shouldShowNotice } from '../../sync/notice';
import Icon from './Icon';

/**
 * 공지 (M47) — the administrator's one line, above every tab.
 *
 * The two people using this app are not in the same room and do not read the
 * same chat. "내일 아침에 서버 껐다 켤게요" had nowhere to live: the 메모 탭 is
 * the trip's conversation and a message there scrolls away in an hour.
 *
 * Neutral, never alarming. It sits exactly where {@link PersistBanner} sits and
 * looks nothing like it, because that one means *your data is not being saved*
 * and this one means *someone left you a note*. A warning tone here would spend
 * the alarm the other banner needs.
 *
 * Dismissal is per device and keyed by the **text** (`sync/notice`): closing it
 * closes this notice, and a different sentence is a different notice. Nothing
 * about it travels to the server — the administrator posts once and takes it
 * down when it stops being true, rather than watching who has read it.
 *
 * ## 보관 (read-only) rides along
 *
 * A second, quieter line for the state where pushes are being refused with 423.
 * It belongs here rather than on the sync chip because the chip is a dot in a
 * corner and this is something the user has to *know*: what they type is
 * staying on this phone. Not dismissible — unlike a 공지 it is not news, it is
 * a condition, and it goes away by itself when the administrator unlocks it.
 */
export default function NoticeBanner() {
  const notice = useServerStateStore((s) => s.notice);
  const locked = useServerStateStore((s) => s.locked);
  const [dismissed, setDismissed] = useState<string | null>(() => loadDismissedNotice());

  const showNotice = shouldShowNotice(notice, dismissed);
  if (!showNotice && !locked) return null;

  const close = (): void => {
    const text = notice?.text ?? '';
    if (text === '') return;
    saveDismissedNotice(text);
    setDismissed(text);
  };

  return (
    <div className="mx-4 mt-3 shrink-0 space-y-2">
      {showNotice && notice ? (
        <div
          role="status"
          data-testid="notice-banner"
          className="flex items-center gap-3 rounded-md border border-line bg-sunken px-3 py-2 text-label text-ink-muted"
        >
          <Icon name="info" size={16} className="shrink-0 text-ink-faint" />
          <p className="min-w-0 flex-1 whitespace-pre-wrap break-words">{notice.text}</p>
          <button
            type="button"
            data-testid="notice-banner-close"
            aria-label="공지 닫기"
            onClick={close}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-ink-faint transition-colors duration-[140ms] ease-quick hover:bg-line hover:text-ink"
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      ) : null}

      {locked ? (
        <p
          role="status"
          data-testid="session-locked-banner"
          className="flex items-center gap-2 rounded-md border border-line bg-sunken px-3 py-2 text-micro font-normal text-ink-muted"
        >
          <Icon name="lock" size={16} className="shrink-0 text-ink-faint" />
          보관된 세션이에요 — 읽기 전용이라 변경한 내용은 서버에 저장되지 않아요.
        </p>
      ) : null}
    </div>
  );
}
