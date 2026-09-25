import type { Editor } from '@tiptap/core';
import { Blockquote as BaseBlockquote } from '@tiptap/extension-blockquote';
import type { NodeType } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import { BLOCK_ATOMS, selectionTouches } from './selection-scan';

// Custom Backspace join for blockquotes, replacing upstream's `handleBackspace`, which merges only
// when the preceding quote's last child is a textblock and otherwise lifts. With nested quotes
// that oscillated forever (docs/editor-pitfalls.md §4.1). This descends to the deepest textblock
// and merges there. Regression: e2e/editor-quote-backspace.spec.ts. (It also once worked around a
// bundled duplicate prosemirror-state, the bug class test/no-inlined-prosemirror.test.ts guards;
// docs/editor-pitfalls.md §4.)
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
      // Refused over a selected block atom (BLOCK_ATOMS, selection-scan.ts): upstream's wrapIn
      // would quote one.
      toggleBlockquote: () => (props) => {
        if (selectionTouches(props.state, ...BLOCK_ATOMS)) return false;
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
