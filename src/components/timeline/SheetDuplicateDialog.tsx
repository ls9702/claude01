import { useState } from 'react';
import type { Sheet as SheetModel } from '../../types/models';
import type { SheetEngineChoice } from '../../stores/workspaceStore';
import ConfirmDialog from '../common/ConfirmDialog';

interface SheetDuplicateDialogProps {
  sheet: SheetModel;
  /** 고른 지도와 함께 복제한다. */
  onConfirm: (engine: SheetEngineChoice) => void;
  onCancel: () => void;
}

/**
 * 「복제」가 지도를 한 번 묻는 자리 (M41) — 구글 키가 있는 기기에서만 뜬다.
 *
 * M40의 복제는 묻지 않고 바로 베꼈고, 그게 옳았다: 물을 것이 없었으니까. 이제는
 * 물을 것이 하나 생겼다 — 「같은 일정을 구글 지도로도 보고 싶다」가 이 기능의
 * 가장 자연스러운 쓰임이기 때문이다. 그래서 **하나만** 묻고, 기본값은 원본과
 * 같은 지도다: 아무 생각 없이 복제를 누른 사람은 M40과 똑같은 사본을 얻는다.
 *
 * {@link ConfirmDialog}를 그대로 입는다 — 이 앱에서 「예/아니오」는 언제나 같은
 * 모양이어야 하고, 세그먼트 한 줄 때문에 새 대화상자 껍데기를 세우면 그 규칙이
 * 깨진다. 키가 없는 기기에서는 이 화면이 아예 없고 복제는 M40 그대로 한 번에
 * 끝난다.
 */
export default function SheetDuplicateDialog({
  sheet,
  onConfirm,
  onCancel,
}: SheetDuplicateDialogProps) {
  const [engine, setEngine] = useState<SheetEngineChoice>(
    sheet.mapEngine === 'google' ? 'google' : 'osm',
  );

  return (
    <ConfirmDialog
      title={`'${sheet.name}' 시트를 복제할까요?`}
      danger={false}
      confirmLabel="복제"
      description={
        <div className="space-y-2">
          <p>일자·배치·메모·항공편을 그대로 베낀 사본이 옆에 서요.</p>
          <div
            data-testid="sheet-duplicate-engine"
            data-engine={engine}
            className="inline-flex w-full rounded-md bg-sunken p-1"
          >
            {(
              [
                ['osm', 'OSM 지도', 'sheet-duplicate-engine-osm'],
                ['google', '구글 지도', 'sheet-duplicate-engine-google'],
              ] as const
            ).map(([choice, label, testId]) => (
              <button
                key={choice}
                type="button"
                data-testid={testId}
                aria-pressed={engine === choice}
                onClick={() => setEngine(choice)}
                className={[
                  'flex h-9 flex-1 items-center justify-center rounded-md text-label',
                  'transition-colors duration-[140ms] ease-quick',
                  engine === choice ? 'bg-surface text-ink shadow-raise' : 'text-ink-muted',
                ].join(' ')}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      }
      onConfirm={() => onConfirm(engine)}
      onCancel={onCancel}
      testId="sheet-duplicate-dialog"
    />
  );
}
