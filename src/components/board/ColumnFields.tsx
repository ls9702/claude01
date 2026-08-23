import { COLORS, COLOR_TOKENS, type ColorToken } from '../../utils/colors';
import { INPUT_CLASS, LABEL_CLASS } from '../common/formStyles';

/** Emojis offered as one-tap category icons. */
export const ICON_PRESETS = ['📌', '🚗', '🍽️', '🏨', '🎡', '🛍️', '☕', '🎁'] as const;

export interface ColumnFieldsProps {
  name: string;
  onNameChange: (name: string) => void;
  icon: string;
  onIconChange: (icon: string) => void;
  color: ColorToken;
  onColorChange: (color: ColorToken) => void;
  /** Prefix so two mounted forms never collide on input ids. */
  idPrefix: string;
  autoFocus?: boolean;
}

/** Name + emoji + palette picker, shared by the inline adder and the editor. */
export default function ColumnFields({
  name,
  onNameChange,
  icon,
  onIconChange,
  color,
  onColorChange,
  idPrefix,
  autoFocus = false,
}: ColumnFieldsProps) {
  return (
    <div className="space-y-4">
      <div>
        <label className={LABEL_CLASS} htmlFor={`${idPrefix}-name`}>
          카테고리 이름
        </label>
        <input
          id={`${idPrefix}-name`}
          data-testid="column-name-input"
          value={name}
          autoFocus={autoFocus}
          onChange={(event) => onNameChange(event.target.value)}
          placeholder="예) 쇼핑"
          className={INPUT_CLASS}
        />
      </div>

      <div>
        <span className={LABEL_CLASS}>아이콘</span>
        <div className="mt-2 flex flex-wrap gap-2">
          {ICON_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              aria-label={`아이콘 ${preset}`}
              aria-pressed={icon === preset}
              data-testid={`column-icon-${preset}`}
              onClick={() => onIconChange(preset)}
              style={{ fontSize: 16, lineHeight: 1 }}
              className={[
                'grid h-11 w-11 place-items-center rounded-md transition-colors duration-[140ms] ease-quick lg:h-9 lg:w-9',
                icon === preset
                  ? 'bg-inverse ring-2 ring-line-strong ring-offset-2 ring-offset-surface'
                  : 'bg-sunken hover:bg-line',
              ].join(' ')}
            >
              {preset}
            </button>
          ))}
        </div>
      </div>

      <div>
        <span className={LABEL_CLASS}>색상</span>
        <div className="mt-2 flex flex-wrap gap-2">
          {COLOR_TOKENS.map((token) => (
            <button
              key={token}
              type="button"
              aria-label={`색상 ${COLORS[token].label}`}
              aria-pressed={color === token}
              data-testid={`column-color-${token}`}
              onClick={() => onColorChange(token)}
              className={[
                'h-8 w-8 rounded-full transition-transform duration-[140ms] ease-quick',
                COLORS[token].dot,
                color === token
                  ? 'scale-110 ring-2 ring-ink ring-offset-2 ring-offset-surface'
                  : 'hover:scale-105',
              ].join(' ')}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
