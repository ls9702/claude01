import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyText } from './clipboard';

const g = globalThis as unknown as { navigator?: unknown; document?: unknown };

afterEach(() => {
  delete g.navigator;
  delete g.document;
});

describe('copyText (M55)', () => {
  it('빈 글은 복사하지 않는다', async () => {
    expect(await copyText('')).toBe(false);
  });

  it('새길이 있으면 그것을 쓴다', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    g.navigator = { clipboard: { writeText } };
    expect(await copyText('지우펀 오후에')).toBe(true);
    expect(writeText).toHaveBeenCalledWith('지우펀 오후에');
  });

  it('새길이 막히면 옛길(execCommand)로 간다', async () => {
    g.navigator = { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } };
    const area = {
      value: '',
      style: {} as Record<string, string>,
      setAttribute: vi.fn(),
      focus: vi.fn(),
      select: vi.fn(),
      remove: vi.fn(),
    };
    const execCommand = vi.fn().mockReturnValue(true);
    g.document = {
      createElement: () => area,
      body: { appendChild: vi.fn() },
      execCommand,
    };
    expect(await copyText('나도')).toBe(true);
    expect(area.value).toBe('나도');
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(area.remove).toHaveBeenCalled();
  });

  it('둘 다 없으면 됐다고 말하지 않는다', async () => {
    g.navigator = {};
    expect(await copyText('츄라우미')).toBe(false);
  });
});
