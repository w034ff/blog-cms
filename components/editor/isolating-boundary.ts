import type { CommandProps } from '@tiptap/core';
import type { NodeType } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';

// A command body (call it from inside a single `editor.commands.command(...)`) for an `isolating`
// block `nodeType`: at the very start of the top-level block sitting directly after one, drop the
// caret into the *end* of that isolating block, rather than ProseMirror's default (which
// node-selects the whole box). Shared by the callout and code block — both are isolating, so their
// lower edge would otherwise leave a bare node-selection when you Backspace up into them. Returns
// true when it acted, so a node can compose it with its own Backspace behavior in one command.
//
// An *empty* following block carries no content that could corrupt the isolating node (unlike a
// non-empty one, which is left untouched so text is never absorbed into e.g. a code fence), so it
// is deleted outright here — matching blockquote's plain-join behavior, where the empty line
// simply disappears instead of surviving as a dangling paragraph below the box.
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
    if ($from.parent.content.size === 0) tr.delete(boundary, $from.after(1));
    tr.setSelection(TextSelection.near(tr.doc.resolve(boundary - 1), -1));
    tr.scrollIntoView();
  }
  return true;
}

// The Delete-direction mirror: at the very end of an isolating block `nodeType`'s content
// (however deeply the caret sits inside it — a code block's content is flat, a callout's is
// nested), a following top-level sibling that is empty carries nothing that could corrupt the
// isolating node, so it is deleted outright — the same cleanup stepIntoPreviousIsolating does
// for a dangling empty line, just approached from the opposite edge. A non-empty following
// sibling needs no handling here: prosemirror-commands' joinForward already refuses to cross an
// isolating boundary (its findCutAfter helper stops at one), so Delete there is already a no-op.
export function stepIntoNextIsolating(
  nodeType: NodeType,
  { state, tr, dispatch }: CommandProps,
): boolean {
  const { selection } = state;
  if (!selection.empty) return false;
  const { $from } = selection;
  // Caret must sit inside a top-level isolating node of this type…
  if ($from.depth < 1 || $from.node(1).type !== nodeType) return false;
  // …at the end of its own textblock…
  if ($from.parentOffset !== $from.parent.content.size) return false;
  // …with every ancestor down to (but not including) the isolating node itself the *last* child
  // of its parent — otherwise there is more content after the caret somewhere inside the node
  // (e.g. a callout's paragraph nested one level deeper than a code block's flat text; a plain
  // position-arithmetic shortcut would silently miscount that extra level).
  for (let depth = $from.depth; depth > 1; depth -= 1) {
    if ($from.index(depth - 1) !== $from.node(depth - 1).childCount - 1) return false;
  }
  // …with a following sibling that exists and is empty.
  const index = $from.index(0);
  if (index + 1 >= state.doc.childCount) return false;
  const next = state.doc.child(index + 1);
  if (next.content.size > 0) return false;
  if (dispatch) {
    const from = $from.after(1);
    tr.delete(from, from + next.nodeSize).scrollIntoView();
  }
  return true;
}
