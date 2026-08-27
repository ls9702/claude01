/**
 * 일정에서만 빼기 — one placement out of the schedule, with a way back (M34).
 *
 * Lives outside the components because two places do it now: the entry detail
 * sheet's 삭제 button (M2a) and the 휴지통 a drag summons (M34). Same sentence,
 * same undo, same guarantee — and only one of them can drift.
 *
 * **The card is not touched.** An entry is a *placement* of a card, so undoing
 * a delete cannot mean putting the card back (it never left the board): it
 * means scheduling an identical placement again — same day, same minute, same
 * length, same note. The restored entry is a new id, which is exactly right,
 * because what the user is restoring is a spot on the timetable.
 *
 * Unlike {@link import('./undoDelete').deleteWithUndo} this does **not**
 * snapshot the workspace: an entry cascades into nothing, so five fields are
 * enough to rebuild it, and a snapshot would roll back whatever else happened
 * during the toast for no reason.
 */

import type { TimelineEntry } from '../types/models';
import { useUndoStore } from './undoStore';
import { useWorkspaceStore } from './workspaceStore';

/** Deletes `entry` and offers to put an identical one back. */
export function deleteEntryWithUndo(entry: TimelineEntry): void {
  const { cardId, dayId, startMin, durationMin, note } = entry;
  const title = useWorkspaceStore.getState().workspace.cards[cardId]?.title ?? '일정';

  useWorkspaceStore.getState().deleteEntry(entry.id);

  useUndoStore.getState().offer(`'${title}' 삭제됨`, () => {
    const store = useWorkspaceStore.getState();
    const restored = store.scheduleCard(cardId, dayId, startMin, durationMin);
    if (restored && note) store.updateEntry(restored, { note });
  });
}
