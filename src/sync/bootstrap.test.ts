import { describe, expect, it } from 'vitest';
import { parseBootstrapConfig } from './bootstrap';

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
