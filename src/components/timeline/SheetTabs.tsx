import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Id, Sheet as SheetModel } from '../../types/models';
import Icon from '../common/Icon';
import { POPOVER_CLASS, POPOVER_ROW_CLASS, POPOVER_ROW_DANGER_CLASS } from '../common/formStyles';

interface SheetTabsProps {
  sheets: readonly SheetModel[];
  activeSheetId?: Id;
  onSelect: (sheetId: Id) => void;
  onCreate: () => void;
  onRename: (sheet: SheetModel) => void;
  onEditFlights: (sheet: SheetModel) => void;
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
  onDelete,
  trailing,
}: SheetTabsProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const strip = useStripOverflow<HTMLDivElement>();

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [menuOpen]);

  const active = sheets.find((sheet) => sheet.id === activeSheetId);

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
              className={[
                'relative flex h-9 shrink-0 items-center rounded-full transition-colors duration-[140ms] ease-quick',
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
                  'max-w-40 text-micro',
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
                <div ref={menuRef} className="relative ml-2 flex items-center">
                  {/* The hairline that turns one pill into two zones. */}
                  <span
                    aria-hidden="true"
                    className={`h-4 w-px ${empty ? 'bg-line' : 'bg-surface/25'}`}
                  />
                  <button
                    type="button"
                    data-testid="sheet-menu"
                    aria-label={`${sheet.name} 시트 메뉴`}
                    aria-expanded={menuOpen}
                    onClick={() => setMenuOpen((open) => !open)}
                    className={[
                      'grid h-8 w-8 place-items-center rounded-full',
                      empty ? 'text-ink-faint hover:text-ink' : 'text-surface/70 hover:text-surface',
                    ].join(' ')}
                  >
                    <Icon name="more" size={16} />
                  </button>

                  {menuOpen ? (
                    <div data-testid="sheet-menu-panel" className={`${POPOVER_CLASS} right-0 top-full`}>
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
                      <button
                        type="button"
                        data-testid="sheet-delete"
                        onClick={() => runAction(onDelete)}
                        className={POPOVER_ROW_DANGER_CLASS}
                      >
                        <Icon name="trash" size={16} />
                        시트 삭제
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {trailing ? <div className="ml-auto shrink-0">{trailing}</div> : null}

      {/* Never allowed to shrink; below `sm` the label goes and the ＋ stays. */}
      <button
        type="button"
        data-testid="sheet-add"
        onClick={onCreate}
        className="flex h-9 shrink-0 items-center gap-1 rounded-full border border-dashed border-line px-3 text-micro text-ink-muted transition-colors duration-[140ms] ease-quick hover:border-line-strong hover:text-ink"
      >
        <Icon name="plus" size={16} />
        <span className="hidden sm:inline">새 시트</span>
        <span className="sr-only sm:hidden">새 시트</span>
      </button>
    </div>
  );
}
