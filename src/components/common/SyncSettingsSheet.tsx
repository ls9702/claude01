import { useRef, useState, type ChangeEvent } from 'react';
import { SYNC_STATUS_LABELS, useSyncStore } from '../../stores/syncStore';
import { fetchMeta } from '../../sync/api';
import { daysBetween, formatLastBackup, loadBackupState } from '../../sync/backup';
import { exportJson, importJson } from '../../sync/exportImport';
import { clearSettings, loadSettings, normalizeBaseUrl, saveSettings } from '../../sync/settings';
import { restartSync, syncNow } from '../../sync/syncEngine';
import Sheet from './Sheet';
import {
  GHOST_BUTTON_CLASS,
  INPUT_CLASS,
  LABEL_CLASS,
  PRIMARY_BUTTON_CLASS,
  DANGER_TEXT_BUTTON_CLASS,
} from './formStyles';

/** A short outcome line under the buttons: green for good news, rose for bad. */
interface Notice {
  tone: 'ok' | 'bad';
  text: string;
}

/** `2026-03-07 19:04` — enough to tell "just now" from "yesterday". */
function formatSyncedAt(at?: number): string {
  if (!at) return '아직 없음';
  const date = new Date(at);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

const errorText = (err: unknown): string =>
  err instanceof Error ? err.message : '알 수 없는 오류예요';

/**
 * 동기화 설정 — server address, token, and the local backup escape hatch.
 *
 * Deliberately does everything in one panel: this app has exactly one settings
 * screen, and burying 내보내기 behind another level would be silly.
 *
 * Nothing here is required. The help text at the bottom says so out loud,
 * because the GitHub Pages build has no server to point at and the empty state
 * should not read like something is broken.
 */
export default function SyncSettingsSheet({ onClose }: { onClose: () => void }) {
  const stored = loadSettings();
  const [baseUrl, setBaseUrl] = useState(stored.baseUrl);
  const [token, setToken] = useState(stored.token);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  /** Bumped by 내보내기 so 마지막 백업 updates without reopening the sheet. */
  const [backupRevision, setBackupRevision] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);

  const status = useSyncStore((s) => s.status);
  const lastSyncedAt = useSyncStore((s) => s.lastSyncedAt);
  const lastError = useSyncStore((s) => s.lastError);
  const serverVersion = useSyncStore((s) => s.serverVersion);

  const configured = normalizeBaseUrl(baseUrl).length > 0;

  void backupRevision; // re-read the stamp on every render (see the state above)
  const backupState = loadBackupState();
  /** Whole days since the last 내보내기; `-1` stands for "never". */
  const backupDays = daysBetween(backupState.lastBackupAt) ?? -1;

  /** Runs an async action with the buttons disabled and the result reported. */
  const guard = async (action: () => Promise<Notice>): Promise<void> => {
    setBusy(true);
    setNotice(null);
    try {
      setNotice(await action());
    } catch (err) {
      setNotice({ tone: 'bad', text: errorText(err) });
    } finally {
      setBusy(false);
    }
  };

  const handleTest = () =>
    guard(async () => {
      // Tests what is *typed*, not what is saved — otherwise you would have to
      // save a wrong address before you could find out it was wrong.
      const meta = await fetchMeta({ baseUrl, token });
      return { tone: 'ok', text: `연결됐어요 (버전 ${meta.version})` };
    });

  const handleSave = () =>
    guard(async () => {
      saveSettings({ baseUrl, token });
      await restartSync();
      return { tone: 'ok', text: '저장했어요' };
    });

  const handleClear = () =>
    guard(async () => {
      clearSettings();
      setBaseUrl('');
      setToken('');
      await restartSync();
      return { tone: 'ok', text: '동기화를 껐어요' };
    });

  const handleSyncNow = () =>
    guard(async () => {
      await syncNow();
      const { status: after, lastError: error } = useSyncStore.getState();
      if (after === 'idle') return { tone: 'ok', text: '동기화했어요' };
      return { tone: 'bad', text: error ?? SYNC_STATUS_LABELS[after] };
    });

  const handleExport = (): void => {
    try {
      exportJson();
      setBackupRevision((value) => value + 1);
      setNotice({ tone: 'ok', text: '백업 파일을 내려받았어요' });
    } catch (err) {
      setNotice({ tone: 'bad', text: errorText(err) });
    }
  };

  const handleImport = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    // Clear immediately so picking the same file twice fires `change` again.
    event.target.value = '';
    if (!file) return;

    void guard(async () => {
      const summary = await importJson(file);
      return {
        tone: 'ok',
        text: `가져왔어요 — 여행 ${summary.trips}개, 카드 ${summary.cards}개`,
      };
    });
  };

  return (
    <Sheet
      title="동기화 설정"
      testId="sync-settings"
      onClose={onClose}
      footer={
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            data-testid="sync-clear"
            onClick={handleClear}
            disabled={busy}
            className={DANGER_TEXT_BUTTON_CLASS}
          >
            해제
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              data-testid="sync-test"
              onClick={handleTest}
              disabled={busy || !configured}
              className={`${GHOST_BUTTON_CLASS} disabled:cursor-not-allowed disabled:text-stone-300`}
            >
              연결 테스트
            </button>
            <button
              type="button"
              data-testid="sync-save"
              onClick={handleSave}
              disabled={busy}
              className={PRIMARY_BUTTON_CLASS}
            >
              저장
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between rounded-xl bg-stone-50 px-3.5 py-2.5">
          <span className="text-xs font-medium text-stone-500">상태</span>
          <span data-testid="sync-status-text" className="text-sm font-semibold text-stone-700">
            {SYNC_STATUS_LABELS[status]}
          </span>
        </div>

        <div>
          <label className={LABEL_CLASS} htmlFor="sync-base-url">
            서버 주소
          </label>
          <input
            id="sync-base-url"
            data-testid="sync-base-url"
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder="/api 또는 https://xxx.synology.me/travel/api"
            className={INPUT_CLASS}
          />
          <p className="mt-1 text-[11px] text-stone-400">
            data.php가 있는 폴더예요. 같은 서버에서 열었다면 <code>/api</code>면 충분해요.
          </p>
        </div>

        <div>
          <label className={LABEL_CLASS} htmlFor="sync-token">
            토큰
          </label>
          <input
            id="sync-token"
            data-testid="sync-token"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder="config.php의 SYNC_TOKEN"
            className={INPUT_CLASS}
          />
        </div>

        {notice ? (
          <p
            data-testid="sync-notice"
            data-tone={notice.tone}
            className={`text-sm ${notice.tone === 'ok' ? 'text-emerald-600' : 'text-rose-500'}`}
          >
            {notice.text}
          </p>
        ) : null}

        <dl className="space-y-1 rounded-xl bg-stone-50 px-3.5 py-2.5 text-xs text-stone-500">
          <div className="flex justify-between gap-3">
            <dt>마지막 동기화</dt>
            <dd data-testid="sync-last" className="text-stone-700">
              {formatSyncedAt(lastSyncedAt)}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt>서버 버전</dt>
            <dd data-testid="sync-version" className="text-stone-700">
              {serverVersion}
            </dd>
          </div>
          {lastError ? (
            <div className="flex justify-between gap-3">
              <dt>최근 오류</dt>
              <dd data-testid="sync-error" className="min-w-0 truncate text-rose-500">
                {lastError}
              </dd>
            </div>
          ) : null}
        </dl>

        <button
          type="button"
          data-testid="sync-now"
          onClick={handleSyncNow}
          disabled={busy || !configured}
          className={`${GHOST_BUTTON_CLASS} w-full disabled:cursor-not-allowed disabled:text-stone-300`}
        >
          지금 동기화
        </button>

        <div className="border-t border-stone-100 pt-4">
          <p className={LABEL_CLASS}>백업</p>
          <p className="mt-1 text-xs text-stone-500">
            마지막 백업:{' '}
            <span data-testid="backup-last" data-days={backupDays} className="font-medium">
              {formatLastBackup(backupState.lastBackupAt)}
            </span>
          </p>
          <div className="mt-1.5 flex gap-2">
            <button
              type="button"
              data-testid="sync-export"
              onClick={handleExport}
              className={`${GHOST_BUTTON_CLASS} flex-1`}
            >
              내보내기
            </button>
            <button
              type="button"
              data-testid="sync-import"
              onClick={() => fileInput.current?.click()}
              disabled={busy}
              className={`${GHOST_BUTTON_CLASS} flex-1`}
            >
              가져오기
            </button>
          </div>
          <input
            ref={fileInput}
            data-testid="sync-import-input"
            type="file"
            accept="application/json,.json"
            onChange={handleImport}
            className="hidden"
          />
          <p className="mt-2 text-[11px] leading-relaxed text-stone-400">
            가져오기는 덮어쓰지 않고 지금 데이터와 합쳐요. NAS 없이도 로컬 저장으로 동작해요.
          </p>
        </div>
      </div>
    </Sheet>
  );
}
