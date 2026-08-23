import { TAB_IDS, TAB_LABELS, useUiStore, type TabId } from '../../stores/uiStore';
import SyncStatusChip from '../common/SyncStatusChip';

const TAB_ICONS: Record<TabId, string> = {
  trips: '🧳',
  board: '🗂️',
  timeline: '🗓️',
  map: '🗺️',
};

/**
 * Bottom tab bar on mobile; a top bar from `lg` (≥1024px) up.
 * Single component, layout swapped with Tailwind responsive utilities.
 */
export default function TabBar() {
  const activeTab = useUiStore((s) => s.activeTab);
  const setTab = useUiStore((s) => s.setTab);

  return (
    <nav
      aria-label="주요 탭"
      data-testid="tab-bar"
      className={[
        'fixed inset-x-0 bottom-0 z-40 border-t border-stone-200 bg-white/90 backdrop-blur',
        'pb-[env(safe-area-inset-bottom)]',
        'lg:inset-x-0 lg:top-0 lg:bottom-auto lg:border-t-0 lg:border-b lg:pb-0',
      ].join(' ')}
    >
      <div className="mx-auto flex max-w-3xl items-stretch lg:h-14 lg:max-w-5xl lg:items-center lg:gap-1 lg:px-4">
        <span className="hidden select-none pr-4 text-base font-semibold tracking-tight text-stone-800 lg:block">
          Trip Board
        </span>
        {TAB_IDS.map((tab) => {
          const active = tab === activeTab;
          return (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={active}
              data-testid={`tab-${tab}`}
              onClick={() => setTab(tab)}
              className={[
                'flex flex-1 flex-col items-center gap-0.5 py-2 text-xs font-medium transition-colors',
                'lg:h-9 lg:flex-none lg:flex-row lg:gap-1.5 lg:rounded-full lg:px-4 lg:text-sm',
                active
                  ? 'text-stone-900 lg:bg-stone-900 lg:text-white'
                  : 'text-stone-400 hover:text-stone-600 lg:hover:bg-stone-100',
              ].join(' ')}
            >
              <span aria-hidden="true" className="text-lg leading-none lg:text-base">
                {TAB_ICONS[tab]}
              </span>
              <span>{TAB_LABELS[tab]}</span>
            </button>
          );
        })}
        <SyncStatusChip />
      </div>
    </nav>
  );
}
