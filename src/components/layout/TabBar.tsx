import { useIsDesktop } from '../../hooks/useMediaQuery';
import { TAB_IDS, TAB_LABELS, useUiStore, type TabId } from '../../stores/uiStore';
import AiAskButton from '../ai/AiAskButton';
import BackupNudge from '../common/BackupNudge';
import Icon, { type IconName } from '../common/Icon';
import SyncStatusChip from '../common/SyncStatusChip';

const TAB_ICONS: Record<TabId, IconName> = {
  trips: 'luggage',
  board: 'board',
  timeline: 'calendar',
  map: 'map',
  memo: 'chat',
};

/**
 * Bottom tab bar on mobile; a top bar from `lg` (≥1024px) up.
 *
 * **The tab row holds tabs and nothing else** (M9 §3.3): exactly five cells
 * (four until 메모 arrived in M21), five `role="tab"`s. The backup nudge and
 * the sync indicator are not tabs, so
 * on desktop they live in a utility zone pushed to the right, and on mobile the
 * app shell renders them above the active view instead.
 */
export default function TabBar() {
  const activeTab = useUiStore((s) => s.activeTab);
  const setTab = useUiStore((s) => s.setTab);
  const isDesktop = useIsDesktop();

  return (
    <nav
      aria-label="주요 탭"
      data-testid="tab-bar"
      className={[
        'fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/92 backdrop-blur',
        'pb-[env(safe-area-inset-bottom)]',
        // From `lg` the bar is at the *top*, so that is where the inset goes —
        // and `tb-safe-top` adds the same amount under it, so the two agree.
        'lg:inset-x-0 lg:top-0 lg:bottom-auto lg:border-t-0 lg:border-b lg:pb-0',
        'lg:pt-[env(safe-area-inset-top)]',
      ].join(' ')}
    >
      <div className="mx-auto grid max-w-3xl grid-cols-5 lg:flex lg:h-14 lg:max-w-5xl lg:items-center lg:gap-1 lg:px-6">
        <span className="hidden select-none pr-4 text-title text-ink lg:block">Trip Board</span>

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
                'relative flex h-14 flex-col items-center justify-center gap-1 text-micro',
                'transition-colors duration-[140ms] ease-quick',
                'lg:h-9 lg:flex-row lg:gap-2 lg:rounded-full lg:px-4 lg:text-label',
                active
                  ? 'text-ink lg:bg-inverse lg:text-surface'
                  : 'text-ink-faint hover:text-ink-muted lg:text-ink-muted lg:hover:bg-sunken',
              ].join(' ')}
            >
              {active ? (
                <span
                  aria-hidden="true"
                  className="absolute top-0 h-[2px] w-8 rounded-full bg-ink lg:hidden"
                />
              ) : null}
              <Icon name={TAB_ICONS[tab]} size={24} className="lg:hidden" />
              <Icon name={TAB_ICONS[tab]} size={16} className="hidden lg:block" />
              <span>{TAB_LABELS[tab]}</span>
            </button>
          );
        })}

        {/* Desktop only. Below `lg` these two ride above the active view — a
            tab bar with things in it that are not tabs is not a tab bar. */}
        {isDesktop ? (
          <div className="ml-auto flex items-center gap-2">
            <BackupNudge />
            <AiAskButton />
            <SyncStatusChip />
          </div>
        ) : null}
      </div>
    </nav>
  );
}
