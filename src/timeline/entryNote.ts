/**
 * 배치 메모의 「비었는가」와 호버 미리보기 — M39.
 *
 * 일정표에 놓인 카드 하나하나에 붙는 메모(`TimelineEntry.note`)는 엑셀 셀의
 * 코멘트와 같은 것이다: 카드가 아니라 **배치**에 붙으므로 같은 가게를 아침에
 * 한 번, 저녁에 한 번 놓으면 메모도 둘이고 서로를 모른다.
 *
 * 이 파일이 답하는 질문은 하나뿐이다 — 「이 메모를 사람에게 한 줄로 보여준다면
 * 무엇인가」. 답이 빈 문자열이면 적힌 것이 없다는 뜻이고, 그러면 블록 모서리의
 * 자국도 서지 않는다. 「비었다」의 정의가 한 곳에만 있어야 표시와 툴팁이 서로
 * 다른 답을 내지 않는다: 공백만 적힌 메모는 메모가 아니다.
 *
 * 순수함수라 React 없이 테스트한다 (`timeline/`의 다른 규칙들과 같다).
 */

/** How many lines of a note a hover tooltip is allowed to promise. */
const HINT_LINES = 2;
/** …and how much of each. A tooltip is a hint, not the note. */
const HINT_LINE_MAX = 48;

/** The first couple of lines of a note, clipped — `''` when there is none. */
export function noteHint(note?: string): string {
  const lines = (note ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  if (lines.length === 0) return '';

  const kept = lines
    .slice(0, HINT_LINES)
    .map((line) => (line.length > HINT_LINE_MAX ? `${line.slice(0, HINT_LINE_MAX)}…` : line));
  // 잘라 낸 줄이 남아 있으면 그 사실을 말한다 — 툴팁이 메모 전부인 척하지 않는다.
  if (lines.length > HINT_LINES) kept.push('…');
  return kept.join('\n');
}
