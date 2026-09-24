import { Slice, type Node as PMNode, type ResolvedPos } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { createBoxSliceRepair } from './box-slice-repair';
import { resolveDropTarget } from './drop-target';
import { replaceSelectionClamped } from './isolating-boundary';
import { dropOpenWrappers } from './slice-placement';

// The rules for what a *slice* carrying a callout may do — the one repair and the one refusal —
// kept apart from the node definition in callout-extension.ts.
//
// drop-cursor-guard.ts needs wouldNestCallout without the node definition, so the dependency runs
// callout-extension → callout-slice-guard → drop-target. CALLOUT_NAME lives here for the same
// reason: CALLOUT_HOSTILE_ANCESTORS reads it at module scope, and defining it on the node's side
// would make a cycle that reads it before initialization.
export const CALLOUT_NAME = 'callout';

// The containers a callout may not be placed into, matching what setCallout refuses: another
// callout, and a blockquote. The latter is editorial, not storage — `> > [!NOTE]` round-trips, but a
// quote is someone else's words and a callout is the author's aside (docs/editor-pitfalls.md §6.1).
const CALLOUT_HOSTILE_ANCESTORS = new Set([CALLOUT_NAME, 'blockquote']);

// Would the slice put a whole callout inside one of those? Both halves must hold: moving a callout
// at top level, or text into a callout, is ordinary. Half-selected boxes and wrappers open on both
// sides are removed before this is asked (repairIncomingSlice), so every callout here is real.
//
// The gesture is guarded rather than the schema because `content: 'block+'` is what lets a nested
// callout from stored markdown *load*; forbidding it in the schema would drop that content on open.
export function wouldNestCallout($pos: ResolvedPos, slice: Slice): boolean {
  let carriesCallout = false;
  slice.content.descendants((node) => {
    if (node.type.name === CALLOUT_NAME) carriesCallout = true;
  });
  if (!carriesCallout) return false;
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    if (CALLOUT_HOSTILE_ANCESTORS.has($pos.node(depth).type.name)) return true;
  }
  return false;
}

// A selection crossing a callout's edge carries the callout node too, and no destination does
// anything sensible with half a box. So the box is dropped and its contents kept, wherever the
// slice is headed (box-slice-repair.ts; docs/editor-pitfalls.md §14).
//
// A callout's children are `block+`, so unwrapping is one level and stays schema-valid in every
// parent: blockquote and callout are `block+`, listItem holds one only at index ≥ 1, cells never
// do. `recurseIntoRemoved` because a callout in a callout still loads from stored `> > [!NOTE]`.
// A drop can be repaired rather than refused because the move's source deletion is clamped at
// isolating edges (isolating-boundary.ts).
const repair = createBoxSliceRepair({
  nodeName: CALLOUT_NAME,
  unwrap: (node) => {
    const blocks: PMNode[] = [];
    node.content.forEach((block) => blocks.push(block));
    return blocks;
  },
  depthDrop: 1,
  recurseIntoRemoved: true,
});

// Everything a slice needs before anybody judges where it may go. The order does not matter (the
// two act on disjoint shapes; slice-guard-composition.test.ts), but composing it in one place lets
// drop-cursor-guard.ts reproduce exactly what this does.
export function repairIncomingSlice(slice: Slice): Slice {
  return dropOpenWrappers(unwrapHalfSelectedCallouts(slice));
}

export const unwrapHalfSelectedCallouts = repair.unwrapHalfSelected;

// The nesting case on the paste side: a whole callout pasted into a hostile ancestor loses its box
// and keeps its contents, since the caret is where the text was asked for.
export const flattenClosedCallouts = repair.flattenClosed;

const calloutSliceGuardKey = new PluginKey('calloutSliceGuard');

// Named for the destination first, like the other refusals: the author needs to know *where* the
// content may not go.
const CALLOUT_NESTING_BLOCKED = 'コールアウトは引用やコールアウトの中に入れられません';

// The half-selected repair is position-independent, so it sits on `transformPasted`, which
// prosemirror-view also runs over the drag slice before any handleDrop prop. The nesting rule
// depends on the destination, so it is split across the two handlers: a paste keeps the text at the
// caret, a drop is refused. Only the refusal notifies — it changes nothing on screen, while the
// paste's result is visible.
export function calloutSliceGuard(notify: (message: string) => void): Plugin {
  return new Plugin({
    key: calloutSliceGuardKey,
    props: {
      transformPasted: repairIncomingSlice,
      handlePaste(view, _event, slice) {
        const { $from } = view.state.selection;
        // A whole box in the slice can't go into a callout or a quote — the same shape a drop is
        // refused for below.
        if (!wouldNestCallout($from, slice)) return false;
        const repaired = flattenClosedCallouts(slice);
        if (repaired === slice) return false;
        // ProseMirror's own paste, metas included, with the selection clamped to isolating edges.
        // The clamp is applied here because `someProp` stops at the first handlePaste returning
        // true, so isolating-boundary.ts never sees this paste.
        view.dispatch(
          replaceSelectionClamped(view.state, repaired)
            .scrollIntoView()
            .setMeta('paste', true)
            .setMeta('uiEvent', 'paste'),
        );
        return true;
      },
      handleDrop(view, event, slice, moved) {
        const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
        if (!coords) return false;
        // resolveDropTarget, not the raw position: a move's source deletion shifts the insertion
        // point (drop-target.ts). `moved` is this event's verdict; view.dragging is stale since
        // dragstart.
        if (!wouldNestCallout(resolveDropTarget(view, coords.pos, slice, moved), slice))
          return false;
        notify(CALLOUT_NESTING_BLOCKED);
        // Returning true makes ProseMirror preventDefault and skip the drop entirely, so the
        // dragged text stays where it was instead of being deleted from its source.
        event.preventDefault();
        return true;
      },
    },
  });
}
