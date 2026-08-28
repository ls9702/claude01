/**
 * 시트 복제가 붙일 이름을 고른다 (M40) — 순수 함수 하나.
 *
 * 규칙은 사람이 파일을 복사할 때 기대하는 것과 같다: 「본 일정」의 사본은
 * 「본 일정 (복사)」이고, 그 이름이 이미 있으면 「본 일정 (복사 2)」, 「(복사 3)」
 * 으로 밀린다. 번호는 2에서 시작한다 — 첫 사본에 1을 붙이면 사본이 하나뿐일 때도
 * 세는 것처럼 읽힌다.
 *
 * 사본의 사본은 **꼬리를 겹치지 않는다**: 「본 일정 (복사)」를 복제하면
 * 「본 일정 (복사) (복사)」가 아니라 「본 일정 (복사 2)」다. 겹쳐 붙이면 세 번만
 * 눌러도 칩 하나가 시트 줄을 다 먹는데, 그 이름이 말해 주는 것은 어차피 「이건
 * 사본이다」 하나뿐이다.
 *
 * 스토어 밖에 있는 이유는 이 규칙이 데이터가 아니라 문구이기 때문이다 — 여기서
 * 혼자 테스트되고, 뮤테이션은 결과만 받아 쓴다.
 */

/** 이름 끝의 `(복사)` / `(복사 3)` 꼬리. */
const COPY_SUFFIX = /\s*\(복사(?:\s+\d+)?\)$/;

/** 이름이 비었을 때의 답 — 스토어의 `addSheet`와 같은 말을 쓴다. */
const FALLBACK = '새 일정';

/**
 * `name`의 사본에 붙일 이름. `existing`에 있는 이름과는 절대 겹치지 않는다.
 *
 * `existing`은 보통 그 여행의 시트 이름 전부다(원본 자신을 포함해도 된다).
 * 앞뒤 공백은 양쪽 모두 손질해서 비교하므로 「본 일정 」과 「본 일정」은 같은
 * 이름으로 친다.
 */
export function copySheetName(name: string, existing: readonly string[]): string {
  const trimmed = name.trim() || FALLBACK;
  const base = trimmed.replace(COPY_SUFFIX, '').trim() || FALLBACK;
  const taken = new Set(existing.map((sheetName) => sheetName.trim()));

  const first = `${base} (복사)`;
  if (!taken.has(first)) return first;

  // `taken`은 유한하므로 반드시 멈춘다.
  let n = 2;
  for (;;) {
    const candidate = `${base} (복사 ${n})`;
    if (!taken.has(candidate)) return candidate;
    n += 1;
  }
}
