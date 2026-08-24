import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyWorkspace, type Card, type Id, type Millis, type Workspace } from '../types/models';

// Neither store can reach IndexedDB under vitest's node environment, so both
// adapters are swapped for memory. What is under test is the *decision*.
vi.mock('./persistMiddleware', () => {
  const memory = new Map<string, string>();
  return {
    idbStorage: {
      getItem: async (key: string) => memory.get(key) ?? null,
      setItem: async (key: string, value: string) => {
        memory.set(key, value);
      },
      removeItem: async (key: string) => {
        memory.delete(key);
      },
    },
  };
});

const blobs = new Set<Id>();

vi.mock('./photoBlobs', () => ({
  listPhotoBlobIds: async () => [...blobs],
  deletePhotoBlobs: async (ids: readonly Id[]) => {
    for (const id of ids) blobs.delete(id);
  },
}));

const { PHOTO_GC_GRACE_MS, planGc, referencedPhotoIds, resetPhotoGc, sweepPhotoBlobs } =
  await import('./photoGc');
const { useWorkspaceStore } = await import('./workspaceStore');

const T = (seconds: number): Millis => 1_760_000_000_000 + seconds * 1_000;

/** A workspace whose cards carry exactly these photo ids. */
function wsWith(photosByCard: Record<Id, Id[]>): Workspace {
  const ws = emptyWorkspace();
  for (const [cardId, ids] of Object.entries(photosByCard)) {
    ws.cards[cardId] = {
      id: cardId,
      tripId: 't1',
      columnId: 'c1',
      title: cardId,
      photos: ids.map((id, index) => ({ id, w: 100, h: 80, bytes: 1_000, createdAt: T(index) })),
      createdAt: T(0),
      updatedAt: T(0),
    } as Card;
  }
  return ws;
}

beforeEach(() => {
  blobs.clear();
  resetPhotoGc();
  useWorkspaceStore.setState({ workspace: emptyWorkspace(), dirty: false });
});

describe('referencedPhotoIds', () => {
  it('collects every id on every card', () => {
    const ids = referencedPhotoIds(wsWith({ k1: ['p1', 'p2'], k2: ['p3'] }));
    expect([...ids].sort()).toEqual(['p1', 'p2', 'p3']);
  });

  it('is empty for a workspace with no photos', () => {
    expect(referencedPhotoIds(emptyWorkspace()).size).toBe(0);
  });
});

describe('planGc', () => {
  const none = new Map<Id, Millis>();

  it('never deletes a referenced blob, however long it has been listed', () => {
    const plan = planGc(
      ['p1'],
      new Set(['p1']),
      new Map([['p1', T(0)]]),
      T(10_000),
      PHOTO_GC_GRACE_MS,
    );
    expect(plan.toDelete).toEqual([]);
    // And it stops being a candidate — the reference forgave it.
    expect(plan.nextCandidates.has('p1')).toBe(false);
  });

  it('only writes a newly unreferenced blob down on the first pass', () => {
    const plan = planGc(['p1'], new Set(), none, T(0));
    expect(plan.toDelete).toEqual([]);
    expect(plan.nextCandidates.get('p1')).toBe(T(0));
  });

  it('respects the grace period to the millisecond', () => {
    const candidates = new Map([['p1', T(0)]]);
    const early = planGc(['p1'], new Set(), candidates, T(0) + PHOTO_GC_GRACE_MS - 1);
    expect(early.toDelete).toEqual([]);
    // The original stamp is kept — the clock does not restart on every sweep.
    expect(early.nextCandidates.get('p1')).toBe(T(0));

    const due = planGc(['p1'], new Set(), candidates, T(0) + PHOTO_GC_GRACE_MS);
    expect(due.toDelete).toEqual(['p1']);
    expect(due.nextCandidates.size).toBe(0);
  });

  it('spares a candidate that got referenced again (실행 취소)', () => {
    const candidates = new Map([['p1', T(0)]]);
    const plan = planGc(['p1'], new Set(['p1']), candidates, T(600));
    expect(plan.toDelete).toEqual([]);
    expect(plan.nextCandidates.size).toBe(0);
  });

  it('sorts the mixed case out in one pass', () => {
    const plan = planGc(
      ['kept', 'due', 'fresh'],
      new Set(['kept']),
      new Map([['due', T(0)]]),
      T(60),
    );
    expect(plan.toDelete).toEqual(['due']);
    expect([...plan.nextCandidates.keys()]).toEqual(['fresh']);
  });

  it('is idempotent — the same inputs decide the same thing', () => {
    const args = [['a', 'b'], new Set(['a']), new Map([['b', T(0)]]), T(60)] as const;
    const once = planGc(...args);
    const twice = planGc(...args);
    expect(twice.toDelete).toEqual(once.toDelete);
    expect([...twice.nextCandidates]).toEqual([...once.nextCandidates]);
  });

  it('does nothing at all when the store is empty', () => {
    const plan = planGc([], new Set(['p1']), none, T(0));
    expect(plan.toDelete).toEqual([]);
    expect(plan.nextCandidates.size).toBe(0);
  });
});

describe('sweepPhotoBlobs', () => {
  it('takes two passes to collect an orphan, and keeps the rest', async () => {
    blobs.add('kept');
    blobs.add('orphan');
    useWorkspaceStore.setState({ workspace: wsWith({ k1: ['kept'] }) });

    // First pass: the orphan is only written down.
    expect(await sweepPhotoBlobs(T(0))).toEqual([]);
    expect([...blobs].sort()).toEqual(['kept', 'orphan']);

    // Second pass, after the grace: gone.
    expect(await sweepPhotoBlobs(T(0) + PHOTO_GC_GRACE_MS)).toEqual(['orphan']);
    expect([...blobs]).toEqual(['kept']);
  });

  it('re-reads the references at delete time, so an undo saves the photos', async () => {
    blobs.add('p1');
    useWorkspaceStore.setState({ workspace: emptyWorkspace() });
    await sweepPhotoBlobs(T(0));

    // 실행 취소 put the card — and its photo — back before the sweep returned.
    useWorkspaceStore.setState({ workspace: wsWith({ k1: ['p1'] }) });
    expect(await sweepPhotoBlobs(T(0) + PHOTO_GC_GRACE_MS)).toEqual([]);
    expect([...blobs]).toEqual(['p1']);
  });

  it('leaves a workspace whose photos are all present completely alone', async () => {
    blobs.add('p1');
    blobs.add('p2');
    useWorkspaceStore.setState({ workspace: wsWith({ k1: ['p1'], k2: ['p2'] }) });

    expect(await sweepPhotoBlobs(T(0))).toEqual([]);
    expect(await sweepPhotoBlobs(T(10_000))).toEqual([]);
    expect([...blobs].sort()).toEqual(['p1', 'p2']);
  });
});
