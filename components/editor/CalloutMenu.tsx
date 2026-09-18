'use client';

import type { Editor } from '@tiptap/core';
import { ToolbarDropdown, DropdownItem } from './ToolbarDropdown';
import { focusThenRun } from './focus-then-run';
import { CalloutIcon } from './svg/CalloutIcon';
import { CALLOUT_MENU_ORDER } from './callout-extension';
import { CALLOUT_TITLES, toCalloutType, type CalloutType } from '@/lib/callout-types';

// Callout control: a dropdown that drops a styled GitHub-alert callout at the cursor — or,
// when the cursor is already inside one, switches that callout's type in place (setCallout
// handles both, so callouts never nest; see the extension). Mirrors the list menu: the
// trigger highlights while inside a callout and the panel marks the current type.
// `labelled` draws the name beside the glyph. The toolbar leaves it off — a row of icons, where
// the tooltip carries the name and width is the scarce dimension. The ＋ menu turns it on: its
// other rows (表・リンク・画像) are worded, and **a tooltip does not exist under `hover: none`**
// (docs/link-requirements.md §5.5.19), so an icon alone there is a row that says nothing at all.
export function CalloutMenu({ editor, labelled }: { editor: Editor; labelled?: boolean }) {
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
    focusThenRun(editor, (c) => c.setCallout(type));
    close();
  };

  return (
    <ToolbarDropdown
      trigger={
        labelled ? (
          <span className='flex items-center gap-3'>
            <CalloutIcon />
            囲み枠
          </span>
        ) : (
          <CalloutIcon />
        )
      }
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
