import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useIsDesktop } from '../../hooks/useMediaQuery';
import { groupByDay, threadOf } from '../../memo/thread';
import { useProfileStore } from '../../profile/profile';
import { firstUnreadIndex, latestSeenStamp, memoReadKey, unreadMemos } from '../../read/readState';
import { schedulePhotoGc } from '../../stores/photoGc';
import { useUiStore } from '../../stores/uiStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { flushPush } from '../../sync/syncEngine';
import type { Id, MemoMessage } from '../../types/models';
import ConfirmDialog from '../common/ConfirmDialog';
import Icon from '../common/Icon';
import SyncStatusChip from '../common/SyncStatusChip';
import {
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
  UNREAD_DOT_CLASS,
} from '../common/formStyles';
import MemoBubble from './MemoBubble';
import MemoComposer from './MemoComposer';

/** How close to the bottom still counts as "reading the newest line", in px. */
const NEAR_BOTTOM_PX = 120;

/** 「여기까지 읽었어요」 — 안 읽은 첫 줄 바로 위에 서는 가로선. */
function UnreadDivider() {
  return (
    <div data-testid="memo-unread-divider" className="my-3 flex items-center gap-2">
      <span aria-hidden="true" className="h-px flex-1 bg-now/40" />
      <span className="shrink-0 text-micro text-now">여기까지 읽었어요</span>
      <span aria-hidden="true" className="h-px flex-1 bg-now/40" />
    </div>
  );
}

/** Shown when no trip is selected yet — same prompt the 보드 tab uses. */
function TripPrompt() {
  const workspace = useWorkspaceStore((s) => s.workspace);
  const profileId = useProfileStore((s) => s.profileId);
  const setTab = useUiStore((s) => s.setTab);
  const setActiveTrip = useUiStore((s) => s.setActiveTrip);
  const trips = useMemo(
    () => Object.values(workspace.trips).sort((a, b) => b.createdAt - a.createdAt),
    [workspace.trips],
  );
  // 탭 배지는 「어딘가에 있다」까지만 말한다. 고르는 화면이 그 「어디」다.
  const unread = useMemo(() => unreadMemos(workspace, profileId).byTrip, [workspace, profileId]);

  return (
    <section
      data-testid="view-memo"
      className="mx-auto flex w-full max-w-md shrink-0 flex-col items-center gap-4 px-6 pb-16 pt-12 text-center"
    >
      <Icon name="chat" size={24} className="text-ink-faint" />
      <h1 className="shrink-0 whitespace-nowrap text-title text-ink">메모</h1>
      <p className="text-label font-normal text-ink-muted">
        {trips.length > 0 ? '어떤 여행의 메모를 열까요?' : '먼저 여행을 만들면 메모가 열려요.'}
      </p>

      {trips.length > 0 ? (
        <ul data-testid="memo-trip-picker" className="mt-1 w-full space-y-2">
          {trips.map((trip) => (
            <li key={trip.id}>
              <button
                type="button"
                data-testid="memo-trip-option"
                data-trip-id={trip.id}
                onClick={() => setActiveTrip(trip.id)}
                className={`${SECONDARY_BUTTON_CLASS} w-full justify-start`}
              >
                <span className="min-w-0 flex-1 truncate text-left">{trip.title}</span>
                {(unread[trip.id] ?? 0) > 0 ? (
                  <span
                    data-testid="memo-trip-unread"
                    data-trip-id={trip.id}
                    data-count={unread[trip.id]}
                    title={`안 읽은 메모 ${unread[trip.id]}개`}
                    className={UNREAD_DOT_CLASS}
                  />
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <button
          type="button"
          data-testid="memo-goto-trips"
          onClick={() => setTab('trips')}
          className={PRIMARY_BUTTON_CLASS}
        >
          여행 만들러 가기
        </button>
      )}
    </section>
  );
}

/**
 * 메모 탭 (M21) — the trip's conversation, newest at the bottom.
 *
 * A chat rather than a note pad because that is what two people planning one
 * trip actually do with a shared text box: "여기 어때?" with a photo under it.
 * Everything it holds is ordinary synced workspace data — messages are
 * entities that merge per id, and photos ride the same idb-blob + `image.php`
 * pipeline a card's do — so a line typed on one phone appears on the other
 * without this file knowing anything about sync at all.
 *
 * The scroll rule is the one piece of behaviour worth stating: the thread
 * sticks to the bottom **only while the reader is already there** (or has just
 * sent something themselves). Scrolling up through last night's plan and being
 * yanked back down because the other person typed is the thing a chat must not
 * do.
 */
export default function MemoView() {
  const memos = useWorkspaceStore((s) => s.workspace.memos);
  const seenBy = useWorkspaceStore((s) => s.workspace.seenBy);
  const removeMemoMessage = useWorkspaceStore((s) => s.removeMemoMessage);
  const markRead = useWorkspaceStore((s) => s.markRead);
  const activeTripId = useUiStore((s) => s.activeTripId);
  const trip = useWorkspaceStore((s) => (activeTripId ? s.workspace.trips[activeTripId] : undefined));
  const profileId = useProfileStore((s) => s.profileId);
  const isDesktop = useIsDesktop();

  const [asking, setAsking] = useState<MemoMessage | null>(null);

  const messages = useMemo(() => threadOf(memos, trip?.id), [memos, trip?.id]);
  const days = useMemo(() => groupByDay(messages), [messages]);

  const readKey = trip && profileId ? memoReadKey(trip.id, profileId) : null;

  /**
   * 「여기까지 읽었어요」가 붙을 메시지 — **이 방문이 시작될 때 한 번** 정한다.
   *
   * 아래의 읽음 표시 이펙트는 화면을 여는 순간 곧바로 찍는다. 구분선을 매
   * 렌더 다시 계산하면 그 표시가 자기 근거를 지워버려서, 선이 뜨자마자
   * 사라진다. 그래서 열린 시점의 stamp와 그때의 스레드로 한 번 정하고 방문이
   * 끝날 때까지 붙들고 있는다 — 보는 동안 새로 온 줄이 선을 움직이지도 않는다
   * (내가 보고 있는 앞에서 온 줄은 「안 읽은 줄」이 아니다). 다음에 다시 열면
   * 선은 없다.
   */
  const visit = useRef<{ key: string; dividerId: Id | null } | null>(null);
  if (readKey === null) {
    visit.current = null;
  } else if (visit.current?.key !== readKey) {
    const index = firstUnreadIndex(messages, seenBy?.[readKey] ?? 0, profileId);
    visit.current = { key: readKey, dividerId: index < 0 ? null : messages[index].id };
  }
  const dividerId = visit.current?.dividerId ?? null;

  /**
   * 스레드가 눈앞에 있는 동안 읽은 지점을 워크스페이스에 남긴다 (M24).
   *
   * 마운트할 때, 여행을 바꿀 때, 보는 중에 새 줄이 올 때마다 돈다. 그래도
   * 트래픽이 되지 않는 건 `markRead`가 **앞으로만 가기** 때문이다 — 같은 값을
   * 다시 찍는 호출은 워크스페이스를 dirty로 만들지 않는다. 찍는 값이
   * `Date.now()`가 아니라 스레드의 마지막 `createdAt`인 이유는
   * `read/readState`에 적어두었다(두 사람의 시계는 서로 다르다).
   */
  useEffect(() => {
    if (!readKey) return;
    const stamp = (): void => {
      // 백그라운드 탭에서 도착한 줄은 읽은 것이 아니다.
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      const at = latestSeenStamp(messages);
      if (at > 0) markRead(readKey, at);
    };

    stamp();
    if (typeof document === 'undefined') return;
    document.addEventListener('visibilitychange', stamp);
    return () => document.removeEventListener('visibilitychange', stamp);
  }, [readKey, messages, markRead]);

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  /** The divider node, while this visit has one — the first scroll aims at it. */
  const dividerRef = useRef<HTMLDivElement | null>(null);
  /** Was the reader at the bottom before this render? Starts true (on mount). */
  const atBottom = useRef(true);
  /** The last message id this view has already scrolled for. */
  const lastSeen = useRef<string | null | undefined>(undefined);
  /** Set by the composer: my own send always wins the scroll. */
  const forceScroll = useRef(false);

  const onScroll = (): void => {
    const node = scrollerRef.current;
    if (!node) return;
    atBottom.current = node.scrollHeight - node.clientHeight - node.scrollTop < NEAR_BOTTOM_PX;
  };

  // Before paint, so the thread is never seen at the wrong offset.
  useLayoutEffect(() => {
    const node = scrollerRef.current;
    if (!node) return;
    const newest = messages.at(-1)?.id ?? null;
    const first = lastSeen.current === undefined;
    if (!first && newest === lastSeen.current) return;
    lastSeen.current = newest;

    if (first || forceScroll.current || atBottom.current) {
      // 안 읽은 줄을 안고 열렸다면 맨 아래가 아니라 그 경계에서 멈춘다 —
      // 「여기까지 읽었어요」는 보라고 그은 선이다. 그 뒤로는 평소대로,
      // 바닥에 붙어 있을 때만 따라 내려간다.
      const divider = first ? dividerRef.current : null;
      if (divider) {
        const offset =
          divider.getBoundingClientRect().top - node.getBoundingClientRect().top + node.scrollTop;
        node.scrollTop = Math.max(0, offset - 48);
        atBottom.current =
          node.scrollHeight - node.clientHeight - node.scrollTop < NEAR_BOTTOM_PX;
      } else {
        node.scrollTop = node.scrollHeight;
        atBottom.current = true;
      }
    }
    forceScroll.current = false;
  }, [messages]);

  // Switching trips is a different conversation: open it at its newest line.
  useEffect(() => {
    lastSeen.current = undefined;
    atBottom.current = true;
  }, [trip?.id]);

  if (!trip) return <TripPrompt />;

  const confirmDelete = (): void => {
    const memo = asking;
    setAsking(null);
    if (!memo) return;
    removeMemoMessage(memo.id);
    // Urgent for the same reason a send is (M22): a line taken back should stop
    // being readable on the other phone now, not four seconds from now.
    void flushPush();
    // The delete stripped the message's photo ids, so those bytes are now
    // unreferenced — book the sweep that reclaims them (and the copy on the
    // NAS behind it). It re-checks references before deleting anything.
    schedulePhotoGc();
  };

  return (
    <section
      data-testid="view-memo"
      aria-labelledby="view-memo-title"
      // One flex column: the thread takes whatever the header and the composer
      // leave over, and the composer sits above the fixed tab bar because the
      // app shell already pads for it (§S6, same shape as 일정 / 지도).
      className="flex min-h-0 flex-1 flex-col"
    >
      <header className="flex shrink-0 items-center gap-3 px-4 pb-3 pt-4 lg:pb-4 lg:pt-6">
        <div className="min-w-0">
          {/* 제목은 줄바꿈되지 않는다 (M18 §1). */}
          <h1 id="view-memo-title" className="shrink-0 whitespace-nowrap text-display text-ink">
            메모
          </h1>
          <p data-testid="memo-trip-title" className="mt-1 min-w-0 truncate text-label text-ink-muted">
            {trip.title}
          </p>
        </div>
        {isDesktop ? null : (
          <span className="ml-auto flex shrink-0 items-center gap-1">
            <SyncStatusChip variant="dot" />
          </span>
        )}
      </header>

      {/* Under the h1, never over it (M9 §3.5). */}

      <div
        ref={scrollerRef}
        onScroll={onScroll}
        data-testid="memo-thread"
        data-count={messages.length}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-3"
      >
        <div className="mx-auto w-full max-w-2xl">
          {messages.length === 0 ? (
            <p
              data-testid="memo-empty"
              className="mt-8 rounded-lg bg-sunken px-4 py-6 text-center text-label font-normal text-ink-faint"
            >
              첫 메시지를 남겨보세요.
            </p>
          ) : (
            days.map((day) => (
              <div key={day.date}>
                {/* The date chip is a separator, not a heading: it belongs to
                    the run under it and scrolls away with it. */}
                <div className="my-3 flex justify-center">
                  <span
                    data-testid="memo-day"
                    data-date={day.date}
                    className="rounded-full bg-sunken px-3 py-1 text-micro font-normal text-ink-muted"
                  >
                    {day.label}
                  </span>
                </div>
                <div className="space-y-2">
                  {day.messages.map((memo) => (
                    <div key={memo.id}>
                      {memo.id === dividerId ? (
                        <div ref={dividerRef}>
                          <UnreadDivider />
                        </div>
                      ) : null}
                      <MemoBubble
                        memo={memo}
                        own={Boolean(profileId) && memo.by === profileId}
                        onDelete={setAsking}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <MemoComposer
        tripId={trip.id}
        onSent={() => {
          forceScroll.current = true;
        }}
      />

      {asking ? (
        <ConfirmDialog
          title="이 메시지를 삭제할까요?"
          description="상대방 화면에서도 「삭제된 메시지」로 바뀌어요."
          onConfirm={confirmDelete}
          onCancel={() => setAsking(null)}
          testId="memo-delete-confirm"
        />
      ) : null}
    </section>
  );
}
