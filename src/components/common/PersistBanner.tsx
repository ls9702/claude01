import { useState } from 'react';
import { selectPersistFailing, usePersistHealthStore } from '../../stores/persistHealth';
import { exportJson } from '../../sync/exportImport';

/**
 * 저장 실패 배너 — the one warning this app is allowed to shout (M7a).
 *
 * Raised by {@link usePersistHealthStore} after two consecutive IndexedDB
 * write failures, which is the situation where the user is still happily
 * typing and none of it is being kept. There is nothing the app can do to fix
 * that from inside the browser, so the banner offers the only real remedy:
 * get a copy out to a file, right now.
 *
 * Not dismissible on purpose. It disappears by itself the moment a write
 * succeeds, and until then the message is still true.
 */
export default function PersistBanner() {
  const failing = usePersistHealthStore(selectPersistFailing);
  const [exported, setExported] = useState(false);

  if (!failing) return null;

  return (
    <div
      role="alert"
      data-testid="persist-banner"
      className="mx-4 mt-3 rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-3 text-sm text-amber-900"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
        <p className="min-w-0 flex-1 leading-relaxed">
          <span aria-hidden="true">⚠️ </span>
          저장에 실패하고 있어요 — 데이터가 보관되지 않을 수 있어요. 지금 백업하세요
        </p>
        <button
          type="button"
          data-testid="persist-banner-export"
          onClick={() => {
            exportJson();
            setExported(true);
          }}
          className="shrink-0 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600"
        >
          백업
        </button>
      </div>
      {exported ? (
        <p data-testid="persist-banner-done" className="mt-1.5 text-xs text-amber-700">
          백업 파일을 내려받았어요.
        </p>
      ) : null}
    </div>
  );
}
