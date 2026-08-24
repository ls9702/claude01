import { describe, expect, it } from 'vitest';
import {
  decideBootstrapSync,
  parseAppliedMarker,
  parseBootstrapConfig,
  type BootstrapApplied,
  type BootstrapSyncInput,
} from './bootstrap';

describe('parseBootstrapConfig', () => {
  it('완전한 설정을 받아들인다', () => {
    const parsed = parseBootstrapConfig({
      sync: { baseUrl: 'https://nas.example:8443/api', token: 'abc' },
      aiEnabled: true,
    });
    expect(parsed).toEqual({
      sync: { baseUrl: 'https://nas.example:8443/api', token: 'abc' },
      aiEnabled: true,
    });
  });

  it('sync만 있어도 된다', () => {
    const parsed = parseBootstrapConfig({ sync: { baseUrl: '/api', token: 't' } });
    expect(parsed?.sync).toEqual({ baseUrl: '/api', token: 't' });
    expect(parsed?.aiEnabled).toBeUndefined();
  });

  it('aiEnabled만 있어도 된다', () => {
    expect(parseBootstrapConfig({ aiEnabled: true })).toEqual({ aiEnabled: true });
  });

  it('aiEnabled는 true만 인정한다 (false/문자열은 무시)', () => {
    expect(parseBootstrapConfig({ aiEnabled: false })).toBeNull();
    expect(parseBootstrapConfig({ aiEnabled: 'yes' })).toBeNull();
  });

  it('빈 baseUrl·빈 토큰·타입 오류 sync는 버린다', () => {
    expect(parseBootstrapConfig({ sync: { baseUrl: '   ', token: 't' } })).toBeNull();
    expect(parseBootstrapConfig({ sync: { baseUrl: '/api', token: '  ' } })).toBeNull();
    expect(parseBootstrapConfig({ sync: { baseUrl: 1, token: 't' } })).toBeNull();
    expect(parseBootstrapConfig({ sync: 'nope' })).toBeNull();
  });

  it('쓰레기 입력은 전부 null', () => {
    expect(parseBootstrapConfig(null)).toBeNull();
    expect(parseBootstrapConfig([])).toBeNull();
    expect(parseBootstrapConfig('json이 아님')).toBeNull();
    expect(parseBootstrapConfig({})).toBeNull();
  });

  it('sync가 무효여도 aiEnabled가 살아 있으면 그것만 살린다', () => {
    const parsed = parseBootstrapConfig({ sync: { baseUrl: '' }, aiEnabled: true });
    expect(parsed).toEqual({ aiEnabled: true });
  });
});

/* ------------------------------------------------------------------ *
 * M20 — 주소 자동 이행
 * ------------------------------------------------------------------ */

describe('parseAppliedMarker', () => {
  it('reads the modern JSON marker', () => {
    expect(parseAppliedMarker(JSON.stringify({ at: 123, baseUrl: '/api' }))).toEqual({
      at: 123,
      baseUrl: '/api',
    });
  });

  it('normalizes the stored address, so a trailing slash is not a move', () => {
    expect(parseAppliedMarker(JSON.stringify({ at: 1, baseUrl: '/api/' }))?.baseUrl).toBe('/api');
  });

  it('accepts M14의 숫자 문자열 as "applied, address unknown"', () => {
    expect(parseAppliedMarker('1760000000000')).toEqual({ at: 1_760_000_000_000 });
  });

  it('treats a present-but-unreadable marker as applied rather than manual', () => {
    // The alternative would silently promote the device to "the user typed
    // this in themselves", which is the one state we must never invent.
    expect(parseAppliedMarker('{{{')).toEqual({ at: 0 });
  });

  it('is null only when there is genuinely nothing stored', () => {
    expect(parseAppliedMarker(null)).toBeNull();
    expect(parseAppliedMarker('')).toBeNull();
  });

  it('drops an empty or non-string baseUrl but keeps the marker', () => {
    expect(parseAppliedMarker(JSON.stringify({ at: 5, baseUrl: '  ' }))).toEqual({ at: 5 });
    expect(parseAppliedMarker(JSON.stringify({ at: 5, baseUrl: 7 }))).toEqual({ at: 5 });
  });
});

describe('decideBootstrapSync', () => {
  const applied = (baseUrl?: string): BootstrapApplied =>
    baseUrl ? { at: 1, baseUrl } : { at: 1 };

  const decide = (input: Partial<BootstrapSyncInput>) =>
    decideBootstrapSync({
      fileBaseUrl: '/api',
      configured: true,
      optedOut: false,
      applied: applied('/api'),
      currentBaseUrl: '/api',
      ...input,
    });

  it('applies on a fresh device', () => {
    expect(decide({ configured: false, applied: null })).toBe('apply');
  });

  it('follows when the file names a different address than it applied', () => {
    expect(decide({ fileBaseUrl: 'https://new.example/api' })).toBe('follow');
  });

  it('is idempotent when the file has not moved', () => {
    expect(decide({})).toBe('skip');
    // Nor is a trailing slash a move.
    expect(decide({ fileBaseUrl: '/api/' })).toBe('skip');
  });

  it('leaves a manually configured device alone, however far the file has moved', () => {
    expect(decide({ applied: null, fileBaseUrl: 'https://new.example/api' })).toBe('skip');
  });

  it('never overrides 해제, applied marker or not', () => {
    expect(decide({ optedOut: true, fileBaseUrl: 'https://new.example/api' })).toBe('skip');
    expect(decide({ optedOut: true, configured: false, applied: null })).toBe('skip');
  });

  it('follows on a legacy marker by comparing against what is actually saved', () => {
    expect(
      decide({
        applied: applied(),
        currentBaseUrl: '/api',
        fileBaseUrl: 'https://new.example/api',
      }),
    ).toBe('follow');
  });

  it('does not follow on a legacy marker when the saved address already matches', () => {
    expect(decide({ applied: applied(), currentBaseUrl: '/api', fileBaseUrl: '/api' })).toBe(
      'skip',
    );
  });

  it('ignores a file with no usable address at all', () => {
    expect(decide({ fileBaseUrl: '   ', configured: false, applied: null })).toBe('skip');
  });
});
