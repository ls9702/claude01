/**
 * 동시 실행 폭을 정해 두고 목록을 훑는 작은 워커 풀 (M45).
 *
 * 신고는 한 줄이었다: 「불러오는게 너무 늦다」. 원인은 M43이 일부러 고른 **순차**
 * 루프였다 — 큐레이션 127집을 한 집씩 `await`하면 왕복이 127번 줄지어 서고,
 * 한 번에 200ms만 걸려도 25초다. 그 선택의 이유(「마흔 집을 동시에 던지면 구글은
 * 받아 주지만 사용자의 폰이 먼저 넘어간다」)는 여전히 옳다. 틀린 것은 **폭이
 * 1이라는 것**뿐이다.
 *
 * 그래서 가운데를 고른다: 여섯. 127집이 스물두 계단이 되고, 동시에 살아 있는
 * 요청은 언제나 여섯 개를 넘지 않는다.
 *
 * ## 이 함수가 지키는 세 가지
 *
 * 1. **폭을 넘지 않는다.** 살아 있는 작업 수는 `width`가 상한이다.
 * 2. **시작 순서는 목록 순서다.** 워커는 만들어진 순서대로 다음 칸을 집어가므로,
 *    첫 번째로 나가는 요청은 언제나 `items[0]`의 것이다 — 「무엇부터 물었나」를
 *    검사하는 e2e가 병렬화 뒤에도 같은 답을 본다.
 * 3. **중간에 멈출 수 있다.** {@link RunPoolOptions.stop}이 참을 돌려주면 남은
 *    칸은 아예 집지 않는다. 레이어를 끈 사용자의 화면에 핀이 하나씩 돋아나는
 *    것보다 이상한 버그는 이 기능에 없다.
 *
 * **끝나는 순서는 보장하지 않는다.** 그래서 부르는 쪽은 결과를 도착하는 대로
 * 반영하고(그게 M43이 이미 하던 일이다), 진행 카운터는 **완료 기준**으로 센다.
 */

/** 큐레이션 해석의 동시 실행 폭. */
export const GOURMET_POOL_WIDTH = 6;

export interface RunPoolOptions {
  /** 참이면 남은 칸을 집지 않고 조용히 끝낸다. 칸을 집기 **직전**에 묻는다. */
  stop?: () => boolean;
}

/**
 * `items`를 `width`개씩 동시에 훑는다.
 *
 * `task`가 던지면 그 워커는 죽고 전체가 던진다 — 부르는 쪽이 한 줄의 실패를
 * 삼키고 싶으면 `task` 안에서 삼키면 된다(M43의 조회들이 전부 그렇게 한다).
 */
export async function runPool<T>(
  items: readonly T[],
  width: number,
  task: (item: T, index: number) => Promise<void>,
  options: RunPoolOptions = {},
): Promise<void> {
  const size = Number.isFinite(width) && width >= 1 ? Math.floor(width) : 1;
  if (items.length === 0) return;

  /** 다음에 집을 칸. 자바스크립트는 한 줄씩 도므로 자물쇠가 필요 없다. */
  let cursor = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      if (options.stop?.()) return;
      const index = cursor;
      if (index >= items.length) return;
      cursor += 1;
      await task(items[index], index);
    }
  };

  // 워커를 **순서대로** 만든다: 각 워커의 첫 `await`가 마이크로태스크 큐에
  // 만들어진 순서로 줄을 서므로, 첫 요청은 언제나 `items[0]`의 것이다.
  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(size, items.length); i += 1) workers.push(worker());
  await Promise.all(workers);
}
