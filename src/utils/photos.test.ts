import { describe, expect, it } from 'vitest';
import {
  JPEG_QUALITY,
  MAX_EDGE_PX,
  MAX_PHOTO_BYTES,
  firstAttempt,
  fitWithin,
  formatBytes,
  nextAttempt,
  photoUsage,
  referencedPhotoIds,
  type Attempt,
} from './photos';

describe('fitWithin', () => {
  it('leaves a photo already inside the box alone', () => {
    expect(fitWithin(800, 600)).toEqual({ w: 800, h: 600 });
    expect(fitWithin(1600, 1200)).toEqual({ w: 1600, h: 1200 });
  });

  it('scales the long edge down to the cap, keeping the ratio', () => {
    expect(fitWithin(4000, 3000)).toEqual({ w: 1600, h: 1200 });
    expect(fitWithin(3000, 4000)).toEqual({ w: 1200, h: 1600 });
    expect(fitWithin(4000, 4000)).toEqual({ w: 1600, h: 1600 });
  });

  it('honours a custom cap', () => {
    expect(fitWithin(4000, 3000, 800)).toEqual({ w: 800, h: 600 });
    expect(fitWithin(1000, 500, 500)).toEqual({ w: 500, h: 250 });
  });

  it('never lets an extreme panorama round away to nothing', () => {
    expect(fitWithin(8000, 3, 1600)).toEqual({ w: 1600, h: 1 });
  });

  it('degrades gracefully on garbage', () => {
    expect(fitWithin(0, 0)).toEqual({ w: 1, h: 1 });
    expect(fitWithin(Number.NaN, -5)).toEqual({ w: 1, h: 1 });
    expect(fitWithin(3200, 1600, 0)).toEqual({ w: 1600, h: 800 });
  });
});

describe('nextAttempt — 압축 사다리', () => {
  const first = firstAttempt();

  it('starts at the nominal quality and the full edge cap', () => {
    expect(first).toEqual({ quality: JPEG_QUALITY, maxEdge: MAX_EDGE_PX });
  });

  it('stops as soon as the result fits', () => {
    expect(nextAttempt(first, MAX_PHOTO_BYTES)).toBeNull();
    expect(nextAttempt(first, 10_000)).toBeNull();
  });

  it('walks the quality down before it touches the pixels', () => {
    const over = MAX_PHOTO_BYTES + 1;
    const qualities: number[] = [];
    let attempt: Attempt | null = first;
    while (attempt && attempt.maxEdge === MAX_EDGE_PX) {
      qualities.push(attempt.quality);
      attempt = nextAttempt(attempt, over);
    }
    expect(qualities).toEqual([0.8, 0.7, 0.6, 0.5]);
    // Only once quality is spent does the edge cap halve, and only once.
    expect(attempt).toEqual({ quality: 0.7, maxEdge: MAX_EDGE_PX / 2 });
  });

  it('accepts whatever the halved attempt produced — never hard-fails', () => {
    const halved: Attempt = { quality: 0.7, maxEdge: MAX_EDGE_PX / 2 };
    expect(nextAttempt(halved, MAX_PHOTO_BYTES * 4)).toBeNull();
  });

  it('terminates in at most five rungs for any size', () => {
    let attempt: Attempt | null = first;
    let rungs = 0;
    while (attempt) {
      rungs += 1;
      attempt = nextAttempt(attempt, Number.MAX_SAFE_INTEGER);
      expect(rungs).toBeLessThanOrEqual(6);
    }
    expect(rungs).toBe(5);
  });
});

describe('formatBytes', () => {
  it('reads as a size a person would say out loud', () => {
    expect(formatBytes(0)).toBe('0KB');
    expect(formatBytes(-1)).toBe('0KB');
    expect(formatBytes(400)).toBe('1KB');
    expect(formatBytes(2_048)).toBe('2KB');
    expect(formatBytes(512 * 1024)).toBe('512KB');
    expect(formatBytes(1024 * 1024)).toBe('1.0MB');
    expect(formatBytes(3.5 * 1024 * 1024)).toBe('3.5MB');
    expect(formatBytes(42 * 1024 * 1024)).toBe('42MB');
  });
});

describe('photoUsage', () => {
  const card = (id: string, photos?: { id: string; bytes: number }[]) => [
    id,
    photos ? { photos } : {},
  ];

  it('adds up every photo on every card', () => {
    const ws = {
      cards: Object.fromEntries([
        card('k1', [
          { id: 'p1', bytes: 100 },
          { id: 'p2', bytes: 200 },
        ]),
        card('k2', [{ id: 'p3', bytes: 300 }]),
        card('k3'),
      ]),
    };
    expect(photoUsage(ws)).toEqual({ count: 3, bytes: 600 });
  });

  it('counts a shared id once', () => {
    const ws = {
      cards: Object.fromEntries([
        card('k1', [{ id: 'p1', bytes: 100 }]),
        card('k2', [{ id: 'p1', bytes: 100 }]),
      ]),
    };
    expect(photoUsage(ws)).toEqual({ count: 1, bytes: 100 });
  });

  it('is zero for a workspace with no photos at all', () => {
    expect(photoUsage({ cards: {} })).toEqual({ count: 0, bytes: 0 });
  });

  it('treats a garbled size as nothing rather than NaN', () => {
    const ws = {
      cards: Object.fromEntries([
        card('k1', [
          { id: 'p1', bytes: Number.NaN },
          { id: 'p2', bytes: -5 },
        ]),
      ]),
    };
    expect(photoUsage(ws)).toEqual({ count: 2, bytes: 0 });
  });
});

describe('referencedPhotoIds', () => {
  it('카드에 붙은 사진을 모은다', () => {
    const ws = {
      cards: {
        k1: { photos: [{ id: 'p1' }, { id: 'p2' }] },
        k2: { photos: [{ id: 'p3' }] },
        k3: {},
      },
    };
    expect([...referencedPhotoIds(ws)].sort()).toEqual(['p1', 'p2', 'p3']);
  });

  it('메모 사진도 센다 (M21) — 이 한 줄이 GC·업로드·백업을 전부 잇는다', () => {
    const ws = {
      cards: { k1: { photos: [{ id: 'p1' }] } },
      memos: {
        m1: { photos: [{ id: 'p2' }, { id: 'p3' }] },
        // 지워진 메시지는 사진을 이미 잃었다 — 그래서 바이트가 회수된다.
        m2: {},
      },
    };
    expect([...referencedPhotoIds(ws)].sort()).toEqual(['p1', 'p2', 'p3']);
  });

  it('같은 id는 한 번만 — 카드와 메모에 걸쳐 있어도 사진 하나다', () => {
    const ws = {
      cards: { k1: { photos: [{ id: 'p1' }] } },
      memos: { m1: { photos: [{ id: 'p1' }] } },
    };
    expect([...referencedPhotoIds(ws)]).toEqual(['p1']);
  });

  it('memos가 없는 워크스페이스도 그대로 답한다 (M21 이전)', () => {
    expect([...referencedPhotoIds({ cards: {} })]).toEqual([]);
    expect([...referencedPhotoIds({ cards: { k1: { photos: [{ id: 'p1' }] } } })]).toEqual(['p1']);
  });
});

describe('photoUsage — 메모 포함 (M21)', () => {
  it('메모 사진의 용량도 설정 화면의 합계에 들어간다', () => {
    const ws = {
      cards: { k1: { photos: [{ id: 'p1', bytes: 100 }] } },
      memos: { m1: { photos: [{ id: 'p2', bytes: 200 }] } },
    };
    expect(photoUsage(ws)).toEqual({ count: 2, bytes: 300 });
  });

  it('카드와 메모가 같은 id를 가리켜도 한 장이다', () => {
    const ws = {
      cards: { k1: { photos: [{ id: 'p1', bytes: 100 }] } },
      memos: { m1: { photos: [{ id: 'p1', bytes: 100 }] } },
    };
    expect(photoUsage(ws)).toEqual({ count: 1, bytes: 100 });
  });
});
