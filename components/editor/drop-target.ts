import type { ResolvedPos, Slice } from '@tiptap/pm/model';
import { dropPoint } from '@tiptap/pm/transform';
import type { EditorView } from '@tiptap/pm/view';

// Where a drop will actually land, resolved in the document the drop leaves behind.
//
// Two steps, both of which prosemirror-view performs and neither of which is visible from the raw
// pointer position. First `dropPoint` finds the place the slice can be fitted, which is not always
// the position under the cursor. Then — and this is the one that bites — a *move* drag deletes the
// dragged range before inserting, and maps the insertion point through that deletion. So the
// position must be judged against the post-deletion document, not the one on screen.
//
// Judging the wrong one produced a real defect: a selection running from inside a callout into the
// paragraph below, dropped onto that paragraph, looked like a drop outside any callout. Deleting
// the source first joined the callout and that paragraph, which pulled the mapped insertion point
// *inside* the callout — so the guard waved it through and the slice's own callout node went in as
// a child. The transaction here is a dry run: it is built to be measured and never dispatched.
export function resolveDropTarget(view: EditorView, pos: number, slice: Slice): ResolvedPos {
  const insertPos = dropPoint(view.state.doc, pos, slice) ?? pos;
  const tr = view.state.tr;
  if (view.dragging?.move) tr.deleteSelection();
  return tr.doc.resolve(tr.mapping.map(insertPos));
}
