import { describe, expect, it } from 'vitest';
import { base64ToBuf, bufToBase64 } from './base64';

/** A buffer with every byte value in it, repeated `times` over. */
const allBytes = (times = 1): ArrayBuffer => {
  const bytes = new Uint8Array(256 * times);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = index % 256;
  return bytes.buffer;
};

const same = (a: ArrayBuffer, b: ArrayBuffer): boolean => {
  const left = new Uint8Array(a);
  const right = new Uint8Array(b);
  return left.length === right.length && left.every((value, index) => value === right[index]);
};

describe('base64 왕복', () => {
  it('빈 버퍼도 왕복한다', () => {
    const empty = new Uint8Array(0).buffer;
    expect(bufToBase64(empty)).toBe('');
    expect(base64ToBuf('').byteLength).toBe(0);
  });

  it('모든 바이트 값을 그대로 되돌린다', () => {
    const buf = allBytes();
    expect(same(base64ToBuf(bufToBase64(buf)), buf)).toBe(true);
  });

  it('청크 경계를 넘는 크기도 안전하다', () => {
    // 0x2000 is the chunk size; 300KB crosses it ~37 times, and this is the
    // size at which the naive `fromCharCode(...bytes)` blows the call stack.
    const buf = allBytes(1_200);
    expect(buf.byteLength).toBeGreaterThanOrEqual(300 * 1024);
    const text = bufToBase64(buf);
    expect(text.length).toBeGreaterThanOrEqual(400 * 1024);
    expect(same(base64ToBuf(text), buf)).toBe(true);
  });

  it('data URL 접두사와 줄바꿈을 참아준다', () => {
    const buf = allBytes();
    const text = bufToBase64(buf);
    const wrapped = text.match(/.{1,76}/g)!.join('\n');
    expect(same(base64ToBuf(`data:image/jpeg;base64,${text}`), buf)).toBe(true);
    expect(same(base64ToBuf(wrapped), buf)).toBe(true);
  });

  it('알려진 값과 맞는다', () => {
    const hello = new Uint8Array([72, 101, 108, 108, 111]).buffer;
    expect(bufToBase64(hello)).toBe('SGVsbG8=');
    expect(same(base64ToBuf('SGVsbG8='), hello)).toBe(true);
  });
});
