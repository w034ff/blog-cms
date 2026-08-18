import { Slice, type Node as PMNode, type ResolvedPos } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { createBoxSliceRepair } from './box-slice-repair';
import { resolveDropTarget } from './drop-target';
import { replaceSelectionClamped } from './isolating-boundary';
import { dropOpenWrappers } from './slice-placement';

// The rules for what a *slice* carrying a callout may do — the one repair and the one refusal —
// kept apart from the node definition in callout-extension.ts.
//
// The split follows an import that already existed: drop-cursor-guard.ts has to ask
// wouldNestCallout (over the repaired slice) to decide whether to draw the drop indicator — see its
// comment for why that hook must be single — and pulling the whole node definition in for that was
// more than it needed. The dependency now runs callout-extension → callout-slice-guard →
// drop-target, with drop-cursor-guard reaching only the middle one.
//
// That direction is also why CALLOUT_NAME lives here rather than with the node: this module reads
// it at module scope (CALLOUT_HOSTILE_ANCESTORS below), so defining it on the node's side would
// make the pair a cycle and leave the Set reading it before its initializer had run.
export const CALLOUT_NAME = 'callout';

// The two containers a callout may not be *placed* into, and the same two setCallout refuses to
// insert one into (see callout-extension.ts's addCommands): another callout, and a blockquote. The
// first is a shape nothing in the editor can author on purpose — the input rules are top-level only
// and setCallout retypes in place instead of nesting. The second is an editorial rule rather than a
// storage one: `> > [!NOTE]` round-trips perfectly well, but a blockquote is someone else's words
// and a callout is the author's own aside, so nesting one in the other misattributes it.
const CALLOUT_HOSTILE_ANCESTORS = new Set([CALLOUT_NAME, 'blockquote']);

// Would the slice put a callout inside one of those? A slice carries a whole callout when the block
// drag handle's NodeSelection picked one up, or when a selection swallowed the box end-to-end on its
// way past — and dropping or pasting that into either container puts the node in as a child.
//
// Both halves have to be true. Either alone is fine: moving a callout around at top level is an
// ordinary edit, and so is dragging plain text into a callout or a quote.
//
// This is the *whole*-callout half of the problem only. A selection that merely crosses a callout's
// edge also arrives carrying a box the user never meant to move; that one is settled separately, by
// halfSelectedEdges below. A selection made *wholly inside* a callout carries the box too, and is
// settled before this is ever asked — dropOpenWrappers takes it off on the way in (see
// slice-placement.ts), so by here every callout in the slice is one that would really be placed.
//
// Guarding the gesture rather than the schema is deliberate. The node's `content: 'block+'` is what
// lets a nested callout *load*: `> [!NOTE]` inside another quote level is legal markdown that an
// imported post can carry, and lib/remark-github-alerts.ts renders it. Forbidding the shape in the
// schema would silently drop that content on open; forbidding the gesture leaves stored documents
// alone. Same reasoning, and the same shape, as tableDropGuard in table-extensions.ts.
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

// The other half, and the one that made "cover every case" feel endless: a selection that crosses a
// callout's edge — from inside one down into the paragraph below, or the reverse. ProseMirror hands
// that drag the callout node too, and *no* destination does anything sensible with it. Dropped
// inside another callout it nested; dropped outside every callout it built a brand new box around
// the moved text. Enumerating destinations was chasing the wrong axis, because the gesture is
// already unanswerable as a *box*: half a box is not a box, and it is not plain text either.
//
// So the box is dropped and its contents kept, wherever the slice is headed — one question about
// the slice, no question about position. `unwrapHalfSelected` below is that repair, and
// `flattenClosed` the paste-side answer to a box the selection covered end-to-end; both are
// box-slice-repair.ts's, specialised here. What stays in this file is where a callout may go, which
// is nothing like the accordion's rule.
//
// A callout's children are `block+`, so taking one apart is one level and its blocks go straight
// up. Splicing them into the parent stays schema-valid throughout: blockquote and callout are both
// `block+`, listItem is `paragraph block*` so a callout can only ever sit at index ≥ 1 there, and
// cells are paragraph-only so none lives in one.
//
// `recurseIntoRemoved`, because a callout inside a callout is reachable: copy a quote that holds one
// (`> > [!NOTE]`, which loads from stored markdown even though it can no longer be authored) and
// both boxes have to come off, not just the outer one.
//
// The refusal this pair replaced: a *drop* carrying a half-selected slice used to be turned down
// rather than repaired, because a move deletes the dragged range before inserting and a ranged
// delete across the callout's edge joined the box to the block below it despite `isolating: true` —
// so even a perfectly normalised slice landed in a document the drop had already broken. That
// deletion is now clamped to the edge for every gesture, drops included (isolating-boundary.ts),
// which is what leaves drop and paste free to answer the same slice the same way.
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

// Everything a slice needs before anybody judges *where* it may go: the half-selected box taken
// off, then the wrappers that were never being moved at all (slice-placement.ts). Composed here
// rather than registered as a second `transformPasted` prop — prosemirror-view runs every one of
// them, so both would happen either way. The order turns out not to matter (the two act on
// disjoint slice shapes; see box-slice-repair.ts and slice-guard-composition.test.ts), but stating
// it here keeps the drop indicator's own composition in drop-cursor-guard.ts honest, since that one
// has to reproduce whatever this does.
export function repairIncomingSlice(slice: Slice): Slice {
  return dropOpenWrappers(unwrapHalfSelectedCallouts(slice));
}

export const unwrapHalfSelectedCallouts = repair.unwrapHalfSelected;

// The nesting case, on the paste side. A callout the selection covered end-to-end is a real box and
// stays one — but pasted into either of CALLOUT_HOSTILE_ANCESTORS it is the same forbidden shape a
// drop is refused for, and Ctrl+V reached both just as easily as a drag did. Here the box is dropped
// and its contents kept, which is the paste-shaped answer: the caret is where the text was asked
// for, and there is no second place it could go.
export const flattenClosedCallouts = repair.flattenClosed;

const calloutSliceGuardKey = new PluginKey('calloutSliceGuard');

// Why the drop below was refused. Named for the destination first, like the table cell's refusal
// and the image ones — the author needs to know *where* the content may not go, since the content
// is the thing they were holding.
const CALLOUT_NESTING_BLOCKED = 'コールアウトは引用やコールアウトの中に入れられません';

// Two rules, and each now sits on the hook that matches its shape.
//
// The half-selected repair is position-independent — half a box is not a box wherever it lands — so
// it goes on `transformPasted`, which prosemirror-view runs over the *drag* slice as well as the
// clipboard one (handleDrop's `view.dragging.slice`, before any handleDrop prop sees it). One hook,
// both gestures, and by the time either handler below is asked the slice no longer carries the box.
// That placement used to be impossible: transformPasted would have disarmed a refusal the drop
// depended on. The refusal is gone because the deletion it existed for is fixed at its own layer.
//
// The nesting rule *is* about position — it asks where the slice is going — so it stays split
// across the two handlers, which reach the destination differently and answer differently: a paste
// keeps the text at the caret, a drop is simply refused.
//
// Which is also the rule for the notice, and why only one of the two raises it: a refused gesture
// leaves the document *and* the clipboard exactly as they were, so without a message the author is
// told nothing at all. The paste is not refused — the box is dropped and its contents land where
// they were asked for — so it needs no explanation beyond what is on screen. Same principle as the
// table cell's two refusals, where the position one stays silent because the drop indicator has
// already hidden itself by the time the mouse comes up.
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
        // What ProseMirror's own paste does with the slice, metas included — the only differences
        // are which slice it gets, and that the selection it replaces is clamped to any isolating
        // edge it spans (see isolating-boundary.ts). That clamp has to be applied here rather than
        // left to the plugin that owns it: `someProp` stops at the first handlePaste to return
        // true, so a paste this one answers never reaches the other.
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
        // resolveDropTarget, not the raw position: a move deletes the dragged range first, and that
        // deletion moves the insertion point — which is how a drop that looked like it landed
        // *outside* a callout still nested (see drop-target.ts). `moved` is prosemirror-view's own
        // move-vs-copy verdict for *this* event, which is why it is threaded through rather than
        // re-read from view.dragging (stale since dragstart).
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
