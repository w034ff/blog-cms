import type { EditorState } from '@tiptap/pm/state';

// Does the selection touch a node of any of these types — anywhere in its range, not just as the
// block it sits in?
//
// This exists because `editor.isActive(name)` cannot answer that question. For a non-empty
// selection isActive requires the matching nodes to *cover* the whole range (@tiptap/core's
// isNodeActive ends in `range >= selectionRange`), so it reports false the moment a selection
// reaches out of the node — one character past the edge of a table or a code block is enough. Every
// guard written as `if (editor.isActive('table')) return false` therefore held only for a caret and
// waved a mixed selection straight through, and what came next was not a near miss: inserting a
// block node over such a range *replaces* it, so the table or the code was silently gone (the
// callout/image guards) or overwritten by a fresh empty table (insertTable, which read
// prosemirror-tables' isInTable — the same defect, since that reads `$head` alone and so missed a
// selection dragged the other way).
//
// `selection.from`/`to` are normalized, so drag direction doesn't matter. An empty selection is
// covered too: nodesBetween(pos, pos) still visits the nodes containing pos, which is what makes
// this a superset of the isActive checks it replaces rather than a different test. A cursor resting
// *between* two blocks (a gap cursor before a table) is correctly not counted — the node starts
// where the cursor is, so it isn't inside it, and inserting there is safe.
export function selectionTouches(state: EditorState, ...typeNames: string[]): boolean {
  const { from, to } = state.selection;
  let found = false;
  state.doc.nodesBetween(from, to, (node) => {
    if (typeNames.includes(node.type.name)) found = true;
  });
  return found;
}
