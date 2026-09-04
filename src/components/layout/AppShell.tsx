import { useEffect } from 'react';
import { useProfileStore } from '../../profile/profile';
import { useUiStore, type TabId } from '../../stores/uiStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { useHashSync } from './HashSync';
import TabBar from './TabBar';
import TripsView from '../trips/TripListView';
import BoardView from '../board/BoardView';
import TimelineView from '../timeline/TimelineView';
import MapView from '../map/MapView';
import MemoView from '../memo/MemoView';
import DrawView from '../draw/DrawView';
import Icon from '../common/Icon';
import NoticeBanner from '../common/NoticeBanner';
import PersistBanner from '../common/PersistBanner';
import ProfilePicker from '../common/ProfilePicker';
import UndoToast from '../common/UndoToast';
import PlaceFixHost from '../map/PlaceFixHost';

const VIEWS: Record<TabId, () => React.JSX.Element> = {
  trips: TripsView,
  board: BoardView,
  timeline: TimelineView,
  map: MapView,
  memo: MemoView,
  // 드로우 (M52a) — 여섯 번째 탭.
  draw: DrawView,
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
  const profileId = useProfileStore((s) => s.profileId);

  // 개발 빌드 전용 카나리아 (M51). 레이아웃 뷰포트가 가시 영역보다 넓어지는
  // 순간 — 즉 위 `overflow-x: clip`이 못 막은 무언가가 body 포털에서 넘친
  // 순간 — 콘솔에 한 줄 남긴다. 프로덕션에서는 조용하다: 사용자에게 할 말이
  // 아니라 다음 개발자에게 할 말이다.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const vv = window.visualViewport;
    if (!vv) return;
    const check = () => {
      if (window.innerWidth > vv.width + 1) {
        console.warn(
          `[tb] 레이아웃 뷰포트가 가시 영역보다 넓다: innerWidth=${window.innerWidth} ` +
            `visualViewport=${vv.width} scrollWidth=${document.documentElement.scrollWidth} ` +
            '— 무언가가 가로로 넘치고 있다 (M51).',
        );
      }
    };
    const timer = window.setInterval(check, 2000);
    vv.addEventListener('resize', check);
    check();
    return () => {
      window.clearInterval(timer);
      vv.removeEventListener('resize', check);
    };
  }, []);

  if (!hydrated) return <Splash />;
  // After the hydration gate, never before: the picker is the first thing this
  // device is asked, but it must not compete with the splash for the screen
  // (M13). Nothing else mounts until it is answered — there is no 건너뛰기,
  // because an unstamped card is exactly what this milestone is about.
  if (!profileId) return <ProfilePicker />;

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
      {/* `overflow-x: clip` — 이 앱에서 가로 오버플로가 **화면 밖으로 나가는
          유일한 문**이고, M51이 그 문을 닫는다.

          안드로이드(삼성 인터넷)에서 탭 바가 사라지고 시트가 잘리던 사고의
          연쇄는 이렇게 시작했다: 일정 헤더가 뷰포트보다 39px 넓어짐 → Blink가
          「내용 폭 맞춤」 최소 배율을 잡고 **레이아웃 뷰포트를 416~423px로
          늘림** → `h-dvh`인 이 `main`은 가시 영역(384×747)을 쓰는데
          `fixed`인 탭 바·시트는 늘어난 레이아웃 뷰포트(823px)를 쓰므로 탭 바가
          화면 63px 아래에 그려짐.

          `clip`이지 `hidden`/`auto`가 **아니다**: 그 둘은 스크롤 컨테이너를
          만들고, 그러면 페이지 스크롤·`sticky` 날짜 머리·dnd 자동 스크롤이
          전부 이 상자 안으로 갇힌다. `clip`은 스크롤 포트를 만들지 않고 자르기만
          한다. 세로(`overflow-y`)는 `visible`로 남으므로 보드·여행·지도처럼
          페이지가 세로로 흐르는 화면도 그대로다.

          html/body가 아니라 이 상자에 거는 이유: 루트의 `clip`은 `hidden`으로
          해석돼 문서 폭(scrollWidth)이 줄지 않는다.

          이것은 **그물**이고 치료가 아니다 — 넘치는 헤더 자체는 `TimelineView`의
          폭 예산이 고친다. 그물이 있어야 다음에 무엇이 넘쳐도 탭 바가 살아남는다. */}
      <main
        data-active-tab={activeTab}
        className="tb-safe-top flex h-dvh flex-col overflow-x-clip pb-[calc(3.5rem+env(safe-area-inset-bottom))] lg:pb-0"
      >
        {/* Above the active view, under the (fixed) tab bar — the one thing
            that outranks whatever tab you are on. 백업 넛지 does *not*: on
            desktop it rides in the top bar's utility zone, and on a phone each
            view mounts the banner variant under its own h1 (M9 §3.5). */}
        <PersistBanner />
        {/* 공지·보관 안내 (M47) — 저장 실패 배너 **아래**다. 그 배너는 지금
            이 순간 데이터가 사라지고 있다는 뜻이고, 이것은 읽어 두라는 뜻이다.
            둘이 같이 뜬 화면에서 순서가 곧 우선순위다. */}
        <NoticeBanner />
        <View />
      </main>
      <TabBar />
      <UndoToast />
      {/* 배치 보정 팝업의 주인 (M41). 여기 사는 이유는 배치가 일정 탭에서도
          보드 탭에서도 일어나기 때문이다 — 자세한 것은 PlaceFixHost. */}
      <PlaceFixHost />
    </div>
  );
}
