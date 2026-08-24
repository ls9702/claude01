import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { refreshAiCapability } from '../../ai/aiClient';
import { useAiStore } from '../../ai/aiSettings';
import { SYNC_STATUS_LABELS, useSyncStore } from '../../stores/syncStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { fetchMeta } from '../../sync/api';
import { daysBetween, formatLastBackup, loadBackupState } from '../../sync/backup';
import {
  exportJson,
  exportJsonWithPhotos,
  findTombstoneConflicts,
  importJson,
  readBackupFile,
} from '../../sync/exportImport';
import { PROFILES, otherProfile, useProfileStore } from '../../profile/profile';
import { formatBytes, photoUsage } from '../../utils/photos';
import { formatStamp } from '../../utils/time';
import {
  clearSettings,
  isConfigured,
  loadSettings,
  normalizeBaseUrl,
  saveSettings,
} from '../../sync/settings';
import {
  clearBootstrapApplied,
  isBootstrapApplied,
  markBootstrapOptOut,
} from '../../sync/bootstrap';
import { restartSync, syncNow } from '../../sync/syncEngine';
import Avatar from './Avatar';
import ConfirmDialog from './ConfirmDialog';
import Icon from './Icon';
import ProfilePicker from './ProfilePicker';
import Sheet from './Sheet';
import { SYNC_DOT_CLASS } from './SyncStatusChip';
import {
  BTN_SIZE_SM,
  CHIP_NEUTRAL,
  DANGER_TEXT_BUTTON_CLASS,
  INPUT_CLASS,
  LABEL_CLASS,
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
  SECTION_TITLE_CLASS,
  withBtnSize,
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

/**
 * 프로필 — who this device is, and when the other one was last on (M13).
 *
 * First section of the only settings screen there is, because it is the only
 * one that changes what gets *written*: every card, comment and receipt from
 * here on carries whichever name is showing here.
 *
 * The 전환 button opens the very same {@link ProfilePicker} the first run does,
 * with a 취소 this time — switching later and choosing at the start are the
 * same question, and should not be two different screens.
 */
function ProfileSection() {
  const profileId = useProfileStore((s) => s.profileId);
  const seenBy = useWorkspaceStore((s) => s.workspace.seenBy);
  const [switching, setSwitching] = useState(false);

  // Unreachable in the app (the shell gates on a profile) but not in a test
  // that mounts the sheet on its own.
  if (!profileId) return null;

  const me = PROFILES[profileId];
  const other = otherProfile(profileId);
  const seen = seenBy?.[other.id];

  return (
    <div>
      <h3 className={SECTION_TITLE_CLASS}>프로필</h3>
      <div className="mt-2 flex items-center gap-3">
        <Avatar id={me.id} size="md" />
        <span
          data-testid="profile-current"
          data-profile={me.id}
          className="min-w-0 flex-1 truncate text-body font-semibold text-ink"
        >
          {me.label}
        </span>
        <button
          type="button"
          data-testid="profile-switch"
          onClick={() => setSwitching(true)}
          className={withBtnSize(SECONDARY_BUTTON_CLASS, BTN_SIZE_SM)}
        >
          전환
        </button>
      </div>

      {/* 누가 봤는지: the *other* person's stamp, because this device already
          knows perfectly well when it was last used itself. */}
      <p
        data-testid="profile-seen"
        data-profile={other.id}
        data-at={typeof seen === 'number' ? seen : ''}
        className="mt-2 text-micro font-normal text-ink-faint"
      >
        {other.label} ·{' '}
        {typeof seen === 'number' ? `마지막 접속 ${formatStamp(seen)}` : '아직 접속 기록 없음'}
      </p>

      {switching ? (
        <ProfilePicker
          onCancel={() => setSwitching(false)}
          onChosen={() => setSwitching(false)}
        />
      ) : null}
    </div>
  );
}

/** A short outcome line under the buttons: green for good news, rose for bad. */
interface Notice {
  tone: 'ok' | 'bad';
  text: string;
}

/**
 * Why the AI 도우미 is or is not usable right now (M11).
 *
 * Three separate things have to line up — a toggle, a server address, a key on
 * that server — and each of them fails differently. One line that says which
 * of the three is missing beats a disabled switch with no explanation.
 */
type AiStatusState = 'off' | 'unconfigured' | 'checking' | 'no-key' | 'ready';

const AI_STATUS_TEXT: Record<AiStatusState, string> = {
  off: 'AI 기능을 켜면 보드·일정에 AI 버튼이 나타나요',
  unconfigured: '동기화(NAS) 연결 후 사용할 수 있어요',
  checking: '서버를 확인하는 중이에요…',
  'no-key': '서버에 AI 키가 설정되지 않았어요',
  ready: '사용 준비 완료',
};

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
/**
 * The browser's own storage estimate, once it answers (M10).
 *
 * `navigator.storage.estimate()` does not exist in every WebView and rejects in
 * a few, so the row it feeds is rendered only when a number actually arrives.
 */
function useStorageEstimate(): { usage: number; quota: number } | null {
  const [estimate, setEstimate] = useState<{ usage: number; quota: number } | null>(null);

  useEffect(() => {
    let live = true;
    try {
      void navigator.storage
        ?.estimate?.()
        .then((result) => {
          if (!live) return;
          const { usage, quota } = result;
          if (typeof usage === 'number' && typeof quota === 'number' && quota > 0) {
            setEstimate({ usage, quota });
          }
        })
        .catch(() => {});
    } catch {
      /* not available here */
    }
    return () => {
      live = false;
    };
  }, []);

  return estimate;
}

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
  // M14: the note lives in state so 저장/해제 can hide it without a re-mount.
  const [bootstrapNote, setBootstrapNote] = useState(
    () => isBootstrapApplied() && isConfigured(),
  );
  const fileInput = useRef<HTMLInputElement>(null);

  const usage = photoUsage(useWorkspaceStore((s) => s.workspace));
  const estimate = useStorageEstimate();
  /** M20: photos ride to the NAS too, but only once there is a NAS. */
  const photoSyncOn = isConfigured(stored);

  const aiEnabledToggle = useAiStore((s) => s.enabled);
  const aiAvailable = useAiStore((s) => s.available);
  const aiChecked = useAiStore((s) => s.checked);
  const setAiEnabled = useAiStore((s) => s.setEnabled);

  const status = useSyncStore((s) => s.status);
  const lastSyncedAt = useSyncStore((s) => s.lastSyncedAt);
  const lastError = useSyncStore((s) => s.lastError);
  const serverVersion = useSyncStore((s) => s.serverVersion);

  const configured = normalizeBaseUrl(baseUrl).length > 0;

  /**
   * Deliberately reads the *saved* settings rather than the typed ones: the
   * capability ping went to the saved server, so a half-typed address must not
   * make the line claim that server has no key.
   */
  const aiState: AiStatusState = !aiEnabledToggle
    ? 'off'
    : !isConfigured()
      ? 'unconfigured'
      : aiAvailable
        ? 'ready'
        : aiChecked
          ? 'no-key'
          : 'checking';

  /** Flipping it on is also the cheapest moment to re-ask the server. */
  const handleAiToggle = (): void => {
    const next = !aiEnabledToggle;
    setAiEnabled(next);
    if (next) void refreshAiCapability();
  };

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
      // A manual save supersedes the auto-applied server config (M14).
      clearBootstrapApplied();
      setBootstrapNote(false);
      await restartSync();
      // A new server is a new answer to "does this thing have a Gemini key?"
      // — including when the answer goes back to no (M11).
      await refreshAiCapability();
      return { tone: 'ok', text: '저장했어요' };
    });

  const handleClear = () =>
    guard(async () => {
      clearSettings();
      // 해제 is a decision: the bootstrap file must not re-connect this device
      // on the next reload (M14).
      markBootstrapOptOut();
      setBootstrapNote(false);
      setBaseUrl('');
      setToken('');
      await restartSync();
      await refreshAiCapability();
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

  /** 사진 포함 내보내기 — reads every referenced blob, so it awaits (M10). */
  const handleExportPhotos = () =>
    guard(async () => {
      const written = await exportJsonWithPhotos();
      setBackupRevision((value) => value + 1);
      return { tone: 'ok', text: `백업 파일을 내려받았어요 (사진 ${written}장)` };
    });

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
        <ProfileSection />

        <div className="flex items-center justify-between gap-3 border-t border-line pt-6">
          <span className={SECTION_TITLE_CLASS}>서버</span>
          <span data-testid="sync-status-text" className={CHIP_NEUTRAL}>
            <span
              aria-hidden="true"
              className={`h-2 w-2 rounded-full ${SYNC_DOT_CLASS[status]}`}
            />
            {SYNC_STATUS_LABELS[status]}
          </span>
        </div>

        {bootstrapNote && (
          <p data-testid="bootstrap-note" className="text-micro font-normal text-ink-faint">
            이 서버의 기본 설정이 자동 적용됐어요
          </p>
        )}

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

        {/* AI 도우미 (M11). One switch and one line saying what it will take to
            make it work — the buttons themselves live on 보드 and 일정. */}
        <div className="border-t border-line pt-6">
          <div className="flex items-center justify-between gap-3">
            <h3 className={SECTION_TITLE_CLASS}>AI 도우미</h3>
            <button
              type="button"
              role="switch"
              aria-checked={aiEnabledToggle}
              aria-label="AI 도우미"
              data-testid="ai-toggle"
              data-on={aiEnabledToggle ? 'true' : 'false'}
              onClick={handleAiToggle}
              className={[
                'relative h-6 w-11 shrink-0 rounded-full transition-colors duration-[140ms]',
                'ease-quick outline-none focus-visible:ring-2 focus-visible:ring-line-strong',
                aiEnabledToggle ? 'bg-inverse' : 'bg-line',
              ].join(' ')}
            >
              <span
                aria-hidden="true"
                className={[
                  'absolute top-1 h-4 w-4 rounded-full bg-surface shadow-raise',
                  'transition-[left] duration-[140ms] ease-quick',
                  aiEnabledToggle ? 'left-6' : 'left-1',
                ].join(' ')}
              />
            </button>
          </div>
          <p
            data-testid="ai-status"
            data-state={aiState}
            className={`mt-2 text-micro font-normal ${
              aiState === 'ready' ? 'text-ok' : 'text-ink-faint'
            }`}
          >
            {AI_STATUS_TEXT[aiState]}
          </p>
          <p className="mt-2 text-micro font-normal text-ink-faint">
            질문과 일정 요약이 NAS를 거쳐 Google Gemini로 보내져요. API 키는 서버의
            config.php에만 있고 이 기기에는 저장되지 않아요.
          </p>
        </div>

        <div className="border-t border-line pt-6">
          <h3 className={SECTION_TITLE_CLASS}>백업</h3>
          <dl className="mt-2">
            <Fact term="마지막 백업">
              <span data-testid="backup-last" data-days={backupDays}>
                {formatLastBackup(backupState.lastBackupAt)}
              </span>
            </Fact>
            <Fact term="사진 용량">
              <span data-testid="photo-usage" data-bytes={usage.bytes} data-count={usage.count}>
                {formatBytes(usage.bytes)} · {usage.count}장
              </span>
              {/* Reads the *saved* address, not the typed one — same reason as
                  `aiState` below: a half-typed URL must not change what this
                  line claims about the server that is actually in use. */}
              {photoSyncOn ? (
                <span data-testid="photo-sync-note" className="text-ink-faint">
                  {' '}
                  · 서버 동기화 켜짐
                </span>
              ) : null}
            </Fact>
            {estimate ? (
              <Fact term="저장 공간">
                <span data-testid="storage-estimate" data-usage={estimate.usage}>
                  {formatBytes(estimate.usage)} / {formatBytes(estimate.quota)}
                </span>
              </Fact>
            ) : null}
          </dl>
          {photoSyncOn ? (
            <p className="mt-2 text-micro font-normal text-ink-faint">
              사진은 자동으로 서버에 보관돼 다른 기기에서 내려받아요.
            </p>
          ) : null}
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
          <button
            type="button"
            data-testid="sync-export-photos"
            onClick={handleExportPhotos}
            disabled={busy}
            className={`${SECONDARY_BUTTON_CLASS} mt-2 w-full`}
          >
            <Icon name="camera" size={16} />
            사진 포함 내보내기
          </button>
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
          <p className="mt-2 text-micro font-normal text-ink-faint">
            내보내기에는 사진이 포함되지 않아요. 사진까지 옮기려면 「사진 포함 내보내기」를 쓰세요.
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
