import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { useUiStore } from '../../stores/uiStore';
import { deleteWithUndo } from '../../stores/undoDelete';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import type { Trip } from '../../types/models';
import ConfirmDialog from '../common/ConfirmDialog';
import TripFormDialog, { type TripFormValues } from './TripFormDialog';

type Dialog =
  | { kind: 'create' }
  | { kind: 'edit'; trip: Trip }
  | { kind: 'delete'; trip: Trip }
  | null;

/** Trip list — the 여행 tab. Entry point to every board. */
export default function TripListView() {
  const workspace = useWorkspaceStore((s) => s.workspace);
  const addTrip = useWorkspaceStore((s) => s.addTrip);
  const updateTrip = useWorkspaceStore((s) => s.updateTrip);
  const deleteTrip = useWorkspaceStore((s) => s.deleteTrip);
  const setTab = useUiStore((s) => s.setTab);
  const setActiveTrip = useUiStore((s) => s.setActiveTrip);
  const activeTripId = useUiStore((s) => s.activeTripId);

  const [dialog, setDialog] = useState<Dialog>(null);

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

  const openBoard = (tripId: string) => {
    setActiveTrip(tripId);
    setTab('board');
  };

  const submitDialog = (values: TripFormValues) => {
    if (dialog?.kind === 'edit') {
      updateTrip(dialog.trip.id, values);
    } else {
      const id = addTrip(values.title, values.currency);
      setActiveTrip(id);
    }
    setDialog(null);
  };

  const confirmDelete = () => {
    if (dialog?.kind !== 'delete') return;
    const { id, title } = dialog.trip;
    deleteWithUndo('trip', title, () => deleteTrip(id));
    if (activeTripId === id) setActiveTrip(undefined);
    setDialog(null);
  };

  return (
    <section
      data-testid="view-trips"
      aria-labelledby="view-trips-title"
      className="mx-auto max-w-3xl px-4 pb-8 pt-5 lg:max-w-5xl lg:pt-8"
    >
      <header className="mb-5 flex items-center justify-between gap-3">
        <div>
          <h1 id="view-trips-title" className="text-2xl font-bold tracking-tight text-stone-800">
            여행
          </h1>
          <p className="mt-0.5 text-sm text-stone-400">
            {trips.length > 0 ? `${trips.length}개의 여행` : '아직 만든 여행이 없어요'}
          </p>
        </div>
        <button
          type="button"
          data-testid="add-trip"
          onClick={() => setDialog({ kind: 'create' })}
          className="rounded-full bg-stone-800 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-stone-900"
        >
          ＋ 새 여행
        </button>
      </header>

      {trips.length === 0 ? (
        <div
          data-testid="trips-empty"
          className="mt-10 flex flex-col items-center gap-3 rounded-2xl border border-dashed border-stone-200 bg-white/60 px-6 py-14 text-center"
        >
          <span aria-hidden="true" className="text-4xl">
            🧳
          </span>
          <p className="text-base font-semibold text-stone-700">첫 여행을 만들어보세요 ✈️</p>
          <p className="max-w-xs text-sm leading-relaxed text-stone-400">
            여행을 만들면 이동수단 · 할일 · 식사 · 숙소 · 볼거리 카테고리가 담긴 보드가 함께
            생겨요.
          </p>
          <button
            type="button"
            data-testid="add-trip-empty"
            onClick={() => setDialog({ kind: 'create' })}
            className="mt-2 rounded-full bg-stone-800 px-5 py-2.5 text-sm font-semibold text-white hover:bg-stone-900"
          >
            ＋ 새 여행 만들기
          </button>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {trips.map((trip) => {
            const count = counts[trip.id] ?? { columns: 0, cards: 0 };
            return (
              <li key={trip.id} data-testid="trip-card" data-trip-id={trip.id} className="relative">
                <button
                  type="button"
                  data-testid="trip-open"
                  onClick={() => openBoard(trip.id)}
                  className="w-full rounded-2xl border border-stone-200/80 bg-white px-4 py-4 pr-24 text-left shadow-sm transition-shadow hover:shadow-md"
                >
                  <h2 className="truncate text-base font-semibold text-stone-800">{trip.title}</h2>
                  <p className="mt-1 text-xs text-stone-400">
                    {format(new Date(trip.createdAt), 'yyyy.MM.dd')} 만듦 · {trip.currency}
                  </p>
                  <p className="mt-2 flex flex-wrap gap-1.5 text-xs">
                    <span className="rounded-full bg-stone-100 px-2 py-0.5 text-stone-500">
                      카테고리 {count.columns}
                    </span>
                    <span className="rounded-full bg-stone-100 px-2 py-0.5 text-stone-500">
                      카드 {count.cards}
                    </span>
                  </p>
                </button>

                <div className="absolute right-3 top-3 flex gap-1">
                  <button
                    type="button"
                    data-testid="trip-edit"
                    aria-label={`${trip.title} 수정`}
                    onClick={() => setDialog({ kind: 'edit', trip })}
                    className="rounded-full px-2 py-1 text-sm text-stone-400 hover:bg-stone-100 hover:text-stone-600"
                  >
                    ✏️
                  </button>
                  <button
                    type="button"
                    data-testid="trip-delete"
                    aria-label={`${trip.title} 삭제`}
                    onClick={() => setDialog({ kind: 'delete', trip })}
                    className="rounded-full px-2 py-1 text-sm text-stone-400 hover:bg-rose-50"
                  >
                    🗑️
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
