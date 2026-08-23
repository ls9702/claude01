import { useMemo, useState } from 'react';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import type { FlightLeg, Id, Sheet as SheetModel } from '../../types/models';
import { MAX_SHEET_DAYS, formatSheetPlan, planSheetDays, type SheetFlightOpts } from '../../utils/flights';
import Icon from '../common/Icon';
import Sheet from '../common/Sheet';
import {
  INPUT_CLASS,
  LABEL_CLASS,
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
  SECTION_TITLE_CLASS,
} from '../common/formStyles';

/** Checkbox that borrows the app's ink instead of the browser's blue (§4.5-1). */
const CHECKBOX_CLASS =
  'h-5 w-5 shrink-0 rounded-xs border border-line-strong bg-surface accent-ink ' +
  'focus-visible:ring-2 focus-visible:ring-line';

/** How the sheet's length is decided. */
type WizardMode = 'flight' | 'days';

/** One leg's form state — every field a string, as the inputs hand them over. */
interface LegForm {
  date: string;
  depTime: string;
  arrTime: string;
  arrNextDay: boolean;
  flightNo: string;
  from: string;
  to: string;
}

const emptyLeg = (): LegForm => ({
  date: '',
  depTime: '',
  arrTime: '',
  arrNextDay: false,
  flightNo: '',
  from: '',
  to: '',
});

const legFormOf = (leg: FlightLeg | undefined): LegForm =>
  leg
    ? {
        date: leg.date,
        depTime: leg.depTime,
        arrTime: leg.arrTime,
        arrNextDay: Boolean(leg.arrNextDay),
        flightNo: leg.flightNo ?? '',
        from: leg.from ?? '',
        to: leg.to ?? '',
      }
    : emptyLeg();

/** A form leg becomes a real one only once date + both times are filled in. */
function toLeg(form: LegForm): FlightLeg | undefined {
  if (!form.date || !form.depTime || !form.arrTime) return undefined;
  const optional = {
    ...(form.flightNo.trim() ? { flightNo: form.flightNo.trim() } : {}),
    ...(form.from.trim() ? { from: form.from.trim() } : {}),
    ...(form.to.trim() ? { to: form.to.trim() } : {}),
  };
  return {
    date: form.date,
    depTime: form.depTime,
    arrTime: form.arrTime,
    ...(form.arrNextDay ? { arrNextDay: true } : {}),
    ...optional,
  };
}

interface LegFieldsProps {
  legend: string;
  /** Prefix for this leg's test ids: `wizard-out` / `wizard-in`. */
  testId: string;
  value: LegForm;
  onChange: (next: LegForm) => void;
}

/** 날짜 · 출발/도착 시각 · +1일 · 편명/공항 for one leg. */
function LegFields({ legend, testId, value, onChange }: LegFieldsProps) {
  const patch = (part: Partial<LegForm>) => onChange({ ...value, ...part });

  return (
    <fieldset
      data-testid={`${testId}-fields`}
      className="rounded-lg border border-line bg-transparent p-4"
    >
      <legend className={`px-1 ${SECTION_TITLE_CLASS}`}>{legend}</legend>

      <div className="space-y-4">
        <div>
          <label className={LABEL_CLASS} htmlFor={`${testId}-date`}>
            날짜
          </label>
          <input
            id={`${testId}-date`}
            data-testid={`${testId}-date`}
            type="date"
            value={value.date}
            onChange={(event) => patch({ date: event.target.value })}
            className={INPUT_CLASS}
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={LABEL_CLASS} htmlFor={`${testId}-dep`}>
              출발
            </label>
            <input
              id={`${testId}-dep`}
              data-testid={`${testId}-dep`}
              type="time"
              value={value.depTime}
              onChange={(event) => patch({ depTime: event.target.value })}
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <label className={LABEL_CLASS} htmlFor={`${testId}-arr`}>
              도착
            </label>
            <input
              id={`${testId}-arr`}
              data-testid={`${testId}-arr`}
              type="time"
              value={value.arrTime}
              onChange={(event) => patch({ arrTime: event.target.value })}
              className={INPUT_CLASS}
            />
          </div>
        </div>

        <label className="flex items-center gap-2 text-label text-ink-muted">
          <input
            data-testid={`${testId}-next`}
            type="checkbox"
            checked={value.arrNextDay}
            onChange={(event) => patch({ arrNextDay: event.target.checked })}
            className={CHECKBOX_CLASS}
          />
          다음 날 도착 (+1일)
        </label>

        {/* Labelled, because `aria-label` alone tells you nothing once the
            three boxes are full of three-letter codes (M9 §4.5-2). At 390px
            the pair sits on one row and 편명 takes the full width below. */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <div>
            <span className="block text-micro font-normal text-ink-faint">출발지</span>
            <input
              data-testid={`${testId}-from`}
              aria-label={`${legend} 출발지`}
              value={value.from}
              onChange={(event) => patch({ from: event.target.value })}
              placeholder="ICN"
              className={`${INPUT_CLASS} mt-1`}
            />
          </div>
          <div>
            <span className="block text-micro font-normal text-ink-faint">도착지</span>
            <input
              data-testid={`${testId}-to`}
              aria-label={`${legend} 도착지`}
              value={value.to}
              onChange={(event) => patch({ to: event.target.value })}
              placeholder="KIX"
              className={`${INPUT_CLASS} mt-1`}
            />
          </div>
          <div className="col-span-2 sm:col-span-1">
            <span className="block text-micro font-normal text-ink-faint">편명</span>
            <input
              data-testid={`${testId}-no`}
              aria-label={`${legend} 편명`}
              value={value.flightNo}
              onChange={(event) => patch({ flightNo: event.target.value })}
              placeholder="OZ112"
              className={`${INPUT_CLASS} mt-1`}
            />
          </div>
        </div>
      </div>
    </fieldset>
  );
}

interface DayStepperProps {
  value: number;
  onChange: (next: number) => void;
}

/** ±1일 stepper — the 일수 mode's only input. */
function DayStepper({ value, onChange }: DayStepperProps) {
  const step = (delta: number) =>
    onChange(Math.min(Math.max(value + delta, 1), MAX_SHEET_DAYS));

  return (
    <div>
      <span className={LABEL_CLASS}>일수</span>
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          data-testid="wizard-days-minus"
          aria-label="일수 줄이기"
          onClick={() => step(-1)}
          className={`${SECONDARY_BUTTON_CLASS} w-11 shrink-0 px-0`}
        >
          <Icon name="minus" size={16} />
        </button>
        <output
          data-testid="wizard-days-value"
          className="h-11 flex-1 rounded-md bg-sunken py-3 text-center text-body font-semibold tabular-nums text-ink lg:h-9 lg:py-2"
        >
          {value}일
        </output>
        <button
          type="button"
          data-testid="wizard-days-plus"
          aria-label="일수 늘리기"
          onClick={() => step(1)}
          className={`${SECONDARY_BUTTON_CLASS} w-11 shrink-0 px-0`}
        >
          <Icon name="plus" size={16} />
        </button>
      </div>
    </div>
  );
}

interface SheetWizardProps {
  tripId: Id;
  /** Editing an existing sheet (항공편 수정) instead of creating a new one. */
  sheet?: SheetModel;
  /** Suggested name for a new sheet — `일정 2`, `일정 3`, … */
  suggestedName?: string;
  onClose: () => void;
  /** Fired with the created / edited sheet id, so the view can activate it. */
  onDone?: (sheetId: Id) => void;
}

/**
 * 새 시트 마법사: one form that builds a sheet either from its flights or from
 * a plain day count.
 *
 * Deliberately step-*lite* — a single scrollable form with a live preview line
 * rather than a multi-page wizard, because every field is optional except the
 * outbound date and its two times.
 *
 * In edit mode the same form re-plans an existing sheet through
 * `updateSheetFlights`, which shifts the days it keeps and drops the ones that
 * fall outside the new range.
 */
export default function SheetWizard({
  tripId,
  sheet,
  suggestedName,
  onClose,
  onDone,
}: SheetWizardProps) {
  const createSheetFromFlights = useWorkspaceStore((s) => s.createSheetFromFlights);
  const updateSheet = useWorkspaceStore((s) => s.updateSheet);
  const updateSheetFlights = useWorkspaceStore((s) => s.updateSheetFlights);

  const editing = Boolean(sheet);

  const [name, setName] = useState(sheet?.name ?? suggestedName ?? '새 일정');
  const [mode, setMode] = useState<WizardMode>(sheet && !sheet.outboundFlight ? 'days' : 'flight');
  const [outbound, setOutbound] = useState<LegForm>(legFormOf(sheet?.outboundFlight));
  const [hasInbound, setHasInbound] = useState(sheet ? Boolean(sheet.inboundFlight) : true);
  const [inbound, setInbound] = useState<LegForm>(legFormOf(sheet?.inboundFlight));
  const [dayCount, setDayCount] = useState(
    sheet && sheet.dayOrder.length > 0 ? sheet.dayOrder.length : 3,
  );

  const opts = useMemo<SheetFlightOpts>(() => {
    if (mode === 'days') return { dayCount };
    const out = toLeg(outbound);
    const back = hasInbound ? toLeg(inbound) : undefined;
    return {
      ...(out ? { outbound: out } : {}),
      ...(back ? { inbound: back } : {}),
      // A one-way sheet has no end date, so the 일수 answers "how long?".
      ...(back ? {} : { dayCount }),
    };
  }, [mode, dayCount, outbound, hasInbound, inbound]);

  const plan = useMemo(() => planSheetDays(opts), [opts]);
  const preview = formatSheetPlan(plan);
  const canSubmit = mode === 'days' ? dayCount >= 1 : Boolean(opts.outbound);

  const submit = () => {
    if (!canSubmit) return;
    if (sheet) {
      updateSheet(sheet.id, { name: name.trim() || sheet.name });
      updateSheetFlights(sheet.id, opts);
      onDone?.(sheet.id);
    } else {
      const created = createSheetFromFlights(tripId, name, opts);
      if (created) onDone?.(created.sheetId);
    }
    onClose();
  };

  return (
    <Sheet
      title={editing ? '시트 수정' : '새 시트'}
      onClose={onClose}
      testId="sheet-wizard"
      footer={
        <div className="space-y-3">
          {/* The answer this whole form is computing, in the footer where it
              cannot scroll away — and, unlike the sticky bar it replaces, where
              it cannot sit on top of the fields either (M9 §4.5-5). */}
          <p
            data-testid="wizard-preview"
            data-day-count={plan.count}
            className="text-center text-title text-ink"
          >
            {preview || '날짜를 채우면 일정 기간이 보여요'}
          </p>
          <button
            type="button"
            data-testid="wizard-submit"
            onClick={submit}
            disabled={!canSubmit}
            className={`w-full ${PRIMARY_BUTTON_CLASS}`}
          >
            {editing ? '이대로 수정' : '이대로 만들기'}
          </button>
        </div>
      }
    >
      <div className="space-y-6">
        <div>
          <label className={LABEL_CLASS} htmlFor="wizard-name">
            시트 이름
          </label>
          <input
            id="wizard-name"
            data-testid="wizard-name-input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="예: 본 일정"
            className={INPUT_CLASS}
          />
        </div>

        {/* A segmented control, not two primaries. Black fill belongs to the
            one primary button in the footer (M9 §4.5-4). */}
        <div data-testid="wizard-mode" className="inline-flex w-full rounded-md bg-sunken p-1">
          {(
            [
              ['flight', '항공편', 'route'],
              ['days', '일수', 'calendar'],
            ] as const
          ).map(([value, label, icon]) => (
            <button
              key={value}
              type="button"
              data-testid={`wizard-mode-${value}`}
              aria-pressed={mode === value}
              onClick={() => setMode(value)}
              className={[
                'flex h-9 flex-1 items-center justify-center gap-1 rounded-md text-label',
                'transition-colors duration-[140ms] ease-quick',
                mode === value ? 'bg-surface text-ink shadow-raise' : 'text-ink-muted',
              ].join(' ')}
            >
              <Icon name={icon} size={16} />
              {label}
            </button>
          ))}
        </div>

        {mode === 'flight' ? (
          <>
            <LegFields
              legend="출발편"
              testId="wizard-out"
              value={outbound}
              onChange={setOutbound}
            />

            <label className="flex items-center gap-2 text-label text-ink-muted">
              <input
                data-testid="wizard-inbound-toggle"
                type="checkbox"
                checked={hasInbound}
                onChange={(event) => setHasInbound(event.target.checked)}
                className={CHECKBOX_CLASS}
              />
              귀국편도 입력할래요
            </label>

            {hasInbound ? (
              <LegFields
                legend="귀국편"
                testId="wizard-in"
                value={inbound}
                onChange={setInbound}
              />
            ) : (
              <DayStepper value={dayCount} onChange={setDayCount} />
            )}
          </>
        ) : (
          <DayStepper value={dayCount} onChange={setDayCount} />
        )}

        {editing ? (
          <p className="text-micro font-normal text-ink-faint">
            기간이 짧아지면 범위 밖 일자와 그 일정은 삭제되고, 카드는 다시 미배치로 돌아가요.
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}
