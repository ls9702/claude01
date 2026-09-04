import { useDroppable } from '@dnd-kit/core';
import { DND_TRASH, TRASH_DROPPABLE_ID } from '../../dnd/planDnd';
import Icon from '../common/Icon';

/**
 * 휴지통 — the bar that appears while a placed entry is being dragged (M34).
 *
 * Only mounted for **entry** drags: a card coming off the tray or the rail has
 * nothing on the schedule yet, and offering to remove it would be offering to
 * undo a placement that has not happened.
 *
 * Three things about its position, all of them the same decision:
 *
 * 1. **`fixed`, never a flex sibling.** A bar that pushed the grid up would move
 *    every drop target out from under the finger at the exact moment the finger
 *    is aiming at one — the drag would end somewhere the user never pointed.
 *    Floating over the layout costs the grid nothing.
 * 2. **Bottom of the screen, above the tab bar.** On a phone the far edge is
 *    where the thumb already is, and the tab bar (`h-14` + safe area) is the one
 *    thing that may not be covered — it is how you leave. Everything between —
 *    the 미배치 tray included — may be covered while the drag lasts: the tray is
 *    not a drop target for entries, so nothing is lost under it.
 * 3. **`lg:bottom-0`.** On desktop the tab bar moved to the top of the window,
 *    so the bottom edge is free and the bar sits flush with it.
 *
 * It says what it takes away, and what it does not: dropping here removes the
 * **placement**, and the card stays on the board — which is the whole reason
 * this is not the 카드 삭제 the board already has.
 */
export default function EntryTrash() {
  const { setNodeRef, isOver } = useDroppable({
    id: TRASH_DROPPABLE_ID,
    data: { type: DND_TRASH },
  });

  return (
    /* 앵커와 드롭 타깃이 **두 상자로 나뉘어 있는 이유** (M51).
     *
     * 가시 뷰포트에 못 박는 `.tb-vp-bottom`은 `transform: translateY(…)`로
     * 되올리는데, dnd-kit은 droppable의 사각형을 재면서 **그 요소 자신의
     * transform을 일부러 벗겨 낸다**(`getTransformAgnosticClientRect` — 끌리는
     * 쪽이 transform으로 움직이기 때문에 그게 옳다). 그래서 못을 드롭 타깃에
     * 직접 박으면 dnd-kit이 보는 휴지통은 화면 맨 위에 있고, 손가락이 바 위에
     * 있어도 `isOver`가 켜지지 않는다(실측: `entrytrash.spec` 두 건이 이걸로
     * 빨개졌다).
     *
     * 그래서 transform은 **바깥 상자**가 지고, `setNodeRef`는 안쪽 상자에 있다.
     * 안쪽 상자의 computed transform은 `none`이므로 벗겨 낼 것이 없고,
     * `getBoundingClientRect`는 조상의 transform을 포함해서 잰다 — dnd-kit이
     * 보는 자리와 눈에 보이는 자리가 같아진다. */
    <div
      aria-hidden="true"
      style={
        {
          '--tb-vp-bottom-offset': 'calc(3.5rem + env(safe-area-inset-bottom))',
        } as React.CSSProperties
      }
      className={[
        // `tb-vp-bottom` — 탭 바와 같은 못 (M51): 늘어난 레이아웃 뷰포트에서도
        // 이 바는 가시 화면의 탭 바 바로 위에 남는다. 올라갈 높이는 아래
        // `bottom-…`과 같은 값을 `--tb-vp-bottom-offset`으로 한 번 더 말한 것이다.
        'tb-vp-bottom fixed inset-x-0 z-40',
        // The tab bar's own height, spelled the way AppShell spells it.
        'bottom-[calc(3.5rem+env(safe-area-inset-bottom))] lg:bottom-0',
      ].join(' ')}
    >
      <div
        ref={setNodeRef}
        data-testid="entry-trash"
        data-over={isOver ? 'true' : 'false'}
        className={[
          'flex min-h-14 flex-col items-center justify-center gap-0.5',
          'border-t px-4 py-2 text-center transition-colors duration-[140ms] ease-quick',
          isOver
            ? 'border-danger bg-danger text-surface shadow-float'
            : 'border-danger/40 bg-danger-wash text-danger',
        ].join(' ')}
      >
        <p className="flex items-center gap-1.5 text-label font-semibold">
          <Icon name="trash" size={20} />
          {isOver ? '놓으면 일정에서 빠져요' : '여기에 놓으면 일정에서 빼요'}
        </p>
        <p className={`text-micro font-normal ${isOver ? 'text-surface/85' : 'text-danger/80'}`}>
          카드는 보드에 그대로 남아요
        </p>
      </div>
    </div>
  );
}
