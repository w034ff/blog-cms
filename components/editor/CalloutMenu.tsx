'use client';

import type { ComponentType } from 'react';
import type { Editor } from '@tiptap/core';
import { ToolbarDropdown, DropdownItem } from './ToolbarDropdown';
import { useInsertMenuNav } from './insert-menu-nav';
import { focusThenRun } from './focus-then-run';
import { CalloutIcon } from './svg/CalloutIcon';
import { AlertTriangleIcon } from './svg/AlertTriangleIcon';
import { AlertOctagonIcon } from './svg/AlertOctagonIcon';
import { CALLOUT_MENU_ORDER } from './callout-extension';
import { CALLOUT_TITLES, toCalloutType, type CalloutType } from '@/lib/callout-types';

// One icon per tier, matching the filled Octicon each published alert draws from its own
// `--alert-icon` (app/globals.css) — info-circle / alert-triangle / alert-octagon — so the
// drilled-in picker previews the shape the reader will actually see, not just 囲み枠's generic
// mark repeated three times.
const CALLOUT_ICONS: Record<CalloutType, ComponentType> = {
  note: CalloutIcon,
  warning: AlertTriangleIcon,
  caution: AlertOctagonIcon,
};

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

  // `null` outside the drawer (the pointer toolbar's own floating panel) — see insert-menu-nav.ts.
  const nav = useInsertMenuNav();

  const choose = (type: CalloutType, close: () => void) => {
    focusThenRun(editor, (c) => c.setCallout(type));
    close();
    // Closes the sheet whole, on top of `close()`'s own "back to the row list" — a pick here is
    // as final as 引用/脚注/画像 tapping their own row (2026-09-20).
    nav?.closeMenu();
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
        CALLOUT_MENU_ORDER.map((type) => {
          const Icon = CALLOUT_ICONS[type];
          return (
            <DropdownItem
              key={type}
              onClick={() => choose(type, close)}
              active={type === currentType}>
              <span className='flex items-center gap-3'>
                <Icon />
                {CALLOUT_TITLES[type]}
              </span>
            </DropdownItem>
          );
        })
      }
    </ToolbarDropdown>
  );
}
