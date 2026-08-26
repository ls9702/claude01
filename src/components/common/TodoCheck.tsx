import Icon from './Icon';

interface TodoCheckProps {
  done: boolean;
}

/**
 * 체크박스의 **모양**만 — 보드 카드와 「할 일」 시트가 같은 상자를 쓴다 (M29).
 *
 * 누르는 일은 하지 않는다: 두 자리의 터치 타깃 크기가 다르고(카드 안 32px,
 * 시트 줄 44px), 상자를 44px로 키우면 카드 제목 줄이 무너진다. 그래서 이 파일은
 * 18px짜리 사각형 하나를 그리고, 그것을 감싸는 버튼과 타깃 크기는 호출부가
 * 정한다 — {@link Icon}이 색을 `currentColor`에 맡기는 것과 같은 분업이다.
 */
export default function TodoCheck({ done }: TodoCheckProps) {
  return (
    <span
      aria-hidden="true"
      data-done={done ? 'true' : 'false'}
      className={[
        'grid h-[18px] w-[18px] shrink-0 place-items-center rounded-xs border',
        'transition-colors duration-[140ms] ease-quick',
        done ? 'border-ink bg-ink text-surface' : 'border-line-strong bg-surface text-transparent',
      ].join(' ')}
    >
      <Icon name="check" size={16} />
    </span>
  );
}
