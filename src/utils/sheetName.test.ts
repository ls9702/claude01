import { describe, expect, it } from 'vitest';
import { copySheetName } from './sheetName';

describe('copySheetName', () => {
  it('appends (복사) when nothing is in the way', () => {
    expect(copySheetName('본 일정', ['본 일정'])).toBe('본 일정 (복사)');
    expect(copySheetName('본 일정', [])).toBe('본 일정 (복사)');
  });

  it('numbers from 2 once (복사) is taken', () => {
    expect(copySheetName('본 일정', ['본 일정', '본 일정 (복사)'])).toBe('본 일정 (복사 2)');
    expect(
      copySheetName('본 일정', ['본 일정', '본 일정 (복사)', '본 일정 (복사 2)']),
    ).toBe('본 일정 (복사 3)');
  });

  it('fills the first free number rather than counting sheets', () => {
    // (복사 2)가 지워진 뒤에도 다음 사본은 그 빈자리를 쓴다.
    expect(
      copySheetName('본 일정', ['본 일정', '본 일정 (복사)', '본 일정 (복사 3)']),
    ).toBe('본 일정 (복사 2)');
  });

  it('does not stack the suffix when copying a copy', () => {
    expect(copySheetName('본 일정 (복사)', ['본 일정', '본 일정 (복사)'])).toBe(
      '본 일정 (복사 2)',
    );
    expect(
      copySheetName('본 일정 (복사 2)', ['본 일정', '본 일정 (복사)', '본 일정 (복사 2)']),
    ).toBe('본 일정 (복사 3)');
  });

  it('trims both sides before comparing', () => {
    expect(copySheetName('  본 일정  ', ['본 일정 (복사)  '])).toBe('본 일정 (복사 2)');
  });

  it('falls back for a blank name', () => {
    expect(copySheetName('   ', [])).toBe('새 일정 (복사)');
    // 「(복사)」밖에 없는 이름은 벗겨내면 아무것도 남지 않는다.
    expect(copySheetName('(복사)', [])).toBe('새 일정 (복사)');
  });
});
