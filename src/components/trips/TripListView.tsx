import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { useIsDesktop } from '../../hooks/useMediaQuery';
import { useUiStore } from '../../stores/uiStore';
import { deleteWithUndo } from '../../stores/undoDelete';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import type { Id, Trip } from '../../types/models';
import { todayIso } from '../../timeline/today';
import { diffDaysIso, formatShortDate, isIsoDate } from '../../utils/flights';
import BackupNudge from '../common/BackupNudge';
import ConfirmDialog from '../common/ConfirmDialog';
import Icon from '../common/Icon';
import SyncStatusChip from '../common/SyncStatusChip';
import { PRIMARY_BUTTON_CLASS, SECONDARY_BUTTON_CLASS } from '../common/formStyles';
import TripFormDialog, { type TripFormValues } from './TripFormDialog';
import TripRecapSheet from './TripRecapSheet';

type Dialog =
  | { kind: 'create' }
  | { kind: 'edit'; trip: Trip }
  | { kind: 'delete'; trip: Trip }
  | { kind: 'recap'; trip: Trip }
  | null;

/**
 * 결산 / 수정 / 삭제 on a trip card.
 *
 * The visual disc stays 36px so three of them fit in a card's corner, but the
 * `::before` blows the *hit* area out to 44px — the finger target the phone
 * needs, without the padding the eye would have to look past (M9 §4.1-6).
 */
const TRIP_ICON_BUTTON =
  "-m-1 relative grid h-9 w-9 place-items-center rounded-full p-1 text-ink-faint " +
  "transition-colors duration-[140ms] ease-quick " +
  "before:absolute before:-inset-1 before:content-['']";

/** Trip list — the 여행 tab. Entry point to every board. */
export default function TripListView() {
  const workspace = useWorkspaceStore((s) => s.workspace);
  const addTrip = useWorkspaceStore((s) => s.addTrip);
  const updateTrip = useWorkspaceStore((s) => s.updateTrip);
  const deleteTrip = useWorkspaceStore((s) => s.deleteTrip);
  const setTab = useUiStore((s) => s.setTab);
  const setActiveTrip = useUiStore((s) => s.setActiveTrip);
  const focusCard = useUiStore((s) => s.focusCard);
  const activeTripId = useUiStore((s) => s.activeTripId);

  const [dialog, setDialog] = useState<Dialog>(null);
  const isDesktop = useIsDesktop();

  const trips = useMemo(
    () => Object.values(workspace.trips).sort((a, b) => b.createdAt - a.createdAt),
    [workspace.trips],
  );

  /** tripId → how many columns / cards it holds, for the summary line. */
  const counts = useMemo(() => {
    const acc: Record<string, { columns: number; cards: number }> = {};
    for (const trip of Object.values(workspace.trips)) acc[trip.id] = { columns: 0, cards: 0 };
    for (const column of Object.values(workspace.columns)) {
      const entry = acc[column.tripId];
      if (entry) entry.columns += 1;
    }
    for (const card of Object.values(workspace.cards)) {
      const entry = acc[card.tripId];
      if (entry) entry.cards += 1;
    }
    return acc;
  }, [workspace.trips, workspace.columns, workspace.cards]);

  /**
   * tripId → `5월 3일 ~ 5월 7일 · 5일간` (or `D-7` before it starts).
   *
   * Read straight off the dates the trip's days already carry, in exactly the
   * shape 결산 shows — a traveller wants to know *when*, and only then how much
   * of the board is filled in.
   */
  const periods = useMemo(() => {
    const byTrip: Record<Id, string[]> = {};
    for (const day of Object.values(workspace.days)) {
      if (isIsoDate(day.date)) (byTrip[day.tripId] ??= []).push(day.date);
    }
    const today = todayIso(new Date());
    const out: Record<Id, string> = {};
    for (const [tripId, dates] of Object.entries(byTrip)) {
      if (dates.length === 0) continue;
      dates.sort();
      const start = dates[0];
      const end = dates[dates.length - 1];
      const span = diffDaysIso(start, end) + 1;
      const untilStart = diffDaysIso(today, start);
      const range =
        start === end
          ? formatShortDate(start)
          : `${formatShortDate(start)} ~ ${formatShortDate(end)}`;
      out[tripId] = `${range} · ${untilStart > 0 ? `D-${untilStart}` : `${span}일간`}`;
    }
    return out;
  }, [workspace.days]);

  const openBoard = (tripId: string) => {
    setActiveTrip(tripId);
    setTab('board');
  };

  const submitDialog = (values: TripFormValues) => {
    if (dialog?.kind === 'edit') {
      updateTrip(dialog.trip.id, values);
    } else {
      const id = addTrip(values.title, values.currency);
      // `addTrip` only knows the two required fields; the 현지 통화 pair (M7b)
      // is optional, so it arrives as a patch right after.
      if (values.localCurrency && values.fxRate) {
        updateTrip(id, { localCurrency: values.localCurrency, fxRate: values.fxRate });
      }
      setActiveTrip(id);
    }
    setDialog(null);
  };

  /** 결산's Top 5 → the 보드 tab, with that card's editor already open. */
  const openCardOnBoard = (tripId: string, cardId: string) => {
    setDialog(null);
    setActiveTrip(tripId);
    focusCard(cardId);
    setTab('board');
  };

  const confirmDelete = () => {
    if (dialog?.kind !== 'delete') return;
    const { id, title } = dialog.trip;
    deleteWithUndo('trip', title, () => deleteTrip(id));
    if (activeTripId === id) setActiveTrip(undefined);
    setDialog(null);
  };

  const hasTrips = trips.length > 0;

  return (
    <section
      data-testid="view-trips"
      aria-labelledby="view-trips-title"
      className="mx-auto w-full max-w-3xl shrink-0 px-4 pb-8 pt-6 lg:max-w-5xl"
    >
      {/* The button lines up with the h1's cap height, not with the middle of
          the two-line block beside it (M9 §4.1-5). */}
      <header className="mb-6 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 id="view-trips-title" className="text-display text-ink">
            여행
          </h1>
          <p className="mt-1 text-label text-ink-muted">
            {hasTrips ? `${trips.length}개의 여행` : '아직 만든 여행이 없어요'}
          </p>
        </div>
        <div className="mt-1 flex shrink-0 items-center gap-2">
          {isDesktop ? null : <SyncStatusChip variant="dot" />}
          {/* One primary per screen: with no trips yet the card below owns it. */}
          <button
            type="button"
            data-testid="add-trip"
            onClick={() => setDialog({ kind: 'create' })}
            className={hasTrips ? PRIMARY_BUTTON_CLASS : SECONDARY_BUTTON_CLASS}
          >
            <Icon name="plus" size={16} />
            새 여행
          </button>
        </div>
      </header>

      {/* Under the h1, never over it (M9 §3.5). Desktop wears the chip in the
          top bar instead, so only one of the two ever mounts. */}
      {isDesktop ? null : <BackupNudge variant="banner" className="mb-6" />}

      {!hasTrips ? (
        <div
          data-testid="trips-empty"
          className="rounded-lg bg-surface px-6 py-12 text-center shadow-raise"
        >
          {/* The card spans the page; its *contents* do not. An invitation set
              in a 1200px-wide measure reads as a banner (M9 §4.1-4). */}
          <div className="mx-auto flex max-w-[36rem] flex-col items-center gap-3">
            <span aria-hidden="true" style={{ fontSize: 32, lineHeight: 1 }}>
              🧳
            </span>
            <p className="text-title text-ink">첫 여행을 만들어보세요</p>
            <p className="mx-auto max-w-[22rem] text-label font-normal text-ink-muted">
              여행을 만들면 이동수단 · 할일 · 식사 · 숙소 · 볼거리 카테고리가 담긴 보드가 함께
              생겨요.
            </p>
            <button
              type="button"
              data-testid="add-trip-empty"
              onClick={() => setDialog({ kind: 'create' })}
              className={`mt-2 ${PRIMARY_BUTTON_CLASS}`}
            >
              <Icon name="plus" size={16} />
              새 여행 만들기
            </button>
          </div>
        </div>
      ) : (
        // Two columns is the ceiling: a third made every card too narrow for
        // the title it exists to show (M9 §4.1-2).
        // `grid-cols-1` is not decoration: the default single `auto` track is
        // sized by its content, so one long unbreakable title widened the track
        // — and with it the page — past the viewport. `minmax(0, 1fr)` tracks
        // (what `grid-cols-*` emits) can never do that.
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {trips.map((trip) => {
            const count = counts[trip.id] ?? { columns: 0, cards: 0 };
            return (
              // `min-w-0`: a grid item's automatic minimum size is its content,
              // so without this the `truncate` on the title below never gets to
              // truncate anything (M9 §4.1-2).
              <li
                key={trip.id}
                data-testid="trip-card"
                data-trip-id={trip.id}
                className="relative min-w-0"
              >
                <button
                  type="button"
                  data-testid="trip-open"
                  onClick={() => openBoard(trip.id)}
                  className="w-full rounded-lg border border-line bg-surface px-4 py-4 pr-28 text-left shadow-raise transition-colors duration-[140ms] ease-quick hover:border-line-strong"
                >
                  <h2 className="truncate text-title text-ink">{trip.title}</h2>
                  <p data-testid="trip-period" className="mt-1 text-label text-ink-muted">
                    {periods[trip.id] ?? trip.currency}
                  </p>
                  {/* Third rank, joined by interpuncts — three grey pills were
                      three objects competing with the title (M9 §4.1-3). */}
                  <p className="mt-2 text-micro font-normal text-ink-faint">
                    카테고리 {count.columns} · 카드 {count.cards} ·{' '}
                    {format(new Date(trip.createdAt), 'yyyy.MM.dd')} 만듦
                  </p>
                </button>

                <div className="absolute right-3 top-3 flex gap-1">
                  <button
                    type="button"
                    data-testid="trip-recap-open"
                    aria-label={`${trip.title} 결산`}
                    onClick={() => setDialog({ kind: 'recap', trip })}
                    className={`${TRIP_ICON_BUTTON} hover:bg-sunken hover:text-ink`}
                  >
                    <Icon name="chart" size={16} />
                  </button>
                  <button
                    type="button"
                    data-testid="trip-edit"
                    aria-label={`${trip.title} 수정`}
                    onClick={() => setDialog({ kind: 'edit', trip })}
                    className={`${TRIP_ICON_BUTTON} hover:bg-sunken hover:text-ink`}
                  >
                    <Icon name="pencil" size={16} />
                  </button>
                  <button
                    type="button"
                    data-testid="trip-delete"
                    aria-label={`${trip.title} 삭제`}
                    onClick={() => setDialog({ kind: 'delete', trip })}
                    className={`${TRIP_ICON_BUTTON} hover:bg-danger-wash hover:text-danger`}
                  >
                    <Icon name="trash" size={16} />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {dialog?.kind === 'create' ? (
        <TripFormDialog onSubmit={submitDialog} onClose={() => setDialog(null)} />
      ) : null}

      {dialog?.kind === 'edit' ? (
        <TripFormDialog
          trip={dialog.trip}
          onSubmit={submitDialog}
          onClose={() => setDialog(null)}
        />
      ) : null}

      {dialog?.kind === 'recap' ? (
        <TripRecapSheet
          trip={dialog.trip}
          onOpenCard={(cardId) => openCardOnBoard(dialog.trip.id, cardId)}
          onClose={() => setDialog(null)}
        />
      ) : null}

      {dialog?.kind === 'delete' ? (
        <ConfirmDialog
          title={`'${dialog.trip.title}'을(를) 삭제할까요?`}
          description="이 여행의 보드 카테고리와 카드, 일정까지 모두 사라져요. 삭제 직후 10초 동안은 실행 취소할 수 있어요."
          confirmLabel="삭제"
          onConfirm={confirmDelete}
          onCancel={() => setDialog(null)}
          testId="trip-delete-confirm"
        />
      ) : null}
    </section>
  );
}
