import { useState } from 'react';
import { COLOR_TOKENS, type ColorToken } from '../../utils/colors';
import Icon from '../common/Icon';
import {
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
} from '../common/formStyles';
import ColumnFields from './ColumnFields';

interface AddColumnPanelProps {
  /** Colors already used on this board — the next unused one is preselected. */
  usedColors: readonly string[];
  onAdd: (name: string, color: string, icon: string) => void;
}

/** Picks the first palette color the board is not using yet. */
const suggestColor = (used: readonly string[]): ColorToken =>
  COLOR_TOKENS.find((token) => !used.includes(token)) ?? 'slate';

/**
 * The "＋ 카테고리" slot at the end of the board. Collapsed it is a dashed
 * column; tapping it expands the form inline (no dialog).
 */
export default function AddColumnPanel({ usedColors, onAdd }: AddColumnPanelProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('📌');
  const [color, setColor] = useState<ColorToken>(() => suggestColor(usedColors));

  const reset = () => {
    setOpen(false);
    setName('');
    setIcon('📌');
    setColor(suggestColor(usedColors));
  };

  const submit = () => {
    if (!name.trim()) return;
    onAdd(name.trim(), color, icon);
    reset();
  };

  if (!open) {
    return (
      <button
        type="button"
        data-testid="add-column"
        onClick={() => {
          setColor(suggestColor(usedColors));
          setOpen(true);
        }}
        className="flex w-[70vw] shrink-0 snap-start items-start justify-center gap-1 rounded-lg border border-dashed border-line bg-surface/40 px-4 py-4 text-label text-ink-faint transition-colors duration-[140ms] ease-quick hover:border-line-strong hover:text-ink sm:w-[13rem]"
      >
        <Icon name="plus" size={16} />
        카테고리
      </button>
    );
  }

  return (
    <div
      data-testid="add-column-form"
      className="h-fit w-[85vw] shrink-0 snap-start rounded-lg border border-line bg-surface p-4 shadow-raise sm:w-[17rem]"
    >
      <ColumnFields
        name={name}
        onNameChange={setName}
        icon={icon}
        onIconChange={setIcon}
        color={color}
        onColorChange={setColor}
        idPrefix="add-column"
        autoFocus
      />
      <div className="mt-4 flex gap-2">
        <button type="button" onClick={reset} className={`flex-1 ${SECONDARY_BUTTON_CLASS}`}>
          취소
        </button>
        <button
          type="button"
          data-testid="add-column-submit"
          onClick={submit}
          disabled={!name.trim()}
          className={`flex-1 ${PRIMARY_BUTTON_CLASS}`}
        >
          추가
        </button>
      </div>
    </div>
  );
}
