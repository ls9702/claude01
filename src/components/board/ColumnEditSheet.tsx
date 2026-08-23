import { useState } from 'react';
import type { BoardColumn } from '../../types/models';
import { DEFAULT_COLOR, isColorToken, type ColorToken } from '../../utils/colors';
import Sheet from '../common/Sheet';
import {
  DANGER_TEXT_BUTTON_CLASS,
  PRIMARY_BUTTON_CLASS,
} from '../common/formStyles';
import ColumnFields from './ColumnFields';

export interface ColumnFormValues {
  name: string;
  color: string;
  icon: string;
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
            onClick={() => canSubmit && onSubmit({ name: name.trim(), color, icon })}
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
      {!canDelete ? (
        <p className="mt-6 rounded-md bg-sunken px-3 py-2 text-label font-normal text-ink-muted">
          마지막 카테고리는 삭제할 수 없어요.
        </p>
      ) : null}
    </Sheet>
  );
}
