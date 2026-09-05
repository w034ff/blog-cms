import type { Editor } from '@tiptap/core';
import { Blockquote as BaseBlockquote } from '@tiptap/extension-blockquote';
import type { NodeType } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import { selectionTouches } from './selection-scan';

// Custom Backspace join for blockquotes, replacing @tiptap/extension-blockquote's own
// (upstream src/handleBackspace.ts): upstream only merges when the preceding blockquote's last
// child is itself a textblock, and otherwise `lift`s the current block out of its quote. With
// *nested* quotes that produced an infinite Backspace toggle: the empty block bounced in and out
// of the quote (lift ↔ ProseMirror's default join-into-quote) and never reached the text. Here we
// instead descend the preceding quote's trailing edge to its deepest textblock and merge there, so
// one Backspace lands the caret at the end of that line regardless of nesting depth. Plain
// textblock-to-textblock joins are left to ProseMirror's default (it already merges paragraphs
// correctly). Regression: e2e/editor-quote-backspace.spec.ts (nested-quote case).
//
// (Historically this also worked around @tiptap/extension-blockquote inlining its own
// prosemirror-state copy, whose duplicate TextSelection broke `instanceof` in prosemirror-view
// — the "dead Backspace" bug. That packaging bug was fixed upstream in 3.28.0, which now imports
// @tiptap/pm/state; the canonical TextSelection below is kept but no longer load-bearing for it.)
function joinIntoBlockquote(editor: Editor, type: NodeType): boolean {
  const { state, view } = editor;
  const { selection } = state;
  if (!selection.empty) return false;
  const { $from } = selection;
  // Caret must sit at the very start of its textblock…
  if ($from.parentOffset !== 0) return false;
  const container = $from.node($from.depth - 1);
  const index = $from.index($from.depth - 1);
  // …with a sibling directly before it…
  if (index === 0) return false;
  const previous = container.child(index - 1);
  // …that is a blockquote (plain-textblock joins are left to ProseMirror's default).
  if (previous.type !== type) return false;

  // Walk the blockquote's trailing edge down to its deepest textblock. Each level between that
  // textblock's end and the current block's start contributes one closing token: the textblock's
  // own close plus one per (nested) blockquote — for a single-level quote that is the familiar 2.
  const blockStart = $from.before();
  let deepest = previous;
  let closings = 1; // `previous`'s own closing token
  while (deepest.lastChild && !deepest.lastChild.isTextblock) {
    if (deepest.lastChild.type !== type) return false; // trailing child is some other block → let default handle
    deepest = deepest.lastChild;
    closings += 1;
  }
  if (!deepest.lastChild?.isTextblock) return false;
  closings += 1; // the deepest textblock's own closing token
  const targetPos = blockStart - closings;

  const { tr } = state;
  tr.delete(blockStart, $from.after()).insert(targetPos, $from.parent.content);
  tr.setSelection(TextSelection.create(tr.doc, targetPos));
  view.dispatch(tr.scrollIntoView());
  return true;
}

export const Blockquote = BaseBlockquote.extend({
  addCommands() {
    const parent = this.parent?.();
    return {
      ...parent,
      // `linkCard`/`embed` are atoms, so selecting one gives a NodeSelection whose range is
      // exactly that node. Upstream's toggleBlockquote → wrapIn finds a valid wrapping for it
      // (both satisfy blockquote's `block+` content) and wraps just that node, producing
      // `<blockquote><linkCard/></blockquote>` — quoting a card was never a thing an author asked
      // for, and it stuck the card under the wrong parent instead of leaving it alone (reported
      // 2026-09-05). Toolbar.tsx's "no command guard is needed" note is about the table-cell
      // refusal `can()` already reports on its own — it doesn't cover this NodeSelection case.
      toggleBlockquote: () => (props) => {
        if (selectionTouches(props.state, 'linkCard', 'embed')) return false;
        return parent?.toggleBlockquote?.()(props) ?? false;
      },
    };
  },
  addKeyboardShortcuts() {
    return {
      ...this.parent?.(),
      Backspace: ({ editor }) => joinIntoBlockquote(editor, this.type),
    };
  },
});
