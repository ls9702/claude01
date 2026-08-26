import { useMemo } from 'react';
import { useIsDesktop } from '../../hooks/useMediaQuery';
import { useProfileStore } from '../../profile/profile';
import { unreadMemos } from '../../read/readState';
import { TAB_IDS, TAB_LABELS, useUiStore, type TabId } from '../../stores/uiStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import AiAskButton from '../ai/AiAskButton';
import Icon, { type IconName } from '../common/Icon';
import SyncStatusChip from '../common/SyncStatusChip';
import { UNREAD_BADGE_CLASS } from '../common/formStyles';

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
 * (four until 메모 arrived in M21), five `role="tab"`s. The sync indicator is
 * not a tab, so on desktop it lives in a utility zone pushed to the right, and
 * on mobile each view renders it above its own content instead. (백업 경고는
 * M26부터 동기화 설정 시트 안에만 있다.)
 *
 * The one thing a tab is allowed to carry is news about itself: 메모 wears the
 * count of lines the other person wrote and this person has not read (M24).
 * It rides *inside* the tab's own button, so the row is still five cells and
 * five `role="tab"`s.
 */
export default function TabBar() {
  const activeTab = useUiStore((s) => s.activeTab);
  const setTab = useUiStore((s) => s.setTab);
  const isDesktop = useIsDesktop();

  const workspace = useWorkspaceStore((s) => s.workspace);
  const profileId = useProfileStore((s) => s.profileId);
  const unread = useMemo(() => unreadMemos(workspace, profileId).total, [workspace, profileId]);

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
              {/* 아래쪽 바에서는 아이콘 어깨 위에(절대), 위쪽 바에서는 라벨
                  뒤에(정적) 붙는다 — 같은 배지 하나가 두 배치를 다 산다. */}
              {tab === 'memo' && unread > 0 ? (
                <span
                  data-testid="memo-tab-badge"
                  data-count={unread}
                  title={`안 읽은 메모 ${unread}개`}
                  className={`${UNREAD_BADGE_CLASS} absolute left-[calc(50%+0.375rem)] top-1.5 lg:static lg:ml-0.5`}
                >
                  {unread > 9 ? '9+' : unread}
                </span>
              ) : null}
            </button>
          );
        })}

        {/* Desktop only. Below `lg` these two ride above the active view — a
            tab bar with things in it that are not tabs is not a tab bar. */}
        {isDesktop ? (
          <div className="ml-auto flex items-center gap-2">
            <AiAskButton />
            <SyncStatusChip />
          </div>
        ) : null}
      </div>
    </nav>
  );
}
