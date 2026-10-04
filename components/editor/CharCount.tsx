'use client';

import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { useEditorState } from '@tiptap/react';
import { countChars, formatCharCount } from '@/lib/format';

// A doc is immutable, so a selection-only transaction hands back the same node and skips the walk.
const counted = new WeakMap<PMNode, number>();

function charsOf(doc: PMNode): number {
  const cached = counted.get(doc);
  if (cached !== undefined) return cached;
  const n = countChars(doc.textContent);
  counted.set(doc, n);
  return n;
}

// The header's 文字数 (docs/editor-requirements.md §12.38). Re-renders only when the number
// changes, not on every keystroke's transaction. Not a live region: announcing every edit would
// drown the editor out.
export function CharCount({ editor }: { editor: Editor }) {
  const chars = useEditorState({ editor, selector: ({ editor: e }) => charsOf(e.state.doc) });
  return (
    <span className='editor-char-count mr-1 text-xs whitespace-nowrap text-zinc-600 tabular-nums dark:text-zinc-400'>
      {formatCharCount(chars)}
    </span>
  );
}
