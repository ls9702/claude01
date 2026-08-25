import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useIsDesktop } from '../../hooks/useMediaQuery';
import { groupByDay, threadOf } from '../../memo/thread';
import { useProfileStore } from '../../profile/profile';
import { schedulePhotoGc } from '../../stores/photoGc';
import { useUiStore } from '../../stores/uiStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { flushPush } from '../../sync/syncEngine';
import type { MemoMessage } from '../../types/models';
import BackupNudge from '../common/BackupNudge';
import ConfirmDialog from '../common/ConfirmDialog';
import Icon from '../common/Icon';
import SyncStatusChip from '../common/SyncStatusChip';
import { PRIMARY_BUTTON_CLASS, SECONDARY_BUTTON_CLASS } from '../common/formStyles';
import MemoBubble from './MemoBubble';
import MemoComposer from './MemoComposer';

/** How close to the bottom still counts as "reading the newest line", in px. */
const NEAR_BOTTOM_PX = 120;

/** Shown when no trip is selected yet — same prompt the 보드 tab uses. */
function TripPrompt() {
  const workspace = useWorkspaceStore((s) => s.workspace);
  const setTab = useUiStore((s) => s.setTab);
  const setActiveTrip = useUiStore((s) => s.setActiveTrip);
  const trips = useMemo(
    () => Object.values(workspace.trips).sort((a, b) => b.createdAt - a.createdAt),
    [workspace.trips],
  );

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
                {trip.title}
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
  const removeMemoMessage = useWorkspaceStore((s) => s.removeMemoMessage);
  const activeTripId = useUiStore((s) => s.activeTripId);
  const trip = useWorkspaceStore((s) => (activeTripId ? s.workspace.trips[activeTripId] : undefined));
  const profileId = useProfileStore((s) => s.profileId);
  const isDesktop = useIsDesktop();

  const [asking, setAsking] = useState<MemoMessage | null>(null);

  const messages = useMemo(() => threadOf(memos, trip?.id), [memos, trip?.id]);
  const days = useMemo(() => groupByDay(messages), [messages]);

  const scrollerRef = useRef<HTMLDivElement | null>(null);
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
      node.scrollTop = node.scrollHeight;
      atBottom.current = true;
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
      {isDesktop ? null : <BackupNudge variant="banner" className="mx-4 mb-2" />}

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
                    <MemoBubble
                      key={memo.id}
                      memo={memo}
                      own={Boolean(profileId) && memo.by === profileId}
                      onDelete={setAsking}
                    />
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
