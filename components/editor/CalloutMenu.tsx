'use client';

import type { Editor } from '@tiptap/core';
import { ToolbarDropdown, DropdownItem } from './ToolbarDropdown';
import { CalloutIcon } from './svg/CalloutIcon';
import { CALLOUT_TYPES, CALLOUT_TITLES, type CalloutType } from './callout-extension';

// Callout-insert control: a dropdown that drops a styled GitHub-alert callout at the
// cursor. Insert-only (like the table picker), so there's no active state. The inserted
// node carries the type as an attribute (not editable marker text) and leaves the caret
// in the empty body, ready for content.
export function CalloutMenu({ editor }: { editor: Editor }) {
  const insert = (type: CalloutType, close: () => void) => {
    editor.chain().focus().setCallout(type).run();
    close();
  };

  return (
    <ToolbarDropdown
      trigger={
        <>
          <CalloutIcon />
          コールアウト
        </>
      }
      title='コールアウト'>
      {(close) =>
        CALLOUT_TYPES.map((type) => (
          <DropdownItem key={type} onClick={() => insert(type, close)}>
            {CALLOUT_TITLES[type]}
          </DropdownItem>
        ))
      }
    </ToolbarDropdown>
  );
}
