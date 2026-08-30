import { describe, expect, it } from 'vitest';
import {
  ARCHIVE_EXTENSIONS,
  MAX_ARCHIVE_NAME_LEN,
  extensionOf,
  isArchivableName,
  safeArchiveName,
  summarizeArchive,
  type ArchiveResult,
} from './archiveFiles';

describe('extensionOf', () => {
  it('마지막 점 뒤를 소문자로 준다', () => {
    expect(extensionOf('IMG_0001.JPG')).toBe('jpg');
    expect(extensionOf('a.b.heic')).toBe('heic');
  });

  it('확장자가 없으면 빈 문자열이다', () => {
    expect(extensionOf('IMG_0001')).toBe('');
    expect(extensionOf('.gitignore')).toBe('');
    expect(extensionOf('')).toBe('');
  });

  it('경로가 붙어 와도 파일 이름만 본다', () => {
    expect(extensionOf('/tmp/사진/IMG.png')).toBe('png');
    expect(extensionOf('C:\\photos\\IMG.png')).toBe('png');
  });
});

describe('isArchivableName', () => {
  it('사진만 받는다', () => {
    for (const ext of ARCHIVE_EXTENSIONS) {
      expect(isArchivableName(`IMG_0001.${ext}`)).toBe(true);
    }
  });

  it('동영상은 일부러 받지 않는다', () => {
    // 폰의 4K 한 편이 수백 MB고, 브라우저 업로드에는 이어받기가 없다.
    expect(isArchivableName('trip.mp4')).toBe(false);
    expect(isArchivableName('trip.mov')).toBe(false);
    expect(isArchivableName('plan.pdf')).toBe(false);
    expect(isArchivableName('notes.txt')).toBe(false);
  });
});

describe('safeArchiveName', () => {
  it('사진이 아니면 이름을 주지 않는다', () => {
    expect(safeArchiveName('trip.mp4')).toBeNull();
    expect(safeArchiveName('IMG_0001')).toBeNull();
    expect(safeArchiveName('')).toBeNull();
    expect(safeArchiveName('..')).toBeNull();
  });

  it('경로는 통째로 버린다 — 파일 이름만 남는다', () => {
    // 서버가 다시 검사하지만, 두 쪽이 같은 규칙을 말해야 화면이 거짓말을 안 한다.
    expect(safeArchiveName('../../etc/passwd.jpg')).toBe('passwd.jpg');
    expect(safeArchiveName('C:\\photos\\IMG_0001.jpg')).toBe('IMG_0001.jpg');
  });

  it('안전하지 않은 글자는 밑줄이 된다', () => {
    expect(safeArchiveName('a b&c.png')).toBe('a_b_c.png');
    expect(safeArchiveName('IMG 0001 (1).jpg')).toBe('IMG_0001_1.jpg');
  });

  it('이름이 통째로 사라지면 photo가 된다', () => {
    // 한글 파일명이 흔한 경우다 — `.jpg`는 이름이 아니다.
    expect(safeArchiveName('사진.jpg')).toBe('photo.jpg');
    expect(safeArchiveName('___.jpg')).toBe('photo.jpg');
  });

  it('확장자는 소문자로 정돈된다', () => {
    expect(safeArchiveName('IMG_0001.JPEG')).toBe('IMG_0001.jpeg');
  });

  it('아주 긴 이름은 잘린다', () => {
    const name = safeArchiveName(`${'a'.repeat(400)}.jpg`);
    expect(name).not.toBeNull();
    expect((name ?? '').length).toBeLessThanOrEqual(MAX_ARCHIVE_NAME_LEN);
    expect(name?.endsWith('.jpg')).toBe(true);
  });
});

describe('summarizeArchive', () => {
  const row = (outcome: ArchiveResult['outcome']): ArchiveResult => ({
    name: 'IMG.jpg',
    outcome,
    detail: '',
  });

  it('아무것도 고르지 않았으면 고르라고 한다', () => {
    expect(summarizeArchive([])).toBe('보관할 사진을 골라 주세요');
  });

  it('좋은 소식만 있으면 좋은 소식만 말한다', () => {
    // 「실패 0장」을 늘 붙이면 정작 하고 싶은 말이 묻힌다.
    expect(summarizeArchive([row('ok'), row('ok')])).toBe('2장 보관했어요');
  });

  it('실패와 건너뜀은 있을 때만 붙는다', () => {
    expect(summarizeArchive([row('ok'), row('failed')])).toBe('1장 보관했어요 · 1장 실패');
    expect(summarizeArchive([row('ok'), row('skipped')])).toBe(
      '1장 보관했어요 · 1장은 사진이 아니라 건너뛰었어요',
    );
  });

  it('전부 건너뛰었으면 보관한 것이 없다고 말한다', () => {
    expect(summarizeArchive([row('skipped')])).toBe('1장은 사진이 아니라 건너뛰었어요');
  });
});
