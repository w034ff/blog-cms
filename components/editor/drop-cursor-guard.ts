import { Extension } from '@tiptap/core';
import type { EditorView } from '@tiptap/pm/view';
import { dragMoves, resolveDropTarget } from './drop-target';
import { unwrapHalfSelectedCallouts, wouldNestCallout } from './callout-slice-guard';
import { tableDropRefusal } from './table-cell-rules';

// prosemirror-dropcursor's `disableDropCursor` hook (return true to hide the drop indicator), for
// every drop this editor refuses. Both refusals live with the node they protect — tableDropGuard in
// table-extensions.ts, calloutSliceGuard in callout-slice-guard.ts — but the *indicator* has to be one
// hook: `extendNodeSchema` merges each extension's contribution into the node spec by key, so two
// extensions each setting `disableDropCursor` on `paragraph` would leave only the last one standing
// and quietly disarm the other. Asking both predicates here is what keeps them both live.
//
// The hook is evaluated on the node under the pointer but the cursor is *drawn* at dropPoint's
// target, and those two disagree near a block's edge — so recompute that target first and ask the
// predicates about it. The indicator then appears exactly when a drop would be accepted and hides
// when it would be rejected.
//
// Flagged on every node rather than a list of the ones that look relevant. prosemirror-dropcursor
// asks only the innermost node under the pointer (`doc.nodeAt(pos.inside)`), which for a pointer
// over text is the textblock holding it — and a callout's `block+` body can hold a heading, a list
// or a code block just as well as a paragraph, so any such list is a list that will be wrong later.
// Outside a table or a callout both predicates are false, so drops elsewhere are unaffected.
// prosemirror-dropcursor hands the dragover event to this hook, which is what lets the move-vs-copy
// question be answered for the drag as it stands right now — `view.dragging.move` was fixed at
// dragstart and goes stale as soon as the copy modifier is pressed or released (see dragMoves).
//
// The slice is repaired first, because the drop will be judged on the repaired one and the two
// disagree. prosemirror-view applies `transformPasted` to a *local copy* of the drag slice on the
// way into handleDrop — `view.dragging.slice` itself keeps the raw shape — so a drag carrying a
// half-selected callout still reads as "contains a callout" here while the drop that follows sees
// the unwrapped blocks. Left unrepaired, the indicator hid for exactly the drags that now land.
function disableDropCursor(view: EditorView, pos: { pos: number }, event: DragEvent): boolean {
  const dragged = view.dragging?.slice;
  if (!dragged) return false;
  const slice = unwrapHalfSelectedCallouts(dragged);
  const $target = resolveDropTarget(view, pos.pos, slice, dragMoves(view, event));
  // Both of the table's reasons hide it, including the slice-shaped one: a block being dragged over
  // a cell is refused wherever in that cell it would land, so promising a landing spot and then
  // raising a notice would be a worse answer than never promising one.
  return tableDropRefusal($target, slice) !== null || wouldNestCallout($target, slice);
}

export const DropCursorGuard = Extension.create({
  name: 'dropCursorGuard',
  extendNodeSchema() {
    return { disableDropCursor };
  },
});
