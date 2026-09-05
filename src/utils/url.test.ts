import { describe, expect, it } from 'vitest';
import { isInAppHash, normalizeUrl } from './url';

describe('normalizeUrl (B13)', () => {
  it('prepends https:// to a bare host or path', () => {
    expect(normalizeUrl('tabelog.com/tokyo')).toBe('https://tabelog.com/tokyo');
    expect(normalizeUrl('example.test')).toBe('https://example.test');
    expect(normalizeUrl('www.example.test/a?b=1#c')).toBe('https://www.example.test/a?b=1#c');
  });

  it('trims before deciding', () => {
    expect(normalizeUrl('   tabelog.com/tokyo  ')).toBe('https://tabelog.com/tokyo');
  });

  it('leaves a URL that already has a scheme alone', () => {
    expect(normalizeUrl('https://example.test')).toBe('https://example.test');
    expect(normalizeUrl('http://example.test')).toBe('http://example.test');
    expect(normalizeUrl('HTTPS://Example.test')).toBe('HTTPS://Example.test');
    expect(normalizeUrl('mailto:a@example.test')).toBe('mailto:a@example.test');
    expect(normalizeUrl('tel:+82-2-000-0000')).toBe('tel:+82-2-000-0000');
  });

  it('resolves a protocol-relative URL to https', () => {
    expect(normalizeUrl('//example.test/a')).toBe('https://example.test/a');
  });

  it('gives back undefined for anything that cannot be a link', () => {
    expect(normalizeUrl('')).toBeUndefined();
    expect(normalizeUrl('   ')).toBeUndefined();
    expect(normalizeUrl(undefined)).toBeUndefined();
    // Prose, not an address — gluing `https://` onto it helps nobody.
    expect(normalizeUrl('맛집 리스트')).toBeUndefined();
    expect(normalizeUrl('example.test/a b')).toBeUndefined();
  });

  it('refuses the schemes that would turn a link into code', () => {
    expect(normalizeUrl('javascript:alert(1)')).toBeUndefined();
    expect(normalizeUrl('JavaScript:alert(1)')).toBeUndefined();
    expect(normalizeUrl('data:text/html,<script></script>')).toBeUndefined();
    expect(normalizeUrl('vbscript:msgbox')).toBeUndefined();
    expect(normalizeUrl('file:///etc/passwd')).toBeUndefined();
  });
});

describe('앱 안의 해시 주소 (M52b)', () => {
  it('`#/draw/<id>`는 그대로 남는다 — https://를 붙이면 열 수 없는 주소가 된다', () => {
    expect(normalizeUrl('#/draw/abc123')).toBe('#/draw/abc123');
    expect(normalizeUrl('  #/board  ')).toBe('#/board');
    expect(isInAppHash('#/draw/abc123')).toBe(true);
  });

  it('그 밖의 것은 앱 안의 주소가 아니다', () => {
    expect(isInAppHash('https://example.test/#/draw/a')).toBe(false);
    expect(isInAppHash('#anchor')).toBe(false);
    expect(isInAppHash(undefined)).toBe(false);
    expect(normalizeUrl('example.test/#/draw/a')).toBe('https://example.test/#/draw/a');
  });
});
