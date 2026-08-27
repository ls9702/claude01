import { useEffect, useMemo, useRef, useState } from 'react';
import { aiSearchPlaces } from '../../ai/aiPlaces';
import {
  applyPlan,
  auditTargets,
  formatDistance,
  isApplicable,
  proposeLocation,
  restoreSnapshot,
  scanAudit,
  type AuditRow,
  type AuditStatus,
} from '../../map/locationAudit';
import { useUndoStore } from '../../stores/undoStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import type { Id } from '../../types/models';
import { searchPlaces } from '../../utils/geo';
import Sheet from '../common/Sheet';
import TodoCheck from '../common/TodoCheck';
import { EmojiIcon } from '../common/Icon';
import { PRIMARY_BUTTON_CLASS, SECONDARY_BUTTON_CLASS } from '../common/formStyles';

interface LocationAuditSheetProps {
  tripId: Id;
  onClose: () => void;
}

/** 훑기가 어느 단계에 있는가. */
type AuditPhase = 'idle' | 'scanning' | 'done';

/** 적용되지 않는 줄이 왜 적용되지 않는지 — 한 마디씩. */
const SKIP_LABEL: Record<Exclude<AuditStatus, 'movable'>, string> = {
  near: '이미 제자리',
  far: '너무 멀어요',
  missing: '제안 없음',
  failed: '확인 실패',
};

/**
 * 「위치 재정비」 — 이미 저장된 핀들을 M35의 방식으로 다시 맞추는 창 (M36).
 *
 * 사용자의 말은 짧았다: *「전에 찍어 둔 핀들이 한두 블록씩 어긋나 있다」*. M35가
 * 고친 것은 **앞으로 찾을** 장소였고, 이미 워크스페이스에 들어앉은 좌표는 그대로
 * 남았다. 이 시트는 그 좌표들에게 같은 한 단계를 뒤늦게 적용한다.
 *
 * ## 훑고 → 보여주고 → 고른 것만
 *
 * 이 화면의 전부다. 자동으로 적용하지 않는 이유는 하나뿐이지만 그 하나가 크다:
 * 사람이 지도를 보며 손으로 맞춰 둔 핀이 섞여 있고, 기계는 그 둘을 구분하지
 * 못한다. 그래서 **모든 줄은 체크박스**이고, 30m 안쪽·3km 밖·못 찾음은 아예
 * 체크할 수 없는 줄로 아래에 접어 둔다(`map/locationAudit`).
 *
 * ## 순차인 것은 사양이다
 *
 * AI 프록시의 퓨즈는 분당 20건이고 Nominatim은 초당 1건을 권한다. 카드 서른 장에
 * 동시에 쏘면 둘 다 어긴다. 그래서 한 장씩 돌고, 대신 **몇 장째인지 세어서**
 * 보여 주고 언제든 중단할 수 있게 한다. 중단해도 그때까지의 결과는 남는다 —
 * 결과를 버리는 취소 버튼은 아무도 누르지 않는다.
 *
 * 훑기 자체와 판정은 전부 `map/locationAudit.ts`의 순수 함수들이다. 여기 있는
 * 것은 진행 표시, 체크 상태, 그리고 스토어 두 개(카드 갱신·실행 취소)뿐이다.
 */
export default function LocationAuditSheet({ tripId, onClose }: LocationAuditSheetProps) {
  const workspace = useWorkspaceStore((s) => s.workspace);
  const updateCard = useWorkspaceStore((s) => s.updateCard);
  const offer = useUndoStore((s) => s.offer);

  const [phase, setPhase] = useState<AuditPhase>('idle');
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [checked, setChecked] = useState<ReadonlySet<Id>>(new Set());
  /** 사람이 중단을 눌렀는가 — 「멈추는 중…」과 아래의 안내 한 줄이 이걸 읽는다. */
  const [stopping, setStopping] = useState(false);

  const targets = useMemo(() => auditTargets(workspace, tripId), [workspace, tripId]);
  const total = targets.length;

  const abortRef = useRef<AbortController | null>(null);
  /** 시트가 닫힌 뒤에 도착한 결과를 화면에 밀어 넣지 않기 위한 문지기. */
  const liveRef = useRef(true);

  // 닫으면 훑기도 끝난다. 시트를 닫아 두고 요청이 계속 나가는 것은
  // 「취소했다」의 정반대다.
  useEffect(() => {
    liveRef.current = true;
    return () => {
      liveRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  const start = (): void => {
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase('scanning');
    setStopping(false);
    setRows([]);
    setChecked(new Set());

    void (async () => {
      const sweep = scanAudit(targets, {
        signal: controller.signal,
        propose: (target, signal) =>
          proposeLocation(target, {
            // 대량 훑기에서는 grounding 재시도를 붙이지 않는다 — 이유는
            // `proposeLocation`의 주석에 있다.
            aiSearch: (query, hint) =>
              aiSearchPlaces(query, { destination: hint, retryGrounded: false }),
            osmSearch: searchPlaces,
            signal,
          }),
      });

      for await (const row of sweep) {
        if (!liveRef.current) return;
        setRows((current) => [...current, row]);
        // 옮길 만한 줄은 켜진 채로 등장한다 — 사람이 하는 일은 「빼는 것」이다.
        if (isApplicable(row)) {
          setChecked((current) => new Set(current).add(row.cardId));
        }
      }

      if (liveRef.current) setPhase('done');
    })();
  };

  const stop = (): void => {
    setStopping(true);
    abortRef.current?.abort();
  };

  const toggle = (cardId: Id): void => {
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(cardId)) next.delete(cardId);
      else next.add(cardId);
      return next;
    });
  };

  /**
   * 고른 줄을 카드에 써 넣고, 배치 하나를 통째로 되돌릴 수 있게 남긴다.
   *
   * 실행 취소는 **한 번에 전부**다. 열 곳을 옮겼다가 열 번 취소를 눌러야 한다면
   * 그건 되돌리기가 아니라 또 한 번의 작업이다. 좌표는 M35와 같은 규칙으로
   * 저장된다 — 바뀌는 것은 lat·lng 두 칸뿐이고 주소는 사용자의 것 그대로다.
   */
  const apply = (): void => {
    const plan = applyPlan(rows, checked);
    if (plan.length === 0) return;
    const restore = restoreSnapshot(rows, plan);

    for (const item of plan) updateCard(item.cardId, { location: item.location });
    offer(`위치 ${plan.length}곳 재정비됨`, () => {
      for (const item of restore) updateCard(item.cardId, { location: item.location });
    });
    onClose();
  };

  const movable = rows.filter(isApplicable);
  const skipped = rows.filter((row) => !isApplicable(row));
  const selected = movable.filter((row) => checked.has(row.cardId)).length;
  /** 퓨즈(429)나 중단으로 끝까지 못 간 훑기. */
  const partial = phase === 'done' && rows.length < total;

  const label = (row: AuditRow): { icon: string; title: string } => ({
    icon: workspace.columns[row.columnId]?.icon ?? '📍',
    title: row.title,
  });

  return (
    <Sheet
      title="위치 재정비"
      testId="location-audit"
      onClose={onClose}
      footer={
        phase === 'idle' ? (
          <button
            type="button"
            data-testid="location-audit-start"
            onClick={start}
            disabled={total === 0}
            className={`${PRIMARY_BUTTON_CLASS} w-full`}
          >
            시작
          </button>
        ) : phase === 'scanning' ? (
          <button
            type="button"
            data-testid="location-audit-stop"
            onClick={stop}
            disabled={stopping}
            className={`${SECONDARY_BUTTON_CLASS} w-full`}
          >
            {stopping ? '멈추는 중…' : '중단'}
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="location-audit-rescan"
              onClick={start}
              className={SECONDARY_BUTTON_CLASS}
            >
              다시 훑기
            </button>
            <button
              type="button"
              data-testid="location-audit-apply"
              data-count={selected}
              onClick={apply}
              disabled={selected === 0}
              className={`${PRIMARY_BUTTON_CLASS} ml-auto min-w-0 flex-1 sm:flex-none sm:min-w-28`}
            >
              선택 적용
            </button>
          </div>
        )
      }
    >
      <div className="space-y-4">
        {phase === 'idle' ? (
          total === 0 ? (
            <p
              data-testid="location-audit-empty"
              className="px-1 py-10 text-center text-label font-normal text-ink-muted"
            >
              위치가 있는 카드가 없어요. 카드에 위치를 넣으면 여기서 다시 맞춰 볼 수 있어요.
            </p>
          ) : (
            <>
              <p data-testid="location-audit-intro" data-total={total} className="text-label text-ink">
                이 여행의 위치 있는 카드 {total}장을 AI와 OpenStreetMap으로 다시 확인해요.
              </p>
              <p className="text-micro font-normal text-ink-faint">
                카드 한 장씩 순서대로 물어봐서 조금 걸려요. 확인만 하고, 옮길지는 목록에서
                직접 고르면 돼요.
              </p>
            </>
          )
        ) : null}

        {phase === 'scanning' ? (
          <>
            <p
              data-testid="location-audit-progress"
              data-done={rows.length}
              data-total={total}
              className="text-label tabular-nums text-ink"
            >
              {rows.length}/{total} 확인했어요
            </p>
            <div aria-hidden="true" className="h-1 w-full overflow-hidden rounded-full bg-sunken">
              <span
                className="block h-full rounded-full bg-inverse transition-[width] duration-[240ms] ease-quick"
                style={{ width: `${total === 0 ? 0 : (rows.length / total) * 100}%` }}
              />
            </div>
            <p className="text-micro font-normal text-ink-faint">
              {stopping
                ? '이번 카드까지만 확인하고 멈춰요.'
                : '중단해도 여기까지 확인한 결과는 그대로 남아요.'}
            </p>
          </>
        ) : null}

        {phase === 'done' ? (
          <>
            <p
              data-testid="location-audit-summary"
              data-movable={movable.length}
              data-scanned={rows.length}
              className="text-label text-ink"
            >
              {movable.length > 0
                ? `옮길 만한 곳 ${movable.length}곳을 찾았어요.`
                : '이미 정리돼 있어요 — 옮길 곳이 없어요.'}
            </p>

            {partial ? (
              <p data-testid="location-audit-partial" className="text-micro font-normal text-ink-faint">
                {total - rows.length}장은 확인하지 못했어요. 「다시 훑기」로 이어서 볼 수 있어요.
              </p>
            ) : null}

            {movable.length > 0 ? (
              <ul>
                {movable.map((row) => {
                  const { icon, title } = label(row);
                  const on = checked.has(row.cardId);
                  return (
                    <li key={row.cardId}>
                      <button
                        type="button"
                        data-testid="location-audit-row"
                        data-card-id={row.cardId}
                        data-checked={on ? 'true' : 'false'}
                        role="checkbox"
                        aria-checked={on}
                        onClick={() => toggle(row.cardId)}
                        className="flex min-h-11 w-full items-center gap-3 rounded-md px-1 py-2 text-left transition-colors duration-[140ms] ease-quick hover:bg-sunken"
                      >
                        <TodoCheck done={on} />
                        <EmojiIcon emoji={icon} />
                        <span className="min-w-0 flex-1 truncate text-label text-ink">{title}</span>
                        <span
                          data-testid="location-audit-distance"
                          data-km={row.distanceKm}
                          className="shrink-0 text-micro tabular-nums text-ink-muted"
                        >
                          {formatDistance(row.distanceKm ?? 0)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}

            {skipped.length > 0 ? (
              <div className="border-t border-line pt-3">
                <h3
                  data-testid="location-audit-skipped"
                  data-count={skipped.length}
                  className="text-micro font-medium text-ink-faint"
                >
                  그대로 두는 곳 {skipped.length}곳
                </h3>
                <ul className="mt-1">
                  {skipped.map((row) => {
                    const { icon, title } = label(row);
                    return (
                      <li
                        key={row.cardId}
                        data-testid="location-audit-skip"
                        data-card-id={row.cardId}
                        data-status={row.status}
                        className="flex min-h-11 items-center gap-3 px-1 py-2 text-ink-faint"
                      >
                        <EmojiIcon emoji={icon} className="opacity-60" />
                        <span className="min-w-0 flex-1 truncate text-label">{title}</span>
                        <span className="shrink-0 text-micro">
                          {SKIP_LABEL[row.status as Exclude<AuditStatus, 'movable'>]}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </Sheet>
  );
}
