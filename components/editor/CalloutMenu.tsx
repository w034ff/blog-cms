'use client';

import type { Editor } from '@tiptap/core';
import { ToolbarDropdown, DropdownItem } from './ToolbarDropdown';
import { CalloutIcon } from './svg/CalloutIcon';
import {
  CALLOUT_TYPES,
  CALLOUT_TITLES,
  toCalloutType,
  type CalloutType,
} from './callout-extension';

// Callout control: a dropdown that drops a styled GitHub-alert callout at the cursor — or,
// when the cursor is already inside one, switches that callout's type in place (setCallout
// handles both, so callouts never nest; see the extension). Mirrors the list menu: the
// trigger highlights while inside a callout and the panel marks the current type.
export function CalloutMenu({ editor }: { editor: Editor }) {
  const inCallout = editor.isActive('callout');
  const currentType: CalloutType | null = inCallout
    ? toCalloutType(editor.getAttributes('callout').type)
    : null;

  const choose = (type: CalloutType, close: () => void) => {
    editor.chain().focus().setCallout(type).run();
    close();
  };

  return (
    <ToolbarDropdown trigger={<CalloutIcon />} title='囲み枠' active={inCallout}>
      {(close) =>
        CALLOUT_TYPES.map((type) => (
          <DropdownItem
            key={type}
            onClick={() => choose(type, close)}
            active={type === currentType}>
            {CALLOUT_TITLES[type]}
          </DropdownItem>
        ))
      }
    </ToolbarDropdown>
  );
}
