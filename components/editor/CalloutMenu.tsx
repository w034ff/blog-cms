'use client';

import type { Editor } from '@tiptap/core';
import { ToolbarDropdown, DropdownItem } from './ToolbarDropdown';
import { CalloutIcon } from './svg/CalloutIcon';
import { CALLOUT_MENU_ORDER } from './callout-extension';
import { CALLOUT_TITLES, toCalloutType, type CalloutType } from '@/lib/callout-types';

// Callout control: a dropdown that drops a styled GitHub-alert callout at the cursor — or,
// when the cursor is already inside one, switches that callout's type in place (setCallout
// handles both, so callouts never nest; see the extension). Mirrors the list menu: the
// trigger highlights while inside a callout and the panel marks the current type.
export function CalloutMenu({ editor }: { editor: Editor }) {
  const inCallout = editor.isActive('callout');
  // setCallout refuses where a callout doesn't belong — inside a table, and inside a quote
  // (someone else's words; a callout is the author's own aside). Ask the command rather than
  // re-testing those contexts here, so this can't drift from the extension's rules, and grey
  // the trigger out instead of letting a pick silently no-op. Same `can()` check backs the
  // `/` menu's row filtering (slash-command.ts). Every type shares one guard, so `some` is
  // just "would any row do something" — it stays true inside a callout, where they switch
  // the type in place.
  const canInsert = CALLOUT_MENU_ORDER.some((type) => editor.can().setCallout(type));
  const currentType: CalloutType | null = inCallout
    ? toCalloutType(editor.getAttributes('callout').type)
    : null;

  const choose = (type: CalloutType, close: () => void) => {
    editor.chain().focus().setCallout(type).run();
    close();
  };

  return (
    <ToolbarDropdown
      trigger={<CalloutIcon />}
      title='囲み枠'
      active={inCallout}
      disabled={!canInsert}>
      {(close) =>
        CALLOUT_MENU_ORDER.map((type) => (
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
