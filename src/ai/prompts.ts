/**
 * What we actually say to Gemini (M11) — pure, store-free, and tested.
 *
 * Every prompt in the app is built here rather than inside a component, for the
 * same reason `timeline/gap.ts` is not inside `EntryBlock`: a prompt is the
 * hard part of an AI feature, it is where the model's answer is won or lost,
 * and it must be inspectable without a browser.
 *
 * Three rules run through all of them:
 *
 * 1. **Korean out.** The whole UI is Korean; an English answer is a bug.
 * 2. **Bounded.** A workspace has no size limit and a trip can carry hundreds
 *    of cards. Every builder caps what it serializes and then caps the result
 *    again at {@link MAX_PROMPT_CHARS}, so one enormous trip can never turn
 *    into one enormous bill.
 * 3. **Facts only.** The prompts state what the plan *is* — times, distances,
 *    money — and never editorialize. The model is asked for judgement; giving
 *    it ours first only teaches it to agree.
 */

import type { GeoPoint, Id, Workspace } from '../types/models';
import { dayTitle } from '../timeline/dayLabel';
import { windowedDayEntries } from '../timeline/dayWindow';
import { dayGapsWindowed } from '../timeline/gap';
import { formatDistanceKm } from '../timeline/route';
import { sheetSpend } from '../utils/spend';
import { formatBudget } from '../utils/money';
import { formatDuration, formatTimeRange } from '../utils/time';

/** Ceiling for a finished prompt. Roughly a thousand tokens of Korean. */
export const MAX_PROMPT_CHARS = 4000;

/** How many existing card titles are worth showing as "we already have these". */
export const MAX_CONTEXT_CARDS = 30;

/** How many days of a sheet the review reads before it stops. */
export const MAX_REVIEW_DAYS = 14;

/** Longest single free-text field (a wish, a question) we forward. */
export const MAX_USER_TEXT = 500;

/**
 * Cuts `text` to `max` characters, marking the cut with `…`.
 *
 * Truncating in the middle of a Korean sentence is ugly but honest; padding
 * the model with half a plan and letting it assume the rest is worse.
 */
export function truncate(text: string, max: number = MAX_PROMPT_CHARS): string {
  const value = text.trim();
  if (max <= 0) return '';
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/** Joins non-empty lines and applies the global cap. */
const assemble = (lines: string[]): string =>
  truncate(lines.filter((line) => line !== '').join('\n'));

/**
 * `여행지: 오사카시, 오사카부, 일본` — or `''` when the trip has no 목적지 (M12).
 *
 * The **full** address, not {@link shortPlace}'s head: the chip on screen has
 * 4mm to work with and the model has none of that problem, and "오사카시" alone
 * would drop the one word that says which country it is in.
 */
function destinationLine(trip: { destination?: GeoPoint } | undefined): string {
  const address = trip?.destination?.address?.trim();
  return address ? `여행지: ${address}` : '';
}

/* ------------------------------------------------------------------ *
 * 추천 — 보드에 넣을 아이디어
 * ------------------------------------------------------------------ */

/** One row of the structured answer the suggest call asks for. */
export interface AiSuggestion {
  title: string;
  /** The column the model thinks it belongs in — matched by name, loosely. */
  columnName: string;
  memo?: string;
  durationMin?: number;
  budget?: number;
}

/**
 * The Gemini `responseSchema` that pins {@link AiSuggestion} down.
 *
 * `propertyOrdering` is not decoration: the API uses it to order the JSON it
 * generates, and a stable order makes a streamed answer readable and a diff of
 * two answers comparable.
 */
export const SUGGEST_SCHEMA = {
  type: 'object',
  properties: {
    suggestions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          columnName: { type: 'string' },
          memo: { type: 'string' },
          durationMin: { type: 'integer' },
          budget: { type: 'integer' },
        },
        required: ['title', 'columnName'],
        propertyOrdering: ['title', 'columnName', 'memo', 'durationMin', 'budget'],
      },
    },
  },
  required: ['suggestions'],
} as const;

/** Standing rules for a 추천 answer. */
export const SUGGEST_SYSTEM =
  '당신은 한국인 여행자를 돕는 여행 플래너예요. 모든 값은 한국어로 쓰고, ' +
  '실제로 존재하는 장소·활동만 제안해요. columnName은 반드시 주어진 칸 이름 중 ' +
  '하나를 그대로 써요. durationMin은 분 단위 정수, budget은 1인 기준 예상 비용의 ' +
  '정수예요. 확실하지 않은 값은 아예 넣지 않아요.';

/**
 * "이런 걸 좋아해요" → 보드에 붙일 카드 후보.
 *
 * The existing card titles go in as a **dedup list**, not as inspiration: the
 * one thing that makes a suggestion useless is getting back the five things
 * already on the board.
 */
export function buildSuggestPrompt(
  workspace: Workspace,
  tripId: Id | undefined,
  userWish: string,
): string {
  const trip = tripId ? workspace.trips[tripId] : undefined;
  const columns = (trip?.columnOrder ?? [])
    .map((columnId) => workspace.columns[columnId])
    .filter((column): column is NonNullable<typeof column> => Boolean(column));

  const columnLine = columns.length
    ? columns.map((column) => `${column.icon} ${column.name}`).join(' / ')
    : '(칸 없음)';

  // Dedup by title, oldest first, capped — a board with 300 cards would
  // otherwise be the entire prompt.
  const seen = new Set<string>();
  const titles: string[] = [];
  for (const column of columns) {
    for (const cardId of column.cardOrder) {
      const card = workspace.cards[cardId];
      const title = card?.title.trim();
      if (!title || seen.has(title)) continue;
      seen.add(title);
      titles.push(title);
      if (titles.length >= MAX_CONTEXT_CARDS) break;
    }
    if (titles.length >= MAX_CONTEXT_CARDS) break;
  }

  const wish = truncate(userWish, MAX_USER_TEXT);

  return assemble([
    `여행 이름: ${trip?.title.trim() || '(이름 없음)'}`,
    // 「3월 오사카」 alone leaves the model guessing which 오사카; the 목적지
    // (M12) is the one fact that pins a suggestion to a real place.
    destinationLine(trip),
    `보드의 칸: ${columnLine}`,
    titles.length
      ? `이미 보드에 있는 카드(${titles.length}개, 중복 금지): ${titles.join(', ')}`
      : '보드가 아직 비어 있어요.',
    '',
    wish ? `여행자가 원하는 것: ${wish}` : '여행자가 특별히 말한 취향은 없어요.',
    '',
    '위 취향에 맞는 새 아이디어를 5~8개 제안해 주세요.',
    '- 이미 있는 카드와 겹치는 것은 빼요.',
    '- columnName은 위 「보드의 칸」 이름 중 하나를 그대로 골라요.',
    '- memo는 왜 추천하는지 한 줄(40자 이내)로 써요.',
    '- durationMin은 머무는 시간(분), budget은 1인 예상 비용이에요. 모르면 생략해요.',
    '- 모든 글자는 한국어예요.',
  ]);
}

/**
 * Narrows a parsed `{suggestions:[…]}` body into rows we can render.
 *
 * The schema makes this *likely* to be right, not guaranteed — the model can
 * still hand back a number where a string was asked for. Anything without a
 * usable title is dropped rather than rendered as an empty card.
 */
export function parseSuggestions(json: unknown): AiSuggestion[] {
  if (typeof json !== 'object' || json === null) return [];
  const list = (json as { suggestions?: unknown }).suggestions;
  if (!Array.isArray(list)) return [];

  const rows: AiSuggestion[] = [];
  for (const raw of list) {
    if (typeof raw !== 'object' || raw === null) continue;
    const item = raw as Record<string, unknown>;
    const title = typeof item.title === 'string' ? item.title.trim() : '';
    if (!title) continue;

    const number = (value: unknown): number | undefined =>
      typeof value === 'number' && Number.isFinite(value) && value > 0
        ? Math.round(value)
        : undefined;

    rows.push({
      title,
      columnName: typeof item.columnName === 'string' ? item.columnName.trim() : '',
      memo: typeof item.memo === 'string' && item.memo.trim() ? item.memo.trim() : undefined,
      durationMin: number(item.durationMin),
      budget: number(item.budget),
    });
  }
  return rows;
}

/* ------------------------------------------------------------------ *
 * 검토 — 짜 놓은 하루를 읽고 문제를 짚기
 * ------------------------------------------------------------------ */

/** Standing rules for a 검토 answer. */
export const REVIEW_SYSTEM =
  '당신은 한국인 여행자의 일정을 검토하는 여행 플래너예요. 한국어 평문으로만 답하고, ' +
  '표나 코드 블록은 쓰지 않아요. 각 줄은 「- 」로 시작하는 한 문장이에요. ' +
  '주어진 사실만 근거로 삼고, 없는 정보를 지어내지 않아요.';

/**
 * The active sheet, serialized the way a person would read it out loud.
 *
 * The distances come from {@link dayGaps}, which is the same source the 이동
 * chips on the grid use — so the model can never be told something the screen
 * contradicts. A leg the user already covered with a 이동수단 card produces no
 * gap row, and rightly gets no comment.
 */
export function buildReviewPrompt(workspace: Workspace, sheetId: Id | undefined): string {
  const sheet = sheetId ? workspace.sheets[sheetId] : undefined;
  if (!sheet) return '';

  const trip = workspace.trips[sheet.tripId];
  const currency = trip?.currency ?? 'KRW';
  const lines: string[] = [
    `여행: ${trip?.title.trim() || '(이름 없음)'}`,
    `일정표: ${sheet.name}`,
    '',
  ];

  const dayIds = sheet.dayOrder.slice(0, MAX_REVIEW_DAYS);
  for (const [index, dayId] of dayIds.entries()) {
    const day = workspace.days[dayId];
    if (!day) continue;

    // The 05시 window, same as the grid and the map (M16-B): the AI reviews
    // the day the user sees, 새벽 일정 included at the end of it.
    const entries = windowedDayEntries(workspace, dayId, sheet.dayOrder).map((row) => row.entry);

    lines.push(`[${dayTitle(day, index)}${day.date ? ` · ${day.date}` : ''}]`);
    if (entries.length === 0) {
      lines.push('  (비어 있음)');
      continue;
    }

    // Gaps are keyed by the *earlier* entry, so one lookup per row places the
    // 이동 line directly under the stop it leaves from.
    const gaps = new Map(
      dayGapsWindowed(workspace, dayId, sheet.dayOrder).map((gap) => [gap.afterEntryId, gap]),
    );

    for (const entry of entries) {
      const card = workspace.cards[entry.cardId];
      const title = card?.title.trim() || '(제목 없음)';
      const located = card?.location ? '위치 있음' : '위치 없음';
      lines.push(`  ${formatTimeRange(entry.startMin, entry.durationMin)} ${title} (${located})`);

      const gap = gaps.get(entry.id);
      if (gap) {
        lines.push(
          `    → 다음 장소까지 직선 ${formatDistanceKm(gap.distanceKm)}, 사이 시간 ${
            gap.gapMin < 0 ? `${gap.gapMin}분(겹침)` : formatDuration(gap.gapMin)
          }`,
        );
      }
    }
  }

  if (sheet.dayOrder.length > dayIds.length) {
    lines.push(`(이하 ${sheet.dayOrder.length - dayIds.length}일 생략)`);
  }

  const totals = sheetSpend(workspace, sheet.id);
  lines.push(
    '',
    `예산 합계 ${formatBudget(totals.budget, currency)} / 지출 합계 ${formatBudget(
      totals.spent,
      currency,
    )}`,
    '',
    '이 일정을 검토해 개선점을 3~6개 짚어 주세요.',
    '- 과밀(쉴 틈 없음), 순서(왔다 갔다), 빈 시간, 이동 부담을 중심으로 봐요.',
    '- 각 줄은 「- 」로 시작하는 한 문장이고, 무엇을 어떻게 바꾸면 되는지까지 말해요.',
    '- 위에 적힌 사실만 근거로 삼아요. 없는 장소나 시간을 지어내지 않아요.',
  );

  return assemble(lines);
}

/* ------------------------------------------------------------------ *
 * 질문 — 그냥 물어보기
 * ------------------------------------------------------------------ */

/** Standing rules for a 질문 answer. */
export const ASK_SYSTEM =
  '당신은 한국인 여행자를 돕는 여행 도우미예요. 한국어 평문으로 짧고 구체적으로 답해요. ' +
  '모르면 모른다고 말하고, 확실하지 않은 사실은 확실하지 않다고 밝혀요.';

/**
 * A free question, with just enough of the trip attached to make "여기" mean
 * something.
 *
 * The context is deliberately thin — a name and a handful of card titles. This
 * is the one AI entry point the user reaches from anywhere in the app, and
 * "환전은 어디서 해요?" does not need the whole board to be answerable.
 */
export function buildAskPrompt(
  question: string,
  workspace?: Workspace,
  tripId?: Id,
): string {
  const trip = workspace && tripId ? workspace.trips[tripId] : undefined;
  const lines: string[] = [];

  if (trip && workspace) {
    lines.push(`지금 계획 중인 여행: ${trip.title.trim() || '(이름 없음)'}`);
    // 「여기」 has to mean somewhere — the 목적지 (M12) is what makes it.
    const where = destinationLine(trip);
    if (where) lines.push(where);
    const titles: string[] = [];
    for (const columnId of trip.columnOrder) {
      const column = workspace.columns[columnId];
      if (!column) continue;
      for (const cardId of column.cardOrder) {
        const title = workspace.cards[cardId]?.title.trim();
        if (title && !titles.includes(title)) titles.push(title);
        if (titles.length >= 10) break;
      }
      if (titles.length >= 10) break;
    }
    if (titles.length) lines.push(`보드에 담긴 것: ${titles.join(', ')}`);
    lines.push('');
  }

  lines.push(`질문: ${truncate(question, MAX_USER_TEXT)}`);
  return assemble(lines);
}
