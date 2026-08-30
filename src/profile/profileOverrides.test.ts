import { describe, expect, it } from 'vitest';
import { PROFILES, resolveProfile } from './profile';

/**
 * 세션마다 다른 두 사람 (M47).
 *
 * The rule this whole feature rests on is the *negative* one: with no overrides
 * — which is every install that existed before this milestone, and every session
 * nobody has edited — the built-in definition must come back unchanged. If that
 * ever stops being true, thousands of existing screens change for no reason, so
 * it is the first thing asserted here and it is asserted by identity.
 */

describe('resolveProfile', () => {
  it('오버라이드가 없으면 기본 정의 **그 객체**를 준다', () => {
    expect(resolveProfile('song', null)).toBe(PROFILES.song);
    expect(resolveProfile('song', undefined)).toBe(PROFILES.song);
    expect(resolveProfile('hoyabom', {})).toBe(PROFILES.hoyabom);
  });

  it('빈 값만 든 오버라이드도 기본 그대로다', () => {
    // 관리자가 칸을 지운 것은 「기본으로 돌려 달라」는 뜻이다.
    expect(resolveProfile('song', { song: {} })).toBe(PROFILES.song);
    expect(resolveProfile('song', { song: { label: '   ', avatar: '' } })).toBe(PROFILES.song);
  });

  it('이름을 바꾸면 이름만 바뀐다', () => {
    const resolved = resolveProfile('song', { song: { label: '민수' } });
    expect(resolved.label).toBe('민수');
    // id·색·이니셜은 카드와 코멘트에 이미 박혀 있다 — 건드리지 않는다.
    expect(resolved.id).toBe('song');
    expect(resolved.colorToken).toBe(PROFILES.song.colorToken);
    expect(resolved.initials).toBe(PROFILES.song.initials);
    expect(resolved.avatar).toBeUndefined();
  });

  it('이모지를 주면 아바타가 생긴다', () => {
    const resolved = resolveProfile('hoyabom', { hoyabom: { avatar: '🐻' } });
    expect(resolved.avatar).toBe('🐻');
    expect(resolved.label).toBe(PROFILES.hoyabom.label);
  });

  it('앞뒤 공백은 다듬는다', () => {
    expect(resolveProfile('song', { song: { label: '  민수  ' } }).label).toBe('민수');
  });

  it('다른 사람의 오버라이드는 이 사람에게 오지 않는다', () => {
    expect(resolveProfile('song', { hoyabom: { label: '지연' } })).toBe(PROFILES.song);
  });

  it('오버라이드는 원본을 고치지 않는다', () => {
    resolveProfile('song', { song: { label: '민수', avatar: '🙂' } });
    expect(PROFILES.song.label).toBe('songlee');
    expect(PROFILES.song.avatar).toBeUndefined();
  });
});
