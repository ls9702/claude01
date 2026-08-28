import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Id, Sheet as SheetModel } from '../../types/models';
import AnchoredMenu from '../common/AnchoredMenu';
import Icon from '../common/Icon';
import { POPOVER_ROW_CLASS, POPOVER_ROW_DANGER_CLASS } from '../common/formStyles';

interface SheetTabsProps {
  sheets: readonly SheetModel[];
  activeSheetId?: Id;
  onSelect: (sheetId: Id) => void;
  onCreate: () => void;
  onRename: (sheet: SheetModel) => void;
  onEditFlights: (sheet: SheetModel) => void;
  /** 시트를 통째로 베껴 형제로 세운다 (M40). */
  onDuplicate: (sheet: SheetModel) => void;
  onDelete: (sheet: SheetModel) => void;
  /** Right-hand slot of the row — the phone parks its 시트 지출 칩 here. */
  trailing?: ReactNode;
}

/**
 * The 일정 tab's sheet switcher: one chip per 시트 plus `＋ 새 시트`.
 *
 * The row is **only** the sheet chips (M9 §4.4-4). The scrolling half and the
 * fixed half no longer fight over one line: the chips scroll, `＋ 새 시트`
 * never shrinks, and the 오늘 / 지출 chips moved into the pager below.
 *
 * The active chip carries its `⋯` menu inside the *same* pill rather than
 * beside it, so the pair stops reading as two half-broken buttons.
 * `timeline-sheet-name` rides on the active chip's label so M2a's assertions
 * keep working with one sheet or ten.
 *
 * M15 §1 — the menu **panel** does not live in this row any more. The strip is
 * `overflow-x-auto`, which clips the other axis too, and the panel used to be
 * drawn entirely outside that box: the owner tapped ⋯, saw nothing, and
 * reported 「삭제가 안 됨」. It is an {@link AnchoredMenu} now, portalled to the
 * body, and the ⋯ itself is a 44px touch target below `lg`.
 */
/** Toggles the right-hand fade on only while a strip really has more to show. */
function useStripOverflow<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [overflowing, setOverflowing] = useState(false);

  const measure = () => {
    const node = ref.current;
    if (!node) return;
    const more = node.scrollWidth - node.clientWidth - node.scrollLeft > 4;
    setOverflowing((current) => (current === more ? current : more));
  };

  useEffect(measure);

  return { ref, overflowing, measure };
}

export default function SheetTabs({
  sheets,
  activeSheetId,
  onSelect,
  onCreate,
  onRename,
  onEditFlights,
  onDuplicate,
  onDelete,
  trailing,
}: SheetTabsProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  /** The ⋯ button itself — the menu positions against its rect. */
  const [menuAnchor, setMenuAnchor] = useState<HTMLButtonElement | null>(null);
  const strip = useStripOverflow<HTMLDivElement>();

  const active = sheets.find((sheet) => sheet.id === activeSheetId);

  // A menu left open over a sheet that is no longer the active one would act
  // on the wrong sheet the moment it is tapped.
  useEffect(() => {
    if (!active) setMenuOpen(false);
  }, [active]);

  /**
   * Keeps the active chip — the only one carrying ⋯ — inside the strip.
   *
   * With half a dozen sheets the chip that owns the menu could sit off the
   * right-hand edge, which is the same "the app has no delete" experience by
   * another route. Only the strip's own `scrollLeft` moves; `scrollIntoView`
   * would drag the whole page around it.
   */
  const chipRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const scroller = strip.ref.current;
    const chip = chipRef.current;
    if (!scroller || !chip) return;
    const left = chip.offsetLeft;
    const right = left + chip.offsetWidth;
    if (left < scroller.scrollLeft) scroller.scrollLeft = Math.max(left - 16, 0);
    else if (right > scroller.scrollLeft + scroller.clientWidth) {
      scroller.scrollLeft = right - scroller.clientWidth + 16;
    }
  }, [activeSheetId, strip.ref]);

  const runAction = (action: (sheet: SheetModel) => void) => {
    setMenuOpen(false);
    if (active) action(active);
  };

  return (
    <div className="flex min-w-0 items-center gap-2 pr-4">
      <div
        ref={strip.ref}
        onScroll={strip.measure}
        data-testid="sheet-tabs"
        role="tablist"
        aria-label="일정표"
        // Hugs the chips and shrinks only when they overflow, so `＋ 새 시트`
        // sits next to the tabs instead of across the room.
        className={[
          'relative flex min-w-0 shrink items-center gap-2 overflow-x-auto pl-4',
          strip.overflowing ? 'tb-strip-fade' : '',
        ].join(' ')}
      >
        {sheets.map((sheet) => {
          const isActive = sheet.id === activeSheetId;
          // A sheet with no days is a shell, not a plan — say so optically.
          const empty = sheet.dayOrder.length === 0;
          return (
            <div
              key={sheet.id}
              ref={isActive ? chipRef : undefined}
              className={[
                // 44px of pill below `lg` so the ⋯ inside it can be a real
                // touch target; the desktop keeps M9's 36px density.
                'relative flex h-11 shrink-0 items-center rounded-full transition-colors duration-[140ms] ease-quick lg:h-9',
                isActive ? 'bg-inverse pl-3 pr-1' : 'bg-sunken px-3 hover:bg-line',
                empty ? 'border border-dashed border-line bg-transparent' : '',
              ].join(' ')}
            >
              <button
                type="button"
                role="tab"
                aria-selected={isActive}
                data-testid="sheet-tab"
                data-sheet-id={sheet.id}
                data-active={isActive ? 'true' : 'false'}
                data-empty={empty ? 'true' : 'false'}
                onClick={() => onSelect(sheet.id)}
                className={[
                  // M19 — 알약은 44px인데 그 안의 버튼은 글자 높이(14px)뿐이라,
                  // 실제로 시트를 바꾸는 자리는 알약 한가운데의 가느다란 띠
                  // 하나였다. 손가락이 알약 위쪽을 스치면 아무 일도 일어나지
                  // 않는다 — 알약이 곧 버튼이 되도록 세로를 채우고, 좌우
                  // 패딩(알약 몫)까지 ::after로 되찾는다.
                  'relative flex h-full max-w-40 items-center text-micro',
                  "after:absolute after:inset-y-0 after:-left-3 after:content-['']",
                  isActive ? 'after:right-0' : 'after:-right-3',
                  empty ? 'text-ink-faint' : isActive ? 'text-surface' : 'text-ink-muted',
                ].join(' ')}
              >
                <span
                  data-testid={isActive ? 'timeline-sheet-name' : undefined}
                  className="block truncate"
                >
                  {sheet.name}
                </span>
              </button>

              {isActive ? (
                <div className="ml-2 flex items-center">
                  {/* The hairline that turns one pill into two zones. */}
                  <span
                    aria-hidden="true"
                    className={`h-4 w-px ${empty ? 'bg-line' : 'bg-surface/25'}`}
                  />
                  <button
                    type="button"
                    ref={setMenuAnchor}
                    data-testid="sheet-menu"
                    aria-label={`${sheet.name} 시트 메뉴 (이름 변경 · 삭제)`}
                    aria-haspopup="menu"
                    aria-expanded={menuOpen}
                    onClick={() => setMenuOpen((open) => !open)}
                    className={[
                      // 44 × 44 on a phone, M9's 32 on a mouse-driven desktop.
                      'grid h-11 w-11 place-items-center rounded-full lg:h-8 lg:w-8',
                      empty ? 'text-ink-faint hover:text-ink' : 'text-surface/70 hover:text-surface',
                    ].join(' ')}
                  >
                    <Icon name="more" size={20} />
                  </button>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {/* Portalled, so the strip's `overflow-x-auto` cannot clip it (M15 §1). */}
      {menuOpen && active ? (
        <AnchoredMenu
          anchor={menuAnchor}
          testId="sheet-menu-panel"
          onClose={() => setMenuOpen(false)}
        >
          <button
            type="button"
            data-testid="sheet-rename"
            onClick={() => runAction(onRename)}
            className={POPOVER_ROW_CLASS}
          >
            <Icon name="pencil" size={16} />
            이름 변경
          </button>
          <button
            type="button"
            data-testid="sheet-edit-flights"
            onClick={() => runAction(onEditFlights)}
            className={POPOVER_ROW_CLASS}
          >
            <Icon name="calendar" size={16} />
            항공편 수정
          </button>
          {/* M40 — 지금은 묻지 않고 바로 베낀다. 사본이 활성 시트가 되고,
              마음에 안 들면 바로 아래 「시트 삭제」가 있다.

              ⚠️ M41: 시트마다 지도 엔진을 고르게 되면 그 선택이 붙는 자리가
              여기다 — 이 줄이 작은 대화상자를 여는 형태로 늘어난다. 그때까지는
              대화상자 없이 한 번에 끝나는 편이 낫다. */}
          <button
            type="button"
            data-testid="sheet-duplicate"
            onClick={() => runAction(onDuplicate)}
            className={POPOVER_ROW_CLASS}
          >
            <Icon name="copy" size={16} />
            복제
          </button>
          <button
            type="button"
            data-testid="sheet-delete"
            onClick={() => runAction(onDelete)}
            className={POPOVER_ROW_DANGER_CLASS}
          >
            <Icon name="trash" size={16} />
            시트 삭제
          </button>
        </AnchoredMenu>
      ) : null}

      {trailing ? <div className="ml-auto shrink-0">{trailing}</div> : null}

      {/* Never allowed to shrink; below `sm` the label goes and the ＋ stays. */}
      <button
        type="button"
        data-testid="sheet-add"
        onClick={onCreate}
        className="flex h-11 shrink-0 items-center gap-1 rounded-full border border-dashed border-line px-3 text-micro text-ink-muted transition-colors duration-[140ms] ease-quick hover:border-line-strong hover:text-ink lg:h-9"
      >
        <Icon name="plus" size={16} />
        <span className="hidden sm:inline">새 시트</span>
        <span className="sr-only sm:hidden">새 시트</span>
      </button>
    </div>
  );
}
