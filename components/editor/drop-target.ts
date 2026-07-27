import type { ResolvedPos, Slice } from '@tiptap/pm/model';
import { dropPoint } from '@tiptap/pm/transform';
import type { EditorView } from '@tiptap/pm/view';

// Which modifier turns a drag into a copy — ⌥ on macOS, Ctrl elsewhere, the same rule
// prosemirror-view applies. Read at call time rather than at module scope so an SSR pass can't
// freeze the wrong answer in, the same guard ToolbarButton's isMac uses.
function dragCopyModifier(): 'altKey' | 'ctrlKey' {
  if (typeof navigator === 'undefined') return 'ctrlKey';
  return /Mac|iP(hone|ad|od)/.test(navigator.platform) ? 'altKey' : 'ctrlKey';
}

// Is this drag a move rather than a copy? prosemirror-view's own `dragMoves`, which it does not
// export.
//
// It has to be recomputed from the event in hand. `view.dragging.move` is captured once, at
// dragstart (`new Dragging(slice, dragMoves(view, event), node)`), but prosemirror-view calls
// dragMoves *again* at drop time (`let move = !!(dragging && dragMoves(view, event))`) — so the
// two disagree the moment the copy modifier is pressed or released mid-drag, and a guard reading
// the stale flag judges the drop against a document that will never exist.
//
// The `dragCopies` prop is consulted the way upstream does, so an override added later reaches
// this too instead of being silently bypassed.
export function dragMoves(view: EditorView, event: DragEvent): boolean {
  let copy: boolean | undefined;
  view.someProp('dragCopies', (test) => {
    copy = copy || test(event);
  });
  return copy != null ? !copy : !event[dragCopyModifier()];
}

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
//
// `move` is a parameter rather than something read off `view.dragging`, because that flag is stale
// by the time the drop happens (see dragMoves above). handleDrop is handed the live value as its
// fourth argument; the drop-cursor hook derives it from the dragover event it is given.
//
// One deliberate difference from upstream: for a NodeSelection drag prosemirror-view deletes the
// source with `dragging.node.replace(tr)` rather than `tr.deleteSelection()`. The two coincide
// here — block-drag-handle.ts puts that same NodeSelection on the state before the drag starts —
// and `dragging.node` is absent from prosemirror-view's public types, so this uses the selection.
export function resolveDropTarget(
  view: EditorView,
  pos: number,
  slice: Slice,
  move: boolean,
): ResolvedPos {
  const insertPos = dropPoint(view.state.doc, pos, slice) ?? pos;
  const tr = view.state.tr;
  if (move) tr.deleteSelection();
  return tr.doc.resolve(tr.mapping.map(insertPos));
}
