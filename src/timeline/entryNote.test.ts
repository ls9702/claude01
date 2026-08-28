import { describe, expect, it } from 'vitest';
import { noteHint } from './entryNote';

describe('noteHint (M39)', () => {
  it('없거나 공백뿐이면 빈 문자열이다 — 자국도 툴팁도 서지 않는다', () => {
    expect(noteHint(undefined)).toBe('');
    expect(noteHint('')).toBe('');
    expect(noteHint('   ')).toBe('');
    expect(noteHint('\n  \n')).toBe('');
  });

  it('한 줄짜리는 손질만 해서 그대로 내준다', () => {
    expect(noteHint('  개장 30분 전 도착  ')).toBe('개장 30분 전 도착');
  });

  it('두 줄까지 보여주고, 남으면 남았다고 말한다', () => {
    expect(noteHint('첫 줄\n둘째 줄')).toBe('첫 줄\n둘째 줄');
    expect(noteHint('첫 줄\n둘째 줄\n셋째 줄')).toBe('첫 줄\n둘째 줄\n…');
  });

  it('빈 줄은 줄로 세지 않는다', () => {
    expect(noteHint('첫 줄\n\n\n둘째 줄')).toBe('첫 줄\n둘째 줄');
  });

  it('긴 줄은 잘라서 말줄임표를 붙인다', () => {
    const long = 'ㄱ'.repeat(80);
    const hint = noteHint(long);
    expect(hint.endsWith('…')).toBe(true);
    expect(hint.length).toBeLessThan(long.length);
  });
});
