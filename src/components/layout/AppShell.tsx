import { useUiStore, type TabId } from '../../stores/uiStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { useHashSync } from './HashSync';
import TabBar from './TabBar';
import TripsView from '../trips/TripListView';
import BoardView from '../board/BoardView';
import TimelineView from '../views/TimelineView';
import MapView from '../views/MapView';

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
      className="flex min-h-dvh flex-col items-center justify-center gap-3 text-stone-400"
    >
      <span aria-hidden="true" className="text-3xl">
        🧳
      </span>
      <p className="text-sm">불러오는 중…</p>
    </div>
  );
}

/**
 * Root layout: hash routing, render gate on hydration, tab bar + active view.
 * Padding leaves room for the fixed tab bar (bottom on mobile, top on ≥1024px).
 */
export default function AppShell() {
  useHashSync();
  const hydrated = useWorkspaceStore((s) => s.hydrated);
  const activeTab = useUiStore((s) => s.activeTab);

  if (!hydrated) return <Splash />;

  const View = VIEWS[activeTab];

  return (
    <div className="min-h-dvh">
      <main
        data-active-tab={activeTab}
        className="pb-[calc(4.5rem+env(safe-area-inset-bottom))] pt-0 lg:pb-0 lg:pt-14"
      >
        <View />
      </main>
      <TabBar />
    </div>
  );
}
