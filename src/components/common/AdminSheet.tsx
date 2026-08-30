import { useEffect, useState } from 'react';
import {
  AdminError,
  adminActivate,
  adminBackups,
  adminCreate,
  adminExport,
  adminList,
  adminRename,
  adminRestore,
  adminSetArchiveFolder,
  adminSetArchived,
  adminSetNotice,
  adminSetProfiles,
  clearAdminToken,
  loadAdminToken,
  saveAdminToken,
  type AdminBackup,
  type AdminSession,
  type AdminState,
} from '../../admin/adminApi';
import { runKeyChecks, type KeyCheck } from '../../admin/keyCheck';
import { PROFILE_IDS, PROFILES, type ProfileId } from '../../profile/profile';
import { normalizeSessionId } from '../../sync/session';
import { pollOnce, syncNow } from '../../sync/syncEngine';
import { formatBytes } from '../../utils/photos';
import ConfirmDialog from './ConfirmDialog';
import Icon from './Icon';
import Sheet from './Sheet';
import {
  BTN_SIZE_SM,
  CHIP_NEUTRAL,
  INPUT_CLASS,
  LABEL_CLASS,
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
  SECTION_TITLE_CLASS,
  withBtnSize,
} from './formStyles';

/**
 * 관리자 (M46/M47) — the one screen that changes what everybody else sees.
 *
 * Reached from a quiet underlined link at the bottom of 설정, in the same tone
 * as 위치 재정비 (M36): it is used a handful of times a year, by one of the two
 * people, and putting it anywhere louder would put a door marked "everyone's
 * data" on a screen the other person opens to change their name.
 *
 * The password is `ADMIN_TOKEN` from `config.php` and is held in memory +
 * `sessionStorage` only — never `localStorage`. It buys three things the sync
 * token deliberately does not: making a workspace, renaming one, and moving
 * everybody into one.
 *
 * **Nothing here is destructive.** There is no delete: a finished trip is
 * 보관ed (read-only) or simply stops being the active session, and the folder
 * stays on the NAS where File Station can reach it. The one action that
 * overwrites anything — 복원 — writes a `pre-restore` copy first, and both it
 * and 전환 ask before they act, because their blast radius is "every phone".
 */

/** A short outcome line under whatever button was last pressed. */
interface Notice {
  tone: 'ok' | 'bad';
  text: string;
}

const errorText = (err: unknown): string =>
  err instanceof AdminError || err instanceof Error ? err.message : '알 수 없는 오류예요';

/** `20261102` → `2026년 11월 2일`. Backup dates arrive as bare filenames. */
function backupDate(date: string): string {
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(date);
  if (!match) return date;
  return `${match[1]}년 ${Number(match[2])}월 ${Number(match[3])}일`;
}

/** `1762000000000` → `2026-11-02 19:04`, or `아직 없음` for a never-written session. */
function stamp(at: number): string {
  if (!at) return '아직 없음';
  const date = new Date(at);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

/* ------------------------------------------------------------------ *
 * 비밀번호
 * ------------------------------------------------------------------ */

/**
 * The gate. A wrong password is proved wrong by {@link adminList} rather than
 * by anything local — there is no client-side copy of the secret to compare
 * against, and there should not be.
 */
function TokenGate({ onUnlock }: { onUnlock: (state: AdminState, token: string) => void }) {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      onUnlock(await adminList(token), token);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-label font-normal text-ink-muted">
        서버 config.php의 ADMIN_TOKEN을 입력하세요. 이 기기에 저장되지 않고, 탭을 닫으면
        잊혀져요.
      </p>
      <div>
        <label className={LABEL_CLASS} htmlFor="admin-token">
          관리자 비밀번호
        </label>
        <input
          id="admin-token"
          data-testid="admin-token-input"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={token}
          onChange={(event) => setToken(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !busy) void submit();
          }}
          className={INPUT_CLASS}
        />
      </div>
      {error ? (
        <p data-testid="admin-token-error" className="text-label text-danger">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        data-testid="admin-token-submit"
        onClick={() => void submit()}
        disabled={busy || token.trim() === ''}
        className={`${PRIMARY_BUTTON_CLASS} w-full`}
      >
        열기
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 세션 한 줄
 * ------------------------------------------------------------------ */

interface SessionRowProps {
  session: AdminSession;
  expanded: boolean;
  busy: boolean;
  onToggle: () => void;
  onActivate: () => void;
  onRename: (label: string) => void;
  onArchived: (archived: boolean) => void;
  onExport: () => void;
  onProfiles: (profiles: Record<string, { label?: string; avatar?: string }>) => void;
  backups: AdminBackup[] | null;
  onLoadBackups: () => void;
  onRestore: (date: string) => void;
  profiles: Record<string, { label?: string; avatar?: string }> | null;
}

/**
 * One session: the summary line everybody reads, and — once expanded — the six
 * things only the administrator does to it.
 *
 * Collapsed by default because the list is a list of *choices* ("which one is
 * everybody in?") and every action below the fold belongs to exactly one of
 * them. Six buttons on every row would make a five-session install a wall.
 */
function SessionRow({
  session,
  expanded,
  busy,
  onToggle,
  onActivate,
  onRename,
  onArchived,
  onExport,
  onProfiles,
  backups,
  onLoadBackups,
  onRestore,
  profiles,
}: SessionRowProps) {
  const [label, setLabel] = useState(session.label);
  /**
   * The two people's names, prefilled only for the **active** session.
   *
   * `admin.php` reports the overrides of the session everybody is currently in
   * (that is the one `?meta=1` has to serve), so prefilling another row's boxes
   * from it would show one session's names under a different session's heading.
   * An empty box means "the default", which is the honest thing to show when we
   * have not been told otherwise.
   */
  const [draft, setDraft] = useState<Record<string, { label: string; avatar: string }>>(() =>
    Object.fromEntries(
      PROFILE_IDS.map((id) => [
        id,
        session.active
          ? { label: profiles?.[id]?.label ?? '', avatar: profiles?.[id]?.avatar ?? '' }
          : { label: '', avatar: '' },
      ]),
    ),
  );

  const total = session.dataBytes + session.photoBytes;

  return (
    <li
      data-testid="admin-session-row"
      data-id={session.id}
      data-active={session.active ? 'true' : 'false'}
      data-archived={session.archived ? 'true' : 'false'}
      className="border-b border-line py-3"
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          data-testid="admin-row-expand"
          onClick={onToggle}
          className="min-w-0 flex-1 text-left"
        >
          <span className="flex items-center gap-2">
            <span className="min-w-0 truncate text-label font-semibold text-ink">
              {session.label || session.id}
            </span>
            {session.active ? (
              <span data-testid="admin-session-active" className={CHIP_NEUTRAL}>
                활성
              </span>
            ) : null}
            {session.archived ? (
              <span data-testid="admin-session-archived" className={CHIP_NEUTRAL}>
                보관됨
              </span>
            ) : null}
          </span>
          <span className="mt-0.5 block truncate text-micro font-normal text-ink-faint">
            {session.id} · {formatBytes(total)} · 사진 {session.photoCount}장 ·{' '}
            {stamp(session.updatedAt)}
          </span>
        </button>

        {session.active ? null : (
          <button
            type="button"
            data-testid="admin-activate"
            onClick={onActivate}
            disabled={busy}
            className={withBtnSize(SECONDARY_BUTTON_CLASS, BTN_SIZE_SM)}
          >
            전환
          </button>
        )}
      </div>

      {expanded ? (
        <div data-testid="admin-row-panel" className="mt-3 space-y-4 rounded-md bg-sunken p-3">
          {/* 이름 — the id never moves; it is a path on the NAS and the thing
              every device has written down as "which workspace am I in". */}
          <div>
            <label className={LABEL_CLASS} htmlFor={`admin-rename-${session.id}`}>
              표시 이름
            </label>
            <div className="mt-1 flex gap-2">
              <input
                id={`admin-rename-${session.id}`}
                data-testid="admin-rename-input"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                placeholder={session.id}
                className={INPUT_CLASS}
              />
              <button
                type="button"
                data-testid="admin-rename-save"
                onClick={() => onRename(label)}
                disabled={busy}
                className={SECONDARY_BUTTON_CLASS}
              >
                저장
              </button>
            </div>
          </div>

          {/* 프로필 (M47) — 이름과 이모지만. id는 카드·코멘트에 박혀 있다. */}
          <div>
            <h4 className={LABEL_CLASS}>이 세션의 두 사람</h4>
            {PROFILE_IDS.map((id: ProfileId) => (
              <div key={id} className="mt-1 flex items-center gap-2">
                <span className="w-16 shrink-0 text-micro text-ink-faint">{PROFILES[id].label}</span>
                <input
                  data-testid={`admin-profile-label-${id}`}
                  value={draft[id]?.label ?? ''}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      [id]: { ...current[id], label: event.target.value },
                    }))
                  }
                  placeholder={PROFILES[id].label}
                  className={INPUT_CLASS}
                />
                <input
                  data-testid={`admin-profile-avatar-${id}`}
                  value={draft[id]?.avatar ?? ''}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      [id]: { ...current[id], avatar: event.target.value },
                    }))
                  }
                  placeholder="🙂"
                  className={`${INPUT_CLASS} w-16 shrink-0 text-center`}
                />
              </div>
            ))}
            <button
              type="button"
              data-testid="admin-profiles-save"
              onClick={() => onProfiles(draft)}
              disabled={busy}
              className={`${withBtnSize(SECONDARY_BUTTON_CLASS, BTN_SIZE_SM)} mt-2`}
            >
              프로필 저장
            </button>
            <p className="mt-1 text-micro font-normal text-ink-faint">
              비워 두면 기본 이름(songlee · hoyabom)을 써요.
            </p>
          </div>

          {/* 백업 — the only thing here that overwrites a workspace. */}
          <div>
            <div className="flex items-center justify-between gap-2">
              <h4 className={LABEL_CLASS}>백업</h4>
              <button
                type="button"
                data-testid="admin-backups"
                onClick={onLoadBackups}
                disabled={busy}
                className={withBtnSize(SECONDARY_BUTTON_CLASS, BTN_SIZE_SM)}
              >
                목록 보기
              </button>
            </div>
            {backups ? (
              backups.length === 0 ? (
                <p data-testid="admin-backups-empty" className="mt-1 text-micro text-ink-faint">
                  아직 일자별 백업이 없어요
                </p>
              ) : (
                <ul className="mt-1">
                  {backups.map((backup) => (
                    <li
                      key={backup.date}
                      data-testid="admin-backup-row"
                      data-date={backup.date}
                      className="flex items-center gap-2 border-b border-line py-1.5 text-micro"
                    >
                      <span className="min-w-0 flex-1 text-ink">{backupDate(backup.date)}</span>
                      <span className="shrink-0 text-ink-faint">{formatBytes(backup.bytes)}</span>
                      <button
                        type="button"
                        data-testid="admin-restore"
                        onClick={() => onRestore(backup.date)}
                        disabled={busy}
                        className={withBtnSize(SECONDARY_BUTTON_CLASS, BTN_SIZE_SM)}
                      >
                        복원
                      </button>
                    </li>
                  ))}
                </ul>
              )
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              data-testid="admin-export"
              onClick={onExport}
              disabled={busy}
              className={withBtnSize(SECONDARY_BUTTON_CLASS, BTN_SIZE_SM)}
            >
              <Icon name="package" size={16} />
              내보내기
            </button>
            <button
              type="button"
              data-testid="admin-lock-toggle"
              data-archived={session.archived ? 'true' : 'false'}
              onClick={() => onArchived(!session.archived)}
              disabled={busy}
              className={withBtnSize(SECONDARY_BUTTON_CLASS, BTN_SIZE_SM)}
            >
              <Icon name="lock" size={16} />
              {session.archived ? '보관 해제' : '보관(읽기 전용)'}
            </button>
          </div>
          <p className="text-micro font-normal text-ink-faint">
            보관하면 모든 기기가 읽기만 할 수 있어요. 지우지는 않아요 — 세션 삭제는 NAS의 File
            Station에서만 해요.
          </p>
        </div>
      ) : null}
    </li>
  );
}

/* ------------------------------------------------------------------ *
 * 시트
 * ------------------------------------------------------------------ */

export default function AdminSheet({ onClose }: { onClose: () => void }) {
  const [state, setState] = useState<AdminState | null>(null);
  /**
   * True while the token this tab already holds is being re-checked.
   *
   * Without it the sheet flashes the 비밀번호 box for the length of one request
   * every time it is reopened — and a finger already on its way to that box
   * would be typing into a field about to be replaced.
   */
  const [checking, setChecking] = useState(() => loadAdminToken() !== null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [backups, setBackups] = useState<AdminBackup[] | null>(null);

  const [newId, setNewId] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [noticeText, setNoticeText] = useState('');
  const [folder, setFolder] = useState('');
  const [checks, setChecks] = useState<KeyCheck[] | null>(null);

  /** A pending question: 전환 and 복원 are the two that ask before they act. */
  const [ask, setAsk] = useState<
    { kind: 'activate'; id: string } | { kind: 'restore'; id: string; date: string } | null
  >(null);

  // A token from earlier in this tab means the gate has already been passed;
  // reopening the sheet during one sitting should not ask again.
  useEffect(() => {
    if (!loadAdminToken()) return;
    let live = true;
    void adminList()
      .then((next) => {
        if (live) adopt(next);
      })
      .catch(() => {
        // A token that no longer works is a token worth forgetting — the gate
        // renders and asks properly rather than showing a broken screen.
        clearAdminToken();
      })
      .finally(() => {
        if (live) setChecking(false);
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const adopt = (next: AdminState): void => {
    setState(next);
    setNoticeText(next.notice?.text ?? '');
    setFolder(next.archive.folder);
  };

  /** Runs an admin action with the buttons disabled and the result reported. */
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

  const unlock = (next: AdminState, token: string): void => {
    saveAdminToken(token);
    adopt(next);
  };

  if (!state) {
    return (
      <Sheet title="관리자" testId="admin-sheet" onClose={onClose}>
        {checking ? (
          <p data-testid="admin-checking" className="text-label font-normal text-ink-faint">
            불러오는 중…
          </p>
        ) : (
          <TokenGate onUnlock={unlock} />
        )}
      </Sheet>
    );
  }

  const activeSession = state.sessions.find((session) => session.id === state.active);

  const doActivate = (id: string) =>
    guard(async () => {
      adopt(await adminActivate(id));
      // The switch is a server-side pointer flip; this device finds out the
      // same way every other device does — by asking. Doing it here rather than
      // waiting for the next poll means the sheet's own app is already in the
      // new session by the time it is closed.
      await syncNow();
      return { tone: 'ok', text: `${id} 세션으로 전환했어요` };
    });

  const doRestore = (id: string, date: string) =>
    guard(async () => {
      adopt(await adminRestore(id, date));
      setBackups(null);
      await syncNow();
      return { tone: 'ok', text: `${backupDate(date)} 상태로 되돌렸어요` };
    });

  return (
    <Sheet title="관리자" testId="admin-sheet" onClose={onClose}>
      <div className="space-y-6">
        {/* 용량 (M47) — 세션을 만들기 전에 볼 수 있어야 하는 유일한 숫자. */}
        <div data-testid="admin-usage" className="rounded-md bg-sunken px-3 py-2 text-micro">
          <p className="text-ink">
            세션 {state.sessions.length}개 ·{' '}
            {formatBytes(
              state.sessions.reduce((sum, s) => sum + s.dataBytes + s.photoBytes, 0),
            )}{' '}
            사용 중
          </p>
          <p className="mt-0.5 text-ink-faint">
            보관함 {state.archive.folder || '(폴더 미설정)'} · {formatBytes(state.archive.bytes)} ·{' '}
            {state.archive.count}개
          </p>
          {state.usage && state.usage.diskTotal > 0 ? (
            <p data-testid="admin-disk" className="mt-0.5 text-ink-faint">
              NAS 여유 {formatBytes(state.usage.diskFree)} / {formatBytes(state.usage.diskTotal)}
            </p>
          ) : null}
        </div>

        {notice ? (
          <p
            data-testid="admin-result"
            data-tone={notice.tone}
            className={`flex items-center gap-2 text-label ${
              notice.tone === 'ok' ? 'text-ok' : 'text-danger'
            }`}
          >
            <Icon name={notice.tone === 'ok' ? 'check' : 'alert'} size={16} />
            {notice.text}
          </p>
        ) : null}

        <div>
          <h3 className={SECTION_TITLE_CLASS}>세션</h3>
          <ul className="mt-1">
            {state.sessions.map((session) => (
              <SessionRow
                key={session.id}
                session={session}
                busy={busy}
                expanded={expanded === session.id}
                profiles={state.profiles}
                backups={expanded === session.id ? backups : null}
                onToggle={() => {
                  setBackups(null);
                  setExpanded((current) => (current === session.id ? null : session.id));
                }}
                onActivate={() => setAsk({ kind: 'activate', id: session.id })}
                onRename={(label) =>
                  void guard(async () => {
                    adopt(await adminRename(session.id, label));
                    return { tone: 'ok', text: '이름을 저장했어요' };
                  })
                }
                onArchived={(archived) =>
                  void guard(async () => {
                    adopt(await adminSetArchived(session.id, archived));
                    // 보관 상태는 `?meta=1`이 나르는 것이라, 이 앱 자신도 다른
                    // 기기와 같은 길로 알아낸다 — 다음 폴링을 30초 기다리는
                    // 대신 지금 한 번 묻는다.
                    await pollOnce();
                    return {
                      tone: 'ok',
                      text: archived ? '읽기 전용으로 바꿨어요' : '보관을 해제했어요',
                    };
                  })
                }
                onExport={() =>
                  void guard(async () => {
                    const filename = await adminExport(session.id);
                    return { tone: 'ok', text: `${filename}을 내려받았어요` };
                  })
                }
                onProfiles={(profiles) =>
                  void guard(async () => {
                    adopt(await adminSetProfiles(session.id, profiles));
                    return { tone: 'ok', text: '프로필을 저장했어요' };
                  })
                }
                onLoadBackups={() =>
                  void guard(async () => {
                    setBackups(await adminBackups(session.id));
                    return null;
                  })
                }
                onRestore={(date) => setAsk({ kind: 'restore', id: session.id, date })}
              />
            ))}
          </ul>
        </div>

        {/* 새 세션 — 만들기와 전환은 두 개의 결정이다. */}
        <div className="border-t border-line pt-6">
          <h3 className={SECTION_TITLE_CLASS}>새 세션</h3>
          <div className="mt-2 space-y-2">
            <input
              data-testid="admin-new-id"
              value={newId}
              onChange={(event) => setNewId(event.target.value)}
              placeholder="osaka-2026 (영문 소문자·숫자·하이픈)"
              autoComplete="off"
              spellCheck={false}
              className={INPUT_CLASS}
            />
            <input
              data-testid="admin-new-label"
              value={newLabel}
              onChange={(event) => setNewLabel(event.target.value)}
              placeholder="표시 이름 (예: 오사카 2026)"
              className={INPUT_CLASS}
            />
            <button
              type="button"
              data-testid="admin-create"
              disabled={busy || normalizeSessionId(newId) === null}
              onClick={() =>
                void guard(async () => {
                  const id = normalizeSessionId(newId);
                  if (!id) return { tone: 'bad', text: '세션 id를 확인해 주세요' };
                  adopt(await adminCreate(id, newLabel));
                  setNewId('');
                  setNewLabel('');
                  return { tone: 'ok', text: `${id} 세션을 만들었어요 (아직 전환하지 않았어요)` };
                })
              }
              className={`${SECONDARY_BUTTON_CLASS} w-full`}
            >
              만들기
            </button>
          </div>
        </div>

        {/* 공지 (M47) */}
        <div className="border-t border-line pt-6">
          <h3 className={SECTION_TITLE_CLASS}>공지</h3>
          <textarea
            data-testid="admin-notice-input"
            value={noticeText}
            onChange={(event) => setNoticeText(event.target.value)}
            rows={2}
            placeholder="모든 화면 위에 한 줄로 떠요"
            className={`${INPUT_CLASS} mt-2 h-auto py-2`}
          />
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              data-testid="admin-notice-post"
              disabled={busy || noticeText.trim() === ''}
              onClick={() =>
                void guard(async () => {
                  adopt(await adminSetNotice(noticeText));
                  // 공지는 `?meta=1`이 나르는 것이라, 이 앱 자신도 다른 기기와
                  // 같은 길로 알아낸다 — 다음 폴링을 기다리는 대신 지금 묻는다.
                  await pollOnce();
                  return { tone: 'ok', text: '공지를 게시했어요' };
                })
              }
              className={`${SECONDARY_BUTTON_CLASS} flex-1`}
            >
              게시
            </button>
            <button
              type="button"
              data-testid="admin-notice-clear"
              disabled={busy}
              onClick={() =>
                void guard(async () => {
                  adopt(await adminSetNotice(''));
                  setNoticeText('');
                  await pollOnce();
                  return { tone: 'ok', text: '공지를 내렸어요' };
                })
              }
              className={`${SECONDARY_BUTTON_CLASS} flex-1`}
            >
              내리기
            </button>
          </div>
        </div>

        {/* 사진 보관함 (M46) */}
        <div className="border-t border-line pt-6">
          <h3 className={SECTION_TITLE_CLASS}>사진 보관함</h3>
          <p className="mt-1 text-micro font-normal text-ink-faint">
            기준 경로 {state.archive.base || '(config.php의 ARCHIVE_DIR 미설정)'}
          </p>
          <div className="mt-2 flex gap-2">
            <input
              data-testid="admin-archive-folder"
              value={folder}
              onChange={(event) => setFolder(event.target.value)}
              placeholder="2026-11-osaka"
              autoComplete="off"
              spellCheck={false}
              className={INPUT_CLASS}
            />
            <button
              type="button"
              data-testid="admin-archive-save"
              disabled={busy}
              onClick={() =>
                void guard(async () => {
                  adopt(await adminSetArchiveFolder(folder.trim()));
                  return { tone: 'ok', text: '보관 폴더를 저장했어요' };
                })
              }
              className={SECONDARY_BUTTON_CLASS}
            >
              저장
            </button>
          </div>
          <p className="mt-1 text-micro font-normal text-ink-faint">
            기준 경로 아래의 폴더 이름만 정해요 (영문 소문자·숫자·하이픈).
          </p>
        </div>

        {/* 키 점검 (M47) */}
        <div className="border-t border-line pt-6">
          <div className="flex items-center justify-between gap-2">
            <h3 className={SECTION_TITLE_CLASS}>키 점검</h3>
            <button
              type="button"
              data-testid="admin-keycheck-run"
              disabled={busy}
              onClick={() =>
                void guard(async () => {
                  setChecks(await runKeyChecks());
                  return null;
                })
              }
              className={withBtnSize(SECONDARY_BUTTON_CLASS, BTN_SIZE_SM)}
            >
              확인
            </button>
          </div>
          {checks ? (
            <ul className="mt-2">
              {checks.map((check) => (
                <li
                  key={check.id}
                  data-testid="admin-keycheck-row"
                  data-id={check.id}
                  data-ok={check.ok ? 'true' : 'false'}
                  className="flex items-baseline gap-2 border-b border-line py-2 text-micro"
                >
                  <span className={check.ok ? 'text-ok' : 'text-danger'}>
                    {check.ok ? '✓' : '✗'}
                  </span>
                  <span className="w-20 shrink-0 text-ink">{check.label}</span>
                  <span className="min-w-0 flex-1 text-ink-faint">{check.detail}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <button
          type="button"
          data-testid="admin-lock"
          onClick={() => {
            clearAdminToken();
            onClose();
          }}
          className="text-micro font-normal text-ink-faint underline decoration-line-strong underline-offset-4"
        >
          관리자 잠그기
        </button>
      </div>

      {ask?.kind === 'activate' ? (
        <ConfirmDialog
          title={`${ask.id} 세션으로 전환할까요?`}
          description={`모든 사용자가 이 세션을 보게 됩니다. 지금 열려 있는 화면도 이 세션으로 바뀌어요. (현재 활성: ${activeSession?.label || state.active})`}
          confirmLabel="전환"
          cancelLabel="취소"
          danger={false}
          onConfirm={() => {
            const id = ask.id;
            setAsk(null);
            void doActivate(id);
          }}
          onCancel={() => setAsk(null)}
          testId="admin-activate-confirm"
        />
      ) : null}

      {ask?.kind === 'restore' ? (
        <ConfirmDialog
          title={`${backupDate(ask.date)} 상태로 되돌릴까요?`}
          description="현재 데이터가 이 날짜로 되돌아갑니다. 모든 기기에 적용됩니다. 되돌리기 직전 상태는 서버에 한 벌 남겨 둬요."
          confirmLabel="복원"
          cancelLabel="취소"
          onConfirm={() => {
            const { id, date } = ask;
            setAsk(null);
            void doRestore(id, date);
          }}
          onCancel={() => setAsk(null)}
          testId="admin-restore-confirm"
        />
      ) : null}
    </Sheet>
  );
}
