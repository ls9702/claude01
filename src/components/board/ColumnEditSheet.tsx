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
            onClick={() => canSubmit && onSubmit({ name: name.trim(), color, icon, todo })}
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

      {/* 체크리스트 카테고리 (M29) — 이름·아이콘·색 **아래**에 선다: 앞의 셋은
          이 칸이 무엇처럼 보일지를 정하고, 이것은 무엇처럼 **동작할지**를
          정한다. 「준비물」로 이름을 바꾼 칸을 체크리스트로 만들 수 있는 곳도,
          자동으로 켜진 칸을 다시 끌 수 있는 곳도 여기 하나뿐이다. */}
      <div className="mt-6 border-t border-line pt-6">
        <div className="flex items-center justify-between gap-3">
          <h3 className={SECTION_TITLE_CLASS}>체크리스트 카테고리</h3>
          <button
            type="button"
            role="switch"
            aria-checked={todo}
            aria-label="체크리스트 카테고리"
            data-testid="column-todo-toggle"
            data-on={todo ? 'true' : 'false'}
            onClick={() => setTodo((current) => !current)}
            className={[
              'relative h-6 w-11 shrink-0 rounded-full transition-colors duration-[140ms]',
              'ease-quick outline-none focus-visible:ring-2 focus-visible:ring-line-strong',
              todo ? 'bg-inverse' : 'bg-line',
            ].join(' ')}
          >
            <span
              aria-hidden="true"
              className={[
                'absolute top-1 h-4 w-4 rounded-full bg-surface shadow-raise',
                'transition-[left] duration-[140ms] ease-quick',
                todo ? 'left-6' : 'left-1',
              ].join(' ')}
            />
          </button>
        </div>
        <p className="mt-2 text-micro font-normal text-ink-faint">
          환전·챙길 것처럼 장소가 없는 일에 어울려요. 카드마다 체크박스가 생기고,
          일정 탭의 「할 일」에 모여요.
        </p>
      </div>

      {!canDelete ? (
        <p className="mt-6 rounded-md bg-sunken px-3 py-2 text-label font-normal text-ink-muted">
          마지막 카테고리는 삭제할 수 없어요.
        </p>
      ) : null}
    </Sheet>
  );
}
