import { useEffect, useMemo, useState } from 'react';
import { drawBytes, drawSizeWarning } from '../../draw/limits';
import { DRAW_TITLE_MAX, liveElementCount, pageTouchedAt, tripPages } from '../../draw/pages';
import { useIsDesktop } from '../../hooks/useMediaQuery';
import { useUiStore } from '../../stores/uiStore';
import { forgetDrawPage } from '../../stores/drawSession';
import { deleteWithUndo } from '../../stores/undoDelete';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import type { DrawPage } from '../../types/models';
import Icon from '../common/Icon';
import PatchNotesButton from '../common/PatchNotesButton';
import Sheet from '../common/Sheet';
import SyncStatusChip from '../common/SyncStatusChip';
import {
  COUNT_BADGE_CLASS,
  INPUT_CLASS,
  LABEL_CLASS,
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
  TOUCH_ICON_BUTTON_CLASS,
} from '../common/formStyles';
import DrawEditor from './DrawEditor';

/** 여행을 아직 안 골랐을 때 — 보드·메모와 **같은** 화면이다. */
function TripPrompt() {
  const workspace = useWorkspaceStore((s) => s.workspace);
  const setTab = useUiStore((s) => s.setTab);
  const setActiveTrip = useUiStore((s) => s.setActiveTrip);
  const trips = useMemo(
    () => Object.values(workspace.trips).sort((a, b) => b.createdAt - a.createdAt),
    [workspace.trips],
  );

  return (
    <section
      data-testid="view-draw"
      className="mx-auto flex w-full max-w-md shrink-0 flex-col items-center gap-4 px-6 pb-16 pt-12 text-center"
    >
      <Icon name="palette" size={24} className="text-ink-faint" />
      <h1 className="shrink-0 whitespace-nowrap text-title text-ink">드로우</h1>
      <p className="text-label font-normal text-ink-muted">
        {trips.length > 0 ? '어떤 여행에 그릴까요?' : '먼저 여행을 만들면 스케치북이 열려요.'}
      </p>

      {trips.length > 0 ? (
        <ul data-testid="draw-trip-picker" className="mt-1 w-full space-y-2">
          {trips.map((trip) => (
            <li key={trip.id}>
              <button
                type="button"
                data-testid="draw-trip-option"
                data-trip-id={trip.id}
                onClick={() => setActiveTrip(trip.id)}
                className={`${SECONDARY_BUTTON_CLASS} w-full justify-start`}
              >
                <span className="min-w-0 flex-1 truncate text-left">{trip.title}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <button
          type="button"
          data-testid="draw-goto-trips"
          onClick={() => setTab('trips')}
          className={PRIMARY_BUTTON_CLASS}
        >
          여행 만들러 가기
        </button>
      )}
    </section>
  );
}

/**
 * 「9월 4일 14:20」 — 목록 줄의 마지막 손질 시각.
 *
 * 값은 `page.updatedAt`이 아니라 {@link pageTouchedAt}이다 (M52a-fix ①): 요소를
 * 그려도 페이지의 도장은 움직이지 않으므로, 「손댄 때」는 껍데기와 요소 중 가장
 * 늦은 것으로 **계산된다**.
 */
function whenLabel(at: number): string {
  const date = new Date(at);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getMonth() + 1}월 ${date.getDate()}일 ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 이름만 바꾸는 한 줄 시트 — 일정표 이름(M40)과 같은 모양이다. */
function RenameDialog({ page, onClose }: { page: DrawPage; onClose: () => void }) {
  const renameDrawPage = useWorkspaceStore((s) => s.renameDrawPage);
  const [title, setTitle] = useState(page.title);

  const submit = (): void => {
    renameDrawPage(page.id, title);
    onClose();
  };

  return (
    <Sheet
      title="페이지 이름"
      onClose={onClose}
      testId="draw-rename-dialog"
      footer={
        <button
          type="button"
          data-testid="draw-rename-submit"
          onClick={submit}
          disabled={!title.trim()}
          className={`w-full ${PRIMARY_BUTTON_CLASS}`}
        >
          저장
        </button>
      }
    >
      <label className={LABEL_CLASS} htmlFor="draw-rename">
        이름
      </label>
      <input
        id="draw-rename"
        data-testid="draw-rename-input"
        value={title}
        maxLength={DRAW_TITLE_MAX}
        autoFocus
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) submit();
        }}
        className={INPUT_CLASS}
      />
    </Sheet>
  );
}

/**
 * 드로우 탭 (M52a) — 여행마다 한 권의 스케치북.
 *
 * 이 파일이 하는 일은 둘뿐이다: **어떤 페이지를 열었나**를 URL과 맞추고
 * (`#/draw/<pageId>`), 열지 않았으면 목록을 그린다. 그리는 일 전부는
 * {@link DrawEditor}가 맡는다.
 *
 * 페이지는 「이번 여행의 브레인스토밍 판」이다 — 관광지 사진(M52b)을 깔고 그
 * 위에 이모지와 낙서로 「여기 어때」를 말하는 자리이고, 그래서 보드처럼
 * 정돈되어 있지 않아도 된다.
 */
export default function DrawView() {
  const workspace = useWorkspaceStore((s) => s.workspace);
  const addDrawPage = useWorkspaceStore((s) => s.addDrawPage);
  const duplicateDrawPage = useWorkspaceStore((s) => s.duplicateDrawPage);
  const deleteDrawPage = useWorkspaceStore((s) => s.deleteDrawPage);
  const moveDrawPage = useWorkspaceStore((s) => s.moveDrawPage);
  const activeTripId = useUiStore((s) => s.activeTripId);
  const activeDrawPageId = useUiStore((s) => s.activeDrawPageId);
  const setActiveDrawPage = useUiStore((s) => s.setActiveDrawPage);
  const isDesktop = useIsDesktop();

  const [renaming, setRenaming] = useState<DrawPage | null>(null);

  const trip = activeTripId ? workspace.trips[activeTripId] : undefined;
  const pages = useMemo(() => tripPages(workspace, trip?.id), [workspace, trip?.id]);
  const open = activeDrawPageId ? workspace.drawPages?.[activeDrawPageId] : undefined;
  const openHere = open && !open.deletedAt && open.tripId === trip?.id ? open : undefined;

  /**
   * 없는 페이지를 가리키는 주소는 목록으로 되돌린다 (M52a).
   *
   * 딥링크(`#/draw/<id>`)는 지운 페이지·다른 기기의 페이지·오타를 가리킬 수
   * 있다. 「빈 편집기」를 보여 주느니 목록이 낫고, 되돌리면서 주소도 같이
   * 고쳐진다(`HashSync`가 상태를 따라간다).
   */
  useEffect(() => {
    if (activeDrawPageId && !openHere) setActiveDrawPage(undefined);
  }, [activeDrawPageId, openHere, setActiveDrawPage]);

  const warning = useMemo(
    () => drawSizeWarning(drawBytes(workspace.drawPages)),
    [workspace.drawPages],
  );

  if (!trip) return <TripPrompt />;

  if (openHere) {
    return (
      <section data-testid="view-draw" className="flex min-h-0 flex-1 flex-col">
        {warning ? <SizeWarning text={warning} /> : null}
        <DrawEditor page={openHere} onClose={() => setActiveDrawPage(undefined)} />
      </section>
    );
  }

  const addPage = (): void => {
    const id = addDrawPage(trip.id);
    if (id) setActiveDrawPage(id);
  };

  return (
    <section data-testid="view-draw" aria-labelledby="view-draw-title" className="shrink-0">
      <header className="grid grid-cols-[auto_1fr] items-center gap-x-3 px-4 pb-4 pt-6">
        {/* 제목은 줄바꿈되지 않는다 (M18 §1). */}
        <h1 id="view-draw-title" className="shrink-0 whitespace-nowrap text-display text-ink">
          드로우
        </h1>
        <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
          {isDesktop ? null : <PatchNotesButton />}
          {isDesktop ? null : <SyncStatusChip variant="dot" />}
        </div>
        <p
          data-testid="draw-trip-title"
          className="col-span-2 mt-1 min-w-0 truncate text-label text-ink-muted"
        >
          {trip.title}
        </p>
      </header>

      {warning ? <SizeWarning text={warning} /> : null}

      <div className="px-4 pb-24">
        <button
          type="button"
          data-testid="draw-add-page"
          onClick={addPage}
          className={`${PRIMARY_BUTTON_CLASS} w-full`}
        >
          <Icon name="plus" size={16} />
          페이지 추가
        </button>

        {pages.length === 0 ? (
          <p
            data-testid="draw-empty"
            className="mt-4 rounded-lg bg-sunken px-4 py-6 text-center text-label font-normal text-ink-faint"
          >
            아직 페이지가 없어요. 사진 위에 낙서하듯 아이디어를 붙여 보세요.
          </p>
        ) : (
          <ul data-testid="draw-page-list" className="mt-4 space-y-2">
            {pages.map((page, index) => (
              <li
                key={page.id}
                data-testid="draw-page-card"
                data-page-id={page.id}
                className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 shadow-raise"
              >
                <button
                  type="button"
                  data-testid="draw-page-open"
                  onClick={() => setActiveDrawPage(page.id)}
                  className="min-w-0 flex-1 py-1 text-left"
                >
                  <span className="block truncate text-label font-semibold text-ink">
                    {page.title}
                  </span>
                  <span className="mt-0.5 flex items-center gap-2 text-micro font-normal text-ink-faint">
                    <span data-testid="draw-page-count" className={COUNT_BADGE_CLASS}>
                      {liveElementCount(page)}
                    </span>
                    <span>요소</span>
                    <span aria-hidden="true">·</span>
                    <span>{whenLabel(pageTouchedAt(page))}</span>
                  </span>
                </button>

                <span className="flex shrink-0 items-center">
                  <button
                    type="button"
                    data-testid="draw-page-up"
                    aria-label="위로"
                    disabled={index === 0}
                    onClick={() => moveDrawPage(page.id, -1)}
                    className={TOUCH_ICON_BUTTON_CLASS}
                  >
                    <Icon name="chevron-up" size={16} />
                  </button>
                  <button
                    type="button"
                    data-testid="draw-page-down"
                    aria-label="아래로"
                    disabled={index === pages.length - 1}
                    onClick={() => moveDrawPage(page.id, 1)}
                    className={TOUCH_ICON_BUTTON_CLASS}
                  >
                    <Icon name="chevron-down" size={16} />
                  </button>
                  <button
                    type="button"
                    data-testid="draw-page-rename"
                    aria-label="이름 바꾸기"
                    onClick={() => setRenaming(page)}
                    className={TOUCH_ICON_BUTTON_CLASS}
                  >
                    <Icon name="pencil" size={16} />
                  </button>
                  <button
                    type="button"
                    data-testid="draw-page-duplicate"
                    aria-label="복제"
                    onClick={() => duplicateDrawPage(page.id)}
                    className={TOUCH_ICON_BUTTON_CLASS}
                  >
                    <Icon name="copy" size={16} />
                  </button>
                  <button
                    type="button"
                    data-testid="draw-page-delete"
                    aria-label="삭제"
                    onClick={() =>
                      deleteWithUndo('drawPage', page.title, () => {
                        deleteDrawPage(page.id);
                        // 방문의 서랍도 함께 비운다 (M52b) — 되살아난 페이지는
                        // 새 방문이고, 지워진 페이지의 실행취소 스택이 남아
                        // 있으면 그것이 다음 방문에 이어 붙는다.
                        forgetDrawPage(page.id);
                      })
                    }
                    className={TOUCH_ICON_BUTTON_CLASS}
                  >
                    <Icon name="trash" size={16} />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {renaming ? <RenameDialog page={renaming} onClose={() => setRenaming(null)} /> : null}
    </section>
  );
}

/**
 * 용량 한 줄 (M52a) — 막지 않고 말만 한다.
 *
 * 공지 배너(M47)와 같은 중립 톤이다: 경고 삼각형도 danger 색도 쓰지 않는다.
 * 여기서 넘친 것은 「데이터가 사라진다」가 아니라 「동기화가 무거워진다」이고,
 * 그 둘을 같은 색으로 칠하면 진짜 경고가 묽어진다.
 */
function SizeWarning({ text }: { text: string }) {
  return (
    <p
      data-testid="draw-size-warning"
      className="mx-4 mb-2 flex items-start gap-2 rounded-md bg-sunken px-3 py-2 text-micro font-normal text-ink-muted"
    >
      <Icon name="info" size={16} className="mt-px" />
      {text}
    </p>
  );
}
