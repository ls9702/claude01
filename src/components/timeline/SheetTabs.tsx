import { useEffect, useRef, useState } from 'react';
import type { Id, Sheet as SheetModel } from '../../types/models';

interface SheetTabsProps {
  sheets: readonly SheetModel[];
  activeSheetId?: Id;
  onSelect: (sheetId: Id) => void;
  onCreate: () => void;
  onRename: (sheet: SheetModel) => void;
  onEditFlights: (sheet: SheetModel) => void;
  onDelete: (sheet: SheetModel) => void;
}

/**
 * The 일정 tab's sheet switcher: one chip per 시트 plus `＋ 새 시트`.
 *
 * The active chip grows a `⋯` menu (이름 변경 / 항공편 수정 / 시트 삭제) —
 * keeping sheet management on the chip means the header stays a single row on
 * a phone. `timeline-sheet-name` rides on the active chip's label so M2a's
 * assertions keep working with one sheet or ten.
 */
export default function SheetTabs({
  sheets,
  activeSheetId,
  onSelect,
  onCreate,
  onRename,
  onEditFlights,
  onDelete,
}: SheetTabsProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

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
    <div
      data-testid="sheet-tabs"
      role="tablist"
      aria-label="일정표"
      className="flex w-full items-center gap-1.5 overflow-x-auto px-4 pb-2"
    >
      {sheets.map((sheet) => {
        const isActive = sheet.id === activeSheetId;
        return (
          <div key={sheet.id} className="relative flex shrink-0 items-center">
            <button
              type="button"
              role="tab"
              aria-selected={isActive}
              data-testid="sheet-tab"
              data-sheet-id={sheet.id}
              data-active={isActive ? 'true' : 'false'}
              onClick={() => onSelect(sheet.id)}
              className={[
                'max-w-40 rounded-full py-1.5 text-xs font-semibold transition-colors',
                isActive
                  ? 'bg-stone-800 pl-3 pr-1.5 text-white'
                  : 'bg-stone-100 px-3 text-stone-500 hover:bg-stone-200',
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
              <div ref={menuRef} className="relative">
                <button
                  type="button"
                  data-testid="sheet-menu"
                  aria-label={`${sheet.name} 시트 메뉴`}
                  aria-expanded={menuOpen}
                  onClick={() => setMenuOpen((open) => !open)}
                  className="-ml-1 rounded-full bg-stone-800 py-1.5 pl-1 pr-2.5 text-xs leading-none text-white/70 hover:text-white"
                >
                  ⋯
                </button>

                {menuOpen ? (
                  <div
                    data-testid="sheet-menu-panel"
                    className="absolute right-0 top-full z-40 mt-1 w-32 overflow-hidden rounded-xl border border-stone-200 bg-white py-1 shadow-lg"
                  >
                    <button
                      type="button"
                      data-testid="sheet-rename"
                      onClick={() => runAction(onRename)}
                      className="block w-full px-3 py-2 text-left text-xs font-medium text-stone-600 hover:bg-stone-50"
                    >
                      이름 변경
                    </button>
                    <button
                      type="button"
                      data-testid="sheet-edit-flights"
                      onClick={() => runAction(onEditFlights)}
                      className="block w-full px-3 py-2 text-left text-xs font-medium text-stone-600 hover:bg-stone-50"
                    >
                      항공편 수정
                    </button>
                    <button
                      type="button"
                      data-testid="sheet-delete"
                      onClick={() => runAction(onDelete)}
                      className="block w-full px-3 py-2 text-left text-xs font-medium text-rose-500 hover:bg-rose-50"
                    >
                      시트 삭제
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}

      <button
        type="button"
        data-testid="sheet-add"
        onClick={onCreate}
        className="shrink-0 rounded-full border border-dashed border-stone-300 px-3 py-1.5 text-xs font-medium text-stone-500 hover:border-stone-400 hover:text-stone-700"
      >
        ＋ 새 시트
      </button>
    </div>
  );
}
