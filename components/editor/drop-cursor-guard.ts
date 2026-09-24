import { Extension } from '@tiptap/core';
import type { EditorView } from '@tiptap/pm/view';
import { dragMoves, resolveDropTarget } from './drop-target';
import { repairIncomingSlice, wouldNestCallout } from './callout-slice-guard';
import { unwrapHalfSelectedDetails, wouldNestDetails } from './details-slice-guard';
import { tableDropRefusal } from './table-cell-rules';

// prosemirror-dropcursor's `disableDropCursor` hook, hiding the indicator for every drop this
// editor refuses. **It must be one hook:** `extendNodeSchema` merges specs by key, so a second
// extension setting it would silently disarm the first.
//
// The cursor is drawn at dropPoint's target, not the node under the pointer, so the target is
// recomputed and the predicates asked about it. Set on every node, because the hook is asked of the
// innermost node under the pointer and a box's `block+` body can hold any block. The dragover event
// answers move-vs-copy for the drag as it stands (see dragMoves).
//
// The slice is repaired first: prosemirror-view applies `transformPasted` only to a local copy on
// the way into handleDrop, and `view.dragging.slice` keeps the raw shape.
function disableDropCursor(view: EditorView, pos: { pos: number }, event: DragEvent): boolean {
  const dragged = view.dragging?.slice;
  if (!dragged) return false;
  const slice = unwrapHalfSelectedDetails(repairIncomingSlice(dragged));
  const $target = resolveDropTarget(view, pos.pos, slice, dragMoves(view, event));
  // Both table reasons hide it: a refused block would be refused anywhere in the cell.
  return (
    tableDropRefusal($target, slice) !== null ||
    wouldNestCallout($target, slice) ||
    wouldNestDetails($target, slice)
  );
}

export const DropCursorGuard = Extension.create({
  name: 'dropCursorGuard',
  extendNodeSchema() {
    return { disableDropCursor };
  },
});
