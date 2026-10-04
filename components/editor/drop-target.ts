import type { ResolvedPos, Slice } from '@tiptap/pm/model';
import { dropPoint } from '@tiptap/pm/transform';
import type { EditorView } from '@tiptap/pm/view';
import { deleteSelectionClamped } from './isolating-boundary';

// Which modifier turns a drag into a copy, as prosemirror-view decides it. Kept apart from isMac
// (ToolbarButton.tsx), which follows prosemirror-keymap: the two upstreams test Mac differently
// (prosemirror-view's `mac` is `ios || /Mac/.test(...)`). Read at call time so an SSR pass can't
// freeze the wrong answer.
function dragCopyModifier(): 'altKey' | 'ctrlKey' {
  if (typeof navigator === 'undefined') return 'ctrlKey';
  return /Mac|iP(hone|ad|od)/.test(navigator.platform) ? 'altKey' : 'ctrlKey';
}

// Is this drag a move rather than a copy? prosemirror-view's own `dragMoves`, which it does not
// export.
//
// Recomputed from the event in hand: `view.dragging.move` is captured at dragstart, but
// prosemirror-view calls dragMoves again at drop time
// (`let move = !!(dragging && dragMoves(view, event))`), so the two disagree once the modifier
// changes mid-drag. `dragCopies` is consulted as upstream does.
export function dragMoves(view: EditorView, event: DragEvent): boolean {
  let copy: boolean | undefined;
  view.someProp('dragCopies', (test) => {
    copy = copy || test(event);
  });
  return copy != null ? !copy : !event[dragCopyModifier()];
}

// Where a drop will actually land, resolved in the document the drop leaves behind.
//
// Mirrors prosemirror-view's two steps: `dropPoint` fits the slice, then a *move* deletes the
// dragged range and maps the insertion point through that deletion. Judging the on-screen document
// instead let a selection from inside a callout, dropped on the paragraph below, nest the callout:
// the deletion pulled the insertion point inside it. The transaction is a dry run, never
// dispatched, and must use the same clamped deletion the drop performs (isolating-boundary.ts).
//
// `move` is a parameter because `view.dragging` is stale by drop time (see dragMoves).
//
// prosemirror-view deletes a NodeSelection drag's source with `dragging.node.replace(tr)`, which
// is not in its public types; the selection is equivalent here because block-drag-handle.ts sets
// that NodeSelection before the drag starts.
export function resolveDropTarget(
  view: EditorView,
  pos: number,
  slice: Slice,
  move: boolean,
): ResolvedPos {
  const insertPos = dropPoint(view.state.doc, pos, slice) ?? pos;
  const tr = move ? deleteSelectionClamped(view.state) : view.state.tr;
  return tr.doc.resolve(tr.mapping.map(insertPos));
}
