import { describe, expect, it } from 'vitest';
import { readNotice, readProfileOverrides } from './api';

/**
 * The additive half of the M46/M47 contract, read the way a client has to read
 * it: a pre-M46 server sends none of these fields, and every one of them must
 * be absent-safe rather than merely optional in a type.
 */

describe('readNotice', () => {
  it('공지가 없는 서버는 null이다', () => {
    expect(readNotice({ version: 3 })).toBeNull();
    expect(readNotice({ version: 3, notice: null })).toBeNull();
    expect(readNotice(null)).toBeNull();
  });

  it('빈 글은 공지가 아니다 — 「내리기」가 이렇게 도달한다', () => {
    expect(readNotice({ notice: { text: '', at: 5 } })).toBeNull();
    expect(readNotice({ notice: { text: '   ', at: 5 } })).toBeNull();
  });

  it('글과 시각을 그대로 읽는다', () => {
    expect(readNotice({ notice: { text: '  내일 점검  ', at: 5 } })).toEqual({
      text: '내일 점검',
      at: 5,
    });
  });

  it('시각이 없으면 0이다', () => {
    expect(readNotice({ notice: { text: '점검' } })).toEqual({ text: '점검', at: 0 });
  });
});

describe('readProfileOverrides', () => {
  it('프로필을 말하지 않는 서버는 null이다', () => {
    expect(readProfileOverrides({ version: 1 })).toBeNull();
    expect(readProfileOverrides({ profiles: null })).toBeNull();
  });

  it('아무것도 바꾸지 않는 오버라이드는 없는 것으로 읽는다', () => {
    // 기본값이 기본값으로 남아야 기존 화면이 한 글자도 안 바뀐다.
    expect(readProfileOverrides({ profiles: {} })).toBeNull();
    expect(readProfileOverrides({ profiles: { song: { label: '  ' } } })).toBeNull();
    expect(readProfileOverrides({ profiles: { song: 'nope' } })).toBeNull();
  });

  it('이름과 이모지만 골라 담는다', () => {
    expect(
      readProfileOverrides({
        profiles: {
          song: { label: ' 민수 ', avatar: '🙂', colorToken: 'lime' },
          hoyabom: { avatar: '🐻' },
        },
      }),
    ).toEqual({ song: { label: '민수', avatar: '🙂' }, hoyabom: { avatar: '🐻' } });
  });
});
