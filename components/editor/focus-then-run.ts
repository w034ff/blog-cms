import type { Editor } from '@tiptap/core';

// `.chain().focus().X().run()` throws `RangeError: Applying a mismatched transaction` on
// Android/iOS when the editor has never had DOM focus and the document's last block isn't a
// paragraph (docs/table-requirements.md §12.21, reported 2026-09-19 from the ＋ sheet's 引用, then
// confirmed on the main toolbar's bold/heading family too). `.chain().focus()` builds a
// transaction from the current state, then synchronously calls `view.dom.focus()` on those
// platforms; the native `focus` event that raises runs `@tiptap/core`'s FocusEvents extension
// synchronously too, which dispatches its OWN transaction — trailing-node-extension.ts's
// `appendTransaction` rides that one and advances `editor.state` before the caller's own
// (already-under-construction) transaction is dispatched, so its `.before` no longer matches.
// Splitting into `editor.commands.focus()` then a separate chain does not fix this:
// `commands.focus()` hits the identical mismatch on its own dispatch, for the same reason
// (measured). A raw `editor.view.dom.focus()`, outside any tiptap command, lets that nested
// dispatch settle before a transaction anything else cares about is built.
export function focusThenRun(
  editor: Editor,
  build: (chain: ReturnType<Editor['chain']>) => ReturnType<Editor['chain']>,
): boolean {
  editor.view.dom.focus();
  return build(editor.chain()).run();
}
