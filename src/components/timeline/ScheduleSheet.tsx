import { useMemo, useState } from 'react';
import { requestPlaceFix } from '../../stores/placeFixQueue';
import { useUndoStore } from '../../stores/undoStore';
import { useUiStore } from '../../stores/uiStore';
import { FIRST_SHEET_NAME, useWorkspaceStore } from '../../stores/workspaceStore';
import type { Card, Day, Id, Sheet as SheetModel } from '../../types/models';
import {
  DAY_MIN,
  DAY_START_MIN,
  MIN_ENTRY_MIN,
  SNAP_MIN,
  formatClock,
  formatDuration,
  formatTimeRange,
} from '../../utils/time';
import Sheet from '../common/Sheet';
import Icon from '../common/Icon';
import { useSubmitLock } from '../common/useSubmitLock';
import {
  CHIP_BUTTON,
  CHIP_SELECTED,
  INPUT_CLASS,
  LABEL_CLASS,
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
  SQUARE_BUTTON_CLASS,
} from '../common/formStyles';
import { dayTitle } from '../../timeline/dayLabel';
import { dropTarget } from '../../timeline/dayWindow';

/** Opening time offered when a card is scheduled from the board. */
const DEFAULT_START_MIN = 600; // 10:00

interface ScheduleSheetProps {
  card: Card;
  onClose: () => void;
}

/**
 * The touch-friendly way to put a card on the timeline: pick 시트 / 일자 and
 * nudge the time in 15-minute steps.
 *
 * This is the mobile counterpart of the desktop drag — M2b adds a proper card
 * tray, but the numbers this sheet writes go through the very same
 * `scheduleCard` mutation.
 */
export default function ScheduleSheet({ card, onClose }: ScheduleSheetProps) {
  const workspace = useWorkspaceStore((s) => s.workspace);
  const addSheet = useWorkspaceStore((s) => s.addSheet);
  const addDay = useWorkspaceStore((s) => s.addDay);
  const scheduleCard = useWorkspaceStore((s) => s.scheduleCard);
  const deleteEntry = useWorkspaceStore((s) => s.deleteEntry);
  const offer = useUndoStore((s) => s.offer);
  const notify = useUndoStore((s) => s.notify);

  const trip = workspace.trips[card.tripId];

  const sheets = useMemo<SheetModel[]>(
    () =>
      (trip?.sheetOrder ?? [])
        .map((sheetId) => workspace.sheets[sheetId])
        .filter((sheet): sheet is SheetModel => Boolean(sheet)),
    [trip?.sheetOrder, workspace.sheets],
  );

  // Open on whatever sheet the 일정 tab is showing — a card scheduled from the
  // board would otherwise silently land on the trip's first sheet.
  const currentSheetId = useUiStore((s) => s.activeSheetId);
  const [sheetId, setSheetId] = useState<Id | undefined>(
    currentSheetId && sheets.some((entry) => entry.id === currentSheetId)
      ? currentSheetId
      : sheets[0]?.id,
  );
  const activeSheet: SheetModel | undefined = sheetId ? workspace.sheets[sheetId] : sheets[0];

  const days = useMemo<Day[]>(
    () =>
      (activeSheet?.dayOrder ?? [])
        .map((dayId) => workspace.days[dayId])
        .filter((day): day is Day => Boolean(day)),
    [activeSheet?.dayOrder, workspace.days],
  );

  const [dayId, setDayId] = useState<Id | undefined>(days[0]?.id);
  const selectedDayId = dayId && days.some((day) => day.id === dayId) ? dayId : days[0]?.id;

  const [startMin, setStartMin] = useState(DEFAULT_START_MIN);
  const [durationMin, setDurationMin] = useState(() =>
    Math.min(Math.max(card.defaultDurationMin ?? 60, MIN_ENTRY_MIN), DAY_MIN - DEFAULT_START_MIN),
  );

  /**
   * 시작을 밀어도 소요는 그대로다 (M50) — 상한이 `DAY_MIN - durationMin`인 것은
   * 스토어의 `clampMove`와 `EntryDetailSheet`가 쓰는 바로 그 상한이다.
   *
   * 전에는 `DAY_MIN - MIN_ENTRY_MIN`까지 시작이 올라갔으므로, 아래의
   * `schedule-preview`가 「23:45–02:45」 같은 **배치될 수 없는** 시간을 보여
   * 주고는 `scheduleCard`의 `clampEntry`가 조용히 15분으로 잘라 넣었다.
   * 두 상한을 맞추면 미리보기가 곧 결과다.
   */
  const stepStart = (delta: number) =>
    setStartMin((value) => Math.min(Math.max(value + delta, 0), DAY_MIN - durationMin));
  const stepDuration = (delta: number) =>
    setDurationMin((value) =>
      Math.min(Math.max(value + delta, MIN_ENTRY_MIN), DAY_MIN - startMin),
    );

  const createDay = () => {
    let targetSheetId: Id | undefined = activeSheet?.id;
    if (!targetSheetId && trip) {
      targetSheetId = addSheet(trip.id, FIRST_SHEET_NAME) ?? undefined;
      setSheetId(targetSheetId);
    }
    if (!targetSheetId) return;
    const created = addDay(targetSheetId);
    if (created) setDayId(created);
  };

  /**
   * 「N일차 + 02:00」은 N일차의 **밤**이다 (M16-B).
   *
   * 1일차 = 1일차 05시 ~ 2일차 05시이므로, 고른 일자에 05시 이전 시각을 붙이면
   * 그것이 가리키는 달력 날짜는 그 다음 날이다. `dropTarget`이 그리드에서 하는
   * 변환과 똑같은 변환을, 여기서는 픽셀 대신 고른 시각에 적용한다.
   *
   * 마지막 일자에는 다음 날이 없다 → 그 시각은 이 시트로 표현할 수 없으므로
   * `null`을 돌려 배치를 거절한다.
   */
  const placement = (): { dayId: Id; startMin: number } | null => {
    if (!selectedDayId) return null;
    if (startMin >= DAY_START_MIN) return { dayId: selectedDayId, startMin };
    return dropTarget(selectedDayId, startMin + DAY_MIN - DAY_START_MIN, activeSheet?.dayOrder ?? []);
  };

  /**
   * 「마지막 일자 + 05시 이전」은 이 시트로 표현할 수 없다 — 미리 말한다 (+A).
   *
   * `placement()`가 `null`을 주는 바로 그 조합이다. 전에는 눌러야 알 수 있었고,
   * 토스트 한 줄과 함께 시트가 닫히면서 고르던 시각·소요까지 같이 사라졌다.
   * 이제 버튼이 잠기고 이유가 그 자리에 뜨므로, 일자만 바꾸면 그대로 이어서
   * 배치할 수 있다.
   */
  const outOfRange = Boolean(selectedDayId) && placement() === null;

  // 「이 시간에 추가」 더블탭이 배치를 둘로 늘리지 않게 (M50, 헌터D2 #3).
  const once = useSubmitLock();

  const submit = () =>
    once(() => {
      const target = placement();
      if (!target) {
        notify('다음 일자가 없어요');
        onClose();
        return;
      }
      const entryId = scheduleCard(card.id, target.dayId, target.startMin, durationMin);
      if (entryId) {
        offer(`'${card.title}' 배치됨`, () => deleteEntry(entryId));
        // 드래그 배치와 같은 뒷이야기 (M41) — 구글 시트라면 위치를 한 번 되묻는다.
        requestPlaceFix(workspace, card.id, target.dayId);
      }
      onClose();
    });

  return (
    <Sheet
      title={`시간표에 추가 · ${card.title}`}
      onClose={onClose}
      testId="schedule-sheet"
      footer={
        <button
          type="button"
          data-testid="schedule-submit"
          onClick={submit}
          disabled={!selectedDayId || outOfRange}
          className={`w-full ${PRIMARY_BUTTON_CLASS}`}
        >
          이 시간에 추가
        </button>
      }
    >
      <div className="space-y-6">
        {sheets.length > 1 ? (
          <div>
            <label className={LABEL_CLASS} htmlFor="schedule-sheet-select">
              일정표
            </label>
            <select
              id="schedule-sheet-select"
              data-testid="schedule-sheet-select"
              value={activeSheet?.id ?? ''}
              onChange={(event) => {
                setSheetId(event.target.value);
                setDayId(undefined);
              }}
              className={INPUT_CLASS}
            >
              {sheets.map((sheet) => (
                <option key={sheet.id} value={sheet.id}>
                  {sheet.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <div>
          <span className={LABEL_CLASS}>일자</span>
          {days.length === 0 ? (
            <div className="mt-2 rounded-md border border-dashed border-line px-3 py-6 text-center">
              <p className="text-label font-normal text-ink-faint">아직 일자가 없어요.</p>
              <button
                type="button"
                data-testid="schedule-add-day"
                onClick={createDay}
                className={`mt-3 ${SECONDARY_BUTTON_CLASS}`}
              >
                <Icon name="plus" size={16} />
                일자 추가
              </button>
            </div>
          ) : (
            <div data-testid="schedule-day-picker" className="mt-2 flex flex-wrap gap-2">
              {days.map((day, index) => {
                const active = day.id === selectedDayId;
                return (
                  <button
                    key={day.id}
                    type="button"
                    data-testid="schedule-day-option"
                    data-day-id={day.id}
                    aria-pressed={active}
                    onClick={() => setDayId(day.id)}
                    className={active ? CHIP_SELECTED : CHIP_BUTTON}
                  >
                    {dayTitle(day, index)}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <span className={LABEL_CLASS}>시작</span>
            <div className="mt-2 flex items-center gap-1">
              <button
                type="button"
                data-testid="schedule-start-minus"
                aria-label="시작 15분 줄이기"
                onClick={() => stepStart(-SNAP_MIN)}
                className={SQUARE_BUTTON_CLASS}
              >
                <Icon name="minus" size={16} />
              </button>
              <output
                data-testid="schedule-start-value"
                className="flex-1 text-center text-body font-semibold tabular-nums text-ink"
              >
                {formatClock(startMin)}
              </output>
              <button
                type="button"
                data-testid="schedule-start-plus"
                aria-label="시작 15분 늘리기"
                onClick={() => stepStart(SNAP_MIN)}
                className={SQUARE_BUTTON_CLASS}
              >
                <Icon name="plus" size={16} />
              </button>
            </div>
          </div>

          <div>
            <span className={LABEL_CLASS}>소요</span>
            <div className="mt-2 flex items-center gap-1">
              <button
                type="button"
                data-testid="schedule-duration-minus"
                aria-label="소요 시간 15분 줄이기"
                onClick={() => stepDuration(-SNAP_MIN)}
                className={SQUARE_BUTTON_CLASS}
              >
                <Icon name="minus" size={16} />
              </button>
              <output
                data-testid="schedule-duration-value"
                className="flex-1 text-center text-body font-semibold tabular-nums text-ink"
              >
                {formatDuration(durationMin)}
              </output>
              <button
                type="button"
                data-testid="schedule-duration-plus"
                aria-label="소요 시간 15분 늘리기"
                onClick={() => stepDuration(SNAP_MIN)}
                className={SQUARE_BUTTON_CLASS}
              >
                <Icon name="plus" size={16} />
              </button>
            </div>
          </div>
        </div>

        <p
          data-testid="schedule-preview"
          className="rounded-md bg-sunken px-3 py-3 text-center text-title tabular-nums text-ink"
        >
          {formatTimeRange(startMin, durationMin)}
        </p>

        {outOfRange ? (
          <p
            data-testid="schedule-out-of-range"
            role="status"
            className="rounded-md bg-warn-wash px-3 py-2 text-center text-label font-normal text-warn-ink ring-1 ring-warn/40"
          >
            마지막 일자라 새벽(05시 이전)으로 넘길 수 없어요
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}
