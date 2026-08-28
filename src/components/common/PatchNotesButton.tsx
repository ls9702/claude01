import { useState } from 'react';
import { LATEST_PATCH_ID, PATCH_NOTES } from '../../patchNotes';
import { hasUnseenPatch, loadPatchSeen, savePatchSeen } from '../../stores/patchSeen';
import Icon from './Icon';
import Sheet from './Sheet';
import { NEWS_DOT_CLASS } from './formStyles';

/** `2026-08-28` → `2026년 8월 28일`. 회차 옆에 붙는 작은 날짜. */
function noteDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  if (!match) return date;
  return `${match[1]}년 ${Number(match[2])}월 ${Number(match[3])}일`;
}

/** 회차 목록. 최신이 맨 위 — 배열 순서 그대로다. */
function PatchNotesSheet({ onClose }: { onClose: () => void }) {
  return (
    <Sheet title="새 소식" testId="patchnotes-sheet" onClose={onClose}>
      <div className="space-y-6 pt-2">
        {PATCH_NOTES.map((note) => (
          <section key={note.id} data-testid="patchnotes-release" data-note-id={note.id}>
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="min-w-0 text-label font-semibold text-ink">{note.title}</h3>
              <span className="shrink-0 text-micro tabular-nums text-ink-faint">
                {noteDate(note.date)}
              </span>
            </div>
            <ul className="mt-2 space-y-1.5">
              {note.items.map((item) => (
                <li key={item} className="flex gap-2 text-label font-normal text-ink-muted">
                  {/* 글머리표를 글자로 쓰면 두 번째 줄이 그 밑으로 파고든다. */}
                  <span aria-hidden="true" className="mt-2 h-1 w-1 shrink-0 rounded-full bg-line-strong" />
                  <span className="min-w-0">{item}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Sheet>
  );
}

/**
 * 「새 소식」 버튼 — 이 회차에 무엇이 달라졌는지 읽는 한 자리 (M40).
 *
 * `AiAskButton`과 같은 모양·같은 크기다: 동기화 점 옆에 서는 34~36px 아이콘
 * 버튼 하나. 데스크톱은 상단 바의 유틸리티 구역에, 폰은 각 화면이 동기화 점을
 * 다는 그 줄에 선다.
 *
 * **일정 탭에는 달지 않는다.** 그 줄은 이미 폭이 모자라서 「리포트」가 390px에서
 * 물러난다(`TimelineView`의 `roomForReport`). 배지는 어디서든 닿을 수 있어야
 * 하는데, 가장 한산한 여행 탭이 늘 이 버튼을 들고 있으므로 그 조건은 지켜진다.
 *
 * 상태는 마운트마다 `localStorage`에서 새로 읽는다. 화면 하나만 마운트되므로
 * (`AppShell`) 이 버튼도 화면에 언제나 하나뿐이고, 탭을 옮기면 방금 적힌 「봤음」이
 * 그대로 반영된다.
 */
export default function PatchNotesButton() {
  const [seen, setSeen] = useState<string | null>(() => loadPatchSeen());
  const [open, setOpen] = useState(false);

  const unseen = hasUnseenPatch(seen);

  const openSheet = () => {
    setOpen(true);
    // 여는 순간 읽은 것으로 친다 — 닫을 때로 미루면, 열어 놓고 탭을 옮긴
    // 사람에게 점이 다시 붙는다.
    savePatchSeen(LATEST_PATCH_ID);
    setSeen(LATEST_PATCH_ID);
  };

  return (
    <>
      <button
        type="button"
        data-testid="patchnotes-open"
        data-unseen={unseen ? 'true' : 'false'}
        onClick={openSheet}
        aria-label={unseen ? '새 소식 (새 내용 있음)' : '새 소식'}
        title="새 소식"
        className="relative grid h-9 w-9 shrink-0 place-items-center rounded-full text-ink-muted transition-colors duration-[140ms] ease-quick hover:bg-sunken hover:text-ink"
      >
        <Icon name="gift" size={20} />
        {/* 재촉하지 않는 소식이므로 코랄이 아니라 중립이다 (M29의 그 판단).
            개수를 셀 것이 없으니 숫자 없는 점 하나면 충분하다. */}
        {unseen ? (
          <span
            data-testid="patchnotes-badge"
            aria-hidden="true"
            className={`${NEWS_DOT_CLASS} absolute right-1.5 top-1.5`}
          />
        ) : null}
      </button>

      {open ? <PatchNotesSheet onClose={() => setOpen(false)} /> : null}
    </>
  );
}
