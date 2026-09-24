import type { Editor } from '@tiptap/core';

// `.chain().focus().X().run()` throws `RangeError: Applying a mismatched transaction` on
// Android/iOS when the editor has never had DOM focus and the last block isn't a paragraph
// (docs/editor-requirements.md §12.21). There `.focus()` synchronously calls `view.dom.focus()`,
// whose native `focus` event makes FocusEvents dispatch its own transaction; trailing-node's
// `appendTransaction` rides it and advances `editor.state` under the chain being built.
// `editor.commands.focus()` followed by a separate chain hits the same mismatch. A raw DOM focus,
// outside any tiptap command, lets that nested dispatch settle first.
//
// `preventScroll`: when the editor is blurred, the browser's own scroll-into-view ignores the
// sticky header and runs before ProseMirror's, leaving the inserted block below the viewport.
// Suppressing it leaves ProseMirror's scrollIntoView (docs/editor-pitfalls.md §13.4) the only one.
export function focusThenRun(
  editor: Editor,
  build: (chain: ReturnType<Editor['chain']>) => ReturnType<Editor['chain']>,
): boolean {
  editor.view.dom.focus({ preventScroll: true });
  return build(editor.chain()).run();
}
