/**
 * 드로우가 워크스페이스에서 차지하는 몫을 지켜본다 (M52a) — 순수 함수뿐.
 *
 * ## 왜 지켜봐야 하나
 *
 * 이 앱의 모든 데이터는 **하나의 JSON**이다. 카드도 배치도 메모도 다 합쳐 수십
 * 킬로바이트인데, 그림은 그 규모가 다르다: 한 페이지를 빽빽하게 채우면 획이
 * 수백 개가 되고, 그 전부가 저장할 때마다·푸시할 때마다·백업할 때마다 통째로
 * 다시 쓰인다. 사진 바이트를 워크스페이스 **밖**에 둔 것(M10)과 같은 이유의
 * 위험이지만, 그림은 좌표라서 밖으로 뺄 데가 없다.
 *
 * ## 왜 막지 않나
 *
 * 브레인스토밍 도구가 「더 못 그립니다」라고 말하는 순간 그것은 브레인스토밍
 * 도구가 아니다. 그리고 여기서 넘치는 것은 「지금 데이터가 사라진다」가 아니라
 * 「동기화가 무거워진다」다 — 그건 알려 줄 일이지 막을 일이 아니다. 그래서
 * 드로우 탭 맨 위의 **조용한 한 줄**이고, 버튼도 확인도 없다.
 */

import type { DrawPage, Id } from '../types/models';

/**
 * 이 크기를 넘으면 한 줄 알린다. **바꾸고 싶으면 이 숫자 하나만 바꾼다.**
 *
 * 1.5MB로 잡은 근거: 워크스페이스 전체가 이 규모를 넘어가면 폰의 idb 쓰기와
 * NAS 푸시가 사람이 느낄 만큼(수백 ms) 길어지기 시작한다. 넉넉한 페이지 열
 * 장쯤에 해당하므로 평범한 여행 하나에서는 평생 보이지 않는 줄이다.
 */
export const DRAW_WARN_BYTES = 1_500_000;

/**
 * 문자열의 UTF-8 바이트 수.
 *
 * `TextEncoder`를 쓰지 않는 이유는 이 파일이 순수해야 하기 때문이다 — 노드·
 * 브라우저·워커 어디서 불려도 같은 답을 주고, 없는 전역을 찾지 않는다.
 * 한글은 3바이트, 이모지는 4바이트(서로게이트 쌍)로 정확히 센다.
 */
export function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      bytes += 4;
      i += 1;
    } else bytes += 3;
  }
  return bytes;
}

/**
 * 드로우 페이지들이 직렬화되면 몇 바이트인가.
 *
 * 워크스페이스 전체를 재는 대신 **드로우 몫만** 잰다: 사람에게 할 말이
 * 「그림이 커요」이지 「데이터가 커요」가 아니기 때문이고, 이 함수가 드로우 탭
 * 렌더마다 불리므로 카드·배치까지 매번 훑을 이유가 없기 때문이다.
 */
export function drawBytes(pages: Record<Id, DrawPage> | undefined): number {
  if (!pages) return 0;
  return utf8Length(JSON.stringify(pages));
}

/** `1.8MB` / `640KB` — 사람이 읽는 크기. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)}MB`;
  if (bytes >= 1_000) return `${Math.round(bytes / 1_000)}KB`;
  return `${bytes}B`;
}

/**
 * 넘쳤을 때 보여줄 한 줄, 아니면 `null`.
 *
 * 문구가 이 파일에 있는 이유는 숫자와 문장이 한 몸이기 때문이다 — 상수를
 * 바꿨는데 문장이 옛 기준을 말하는 일이 생길 수 없다.
 */
export function drawSizeWarning(bytes: number, limit: number = DRAW_WARN_BYTES): string | null {
  if (bytes <= limit) return null;
  return `그림이 ${formatBytes(bytes)}까지 커졌어요 — 안 쓰는 페이지를 지우면 동기화가 가벼워져요.`;
}
