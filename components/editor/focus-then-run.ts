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
//
// `{ preventScroll: true }` (reported 2026-09-20, tapping the header's own background then
// inserting 引用 from the ＋ sheet): calling this while the editor is blurred — a header tap
// blurs it without moving the caret — makes the *browser* scroll the focused element into view
// by its own naive rule, which does not know the sticky header covers the viewport's own top
// pixels. That native scroll runs before `build(...).run()`'s own transaction dispatches, and
// ProseMirror's own scrollIntoView (already the thing correctly written around the sticky chrome
// elsewhere — pm-scrollintoview-under-sticky-toolbar) then has to work from wherever the native
// one left the page rather than from the pre-tap position, and the two disagreed (measured: the
// inserted blockquote's own bottom edge landed 19px past the viewport's). Suppressing the native
// scroll leaves PM's own scrollIntoView the only one that runs, off the state this chain actually
// changes.
export function focusThenRun(
  editor: Editor,
  build: (chain: ReturnType<Editor['chain']>) => ReturnType<Editor['chain']>,
): boolean {
  editor.view.dom.focus({ preventScroll: true });
  return build(editor.chain()).run();
}
