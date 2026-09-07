/**
 * 글을 클립보드에 넣는다 (M55 — 메모 「메시지 복사」).
 *
 * 두 갈래인 이유: `navigator.clipboard.writeText`는 https·포커스·권한이 다
 * 맞아야 하고, 일부 웹뷰·구형 브라우저에는 아예 없다. 실패하면 옛길로 간다 —
 * 보이지 않는 textarea에 글을 넣고 `execCommand('copy')`. 폐기 예정 API지만
 * 아직 모든 브라우저가 지원하고, 사용자 제스처 안에서 부르면 권한을 묻지 않는다.
 *
 * 돌려주는 값은 **실제로 들어갔는가**다. 둘 다 실패하면 `false`이고, 부르는
 * 쪽은 「복사했어요」 대신 「복사하지 못했어요」를 보여 줘야 한다 — 안 된 복사를
 * 됐다고 말하는 것이 이 함수가 할 수 있는 가장 나쁜 일이다.
 */
export async function copyText(text: string): Promise<boolean> {
  if (!text) return false;
  const clip = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
  if (clip && typeof clip.writeText === 'function') {
    try {
      await clip.writeText(text);
      return true;
    } catch {
      // 권한 거부·포커스 없음 — 아래 옛길로.
    }
  }
  return legacyCopy(text);
}

function legacyCopy(text: string): boolean {
  if (typeof document === 'undefined' || typeof document.execCommand !== 'function') return false;
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  // 화면 밖·투명 — 잠깐 붙었다 떨어지는 동안 레이아웃을 흔들지 않는다.
  area.style.position = 'fixed';
  area.style.top = '0';
  area.style.left = '-9999px';
  area.style.opacity = '0';
  document.body.appendChild(area);
  try {
    area.focus();
    area.select();
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    area.remove();
  }
}
