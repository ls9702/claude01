import { useEffect, useRef, useState, type RefObject } from 'react';

/**
 * 화면 하단에 달라붙는 가로 스크롤 대리 막대 (M50-fix).
 *
 * 보드처럼 **페이지가 세로로 스크롤되는** 화면에서는 가로 스크롤러의 진짜
 * 막대가 내용 맨 아래 — 즉 화면 밖 — 에 붙는다. v24가 막대를 「늘 보이게」
 * 스타일해도 사용자는 볼 수 없었다(신고: 「가로 스크롤 어딨지..?」).
 *
 * 그래서 스크롤러와 `scrollLeft`를 양방향으로 묶은 얇은 대리 스크롤러를
 * `sticky bottom-0`으로 세운다. 세로로 어디까지 내렸든 막대는 뷰포트
 * 아래 가장자리에 떠 있고, 끌면 진짜 스크롤러가 따라온다(반대도 같다).
 *
 * - **데스크톱(lg) 전용**: 폰은 스와이프·스냅·화살표가 이미 있고, 겹침
 *   막대라 대리도 안 보인다.
 * - 넘칠 때만 렌더 — 내용이 다 보이면 막대도 없다.
 * - 모양은 진짜 막대와 같은 규칙(`index.css`의 스크롤바 블록이
 *   `[data-scrollbar-proxy]`를 같은 목록에 들고 있다).
 */
export default function StickyHScrollbar({
  targetRef,
  testid,
}: {
  /** 가로로 넘치는 실제 스크롤러. */
  targetRef: RefObject<HTMLElement | null>;
  testid: string;
}) {
  const proxyRef = useRef<HTMLDivElement | null>(null);
  const [contentWidth, setContentWidth] = useState(0);
  const [needed, setNeeded] = useState(false);

  useEffect(() => {
    const target = targetRef.current;
    if (!target) return;

    /* 같은 값 대입은 no-op이라 두 sync가 서로를 되받아도 루프가 없다. */
    const sync = () => {
      const proxy = proxyRef.current;
      if (proxy && proxy.scrollLeft !== target.scrollLeft) proxy.scrollLeft = target.scrollLeft;
    };
    const measure = () => {
      setContentWidth(target.scrollWidth);
      setNeeded(target.scrollWidth > target.clientWidth + 1);
      sync();
    };

    measure();
    target.addEventListener('scroll', sync, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(target);
    /* 칸이 늘어나면 상자 크기는 그대로여도 scrollWidth가 자란다. */
    const mo = new MutationObserver(measure);
    mo.observe(target, { childList: true, subtree: true });
    window.addEventListener('resize', measure);
    return () => {
      target.removeEventListener('scroll', sync);
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [targetRef]);

  if (!needed) return null;

  return (
    <div
      ref={proxyRef}
      data-testid={testid}
      data-scrollbar-proxy
      aria-hidden="true"
      onScroll={() => {
        const target = targetRef.current;
        const proxy = proxyRef.current;
        if (target && proxy && target.scrollLeft !== proxy.scrollLeft) {
          target.scrollLeft = proxy.scrollLeft;
        }
      }}
      className="sticky bottom-0 z-30 hidden overflow-x-auto overscroll-x-none lg:block"
    >
      {/* 스크롤바가 설 자리를 만드는 1px 유령 — 폭이 곧 내용 폭이다. */}
      <div style={{ width: contentWidth, height: 1 }} />
    </div>
  );
}
