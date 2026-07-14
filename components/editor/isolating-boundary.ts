import type { CommandProps } from '@tiptap/core';
import type { NodeType } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';

// A command body (call it from inside a single `editor.commands.command(...)`) for an `isolating`
// block `nodeType`: at the very start of the top-level block sitting directly after one, drop the
// caret into the *end* of that isolating block, rather than ProseMirror's default (which
// node-selects the whole box). Shared by the callout and code block — both are isolating, so their
// lower edge would otherwise leave a bare node-selection when you Backspace up into them. Returns
// true when it acted, so a node can compose it with its own Backspace behavior in one command.
export function stepIntoPreviousIsolating(
  nodeType: NodeType,
  { state, tr, dispatch }: CommandProps,
): boolean {
  const { selection } = state;
  if (!selection.empty) return false;
  const { $from } = selection;
  // Caret must sit at the very start of a top-level block…
  if ($from.depth !== 1 || $from.parentOffset !== 0) return false;
  // …whose immediately preceding sibling is the isolating node.
  const index = $from.index(0);
  if (index === 0 || state.doc.child(index - 1).type !== nodeType) return false;
  if (dispatch) {
    const boundary = $from.before(1); // position between that node and this block
    tr.setSelection(TextSelection.near(tr.doc.resolve(boundary - 1), -1));
    tr.scrollIntoView();
  }
  return true;
}
