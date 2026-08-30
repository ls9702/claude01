import { describe, expect, it } from 'vitest';
import { parseAdminBackups, parseAdminState } from './adminApi';

/**
 * The admin screen is the one place in this app where a misread response has a
 * blast radius bigger than one device: a session row that claims to be active
 * when it is not, or a size that reads as `NaN`, is what stands between the
 * owner and everybody's trip. So every field is defended, and this is where
 * that defence is proved — without a server, because the parsing is pure.
 */

describe('parseAdminState', () => {
  it('제대로 온 응답을 그대로 읽는다', () => {
    const state = parseAdminState({
      ok: true,
      active: 'osaka-2026',
      sessions: [
        {
          id: 'default',
          label: '',
          active: false,
          archived: true,
          updatedAt: 1_700_000_000_000,
          dataBytes: 2048,
          photoBytes: 1024,
          photoCount: 3,
        },
        { id: 'osaka-2026', label: '오사카 2026', active: true, archived: false },
      ],
      archive: { folder: '2026-11-osaka', base: '/volume1/photo', ready: true, baseExists: true, bytes: 99, count: 2 },
      usage: { diskFree: 10, diskTotal: 100, at: 5 },
      notice: { text: '내일 점검', at: 7 },
      profiles: { song: { label: '민수' } },
    });

    expect(state.active).toBe('osaka-2026');
    expect(state.sessions).toHaveLength(2);
    expect(state.sessions[0]).toEqual({
      id: 'default',
      label: '',
      active: false,
      archived: true,
      updatedAt: 1_700_000_000_000,
      dataBytes: 2048,
      photoBytes: 1024,
      photoCount: 3,
    });
    // 없는 숫자는 0이다 — 화면에 NaN이 뜨느니 0이 뜨는 편이 낫다.
    expect(state.sessions[1].dataBytes).toBe(0);
    expect(state.archive.folder).toBe('2026-11-osaka');
    expect(state.usage).toEqual({ diskFree: 10, diskTotal: 100, at: 5 });
    expect(state.notice).toEqual({ text: '내일 점검', at: 7 });
    expect(state.profiles).toEqual({ song: { label: '민수' } });
  });

  it('빈 응답도 그릴 수 있는 상태로 만든다', () => {
    const state = parseAdminState({ ok: true });
    expect(state.active).toBe('default');
    expect(state.sessions).toEqual([]);
    expect(state.archive.folder).toBe('');
    expect(state.archive.ready).toBe(false);
    expect(state.usage).toBeNull();
    expect(state.notice).toBeNull();
    expect(state.profiles).toBeNull();
  });

  it('id 없는 세션 줄은 버린다', () => {
    const state = parseAdminState({ sessions: [{ label: '이름만' }, null, 3, { id: 'ok' }] });
    expect(state.sessions.map((s) => s.id)).toEqual(['ok']);
  });

  it('빈 공지는 공지가 아니다 — 「내리기」가 도달하는 모습이다', () => {
    expect(parseAdminState({ notice: { text: '   ', at: 1 } }).notice).toBeNull();
    expect(parseAdminState({ notice: null }).notice).toBeNull();
  });

  it('본문이 객체가 아니면 던진다', () => {
    expect(() => parseAdminState('nope')).toThrow();
    expect(() => parseAdminState(null)).toThrow();
  });
});

describe('parseAdminBackups', () => {
  it('날짜가 있는 줄만 남긴다', () => {
    expect(
      parseAdminBackups({
        backups: [{ date: '20261102', bytes: 100 }, { bytes: 5 }, null, { date: '20261101' }],
      }),
    ).toEqual([
      { date: '20261102', bytes: 100 },
      { date: '20261101', bytes: 0 },
    ]);
  });

  it('목록이 없으면 빈 목록이다', () => {
    expect(parseAdminBackups({})).toEqual([]);
    expect(parseAdminBackups(null)).toEqual([]);
  });
});
