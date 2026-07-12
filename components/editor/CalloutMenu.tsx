'use client';

import { useState } from 'react';
import type { Editor } from '@tiptap/core';
import { ToolbarButton } from './ToolbarButton';
import { useDismiss } from './useDismiss';
import { ChevronIcon } from './svg/ChevronIcon';
import { CalloutIcon } from './svg/CalloutIcon';
import { CALLOUT_TYPES, CALLOUT_TITLES, type CalloutType } from './callout-extension';

// One row of the menu — full-width, border-less so the hover highlight spans the whole
// dropdown, matching Toolbar's ListMenuItem.
function CalloutMenuItem({ onClick, children }: { onClick: () => void; children: string }) {
  return (
    <button
      type='button'
      onClick={onClick}
      className='px-3 py-1.5 text-left text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800'>
      {children}
    </button>
  );
}

// Callout-insert control: a dropdown that drops a styled GitHub-alert callout at the
// cursor. Insert-only (like the table picker), so there's no active state. The inserted
// node carries the type as an attribute (not editable marker text) and leaves the caret
// in the empty body, ready for content.
export function CalloutMenu({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss<HTMLDivElement>(open, () => setOpen(false));

  const insert = (type: CalloutType) => {
    editor.chain().focus().setCallout(type).run();
    setOpen(false);
  };

  return (
    <div ref={ref} className='relative flex'>
      <ToolbarButton onClick={() => setOpen((prev) => !prev)} active={open} title='コールアウト'>
        <span className='flex items-center gap-1'>
          <CalloutIcon />
          コールアウト
          <ChevronIcon open={open} />
        </span>
      </ToolbarButton>
      {open && (
        <div className='absolute left-1/2 top-full z-50 mt-1 flex min-w-max -translate-x-1/2 flex-col overflow-hidden rounded border border-zinc-300 bg-white px-1 py-0.5 shadow-lg dark:border-zinc-700 dark:bg-zinc-900'>
          {CALLOUT_TYPES.map((type) => (
            <CalloutMenuItem key={type} onClick={() => insert(type)}>
              {CALLOUT_TITLES[type]}
            </CalloutMenuItem>
          ))}
        </div>
      )}
    </div>
  );
}
