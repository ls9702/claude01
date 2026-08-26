import { describe, expect, it } from 'vitest';
import { emptyWorkspace, type Workspace } from '../types/models';
import {
  backupDateStamp,
  backupFileName,
  backupPhotoFileName,
  deserializeBackup,
  findTombstoneConflicts,
  readBackupPhotos,
  serializeBackup,
  serializeBackupWithPhotos,
  withoutTombstones,
  type BackupFile,
} from './exportImport';
import { merge, workspaceEquals } from './merge';

const AT = new Date('2026-03-07T10:20:30+09:00').getTime();

/** 톰스톤 시각 — populated()를 여러 번 불러도 같도록 모듈 로드 때 한 번만 계산 (TTL 이내). */
const TOMBSTONE_AT = Date.now() - 1_000;

/** A workspace with one of everything, so the round trip has something to lose. */
function populated(): Workspace {
  const ws = emptyWorkspace();
  ws.trips.t1 = {
    id: 't1',
    title: '오사카 3박4일',
    currency: 'JPY',
    columnOrder: ['c1'],
    sheetOrder: ['s1'],
    createdAt: 1_000,
    updatedAt: 2_000,
  };
  ws.columns.c1 = {
    id: 'c1',
    tripId: 't1',
    name: '볼거리',
    color: 'emerald',
    icon: '🎡',
    cardOrder: ['k1'],
    createdAt: 1_000,
    updatedAt: 1_000,
  };
  ws.cards.k1 = {
    id: 'k1',
    tripId: 't1',
    columnId: 'c1',
    title: '유니버설 스튜디오',
    memo: '아침 일찍',
    budget: 8_400,
    location: { lat: 34.6654, lng: 135.4323, address: '오사카시 고노하나구' },
    createdAt: 1_000,
    updatedAt: 1_500,
  };
  ws.sheets.s1 = {
    id: 's1',
    tripId: 't1',
    name: '일정 1',
    dayOrder: ['d1'],
    createdAt: 1_000,
    updatedAt: 1_000,
  };
  ws.days.d1 = {
    id: 'd1',
    tripId: 't1',
    sheetId: 's1',
    date: '2026-03-08',
    label: '1일차',
    createdAt: 1_000,
    updatedAt: 1_000,
  };
  ws.entries.e1 = {
    id: 'e1',
    tripId: 't1',
    cardId: 'k1',
    dayId: 'd1',
    startMin: 540,
    durationMin: 240,
    createdAt: 1_000,
    updatedAt: 1_000,
  };
  ws.tombstones.push({ id: 'gone', entity: 'card', deletedAt: TOMBSTONE_AT });
  return ws;
}

describe('백업 파일 이름', () => {
  it('로컬 날짜를 YYYYMMDD로 찍는다', () => {
    expect(backupDateStamp(AT)).toMatch(/^\d{8}$/);
    expect(backupFileName(AT)).toBe(`trip-board-backup-${backupDateStamp(AT)}.json`);
  });

  it('한 자리 월/일도 0으로 채운다', () => {
    const january = new Date(2026, 0, 5, 12).getTime();
    expect(backupDateStamp(january)).toBe('20260105');
  });
});

describe('내보내기 → 가져오기 왕복', () => {
  it('직렬화한 워크스페이스를 그대로 되읽는다', () => {
    const workspace = populated();
    const restored = deserializeBackup(serializeBackup(workspace, AT));
    expect(restored).toEqual(workspace);
  });

  it('봉투에 exportedAt과 workspace를 담는다', () => {
    const parsed = JSON.parse(serializeBackup(populated(), AT)) as BackupFile;
    expect(parsed.exportedAt).toBe(AT);
    expect(parsed.workspace.schemaVersion).toBe(1);
    expect(Object.keys(parsed.workspace.trips)).toEqual(['t1']);
  });

  it('빈 워크스페이스도 왕복한다', () => {
    expect(deserializeBackup(serializeBackup(emptyWorkspace(), AT))).toEqual(emptyWorkspace());
  });

  it('봉투 없이 워크스페이스만 있는 파일도 받아준다', () => {
    const bare = JSON.stringify(populated());
    expect(deserializeBackup(bare)).toEqual(populated());
  });

  it('서버 봉투({version, data})도 받아준다 — NAS 일 단위 스냅샷 복구 경로 (M30)', () => {
    const envelope = JSON.stringify({ version: 42, updatedAt: AT, data: populated() });
    expect(deserializeBackup(envelope)).toEqual(populated());
  });

  it('서버 봉투라도 data가 워크스페이스가 아니면 거른다', () => {
    const bogus = JSON.stringify({ version: 1, data: { schemaVersion: 999 } });
    expect(() => deserializeBackup(bogus)).toThrow('지원하지 않는 백업 버전이에요');
  });

  it('가져오기는 병합이라 같은 파일을 두 번 넣어도 그대로다', () => {
    const workspace = populated();
    const imported = deserializeBackup(serializeBackup(workspace, AT));

    const once = merge(workspace, imported);
    const twice = merge(once, imported);

    expect(workspaceEquals(once, workspace)).toBe(true);
    expect(twice).toEqual(once);
  });

  it('가져오기는 로컬에만 있는 여행을 지우지 않는다', () => {
    const local = populated();
    local.trips.t2 = {
      id: 't2',
      title: '삿포로',
      currency: 'JPY',
      columnOrder: [],
      sheetOrder: [],
      createdAt: 5_000,
      updatedAt: 5_000,
    };
    const backup = deserializeBackup(serializeBackup(populated(), AT));

    const merged = merge(local, backup);
    expect(Object.keys(merged.trips).sort()).toEqual(['t1', 't2']);
  });
});

describe('가져오기 검증', () => {
  const invalid: [string, string][] = [
    ['JSON이 아님', 'not json at all'],
    ['빈 문자열', ''],
    ['배열', '[]'],
    ['schemaVersion 없음', JSON.stringify({ trips: {} })],
    ['미래 schemaVersion', JSON.stringify({ ...emptyWorkspace(), schemaVersion: 2 })],
    ['맵 누락', JSON.stringify({ schemaVersion: 1, trips: {}, tombstones: [] })],
    [
      'tombstones가 배열이 아님',
      JSON.stringify({ ...emptyWorkspace(), tombstones: {} }),
    ],
  ];

  it.each(invalid)('%s → 한국어 오류를 던진다', (_name, text) => {
    expect(() => deserializeBackup(text)).toThrow(/(에요|어요)$/);
  });

  it('null을 거부한다', () => {
    expect(() => deserializeBackup('null')).toThrow('백업 파일 형식이 아니에요');
  });
});

describe('workspaceEquals', () => {
  it('같은 내용이면 참', () => {
    expect(workspaceEquals(populated(), populated())).toBe(true);
  });

  it('JSON 왕복으로 optional 필드가 사라져도 같다고 본다', () => {
    const workspace = emptyWorkspace();
    workspace.days.d1 = {
      id: 'd1',
      tripId: 't1',
      sheetId: 's1',
      date: undefined,
      label: '1일차',
      createdAt: 1,
      updatedAt: 1,
    };
    const roundTripped = JSON.parse(JSON.stringify(workspace)) as Workspace;
    expect(roundTripped.days.d1.date).toBeUndefined();
    expect(workspaceEquals(workspace, roundTripped)).toBe(true);
  });

  it('내용이 다르면 거짓', () => {
    const a = populated();
    const b = populated();
    b.cards.k1.title = '다른 제목';
    expect(workspaceEquals(a, b)).toBe(false);
  });

  it('툼스톤 순서는 무시하지만 개수는 본다', () => {
    const a = emptyWorkspace();
    const b = emptyWorkspace();
    a.tombstones = [
      { id: 'x', entity: 'card', deletedAt: 1 },
      { id: 'y', entity: 'day', deletedAt: 2 },
    ];
    b.tombstones = [
      { id: 'y', entity: 'day', deletedAt: 2 },
      { id: 'x', entity: 'card', deletedAt: 1 },
    ];
    expect(workspaceEquals(a, b)).toBe(true);

    b.tombstones.push({ id: 'z', entity: 'entry', deletedAt: 3 });
    expect(workspaceEquals(a, b)).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * 삭제 복원 (B11)
 * ------------------------------------------------------------------ */

/** `populated()` with the whole trip deleted the way `deleteTrip` does it. */
function afterDeletingTrip(at: number): Workspace {
  const ws = populated();
  const dead: Workspace['tombstones'] = [
    { id: 't1', entity: 'trip', deletedAt: at },
    { id: 's1', entity: 'sheet', deletedAt: at },
    { id: 'c1', entity: 'column', deletedAt: at },
    { id: 'k1', entity: 'card', deletedAt: at },
    { id: 'd1', entity: 'day', deletedAt: at },
    { id: 'e1', entity: 'entry', deletedAt: at },
  ];
  return {
    ...emptyWorkspace(),
    tombstones: [...ws.tombstones, ...dead],
  };
}

describe('findTombstoneConflicts', () => {
  it('names every entity the local tombstones would swallow', () => {
    const local = afterDeletingTrip(Date.now());
    const backup = populated();

    const conflicts = findTombstoneConflicts(local, backup);
    expect(conflicts.map((tomb) => `${tomb.entity}:${tomb.id}`).sort()).toEqual([
      'card:k1',
      'column:c1',
      'day:d1',
      'entry:e1',
      'sheet:s1',
      'trip:t1',
    ]);
  });

  it('ignores a tombstone the backup knows nothing about', () => {
    // `gone` is tombstoned locally and absent from the file — nothing to save.
    expect(findTombstoneConflicts(populated(), populated())).toEqual([]);
  });

  it('ignores a tombstone the backup already outlives', () => {
    // Merge would keep this entity anyway (edited after the delete), so it is
    // not a question worth asking the user.
    const local: Workspace = {
      ...emptyWorkspace(),
      tombstones: [{ id: 't1', entity: 'trip', deletedAt: 1_500 }],
    };
    const backup = populated(); // t1.updatedAt === 2_000
    expect(findTombstoneConflicts(local, backup)).toEqual([]);
  });
});

describe('복원 병합', () => {
  it('되살리기를 고르면 지운 여행이 백업 그대로 돌아온다', () => {
    const at = Date.now();
    const local = afterDeletingTrip(at);
    const backup = deserializeBackup(serializeBackup(populated(), AT));

    // 건너뛰기 — today's behaviour, and the bug the user reported.
    expect(Object.keys(merge(local, backup).trips)).toEqual([]);

    // 복원 — exactly those tombstones dropped, nothing else touched.
    const restored = merge(
      withoutTombstones(local, findTombstoneConflicts(local, backup)),
      backup,
    );
    expect(Object.keys(restored.trips)).toEqual(['t1']);
    expect(restored.trips.t1.title).toBe('오사카 3박4일');
    expect(Object.keys(restored.cards)).toEqual(['k1']);
    expect(Object.keys(restored.entries)).toEqual(['e1']);
    expect(restored.trips.t1.columnOrder).toEqual(['c1']);
  });

  it('복원이 다른 톰스톤은 건드리지 않는다', () => {
    const local = afterDeletingTrip(Date.now());
    const backup = populated();
    const stripped = withoutTombstones(local, findTombstoneConflicts(local, backup));

    // The unrelated `gone` card stays buried, so sync still agrees it is dead.
    expect(stripped.tombstones.map((tomb) => tomb.id)).toEqual(['gone']);
  });

  it('되살릴 게 없으면 워크스페이스를 그대로 돌려준다', () => {
    const local = populated();
    expect(withoutTombstones(local, [])).toBe(local);
  });
});

/* ------------------------------------------------------------------ *
 * 사진 포함 백업 (M10)
 * ------------------------------------------------------------------ */

/** `populated()` with two photos on its one card. */
function withPhotos(): Workspace {
  const ws = populated();
  ws.cards.k1 = {
    ...ws.cards.k1,
    photos: [
      { id: 'ph1', w: 1_600, h: 1_200, bytes: 240_000, createdAt: 1_400 },
      { id: 'ph2', w: 900, h: 1_600, bytes: 180_000, createdAt: 1_500 },
    ],
  };
  return ws;
}

describe('사진 포함 백업 (M10)', () => {
  const photos = { ph1: 'AAECAw==', ph2: 'BAUGBw==' };

  it('파일 이름으로 사진 포함본을 구분한다', () => {
    expect(backupPhotoFileName(AT)).toBe(
      `trip-board-backup-${backupDateStamp(AT)}-photos.json`,
    );
    expect(backupPhotoFileName(AT)).not.toBe(backupFileName(AT));
  });

  it('워크스페이스와 사진을 한 봉투에 담아 그대로 되읽는다', () => {
    const workspace = withPhotos();
    const text = serializeBackupWithPhotos(workspace, photos, AT);
    const parsed = JSON.parse(text) as BackupFile;

    expect(parsed.exportedAt).toBe(AT);
    expect(deserializeBackup(text)).toEqual(workspace);
    expect(readBackupPhotos(parsed)).toEqual(photos);
    // 사진 메타데이터는 워크스페이스 쪽에 그대로 남아 있다.
    expect(deserializeBackup(text).cards.k1.photos).toHaveLength(2);
  });

  it('사진이 없는 예전 백업도 그대로 읽힌다', () => {
    const text = serializeBackup(populated(), AT);
    expect(deserializeBackup(text)).toEqual(populated());
    expect(readBackupPhotos(JSON.parse(text))).toBeUndefined();
  });

  it('사진 칸이 비었거나 망가진 파일은 없는 셈 친다', () => {
    expect(readBackupPhotos(null)).toBeUndefined();
    expect(readBackupPhotos({})).toBeUndefined();
    expect(readBackupPhotos({ photos: {} })).toBeUndefined();
    expect(readBackupPhotos({ photos: [] })).toBeUndefined();
    expect(readBackupPhotos({ photos: 'nope' })).toBeUndefined();
    // 문자열이 아닌 값은 통째로 버린다 — 손으로 고친 파일이 객체를 밀어넣지
    // 못하게.
    expect(readBackupPhotos({ photos: { ph1: { evil: true }, ph2: 'BAUGBw==' } })).toEqual({
      ph2: 'BAUGBw==',
    });
  });

  it('병합이 버린 카드의 사진은 되살릴 대상이 아니다', () => {
    // 백업에는 사진이 둘 다 있지만, 로컬 톰스톤이 카드를 삼킨 뒤라면 병합
    // 결과에는 어떤 사진 id도 남지 않는다 — 복원 루프가 도는 기준이 그것이다.
    const backup = withPhotos();
    const local = emptyWorkspace();
    local.tombstones.push({ id: 'k1', entity: 'card', deletedAt: Date.now() });

    const merged = merge(local, backup);
    expect(merged.cards.k1).toBeUndefined();

    const referenced = new Set(
      Object.values(merged.cards).flatMap((card) => (card.photos ?? []).map((p) => p.id)),
    );
    expect(referenced.size).toBe(0);
    expect(Object.keys(readBackupPhotos({ photos })!).filter((id) => referenced.has(id))).toEqual(
      [],
    );
  });

  it('사진이 살아남으면 그 id만 복원 대상이 된다', () => {
    const merged = merge(emptyWorkspace(), withPhotos());
    const referenced = new Set(
      Object.values(merged.cards).flatMap((card) => (card.photos ?? []).map((p) => p.id)),
    );
    const restorable = Object.keys(photos).filter((id) => referenced.has(id));
    expect(restorable).toEqual(['ph1', 'ph2']);
  });
});
