import { useRef, useState, type ChangeEvent } from 'react';
import { SYNC_STATUS_LABELS, useSyncStore } from '../../stores/syncStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { fetchMeta } from '../../sync/api';
import { daysBetween, formatLastBackup, loadBackupState } from '../../sync/backup';
import {
  exportJson,
  findTombstoneConflicts,
  importJson,
  readBackupFile,
} from '../../sync/exportImport';
import { clearSettings, loadSettings, normalizeBaseUrl, saveSettings } from '../../sync/settings';
import { restartSync, syncNow } from '../../sync/syncEngine';
import ConfirmDialog from './ConfirmDialog';
import Icon from './Icon';
import Sheet from './Sheet';
import { SYNC_DOT_CLASS } from './SyncStatusChip';
import {
  CHIP_NEUTRAL,
  DANGER_TEXT_BUTTON_CLASS,
  INPUT_CLASS,
  LABEL_CLASS,
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
  SECTION_TITLE_CLASS,
} from './formStyles';

/** One read-only fact. No box, no background — it is not pressable (§4.8-1). */
function Fact({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line py-2 text-label">
      <dt className="shrink-0 font-normal text-ink-muted">{term}</dt>
      <dd className="min-w-0 truncate font-semibold tabular-nums text-ink">{children}</dd>
    </div>
  );
}

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
  /** A picked backup waiting on the 복원 / 건너뛰기 question (B11). */
  const [restoreAsk, setRestoreAsk] = useState<{ file: File; count: number } | null>(null);
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

  /**
   * Runs an async action with the buttons disabled and the result reported.
   * A `null` result means "no news yet" — the import flow uses it to hand over
   * to a dialog instead of ending on a line of text.
   */
  const guard = async (action: () => Promise<Notice | null>): Promise<void> => {
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

  /** The merge itself, once the 복원 question (if any) has been answered. */
  const runImport = (file: File, restore: boolean): Promise<void> =>
    guard(async () => {
      const summary = await importJson(file, { restore });
      return {
        tone: 'ok',
        text: `가져왔어요 — 여행 ${summary.trips}개, 카드 ${summary.cards}개`,
      };
    });

  const handleImport = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    // Clear immediately so picking the same file twice fires `change` again.
    event.target.value = '';
    if (!file) return;

    void guard(async () => {
      // Look before merging: a backup that still holds something this device has
      // since deleted is the one case where 합치기 alone throws the file away.
      const imported = await readBackupFile(file);
      const conflicts = findTombstoneConflicts(
        useWorkspaceStore.getState().workspace,
        imported,
      );
      if (conflicts.length > 0) {
        setRestoreAsk({ file, count: conflicts.length });
        return null;
      }

      const summary = await importJson(file);
      return {
        tone: 'ok',
        text: `가져왔어요 — 여행 ${summary.trips}개, 카드 ${summary.cards}개`,
      };
    });
  };

  /** Answers the 복원 question and gets on with the import either way. */
  const answerRestore = (restore: boolean): void => {
    const pending = restoreAsk;
    setRestoreAsk(null);
    if (pending) void runImport(pending.file, restore);
  };

  return (
    <Sheet
      title="동기화 설정"
      testId="sync-settings"
      onClose={onClose}
      footer={
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="sync-clear"
            onClick={handleClear}
            disabled={busy}
            className={DANGER_TEXT_BUTTON_CLASS}
          >
            해제
          </button>
          <div className="ml-auto flex min-w-0 flex-1 justify-end gap-2">
            <button
              type="button"
              data-testid="sync-test"
              onClick={handleTest}
              disabled={busy || !configured}
              className={SECONDARY_BUTTON_CLASS}
            >
              연결 테스트
            </button>
            {/* Primary is the biggest button on the screen. It was the smallest. */}
            <button
              type="button"
              data-testid="sync-save"
              onClick={handleSave}
              disabled={busy}
              className={`${PRIMARY_BUTTON_CLASS} flex-1 sm:flex-none sm:min-w-28`}
            >
              저장
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-3">
          <span className={SECTION_TITLE_CLASS}>서버</span>
          <span data-testid="sync-status-text" className={CHIP_NEUTRAL}>
            <span
              aria-hidden="true"
              className={`h-2 w-2 rounded-full ${SYNC_DOT_CLASS[status]}`}
            />
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
          <p className="mt-2 text-micro font-normal text-ink-faint">
            data.php가 있는 폴더예요. 같은 서버에서 열었다면{' '}
            <code className="rounded-xs bg-sunken px-1">/api</code>면 충분해요.
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
            className={`flex items-center gap-2 text-label ${
              notice.tone === 'ok' ? 'text-ok' : 'text-danger'
            }`}
          >
            <Icon name={notice.tone === 'ok' ? 'check' : 'alert'} size={16} />
            {notice.text}
          </p>
        ) : null}

        {/* Read-only facts. Rows, not boxes — nothing here can be pressed. */}
        <dl>
          <Fact term="마지막 동기화">
            <span data-testid="sync-last">{formatSyncedAt(lastSyncedAt)}</span>
          </Fact>
          <Fact term="서버 버전">
            <span data-testid="sync-version">{serverVersion}</span>
          </Fact>
          {lastError ? (
            <Fact term="최근 오류">
              <span data-testid="sync-error" className="text-danger">
                {lastError}
              </span>
            </Fact>
          ) : null}
        </dl>

        <button
          type="button"
          data-testid="sync-now"
          onClick={handleSyncNow}
          disabled={busy || !configured}
          className={`${SECONDARY_BUTTON_CLASS} w-full`}
        >
          지금 동기화
        </button>

        <div className="border-t border-line pt-6">
          <h3 className={SECTION_TITLE_CLASS}>백업</h3>
          <dl className="mt-2">
            <Fact term="마지막 백업">
              <span data-testid="backup-last" data-days={backupDays}>
                {formatLastBackup(backupState.lastBackupAt)}
              </span>
            </Fact>
          </dl>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              data-testid="sync-export"
              onClick={handleExport}
              className={`${SECONDARY_BUTTON_CLASS} flex-1`}
            >
              내보내기
            </button>
            <button
              type="button"
              data-testid="sync-import"
              onClick={() => fileInput.current?.click()}
              disabled={busy}
              className={`${SECONDARY_BUTTON_CLASS} flex-1`}
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
          <p className="mt-3 text-micro font-normal text-ink-faint">
            가져오기는 덮어쓰지 않고 지금 데이터와 합쳐요. NAS 없이도 로컬 저장으로 동작해요.
          </p>
        </div>
      </div>

      {restoreAsk ? (
        <ConfirmDialog
          title={`백업에 삭제된 항목 ${restoreAsk.count}개가 있어요. 복원할까요?`}
          description="이 기기에서 지운 항목이 백업에는 남아 있어요. 복원하면 다시 살아나고, 건너뛰면 지운 상태 그대로 합쳐요."
          confirmLabel="복원"
          cancelLabel="건너뛰기"
          danger={false}
          onConfirm={() => answerRestore(true)}
          onCancel={() => answerRestore(false)}
          testId="import-restore-confirm"
        />
      ) : null}
    </Sheet>
  );
}
