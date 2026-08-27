import { describe, expect, it } from 'vitest';
import { SHORT_LINK_HINT, parseCoordInput } from './coordInput';

/** 잇푸도 난바점 — 이 마일스톤을 부른 그 가게. */
const IPPUDO = { lat: 34.6659, lng: 135.5013 };

describe('parseCoordInput — 손으로 적은 좌표', () => {
  it('reads a comma-separated pair', () => {
    expect(parseCoordInput('34.6659, 135.5013')).toEqual({ kind: 'coords', ...IPPUDO });
  });

  it('reads a pair with no space, and one with only a space', () => {
    expect(parseCoordInput('34.6659,135.5013')).toEqual({ kind: 'coords', ...IPPUDO });
    expect(parseCoordInput('34.6659 135.5013')).toEqual({ kind: 'coords', ...IPPUDO });
  });

  it('ignores the whitespace around and inside the pair', () => {
    expect(parseCoordInput('  34.6659 ,   135.5013  ')).toEqual({ kind: 'coords', ...IPPUDO });
  });

  it('keeps latitude first — the order Google and this app both use', () => {
    const parsed = parseCoordInput('35.6595, 139.7005');
    expect(parsed).toEqual({ kind: 'coords', lat: 35.6595, lng: 139.7005 });
  });

  it('reads negative and explicitly positive numbers', () => {
    expect(parseCoordInput('-33.8688, 151.2093')).toEqual({
      kind: 'coords',
      lat: -33.8688,
      lng: 151.2093,
    });
    expect(parseCoordInput('+34.6659, -135.5013')).toEqual({
      kind: 'coords',
      lat: 34.6659,
      lng: -135.5013,
    });
  });

  it('reads whole numbers too', () => {
    expect(parseCoordInput('35, 139')).toEqual({ kind: 'coords', lat: 35, lng: 139 });
  });

  it('rejects a pair outside the world', () => {
    expect(parseCoordInput('91, 0')).toBeNull();
    expect(parseCoordInput('-90.5, 0')).toBeNull();
    expect(parseCoordInput('0, 181')).toBeNull();
    expect(parseCoordInput('0, -180.1')).toBeNull();
    // 위경도를 뒤집어 적은 것도 그냥 거절한다 — 말없이 바로잡는 것이 더 위험하다.
    expect(parseCoordInput('135.5013, 34.6659')).toBeNull();
  });

  it('rejects null island — that is what an empty value looks like', () => {
    expect(parseCoordInput('0, 0')).toBeNull();
    expect(parseCoordInput('0,0')).toBeNull();
  });

  it('rejects anything that is not exactly two numbers', () => {
    expect(parseCoordInput('츠텐카쿠')).toBeNull();
    expect(parseCoordInput('')).toBeNull();
    expect(parseCoordInput('   ')).toBeNull();
    expect(parseCoordInput('34.6659')).toBeNull();
    expect(parseCoordInput('34.6659, 135.5013, 17')).toBeNull();
    expect(parseCoordInput('오사카 34.6659, 135.5013')).toBeNull();
    expect(parseCoordInput('34.6659, 삼십오')).toBeNull();
    expect(parseCoordInput('1-2, 3-4')).toBeNull();
  });
});

describe('parseCoordInput — 구글 지도 주소', () => {
  it('reads the map centre out of a /maps/place URL', () => {
    expect(
      parseCoordInput('https://www.google.com/maps/place/大阪城/@34.6873,135.5259,17z/data=!3m1'),
    ).toEqual({ kind: 'coords', lat: 34.6873, lng: 135.5259 });
  });

  it("prefers the place's own point (!3d!4d) over the viewport centre (@)", () => {
    // 지도를 손으로 끌어 놓고 복사하면 @는 밀려 있다. 가게의 점은 밀리지 않는다.
    const url =
      'https://www.google.com/maps/place/一風堂+難波店/@34.6700,135.5100,17z/' +
      'data=!4m6!3m5!1s0x6000e1f0!8m2!3d34.6659!4d135.5013!16s%2Fg%2F1td';
    expect(parseCoordInput(url)).toEqual({ kind: 'coords', ...IPPUDO });
  });

  it('reads ?q= and ?query= coordinates', () => {
    expect(parseCoordInput('https://www.google.com/maps?q=34.6659,135.5013')).toEqual({
      kind: 'coords',
      ...IPPUDO,
    });
    expect(
      parseCoordInput('https://www.google.com/maps/search/?api=1&query=34.6659,135.5013'),
    ).toEqual({ kind: 'coords', ...IPPUDO });
  });

  it('decodes an escaped comma and a plus-as-space in the query', () => {
    expect(parseCoordInput('https://maps.google.com/?q=34.6659%2C135.5013')).toEqual({
      kind: 'coords',
      ...IPPUDO,
    });
    expect(parseCoordInput('https://maps.google.com/?q=34.6659,+135.5013')).toEqual({
      kind: 'coords',
      ...IPPUDO,
    });
  });

  it('reads the ll= parameter of an older maps link', () => {
    expect(parseCoordInput('https://maps.google.com/maps?ll=34.6659,135.5013&z=17')).toEqual({
      kind: 'coords',
      ...IPPUDO,
    });
  });

  it('falls through a named ?q= to the coordinates elsewhere in the link', () => {
    expect(
      parseCoordInput('https://www.google.com/maps?q=Ichiran+Namba&ll=34.6659,135.5013'),
    ).toEqual({ kind: 'coords', ...IPPUDO });
  });

  it('is null for a maps link with no coordinates in it at all', () => {
    expect(parseCoordInput('https://www.google.com/maps/search/이치란+난바')).toBeNull();
  });

  it('is null for a link that is not a map', () => {
    expect(parseCoordInput('https://example.com/34.6659,135.5013')).toBeNull();
  });
});

describe('parseCoordInput — 단축 링크', () => {
  it('recognises both short-link hosts instead of failing silently', () => {
    expect(parseCoordInput('https://maps.app.goo.gl/abcDEF123')).toEqual({ kind: 'short-link' });
    expect(parseCoordInput('https://goo.gl/maps/abcDEF123')).toEqual({ kind: 'short-link' });
  });

  it('recognises one pasted with the sharing sentence around it', () => {
    expect(parseCoordInput('일풍당 난바점 https://maps.app.goo.gl/abcDEF123')).toEqual({
      kind: 'short-link',
    });
  });

  it('says what to do about it in one line', () => {
    expect(SHORT_LINK_HINT).toContain('전체 주소를 복사');
  });
});
