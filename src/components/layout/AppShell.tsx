import { useUiStore, type TabId } from '../../stores/uiStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { useHashSync } from './HashSync';
import TabBar from './TabBar';
import TripsView from '../trips/TripListView';
import BoardView from '../board/BoardView';
import TimelineView from '../timeline/TimelineView';
import MapView from '../map/MapView';
import Icon from '../common/Icon';
import PersistBanner from '../common/PersistBanner';
import UndoToast from '../common/UndoToast';

const VIEWS: Record<TabId, () => React.JSX.Element> = {
  trips: TripsView,
  board: BoardView,
  timeline: TimelineView,
  map: MapView,
};

/** Minimal splash shown until IndexedDB rehydration completes. */
function Splash() {
  return (
    <div
      data-testid="splash"
      className="flex min-h-dvh flex-col items-center justify-center gap-3 text-ink-faint"
    >
      <Icon name="luggage" size={24} />
      <p className="text-label">불러오는 중…</p>
    </div>
  );
}

/**
 * Root layout: hash routing, render gate on hydration, tab bar + active view.
 *
 * The bottom padding is the one number that has to agree with the tab bar's
 * own height (`h-14` + safe area). Everything else sizes itself.
 */
export default function AppShell() {
  useHashSync();
  const hydrated = useWorkspaceStore((s) => s.hydrated);
  const activeTab = useUiStore((s) => s.activeTab);

  if (!hydrated) return <Splash />;

  const View = VIEWS[activeTab];

  return (
    <div className="min-h-dvh">
      {/* A flex column of exactly one viewport minus the tab bar. The banners
          take what they need off the top and the 일정 grid gets the rest — so a
          banner can never push the timeline's own scroller off-screen. Views
          that scroll the page instead (여행 / 보드 / 지도) opt out with
          `shrink-0` and simply overflow. */}
      {/* `tb-safe-top` owns the whole top inset: the notch below `lg`, the top
          bar (plus notch) above it. It replaces `pt-0 lg:pt-14` rather than
          joining it — two rules for one padding is how a screen ends up padded
          twice. */}
      <main
        data-active-tab={activeTab}
        className="tb-safe-top flex h-dvh flex-col pb-[calc(3.5rem+env(safe-area-inset-bottom))] lg:pb-0"
      >
        {/* Above the active view, under the (fixed) tab bar — the one thing
            that outranks whatever tab you are on. 백업 넛지 does *not*: on
            desktop it rides in the top bar's utility zone, and on a phone each
            view mounts the banner variant under its own h1 (M9 §3.5). */}
        <PersistBanner />
        <View />
      </main>
      <TabBar />
      <UndoToast />
    </div>
  );
}
