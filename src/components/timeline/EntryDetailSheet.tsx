import { useEffect, useRef, useState } from 'react';
import { DIRECTIONS_LABEL, directionsUrl } from '../../map/directions';
import type { Card, TimelineEntry } from '../../types/models';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import {
  DAY_MIN,
  SNAP_MIN,
  formatDuration,
  formatTimeRange,
} from '../../utils/time';
import CardLedger, { type LocalMoney } from '../common/CardLedger';
import CardPhotoStrip from '../common/CardPhotoStrip';
import Sheet from '../common/Sheet';
import Icon from '../common/Icon';
import {
  DANGER_TEXT_BUTTON_CLASS,
  LABEL_CLASS,
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
  SQUARE_BUTTON_CLASS,
  TEXTAREA_CLASS,
} from '../common/formStyles';

interface StepperProps {
  label: string;
  value: string;
  testId: string;
  onStep: (delta: number) => void;
}

/** ±15분 pair around a read-only value — the reliable mobile time editor. */
function Stepper({ label, value, testId, onStep }: StepperProps) {
  return (
    <div>
      <span className={LABEL_CLASS}>{label}</span>
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          data-testid={`${testId}-minus`}
          aria-label={`${label} 15분 줄이기`}
          onClick={() => onStep(-SNAP_MIN)}
          className={SQUARE_BUTTON_CLASS}
        >
          <Icon name="minus" size={16} />
        </button>
        <output
          data-testid={`${testId}-value`}
          className="h-11 flex-1 rounded-md bg-sunken py-3 text-center text-body font-semibold tabular-nums text-ink lg:h-9 lg:py-2"
        >
          {value}
        </output>
        <button
          type="button"
          data-testid={`${testId}-plus`}
          aria-label={`${label} 15분 늘리기`}
          onClick={() => onStep(SNAP_MIN)}
          className={SQUARE_BUTTON_CLASS}
        >
          <Icon name="plus" size={16} />
        </button>
      </div>
    </div>
  );
}

interface EntryDetailSheetProps extends LocalMoney {
  entry: TimelineEntry;
  card?: Card;
  /** Day heading shown in the sheet subtitle. */
  dayTitle: string;
  /** Trip currency, for the 지출 기록 section. Defaults to `KRW`. */
  currency?: string;
  /**
   * 「길찾기」의 출발지 (M42) — 이 배치 **바로 앞**에 오는 그 날의 장소.
   *
   * 05시 창의 그 날 동선(`dayRouteWindowed`)에서 나온다. 앞이 없으면(그 날의 첫
   * 장소, 또는 위치 있는 장소가 이것뿐이면) 없이 온다 — 그러면 링크는 도착지만
   * 싣고, 구글이 현재 위치에서 길을 찾는다.
   */
  directionsOrigin?: { lat: number; lng: number } | null;
  onClose: () => void;
  /** Deletes with an 실행 취소 offer — owned by the view. */
  onDelete: (entry: TimelineEntry) => void;
  /** Jumps to the 보드 tab with this card's trip active. */
  onOpenBoard?: () => void;
}

/** Tallest the 메모 box grows before it scrolls inside itself (M39). */
const MAX_NOTE_PX = 240;

/**
 * Tap-an-entry detail sheet: card info, note, ±15분 time editors, delete.
 *
 * These steppers are the dependable path on touch devices — dragging a block
 * works, but nudging a start time by a quarter hour with a thumb does not.
 *
 * 메모는 이 시트에만 있다 (M39): 그리드의 블록은 15분짜리 한 줄일 수도 있어서
 * 글이 들어갈 자리가 없고, 대신 모서리에 접힌 자국이 서서 「여기 적어 둔 것이
 * 있다」만 말한다. 읽는 자리와 쓰는 자리가 같은 하나라는 뜻이기도 하다 —
 * 자국이 보이면 블록을 눌러 이리로 온다.
 */
export default function EntryDetailSheet({
  entry,
  card,
  dayTitle,
  currency = 'KRW',
  localCurrency,
  fxRate,
  directionsOrigin,
  onClose,
  onDelete,
  onOpenBoard,
}: EntryDetailSheetProps) {
  const moveEntry = useWorkspaceStore((s) => s.moveEntry);
  const resizeEntry = useWorkspaceStore((s) => s.resizeEntry);
  const updateEntryNote = useWorkspaceStore((s) => s.updateEntryNote);
  const [note, setNote] = useState(entry.note ?? '');
  const noteRef = useRef<HTMLTextAreaElement | null>(null);

  /**
   * Grows with the memo, capped so the sheet keeps its shape (M39).
   *
   * `rows`가 정한 세 줄 아래로는 **줄어들지 않는다**: `height: auto`로 되돌린
   * 순간의 `clientHeight`가 바로 그 세 줄이고, 짧은 메모의 `scrollHeight`는 그보다
   * 작다. 바닥을 두지 않으면 빈 메모 칸이 한 줄로 짜부라져 M39 이전보다 좁아진다.
   */
  const growNote = (): void => {
    const node = noteRef.current;
    if (!node) return;
    node.style.height = 'auto';
    const floor = node.clientHeight;
    node.style.height = `${Math.min(Math.max(node.scrollHeight, floor), MAX_NOTE_PX)}px`;
  };

  // 이미 적혀 있던 메모는 처음부터 제 높이로 열린다 — 열자마자 스크롤바를
  // 만나는 것은 세 줄짜리 메모에게 부당하다.
  useEffect(growNote, []);

  /**
   * 시작만 움직인다 — 소요는 건드리지 않는다 (M50).
   *
   * 상한이 `DAY_MIN - entry.durationMin`인 것은 `clampMove`가 스토어에서 쓰는
   * 바로 그 상한이다. 전에는 여기서 `DAY_MIN - MIN_ENTRY_MIN`까지 올려 보내고
   * 스토어가 그 차이를 **소요에서** 깎았으므로, 3시간짜리 일정을 자정 쪽으로
   * 밀면 한 번 누를 때마다 15분씩 사라졌다(헌터A #1). 두 상한을 같게 두면
   * 걸린 뒤로는 아무 일도 일어나지 않고, 화면의 미리보기는 항상 참말이 된다.
   */
  const stepStart = (delta: number) => {
    const next = Math.min(Math.max(entry.startMin + delta, 0), DAY_MIN - entry.durationMin);
    moveEntry(entry.id, entry.dayId, next);
  };

  const stepDuration = (delta: number) => {
    resizeEntry(entry.id, entry.durationMin + delta);
  };

  /** 위치가 있는 카드에만 서는 링크 — 없으면 `null`이고 버튼도 없다. */
  const directionsHref = directionsUrl(card?.location, directionsOrigin);

  const save = () => {
    // 손질도, 비우면 필드를 키째 지우는 것도, 그대로면 아무 일도 하지 않는 것도
    // 전부 스토어 쪽 규칙이다 — 이 화면은 「저장」과 「닫기」만 안다 (M39).
    updateEntryNote(entry.id, note);
    onClose();
  };

  return (
    <Sheet
      title={card?.title ?? '일정'}
      onClose={onClose}
      testId="entry-sheet"
      footer={
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            data-testid="entry-delete"
            onClick={() => onDelete(entry)}
            className={DANGER_TEXT_BUTTON_CLASS}
          >
            삭제
          </button>
          <button
            type="button"
            data-testid="entry-save"
            onClick={save}
            className={`flex-1 ${PRIMARY_BUTTON_CLASS}`}
          >
            저장
          </button>
        </div>
      }
    >
      <div className="space-y-6">
        <p className="text-label font-normal text-ink-muted">
          {dayTitle} ·{' '}
          <span data-testid="entry-range" className="font-semibold tabular-nums text-ink">
            {formatTimeRange(entry.startMin, entry.durationMin)}
          </span>{' '}
          · {formatDuration(entry.durationMin)}
        </p>

        {card?.memo ? (
          <p className="rounded-md bg-sunken px-3 py-2 text-label font-normal text-ink-muted">
            {card.memo}
          </p>
        ) : null}

        <Stepper
          label="시작 시각"
          testId="entry-start"
          value={formatTimeRange(entry.startMin, entry.durationMin).split('–')[0]}
          onStep={stepStart}
        />

        <Stepper
          label="소요 시간"
          testId="entry-duration"
          value={formatDuration(entry.durationMin)}
          onStep={stepDuration}
        />

        <div>
          <label className={LABEL_CLASS} htmlFor="entry-note">
            메모
          </label>
          <textarea
            id="entry-note"
            ref={noteRef}
            data-testid="entry-note-input"
            value={note}
            rows={3}
            onChange={(event) => {
              setNote(event.target.value);
              growNote();
            }}
            placeholder="이 시간에 기억해 둘 것"
            className={TEXTAREA_CLASS}
          />
        </div>

        {/* The card owns its money, its thread and its photos, so these are
            the *same* ones the board shows — not a copy. Recording a receipt,
            or a shot of what you are looking at, from the day you are standing
            in is the whole point of 오늘 모드. */}
        {card ? (
          <div className="border-t border-line pt-6">
            <CardPhotoStrip cardId={card.id} />
          </div>
        ) : null}

        {card ? (
          <CardLedger
            card={card}
            currency={currency}
            localCurrency={localCurrency}
            fxRate={fxRate}
          />
        ) : null}

        {/* 「내일 여기 어떻게 가지」는 일정 화면에서 나오는 질문이다 (M42).
            그래서 그 답으로 가는 문도 여기 있다 — 위치가 있는 카드에만. */}
        {directionsHref ? (
          <a
            data-testid="entry-directions"
            href={directionsHref}
            target="_blank"
            rel="noopener noreferrer"
            className={`${SECONDARY_BUTTON_CLASS} w-full`}
          >
            <Icon name="route" size={16} />
            {DIRECTIONS_LABEL}
          </a>
        ) : null}

        {onOpenBoard ? (
          <button
            type="button"
            data-testid="entry-open-board"
            onClick={onOpenBoard}
            className={`${SECONDARY_BUTTON_CLASS} w-full`}
          >
            <Icon name="board" size={16} />
            보드에서 열기
          </button>
        ) : null}
      </div>
    </Sheet>
  );
}
