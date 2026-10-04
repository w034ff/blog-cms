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

// Callout control: inserts a GitHub-alert callout at the cursor, or switches the type of the one
// the cursor is in (setCallout handles both, so callouts never nest). `labelled` draws the name
// beside the glyph for the ＋ menu, where there is no tooltip under `hover: none`
// (docs/link-requirements.md §5.5.19).
export function CalloutMenu({ editor, labelled }: { editor: Editor; labelled?: boolean }) {
  const inCallout = editor.isActive('callout');
  // Ask setCallout itself (it refuses in tables and quotes) so this can't drift from the
  // extension's rules; the `/` menu uses the same `can()` check. `some` stays true inside a
  // callout, where the rows switch the type.
  const canInsert = CALLOUT_MENU_ORDER.some((type) => editor.can().setCallout(type));
  const currentType: CalloutType | null = inCallout
    ? toCalloutType(editor.getAttributes('callout').type)
    : null;

  // `null` outside the drawer (the pointer toolbar's own floating panel) — see insert-menu-nav.ts.
  const nav = useInsertMenuNav();

  const choose = (type: CalloutType, close: () => void) => {
    focusThenRun(editor, (c) => c.setCallout(type));
    close();
    // A pick is final, so the whole sheet closes, not just the picker.
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
