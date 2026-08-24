import { describe, expect, it } from 'vitest';
import { emptyWorkspace, type GeoPoint, type Workspace } from '../types/models';
import {
  MAX_CONTEXT_CARDS,
  MAX_PROMPT_CHARS,
  MAX_REVIEW_DAYS,
  MAX_USER_TEXT,
  SUGGEST_SCHEMA,
  buildAskPrompt,
  buildReviewPrompt,
  buildSuggestPrompt,
  parseSuggestions,
  truncate,
} from './prompts';

const AT = 1_760_000_000_000;

const NAMBA: GeoPoint = { lat: 34.6659, lng: 135.5011 };
const UMEDA: GeoPoint = { lat: 34.7025, lng: 135.4959 };

/**
 * One trip, two columns, one sheet with one day — the smallest workspace every
 * builder in this file can be pointed at.
 */
function scaffold(): Workspace {
  const ws = emptyWorkspace();
  ws.trips.t1 = {
    id: 't1',
    title: '오사카',
    currency: 'KRW',
    columnOrder: ['c-see', 'c-eat'],
    sheetOrder: ['s1'],
    createdAt: AT,
    updatedAt: AT,
  };
  ws.columns['c-see'] = {
    id: 'c-see',
    tripId: 't1',
    name: '볼거리',
    color: 'emerald',
    icon: '🎡',
    cardOrder: [],
    createdAt: AT,
    updatedAt: AT,
  };
  ws.columns['c-eat'] = {
    id: 'c-eat',
    tripId: 't1',
    name: '식사',
    color: 'amber',
    icon: '🍽️',
    cardOrder: [],
    createdAt: AT,
    updatedAt: AT,
  };
  ws.sheets.s1 = {
    id: 's1',
    tripId: 't1',
    name: '플랜 A',
    dayOrder: ['d1'],
    createdAt: AT,
    updatedAt: AT,
  };
  ws.days.d1 = { id: 'd1', tripId: 't1', sheetId: 's1', date: '2026-04-02', createdAt: AT, updatedAt: AT };
  return ws;
}

/** Adds a card to a column and returns its id. */
function addCard(
  ws: Workspace,
  columnId: string,
  id: string,
  title: string,
  extra: Partial<Workspace['cards'][string]> = {},
): string {
  ws.cards[id] = {
    id,
    tripId: 't1',
    columnId,
    title,
    createdAt: AT,
    updatedAt: AT,
    ...extra,
  };
  ws.columns[columnId].cardOrder = [...ws.columns[columnId].cardOrder, id];
  return id;
}

/** Places a card on `d1`. */
function place(ws: Workspace, id: string, cardId: string, startMin: number, durationMin: number) {
  ws.entries[id] = {
    id,
    tripId: 't1',
    cardId,
    dayId: 'd1',
    startMin,
    durationMin,
    createdAt: AT,
    updatedAt: AT,
  };
}

describe('truncate', () => {
  it('leaves anything short enough alone', () => {
    expect(truncate('짧다', 10)).toBe('짧다');
  });

  it('marks the cut with a single ellipsis and never exceeds the cap', () => {
    const cut = truncate('가나다라마바사', 4);
    expect(cut.length).toBeLessThanOrEqual(4);
    expect(cut.endsWith('…')).toBe(true);
  });

  it('trims before measuring, so whitespace never costs a character', () => {
    expect(truncate('   여백   ', 10)).toBe('여백');
  });

  it('answers empty for a non-positive cap rather than a lone ellipsis', () => {
    expect(truncate('아무거나', 0)).toBe('');
  });
});

describe('buildSuggestPrompt', () => {
  it('names the trip, the columns with their icons, and the wish', () => {
    const ws = scaffold();
    addCard(ws, 'c-see', 'k1', '유니버설');

    const prompt = buildSuggestPrompt(ws, 't1', '라멘과 건담을 좋아해요');

    expect(prompt).toContain('오사카');
    expect(prompt).toContain('🎡 볼거리');
    expect(prompt).toContain('🍽️ 식사');
    expect(prompt).toContain('유니버설');
    expect(prompt).toContain('라멘과 건담을 좋아해요');
    expect(prompt).toContain('5~8개');
  });

  it('says the board is empty rather than printing an empty list', () => {
    const prompt = buildSuggestPrompt(scaffold(), 't1', '');
    expect(prompt).toContain('보드가 아직 비어 있어요');
    expect(prompt).toContain('특별히 말한 취향은 없어요');
  });

  it(`shows at most ${MAX_CONTEXT_CARDS} existing titles`, () => {
    const ws = scaffold();
    for (let i = 0; i < MAX_CONTEXT_CARDS + 20; i += 1) {
      addCard(ws, 'c-see', `k${i}`, `장소${i}`);
    }

    const prompt = buildSuggestPrompt(ws, 't1', '');
    expect(prompt).toContain(`${MAX_CONTEXT_CARDS}개, 중복 금지`);
    expect(prompt).not.toContain('장소35');
  });

  it('lists a repeated title once', () => {
    const ws = scaffold();
    addCard(ws, 'c-see', 'k1', '도톤보리');
    addCard(ws, 'c-eat', 'k2', '도톤보리');

    const prompt = buildSuggestPrompt(ws, 't1', '');
    expect(prompt).toContain('(1개, 중복 금지)');
  });

  it('caps a runaway wish and then the whole prompt', () => {
    const ws = scaffold();
    const prompt = buildSuggestPrompt(ws, 't1', '먹'.repeat(MAX_USER_TEXT * 4));

    expect(prompt.length).toBeLessThanOrEqual(MAX_PROMPT_CHARS);
  });

  it('survives an unknown trip', () => {
    const prompt = buildSuggestPrompt(emptyWorkspace(), undefined, '아무거나');
    expect(prompt).toContain('(칸 없음)');
    expect(prompt).toContain('아무거나');
  });
});

describe('SUGGEST_SCHEMA', () => {
  it('requires a title and a columnName on every row', () => {
    expect(SUGGEST_SCHEMA.required).toEqual(['suggestions']);
    expect(SUGGEST_SCHEMA.properties.suggestions.items.required).toEqual(['title', 'columnName']);
  });
});

describe('parseSuggestions', () => {
  it('reads the rows the schema promised', () => {
    const rows = parseSuggestions({
      suggestions: [
        { title: '라멘 골목', columnName: '식사', memo: '한 줄', durationMin: 60, budget: 12000 },
      ],
    });

    expect(rows).toEqual([
      { title: '라멘 골목', columnName: '식사', memo: '한 줄', durationMin: 60, budget: 12000 },
    ]);
  });

  it('drops rows with no usable title', () => {
    const rows = parseSuggestions({ suggestions: [{ columnName: '식사' }, { title: '  ' }, null, 7] });
    expect(rows).toEqual([]);
  });

  it('keeps a row whose optional fields are the wrong type, minus those fields', () => {
    const rows = parseSuggestions({
      suggestions: [{ title: '건담베이스', columnName: 7, durationMin: '90', budget: -5 }],
    });

    expect(rows).toEqual([
      { title: '건담베이스', columnName: '', memo: undefined, durationMin: undefined, budget: undefined },
    ]);
  });

  it('answers empty for anything that is not `{suggestions: []}`', () => {
    expect(parseSuggestions(null)).toEqual([]);
    expect(parseSuggestions('문자열')).toEqual([]);
    expect(parseSuggestions({ suggestions: '아니요' })).toEqual([]);
  });
});

describe('buildReviewPrompt', () => {
  it('serializes each entry as a time range with its title', () => {
    const ws = scaffold();
    place(ws, 'e1', addCard(ws, 'c-see', 'k1', '유니버설'), 540, 180);
    place(ws, 'e2', addCard(ws, 'c-eat', 'k2', '점심'), 780, 60);

    const prompt = buildReviewPrompt(ws, 's1');

    expect(prompt).toContain('플랜 A');
    expect(prompt).toContain('09:00–12:00 유니버설');
    expect(prompt).toContain('13:00–14:00 점심');
    expect(prompt).toContain('3~6개');
  });

  it('marks whether a card has a location', () => {
    const ws = scaffold();
    place(ws, 'e1', addCard(ws, 'c-see', 'k1', '난바', { location: NAMBA }), 540, 60);
    place(ws, 'e2', addCard(ws, 'c-eat', 'k2', '점심'), 720, 60);

    const prompt = buildReviewPrompt(ws, 's1');
    expect(prompt).toContain('난바 (위치 있음)');
    expect(prompt).toContain('점심 (위치 없음)');
  });

  it('adds the straight-line gap between two located stops', () => {
    const ws = scaffold();
    place(ws, 'e1', addCard(ws, 'c-see', 'k1', '난바', { location: NAMBA }), 540, 60);
    place(ws, 'e2', addCard(ws, 'c-see', 'k2', '우메다', { location: UMEDA }), 660, 60);

    const prompt = buildReviewPrompt(ws, 's1');
    expect(prompt).toMatch(/→ 다음 장소까지 직선 4\.1km, 사이 시간 1시간/);
  });

  it('calls an overlap an overlap instead of a negative duration', () => {
    const ws = scaffold();
    place(ws, 'e1', addCard(ws, 'c-see', 'k1', '난바', { location: NAMBA }), 540, 120);
    place(ws, 'e2', addCard(ws, 'c-see', 'k2', '우메다', { location: UMEDA }), 600, 60);

    expect(buildReviewPrompt(ws, 's1')).toContain('-60분(겹침)');
  });

  it('says a day is empty rather than leaving a bare heading', () => {
    expect(buildReviewPrompt(scaffold(), 's1')).toContain('(비어 있음)');
  });

  it('reports the sheet totals', () => {
    const ws = scaffold();
    place(ws, 'e1', addCard(ws, 'c-see', 'k1', '유니버설', { budget: 90000 }), 540, 180);

    const prompt = buildReviewPrompt(ws, 's1');
    expect(prompt).toContain('예산 합계 90,000원');
    expect(prompt).toContain('지출 합계 0원');
  });

  it(`stops after ${MAX_REVIEW_DAYS} days and says how many it skipped`, () => {
    const ws = scaffold();
    const dayOrder: string[] = [];
    for (let i = 0; i < MAX_REVIEW_DAYS + 3; i += 1) {
      const id = `dd${i}`;
      ws.days[id] = { id, tripId: 't1', sheetId: 's1', label: `${i}호`, createdAt: AT, updatedAt: AT };
      dayOrder.push(id);
    }
    ws.sheets.s1.dayOrder = dayOrder;

    const prompt = buildReviewPrompt(ws, 's1');
    expect(prompt).toContain('(이하 3일 생략)');
  });

  it('answers empty for an unknown sheet, so the caller can refuse to ask', () => {
    expect(buildReviewPrompt(scaffold(), undefined)).toBe('');
    expect(buildReviewPrompt(scaffold(), 'nope')).toBe('');
  });

  it('stays inside the cap for a big sheet', () => {
    const ws = scaffold();
    const dayOrder: string[] = [];
    for (let d = 0; d < MAX_REVIEW_DAYS; d += 1) {
      const dayId = `dd${d}`;
      ws.days[dayId] = { id: dayId, tripId: 't1', sheetId: 's1', createdAt: AT, updatedAt: AT };
      dayOrder.push(dayId);
      for (let e = 0; e < 8; e += 1) {
        const cardId = addCard(ws, 'c-see', `k${d}-${e}`, `아주 긴 카드 제목 ${d}-${e}`);
        ws.entries[`e${d}-${e}`] = {
          id: `e${d}-${e}`,
          tripId: 't1',
          cardId,
          dayId,
          startMin: 480 + e * 60,
          durationMin: 45,
          createdAt: AT,
          updatedAt: AT,
        };
      }
    }
    ws.sheets.s1.dayOrder = dayOrder;

    expect(buildReviewPrompt(ws, 's1').length).toBeLessThanOrEqual(MAX_PROMPT_CHARS);
  });
});

describe('buildAskPrompt', () => {
  it('is just the question when there is no trip to attach', () => {
    expect(buildAskPrompt('환전은 어디서 해요?')).toBe('질문: 환전은 어디서 해요?');
  });

  it('attaches the trip name and a few card titles', () => {
    const ws = scaffold();
    addCard(ws, 'c-see', 'k1', '유니버설');
    addCard(ws, 'c-eat', 'k2', '이치란');

    const prompt = buildAskPrompt('비 오면 어디 가요?', ws, 't1');

    expect(prompt).toContain('지금 계획 중인 여행: 오사카');
    expect(prompt).toContain('유니버설, 이치란');
    expect(prompt).toContain('질문: 비 오면 어디 가요?');
  });

  it('shows at most ten titles', () => {
    const ws = scaffold();
    for (let i = 0; i < 25; i += 1) addCard(ws, 'c-see', `k${i}`, `장소${i}`);

    const prompt = buildAskPrompt('추천?', ws, 't1');
    expect(prompt).toContain('장소9');
    expect(prompt).not.toContain('장소12');
  });

  it('caps a runaway question', () => {
    const prompt = buildAskPrompt('왜'.repeat(MAX_USER_TEXT * 3));
    expect(prompt.length).toBeLessThanOrEqual(MAX_PROMPT_CHARS);
    expect(prompt.endsWith('…')).toBe(true);
  });
});
