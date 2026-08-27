import { describe, expect, it, vi } from 'vitest';
import { AiError } from '../ai/aiClient';
import type { PlaceCandidate } from '../ai/aiPlaces';
import { emptyWorkspace, type Card, type GeoPoint, type Id, type Workspace } from '../types/models';
import { SEARCH_ERROR_MESSAGE } from '../utils/geo';
import {
  AUDIT_MAX_CANDIDATES,
  AUDIT_MAX_MOVE_KM,
  AUDIT_MIN_MOVE_M,
  AUDIT_REFINE_QUERIES,
  applyPlan,
  auditHint,
  auditTargets,
  buildRow,
  evaluateProposal,
  formatDistance,
  isFatalScanError,
  nearestCandidate,
  proposeLocation,
  restoreSnapshot,
  scanAudit,
  type AuditRow,
  type AuditTarget,
} from './locationAudit';

const AT = 1_760_000_000_000;

/** 통천각 근처 — 이 파일의 모든 거리는 이 점을 기준으로 잰다. */
const HERE: GeoPoint = { lat: 34.6525, lng: 135.5063, address: '통천각, 오사카' };

/** 위도 1도 ≈ 111.2km. 남북으로 `metres`만큼 떨어진 점. */
function northOf(origin: GeoPoint, metres: number): { lat: number; lng: number } {
  return { lat: origin.lat + metres / 111_195, lng: origin.lng };
}

/** OSM이 확인해 준 후보 하나. */
function confirmed(at: { lat: number; lng: number }, name = '통천각'): PlaceCandidate {
  return { name, lat: at.lat, lng: at.lng, refined: true };
}

/* ------------------------------------------------------------------ *
 * 입력 만들기
 * ------------------------------------------------------------------ */

function card(id: Id, columnId: Id, location?: GeoPoint, title = id): Card {
  return { id, tripId: 't1', columnId, title, location, createdAt: AT, updatedAt: AT };
}

function scaffold(): Workspace {
  const ws = emptyWorkspace();
  ws.trips.t1 = {
    id: 't1',
    title: '오사카',
    currency: 'KRW',
    destination: { lat: 34.69, lng: 135.5, address: '오사카시, 일본' },
    columnOrder: ['c1', 'c2'],
    sheetOrder: [],
    createdAt: AT,
    updatedAt: AT,
  };
  for (const id of ['c1', 'c2'] as const) {
    ws.columns[id] = {
      id,
      tripId: 't1',
      name: id,
      color: 'emerald',
      icon: '🎡',
      cardOrder: [],
      createdAt: AT,
      updatedAt: AT,
    };
  }
  return ws;
}

function put(ws: Workspace, entity: Card): void {
  ws.cards[entity.id] = entity;
  ws.columns[entity.columnId].cardOrder.push(entity.id);
}

describe('auditHint', () => {
  it('prefers the address already stored on the card', () => {
    expect(auditHint(card('k1', 'c1', HERE), { lat: 0, lng: 0, address: '오사카시, 일본' })).toBe(
      '통천각, 오사카',
    );
  });

  it('falls back to the trip destination when the address is a bare pin coordinate', () => {
    const pinned = card('k1', 'c1', { lat: 34.6525, lng: 135.5063, address: '34.6525, 135.5063' });
    expect(auditHint(pinned, { lat: 0, lng: 0, address: '오사카시, 일본' })).toBe('오사카시, 일본');
  });

  it('carries nothing rather than something wrong', () => {
    expect(auditHint(card('k1', 'c1', { lat: 1, lng: 2 }))).toBeUndefined();
    expect(auditHint(card('k1', 'c1', { lat: 1, lng: 2, address: '   ' }))).toBeUndefined();
  });
});

describe('auditTargets', () => {
  it('takes the located cards of the trip in board order, with a hint each', () => {
    const ws = scaffold();
    put(ws, card('k1', 'c1', HERE));
    put(ws, card('k2', 'c2', { lat: 35, lng: 135 }));

    const targets = auditTargets(ws, 't1');
    expect(targets.map((target) => target.cardId)).toEqual(['k1', 'k2']);
    expect(targets[0].from).toEqual(HERE);
    expect(targets[0].hint).toBe('통천각, 오사카');
    // 주소가 없는 카드는 여행의 목적지를 문맥으로 받는다.
    expect(targets[1].hint).toBe('오사카시, 일본');
  });

  it('skips cards with no location and cards with no title', () => {
    const ws = scaffold();
    put(ws, card('k1', 'c1'));
    put(ws, card('k2', 'c1', HERE, '   '));
    put(ws, card('k3', 'c1', HERE));

    expect(auditTargets(ws, 't1').map((target) => target.cardId)).toEqual(['k3']);
  });

  it('is empty without a trip', () => {
    expect(auditTargets(scaffold(), undefined)).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * 판정
 * ------------------------------------------------------------------ */

describe('nearestCandidate', () => {
  it('picks the candidate closest to the pin that is already there', () => {
    const near = confirmed(northOf(HERE, 120), '가까운 쪽');
    const far = confirmed(northOf(HERE, 900), '먼 쪽');
    expect(nearestCandidate(HERE, [far, near])?.name).toBe('가까운 쪽');
  });

  it('has no radius of its own — 「너무 멀다」는 판정은 한 곳에서만 한다', () => {
    const tokyo = confirmed({ lat: 35.6595, lng: 139.7005 }, '도쿄');
    expect(nearestCandidate(HERE, [tokyo])?.name).toBe('도쿄');
  });

  it('is null for an empty list', () => {
    expect(nearestCandidate(HERE, [])).toBeNull();
  });
});

describe('evaluateProposal', () => {
  it('calls a missing proposal missing, with no distance', () => {
    expect(evaluateProposal(HERE, null)).toEqual({ status: 'missing' });
  });

  it(`leaves a pin alone when the proposal is under ${AUDIT_MIN_MOVE_M}m away`, () => {
    const result = evaluateProposal(HERE, confirmed(northOf(HERE, 12)));
    expect(result.status).toBe('near');
    expect(result.distanceKm).toBeLessThan(0.03);
  });

  it('moves a pin that is a block or two off', () => {
    const result = evaluateProposal(HERE, confirmed(northOf(HERE, 210)));
    expect(result.status).toBe('movable');
    expect(result.distanceKm).toBeCloseTo(0.21, 2);
  });

  it(`refuses a proposal further than ${AUDIT_MAX_MOVE_KM}km — 같은 이름의 다른 도시`, () => {
    const result = evaluateProposal(HERE, confirmed({ lat: 35.6595, lng: 139.7005 }));
    expect(result.status).toBe('far');
    expect(result.distanceKm).toBeGreaterThan(390);
  });

  it('draws both lines exactly where the constants say', () => {
    // 30m 바로 아래는 near, 바로 위는 movable.
    expect(evaluateProposal(HERE, confirmed(northOf(HERE, 29))).status).toBe('near');
    expect(evaluateProposal(HERE, confirmed(northOf(HERE, 31))).status).toBe('movable');
    // 3km 바로 아래는 movable, 바로 위는 far.
    expect(evaluateProposal(HERE, confirmed(northOf(HERE, 2_950))).status).toBe('movable');
    expect(evaluateProposal(HERE, confirmed(northOf(HERE, 3_050))).status).toBe('far');
  });
});

describe('buildRow', () => {
  const target: AuditTarget = {
    cardId: 'k1',
    columnId: 'c1',
    title: '통천각',
    from: HERE,
    hint: '오사카',
  };

  it('keeps every field of the target and adds the verdict', () => {
    const to = confirmed(northOf(HERE, 210));
    const row = buildRow(target, to);
    expect(row.cardId).toBe('k1');
    expect(row.columnId).toBe('c1');
    expect(row.hint).toBe('오사카');
    expect(row.status).toBe('movable');
    expect(row.to).toBe(to);
  });

  it('carries no coordinates at all when there was no proposal', () => {
    const row = buildRow(target, null);
    expect(row.status).toBe('missing');
    expect(row.to).toBeUndefined();
    expect(row.distanceKm).toBeUndefined();
  });
});

describe('formatDistance', () => {
  it('says metres up to a kilometre and kilometres past it', () => {
    expect(formatDistance(0)).toBe('0m');
    expect(formatDistance(0.21)).toBe('210m');
    expect(formatDistance(0.9994)).toBe('999m');
    // 999.5m은 반올림하면 1000m — 「1000m」이라 쓰지 않는다.
    expect(formatDistance(0.9995)).toBe('1.0km');
    expect(formatDistance(1.44)).toBe('1.4km');
    expect(formatDistance(402.3)).toBe('402.3km');
  });

  it('never says a negative distance', () => {
    expect(formatDistance(-1)).toBe('0m');
  });
});

/* ------------------------------------------------------------------ *
 * 적용 계획 · 되돌리기
 * ------------------------------------------------------------------ */

function row(cardId: Id, status: AuditRow['status'], to?: PlaceCandidate, from = HERE): AuditRow {
  return {
    cardId,
    columnId: 'c1',
    title: cardId,
    from,
    status,
    ...(to ? { to, distanceKm: 0.2 } : {}),
  };
}

describe('applyPlan', () => {
  const moved = confirmed(northOf(HERE, 210));

  it('takes only the checked rows that are movable', () => {
    const rows = [
      row('k1', 'movable', moved),
      row('k2', 'movable', moved),
      row('k3', 'near', confirmed(northOf(HERE, 5))),
      row('k4', 'far', confirmed({ lat: 35.66, lng: 139.7 })),
      row('k5', 'missing'),
    ];
    const plan = applyPlan(rows, new Set(['k1', 'k3', 'k4', 'k5']));
    expect(plan.map((item) => item.cardId)).toEqual(['k1']);
  });

  it('writes the coordinates and keeps the address the user already had', () => {
    const [item] = applyPlan([row('k1', 'movable', moved)], new Set(['k1']));
    expect(item.location.lat).toBe(moved.lat);
    expect(item.location.lng).toBe(moved.lng);
    expect(item.location.address).toBe('통천각, 오사카');
  });

  it('leaves the address off when the card never had one', () => {
    const bare = row('k1', 'movable', moved, { lat: HERE.lat, lng: HERE.lng });
    const [item] = applyPlan([bare], new Set(['k1']));
    expect('address' in item.location).toBe(false);
  });

  it('is empty when nothing is checked', () => {
    expect(applyPlan([row('k1', 'movable', moved)], new Set())).toEqual([]);
  });
});

describe('restoreSnapshot', () => {
  it('mirrors the plan — same cards, same order, the coordinates from before', () => {
    const there: GeoPoint = { lat: 34.7, lng: 135.6, address: '다른 곳' };
    const rows = [
      row('k1', 'movable', confirmed(northOf(HERE, 210))),
      row('k2', 'movable', confirmed(northOf(there, 210)), there),
    ];
    const plan = applyPlan(rows, new Set(['k1', 'k2']));
    const restore = restoreSnapshot(rows, plan);

    expect(restore.map((item) => item.cardId)).toEqual(plan.map((item) => item.cardId));
    expect(restore[0].location).toEqual(HERE);
    expect(restore[1].location).toEqual(there);
  });

  it('ignores a plan entry whose row is gone', () => {
    expect(restoreSnapshot([], [{ cardId: 'k1', location: HERE }])).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * 제안 만들기
 * ------------------------------------------------------------------ */

const TARGET: AuditTarget = {
  cardId: 'k1',
  columnId: 'c1',
  title: '히요리 호텔',
  from: HERE,
  hint: '나니와구, 오사카시, 일본',
};

/** AI가 낸 후보 하나 — 현지 표기가 있어야 refine이 그것으로 되묻는다. */
const AI_HIT: PlaceCandidate = {
  name: '히요리 호텔',
  localName: '日和ホテル',
  locality: '오사카',
  ...northOf(HERE, 260),
};

describe('proposeLocation', () => {
  it('asks the AI with the hint the card carries, then confirms with OpenStreetMap', async () => {
    const aiSearch = vi.fn(async () => [AI_HIT]);
    const osmSearch = vi.fn(async () => [{ ...northOf(HERE, 210), address: '日和ホテル' }]);

    const proposal = await proposeLocation(TARGET, { aiSearch, osmSearch });

    expect(aiSearch).toHaveBeenCalledWith('히요리 호텔', '나니와구, 오사카시, 일본');
    expect(osmSearch).toHaveBeenCalledWith('日和ホテル', undefined);
    expect(proposal?.refined).toBe(true);
    expect(proposal?.lat).toBeCloseTo(northOf(HERE, 210).lat, 6);
  });

  it('refuses a candidate OpenStreetMap could not confirm', async () => {
    // OSM이 4km 밖을 주면 refine은 스냅하지 않는다 → `refined`가 없다 → 제안 아님.
    const osmSearch = vi.fn(async () => [{ ...northOf(HERE, 4_000), address: '다른 곳' }]);
    const proposal = await proposeLocation(TARGET, {
      aiSearch: async () => [AI_HIT],
      osmSearch,
    });
    expect(proposal).toBeNull();
  });

  it('is null when the AI finds nothing at all', async () => {
    const osmSearch = vi.fn(async () => []);
    expect(await proposeLocation(TARGET, { aiSearch: async () => [], osmSearch })).toBeNull();
    expect(osmSearch).not.toHaveBeenCalled();
  });

  it('is null for a card with no title to ask about', async () => {
    const aiSearch = vi.fn(async () => [AI_HIT]);
    expect(
      await proposeLocation({ ...TARGET, title: '  ' }, { aiSearch, osmSearch: async () => [] }),
    ).toBeNull();
    expect(aiSearch).not.toHaveBeenCalled();
  });

  it(`looks at no more than ${AUDIT_MAX_CANDIDATES} candidates and ${AUDIT_REFINE_QUERIES} OSM queries`, async () => {
    const many: PlaceCandidate[] = Array.from({ length: 5 }, (_, index) => ({
      name: `후보 ${index}`,
      localName: `현지 ${index}`,
      ...northOf(HERE, 1_000 * (index + 1)),
    }));
    const osmSearch = vi.fn(async (_query: string): Promise<GeoPoint[]> => []);

    await proposeLocation(TARGET, { aiSearch: async () => many, osmSearch });
    expect(osmSearch.mock.calls.length).toBeLessThanOrEqual(AUDIT_REFINE_QUERIES);
    // 뒤의 두 후보(3·4번)는 예산이 떨어져 아예 물어보지도 못한다.
    for (const [query] of osmSearch.mock.calls) {
      expect(query).toMatch(/^(현지|후보) [012]$/);
    }
  });

  it('picks the confirmed candidate nearest the pin that is already there', async () => {
    const candidates: PlaceCandidate[] = [
      { name: '먼 지점', localName: '遠', ...northOf(HERE, 900) },
      { name: '가까운 지점', localName: '近', ...northOf(HERE, 200) },
    ];
    const osmSearch = vi.fn(async (query: string) =>
      query === '近'
        ? [{ ...northOf(HERE, 195), address: '近' }]
        : [{ ...northOf(HERE, 905), address: '遠' }],
    );

    const proposal = await proposeLocation(TARGET, {
      aiSearch: async () => candidates,
      osmSearch,
    });
    expect(proposal?.name).toBe('가까운 지점');
  });

  it('lets an AI failure through — the scan decides what to do with it', async () => {
    await expect(
      proposeLocation(TARGET, {
        aiSearch: async () => {
          throw new AiError('rate');
        },
        osmSearch: async () => [],
      }),
    ).rejects.toBeInstanceOf(AiError);
  });

  it('survives Nominatim falling over — refine gives up quietly, so there is no proposal', async () => {
    const proposal = await proposeLocation(TARGET, {
      aiSearch: async () => [AI_HIT],
      osmSearch: async () => {
        throw new Error(SEARCH_ERROR_MESSAGE);
      },
    });
    expect(proposal).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * 훑기
 * ------------------------------------------------------------------ */

const TARGETS: AuditTarget[] = [
  { cardId: 'k1', columnId: 'c1', title: '하나', from: HERE },
  { cardId: 'k2', columnId: 'c1', title: '둘', from: HERE },
  { cardId: 'k3', columnId: 'c2', title: '셋', from: HERE },
];

async function collect(
  generator: AsyncGenerator<AuditRow, void, void>,
): Promise<AuditRow[]> {
  const rows: AuditRow[] = [];
  for await (const one of generator) rows.push(one);
  return rows;
}

describe('isFatalScanError', () => {
  it('stops the sweep for the failures every remaining card would hit too', () => {
    expect(isFatalScanError(new AiError('rate'))).toBe(true);
    expect(isFatalScanError(new AiError('auth'))).toBe(true);
    expect(isFatalScanError(new AiError('unavailable'))).toBe(true);
  });

  it('keeps going for a failure that may belong to this one card', () => {
    expect(isFatalScanError(new AiError('network'))).toBe(false);
    expect(isFatalScanError(new AiError('server'))).toBe(false);
    expect(isFatalScanError(new Error('아무 오류'))).toBe(false);
  });
});

describe('scanAudit', () => {
  it('visits the cards one at a time, in order, and yields a row each', async () => {
    const seen: Id[] = [];
    const propose = vi.fn(async (target: AuditTarget) => {
      seen.push(target.cardId);
      return confirmed(northOf(HERE, 210));
    });

    const rows = await collect(scanAudit(TARGETS, { propose }));
    expect(seen).toEqual(['k1', 'k2', 'k3']);
    expect(rows.map((one) => one.cardId)).toEqual(['k1', 'k2', 'k3']);
    expect(rows.every((one) => one.status === 'movable')).toBe(true);
  });

  it('sorts each card into its own verdict', async () => {
    const answers: Record<string, PlaceCandidate | null> = {
      k1: confirmed(northOf(HERE, 210)),
      k2: confirmed(northOf(HERE, 8)),
      k3: null,
    };
    const rows = await collect(
      scanAudit(TARGETS, { propose: async (target) => answers[target.cardId] }),
    );
    expect(rows.map((one) => one.status)).toEqual(['movable', 'near', 'missing']);
  });

  it('turns a single failure into a 확인 실패 row and keeps going', async () => {
    const rows = await collect(
      scanAudit(TARGETS, {
        propose: async (target) => {
          if (target.cardId === 'k2') throw new AiError('network');
          return confirmed(northOf(HERE, 210));
        },
      }),
    );
    expect(rows.map((one) => one.status)).toEqual(['movable', 'failed', 'movable']);
    expect(rows[1].to).toBeUndefined();
  });

  it('stops after a 429 rather than filling the list with the same failure', async () => {
    const propose = vi.fn(async (target: AuditTarget) => {
      if (target.cardId === 'k2') throw new AiError('rate');
      return confirmed(northOf(HERE, 210));
    });

    const rows = await collect(scanAudit(TARGETS, { propose }));
    expect(rows.map((one) => one.status)).toEqual(['movable', 'failed']);
    // 세 번째 카드는 아예 물어보지 않았다.
    expect(propose).toHaveBeenCalledTimes(2);
  });

  it('keeps the rows gathered so far when the sweep is cancelled', async () => {
    const controller = new AbortController();
    const propose = vi.fn(async (target: AuditTarget) => {
      if (target.cardId === 'k2') controller.abort();
      return confirmed(northOf(HERE, 210));
    });

    const rows = await collect(scanAudit(TARGETS, { propose, signal: controller.signal }));
    // k1은 온전히 나왔고, 취소된 k2부터는 나오지 않는다.
    expect(rows.map((one) => one.cardId)).toEqual(['k1']);
    expect(propose).toHaveBeenCalledTimes(2);
  });

  it('never even starts when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const propose = vi.fn(async () => null);

    expect(await collect(scanAudit(TARGETS, { propose, signal: controller.signal }))).toEqual([]);
    expect(propose).not.toHaveBeenCalled();
  });

  it('treats an AbortError from the request itself as a cancellation, not a failure', async () => {
    const rows = await collect(
      scanAudit(TARGETS, {
        propose: async (target) => {
          if (target.cardId === 'k2') throw new DOMException('aborted', 'AbortError');
          return confirmed(northOf(HERE, 210));
        },
      }),
    );
    expect(rows.map((one) => one.cardId)).toEqual(['k1']);
  });

  it('does nothing for a trip with no located cards', async () => {
    const propose = vi.fn(async () => null);
    expect(await collect(scanAudit([], { propose }))).toEqual([]);
    expect(propose).not.toHaveBeenCalled();
  });
});
