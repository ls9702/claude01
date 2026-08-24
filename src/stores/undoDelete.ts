/**
 * 전역 삭제 실행취소 — one helper behind every destructive delete (M7a).
 *
 * The board's five deletes (여행 / 카테고리 / 카드 / 일정표 / 일자) all cascade:
 * a trip takes its columns, cards, sheets, days and entries with it, and a
 * sheet takes its days and entries. Reversing that by hand would mean five
 * bespoke "recreate everything" routines, each of which would have to invent
 * new ids and would therefore *not* actually restore what was deleted.
 *
 * So the undo is a **snapshot**: grab the workspace object before the delete
 * and hand it straight back to `replaceWorkspace` if the user taps 실행 취소.
 * Every mutation in `workspaceStore` builds a fresh draft (see `draftOf`), so
 * the captured object is never mutated underneath us and a restore is exact —
 * same ids, same `*Order` arrays, same `updatedAt` stamps.
 *
 * ⚠️ Two documented consequences of the snapshot approach (the design debate's
 * conclusion — accepted, not overlooked):
 *
 *  1. **Tombstones are rolled back too.** Restoring reinstates the pre-delete
 *     `tombstones` array, so the deletion is not just undone locally, it is
 *     forgotten. That is exactly what we want for a mis-tap. It would be wrong
 *     if another device had already merged the tombstone and moved on — but the
 *     offer only lives for {@link UNDO_DESTRUCTIVE_MS} (10초) and the sync push
 *     is debounced, so within the toast window a single user cannot get there.
 *     Trip Board is a personal/couple app; that is a trade we take knowingly.
 *
 *  2. **Edits made during the toast window are rolled back with it.** Same
 *     reasoning: 10초 of one person's attention is spent on the toast, not on
 *     editing another card.
 */

import { schedulePhotoGc } from './photoGc';
import { useUndoStore, UNDO_DESTRUCTIVE_MS } from './undoStore';
import { useWorkspaceStore } from './workspaceStore';

/** Which entity a delete removed — picks the noun in the toast. */
export type DeleteKind = 'trip' | 'column' | 'card' | 'sheet' | 'day';

/** Korean noun shown in the toast for each {@link DeleteKind}. */
export const DELETE_KIND_LABELS: Record<DeleteKind, string> = {
  trip: '여행',
  column: '카테고리',
  card: '카드',
  sheet: '일정표',
  day: '일자',
};

/** `여행 「오사카」 삭제됨` — a nameless entity drops the quotes. */
export function deleteMessage(kind: DeleteKind, label: string): string {
  const name = label.trim();
  const noun = DELETE_KIND_LABELS[kind];
  return name ? `${noun} 「${name}」 삭제됨` : `${noun} 삭제됨`;
}

/**
 * Runs a destructive delete and offers a 10초 실행 취소 that puts the whole
 * workspace back exactly as it was.
 *
 * `doDelete` may report that it declined — `deleteColumn` returns `false` for
 * a trip's last category — in which case nothing is offered and `false` comes
 * back. Any other return value (including `undefined`, what the `void`
 * mutations give us) counts as "it happened".
 */
export function deleteWithUndo(
  kind: DeleteKind,
  label: string,
  doDelete: () => unknown,
): boolean {
  // Captured *before* the mutation: `workspaceStore` never edits in place, so
  // this reference keeps the pre-delete tree alive on its own.
  const snapshot = useWorkspaceStore.getState().workspace;

  if (doDelete() === false) return false;

  // A deleted 여행/카테고리/카드 may have taken photos out of reach. The sweep
  // is only *booked* here — it runs after a grace period longer than this very
  // toast, and re-checks the references before deleting anything, so tapping
  // 실행 취소 puts the photos back with the card (M10).
  schedulePhotoGc();

  useUndoStore
    .getState()
    .offer(
      deleteMessage(kind, label),
      () => useWorkspaceStore.getState().replaceWorkspace(snapshot),
      UNDO_DESTRUCTIVE_MS,
    );
  return true;
}
