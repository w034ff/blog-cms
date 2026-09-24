'use client';

import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import type { ChainedCommands } from '@tiptap/core';
import type { SuggestionKeyDownProps, SuggestionProps } from '@tiptap/suggestion';

// One row of the `/` menu. `id` keys the row (a stable slug); `title` is the visible label;
// `keywords` widen what the query matches; `run` applies the block insertion onto a chain that
// has already focused the editor and deleted the `/query` range (see slash-command.ts).
export type SlashItem = {
  id: string;
  title: string;
  keywords: string[];
  // The range the `/query` occupies, so a row can say *where* it acts: a focus after a blur (the
  // row was clicked) does not reliably restore the selection. `range.from` is unchanged by
  // `deleteRange`.
  run: (chain: ChainedCommands, range: { from: number; to: number }) => ChainedCommands;
};

// Imperative handle so the suggestion plugin's render.onKeyDown can drive the highlight
// (↑ / ↓ / Enter) from the editor, where the key events actually land.
export type SlashListRef = {
  onKeyDown: (props: SuggestionKeyDownProps) => boolean;
};

// The `/` command popup: a caret-anchored menu of the insertable blocks, styled to match the
// toolbar's dropdowns. Keyboard is driven through the ref; a pointer press runs the same command
// (mousedown + preventDefault so the editor selection isn't lost to a blur before the command
// reads its range).
export const SlashList = forwardRef<SlashListRef, SuggestionProps<SlashItem, SlashItem>>(
  ({ items, command }, ref) => {
    const [selected, setSelected] = useState(0);
    // Reset the highlight to the first item whenever the filtered list changes.
    useEffect(() => setSelected(0), [items]);

    const select = (index: number) => {
      const item = items[index];
      if (item) command(item);
    };

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }) => {
        if (items.length === 0) return false;
        if (event.key === 'ArrowUp') {
          setSelected((s) => (s + items.length - 1) % items.length);
          return true;
        }
        if (event.key === 'ArrowDown') {
          setSelected((s) => (s + 1) % items.length);
          return true;
        }
        if (event.key === 'Enter') {
          select(selected);
          return true;
        }
        return false;
      },
    }));

    if (items.length === 0) return null;

    return (
      <div
        data-slash-menu
        className='flex min-w-[8rem] flex-col overflow-hidden rounded border border-zinc-300 bg-white py-0.5 shadow-lg dark:border-zinc-700 dark:bg-zinc-900'>
        {items.map((item, index) => (
          <button
            key={item.id}
            type='button'
            onMouseDown={(event) => {
              event.preventDefault();
              select(index);
            }}
            className={`px-3 py-1.5 text-left text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
              index === selected ? 'bg-zinc-200 dark:bg-zinc-700' : ''
            }`}>
            {item.title}
          </button>
        ))}
      </div>
    );
  },
);

SlashList.displayName = 'SlashList';
