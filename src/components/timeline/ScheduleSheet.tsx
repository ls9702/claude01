import { useMemo, useState } from 'react';
import { useUndoStore } from '../../stores/undoStore';
import { useUiStore } from '../../stores/uiStore';
import { FIRST_SHEET_NAME, useWorkspaceStore } from '../../stores/workspaceStore';
import type { Card, Day, Id, Sheet as SheetModel } from '../../types/models';
import {
  DAY_MIN,
  MIN_ENTRY_MIN,
  SNAP_MIN,
  formatClock,
  formatDuration,
  formatTimeRange,
} from '../../utils/time';
import Sheet from '../common/Sheet';
import Icon from '../common/Icon';
import {
  CHIP_BUTTON,
  CHIP_SELECTED,
  INPUT_CLASS,
  LABEL_CLASS,
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
} from '../common/formStyles';
import { dayTitle } from './DayColumn';

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
  const [durationMin, setDurationMin] = useState(card.defaultDurationMin ?? 60);

  const stepStart = (delta: number) =>
    setStartMin((value) => Math.min(Math.max(value + delta, 0), DAY_MIN - MIN_ENTRY_MIN));
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

  const submit = () => {
    if (!selectedDayId) return;
    const entryId = scheduleCard(card.id, selectedDayId, startMin, durationMin);
    if (entryId) offer(`'${card.title}' 배치됨`, () => deleteEntry(entryId));
    onClose();
  };

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
          disabled={!selectedDayId}
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
                className={`${SECONDARY_BUTTON_CLASS} w-11 shrink-0 px-0`}
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
                className={`${SECONDARY_BUTTON_CLASS} w-11 shrink-0 px-0`}
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
                className={`${SECONDARY_BUTTON_CLASS} w-11 shrink-0 px-0`}
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
                className={`${SECONDARY_BUTTON_CLASS} w-11 shrink-0 px-0`}
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
      </div>
    </Sheet>
  );
}
