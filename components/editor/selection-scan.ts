import type { EditorState } from '@tiptap/pm/state';

// Does the selection touch a node of any of these types — anywhere in its range, not just as the
// block it sits in?
//
// `editor.isActive(name)` cannot answer that: for a non-empty selection it requires the nodes to
// *cover* the range (@tiptap/core's isNodeActive ends in `range >= selectionRange`), so a
// selection reaching one character out of a table reads as outside it — and inserting a block over
// that range replaces the table. prosemirror-tables' `isInTable` has the same gap, since it reads
// `$head` alone.
//
// `from`/`to` are normalized, so drag direction doesn't matter. An empty selection is covered
// (nodesBetween(pos, pos) visits the nodes containing pos), making this a superset of the isActive
// checks it replaces. A gap cursor before a block is correctly not counted: inserting there is
// safe.
export function selectionTouches(state: EditorState, ...typeNames: string[]): boolean {
  const { from, to } = state.selection;
  let found = false;
  state.doc.nodesBetween(from, to, (node) => {
    if (typeNames.includes(node.type.name)) found = true;
  });
  return found;
}
