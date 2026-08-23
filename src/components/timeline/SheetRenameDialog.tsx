import { useState } from 'react';
import type { Sheet as SheetModel } from '../../types/models';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import Sheet from '../common/Sheet';
import { INPUT_CLASS, LABEL_CLASS, PRIMARY_BUTTON_CLASS } from '../common/formStyles';

interface SheetRenameDialogProps {
  sheet: SheetModel;
  onClose: () => void;
}

/** 이름만 바꾸는 한 줄짜리 시트 — 항공편은 {@link SheetWizard}가 맡아요. */
export default function SheetRenameDialog({ sheet, onClose }: SheetRenameDialogProps) {
  const updateSheet = useWorkspaceStore((s) => s.updateSheet);
  const [name, setName] = useState(sheet.name);

  const submit = () => {
    const next = name.trim();
    if (next && next !== sheet.name) updateSheet(sheet.id, { name: next });
    onClose();
  };

  return (
    <Sheet
      title="시트 이름"
      onClose={onClose}
      testId="sheet-rename-dialog"
      footer={
        <button
          type="button"
          data-testid="sheet-rename-submit"
          onClick={submit}
          disabled={!name.trim()}
          className={`w-full ${PRIMARY_BUTTON_CLASS}`}
        >
          저장
        </button>
      }
    >
      <label className={LABEL_CLASS} htmlFor="sheet-rename">
        이름
      </label>
      <input
        id="sheet-rename"
        data-testid="sheet-rename-input"
        value={name}
        autoFocus
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') submit();
        }}
        className={INPUT_CLASS}
      />
    </Sheet>
  );
}
