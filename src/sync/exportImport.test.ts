import { describe, expect, it } from 'vitest';
import { emptyWorkspace, type Workspace } from '../types/models';
import {
  backupDateStamp,
  backupFileName,
  deserializeBackup,
  serializeBackup,
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
