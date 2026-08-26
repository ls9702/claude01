import { useState } from 'react';
import type { BoardColumn } from '../../types/models';
import { DEFAULT_COLOR, isColorToken, type ColorToken } from '../../utils/colors';
import Sheet from '../common/Sheet';
import {
  DANGER_TEXT_BUTTON_CLASS,
  PRIMARY_BUTTON_CLASS,
  SECTION_TITLE_CLASS,
} from '../common/formStyles';
import ColumnFields from './ColumnFields';

export interface ColumnFormValues {
  name: string;
  color: string;
  icon: string;
  /**
   * 체크리스트 카테고리인가 (M29). 언제나 참/거짓 둘 중 하나다 — 「없음」은
   * 자동 이행이 쓰는 상태이지 사람이 고를 수 있는 상태가 아니다.
   */
  todo: boolean;
  /**
   * 예산을 시트마다 한 번만 세는 칸인가 (M31). `todo`와 같은 이유로 언제나
   * 참/거짓 둘 중 하나다 — 「없음」은 자동 이행의 상태다.
   */
  budgetOnce: boolean;
}

/**
 * 이름·아이콘·색 아래에 서는 「이 칸이 어떻게 **동작**할지」 토글 한 줄.
 *
 * M29가 체크리스트 토글로 세운 모양 그대로다. 두 번째 토글(M31)이 붙으면서
 * 같은 30줄을 두 번 쓰는 대신 한 곳으로 접었다 — 스위치·설명·간격이 두 줄
 * 사이에서 갈라지면 그건 두 개의 다른 토글처럼 보인다.
 */
function ColumnBehaviorToggle({
  title,
  description,
  checked,
  onToggle,
  testId,
}: {
  title: string;
  description: string;
  checked: boolean;
  onToggle: () => void;
  testId: string;
}) {
  return (
    <div className="mt-6 border-t border-line pt-6">
      <div className="flex items-center justify-between gap-3">
        <h3 className={SECTION_TITLE_CLASS}>{title}</h3>
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          aria-label={title}
          data-testid={testId}
          data-on={checked ? 'true' : 'false'}
          onClick={onToggle}
          className={[
            'relative h-6 w-11 shrink-0 rounded-full transition-colors duration-[140ms]',
            'ease-quick outline-none focus-visible:ring-2 focus-visible:ring-line-strong',
            checked ? 'bg-inverse' : 'bg-line',
          ].join(' ')}
        >
          <span
            aria-hidden="true"
            className={[
              'absolute top-1 h-4 w-4 rounded-full bg-surface shadow-raise',
              'transition-[left] duration-[140ms] ease-quick',
              checked ? 'left-6' : 'left-1',
            ].join(' ')}
          />
        </button>
      </div>
      <p className="mt-2 text-micro font-normal text-ink-faint">{description}</p>
    </div>
  );
}

interface ColumnEditSheetProps {
  column: BoardColumn;
  /** False when this is the board's last column — deletion is then blocked. */
  canDelete: boolean;
  onSubmit: (values: ColumnFormValues) => void;
  onDelete: () => void;
  onClose: () => void;
}

/** Rename / recolor / delete one board category. */
export default function ColumnEditSheet({
  column,
  canDelete,
  onSubmit,
  onDelete,
  onClose,
}: ColumnEditSheetProps) {
  const [name, setName] = useState(column.name);
  const [icon, setIcon] = useState(column.icon);
  const [color, setColor] = useState<ColorToken>(
    isColorToken(column.color) ? column.color : DEFAULT_COLOR,
  );
  const [todo, setTodo] = useState(column.todo === true);
  const [budgetOnce, setBudgetOnce] = useState(column.budgetOnce === true);

  const canSubmit = name.trim().length > 0;

  return (
    <Sheet
      title="카테고리 수정"
      onClose={onClose}
      testId="column-form"
      footer={
        <div className="flex items-center justify-between gap-2">
          {canDelete ? (
            <button
              type="button"
              data-testid="column-delete"
              onClick={onDelete}
              className={DANGER_TEXT_BUTTON_CLASS}
            >
              삭제
            </button>
          ) : null}
          <button
            type="button"
            data-testid="column-submit"
            disabled={!canSubmit}
            onClick={() =>
              canSubmit && onSubmit({ name: name.trim(), color, icon, todo, budgetOnce })
            }
            className={`flex-1 ${PRIMARY_BUTTON_CLASS}`}
          >
            저장
          </button>
        </div>
      }
    >
      <ColumnFields
        name={name}
        onNameChange={setName}
        icon={icon}
        onIconChange={setIcon}
        color={color}
        onColorChange={setColor}
        idPrefix="edit-column"
      />

      {/* 이 칸이 어떻게 동작할지 (M29 → M31) — 이름·아이콘·색 **아래**에 선다:
          앞의 셋은 이 칸이 무엇처럼 보일지를 정하고, 이 둘은 무엇처럼
          동작할지를 정한다. 「준비물」로 이름을 바꾼 칸을 체크리스트로 만들 수
          있는 곳도, 자동으로 켜진 칸을 다시 끌 수 있는 곳도 여기 하나뿐이다. */}
      <ColumnBehaviorToggle
        title="체크리스트 카테고리"
        description="환전·챙길 것처럼 장소가 없는 일에 어울려요. 카드마다 체크박스가 생기고, 일정 탭의 「할 일」에 모여요."
        checked={todo}
        onToggle={() => setTodo((current) => !current)}
        testId="column-todo-toggle"
      />

      {/* M31 — 숙소의 셈법. 필요 예산은 배치마다 세는 게 기본이라(식사 카드를
          네 날에 걸면 밥값도 네 번), 4박 예약 하나를 네 칸에 걸어 둔 숙소 칸은
          그 기본이 틀린 답을 낸다. */}
      <ColumnBehaviorToggle
        title="예산은 한 번만"
        description="숙소처럼 여러 날에 걸쳐 놓아도 결제는 한 번인 카테고리예요. 필요 예산에 첫날 한 번만 더해요."
        checked={budgetOnce}
        onToggle={() => setBudgetOnce((current) => !current)}
        testId="column-budget-once-toggle"
      />

      {!canDelete ? (
        <p className="mt-6 rounded-md bg-sunken px-3 py-2 text-label font-normal text-ink-muted">
          마지막 카테고리는 삭제할 수 없어요.
        </p>
      ) : null}
    </Sheet>
  );
}
