'use client';

import { useState } from 'react';
import type { Editor } from '@tiptap/core';
import { ToolbarButton } from './ToolbarButton';
import { useDismiss } from './useDismiss';
import { ChevronIcon } from './svg/ChevronIcon';
import { CalloutIcon } from './svg/CalloutIcon';

// The 3-tier callout set, matching the render transform (lib/remark-github-alerts.ts)
// and its editor preview (alert-highlight.ts): only 情報 → 警告 → 注意 are styled, so
// the menu offers exactly those. `marker` is the GitHub-alert tag that must sit alone
// on the blockquote's first line; the Japanese `label` mirrors the published title.
const CALLOUT_TYPES = [
  { marker: '[!NOTE]', label: '情報' },
  { marker: '[!WARNING]', label: '警告' },
  { marker: '[!CAUTION]', label: '注意' },
] as const;

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

// Callout-insert control: a dropdown that drops a styled GitHub-alert blockquote at the
// cursor instead of making the author hand-type `[!WARNING]`. Insert-only (like the
// table picker), so there's no active state. The inserted node is the canonical shape
// the preview tints and the render transform strips — a blockquote holding the marker
// paragraph plus an empty body paragraph — which is exactly what typing `> [!NOTE]` and
// pressing Enter produces; the cursor lands in the empty body ready for content.
export function CalloutMenu({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss<HTMLDivElement>(open, () => setOpen(false));

  const insert = (marker: string) => {
    editor
      .chain()
      .focus()
      .insertContent({
        type: 'blockquote',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: marker }] },
          { type: 'paragraph' },
        ],
      })
      .run();
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
          {CALLOUT_TYPES.map(({ marker, label }) => (
            <CalloutMenuItem key={marker} onClick={() => insert(marker)}>
              {label}
            </CalloutMenuItem>
          ))}
        </div>
      )}
    </div>
  );
}
