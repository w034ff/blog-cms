import { Fragment, Slice, type Node as PMNode, type ResolvedPos } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { resolveDropTarget } from './drop-target';
import { replaceSelectionClamped } from './isolating-boundary';

// The rules for what a *slice* carrying a callout may do — the drop refusals and the paste
// repairs — kept apart from the node definition in callout-extension.ts.
//
// The split follows an import that already existed: drop-cursor-guard.ts has to ask
// wouldNestCallout/carriesHalfSelectedCallout to decide whether to draw the drop indicator (see
// its comment for why that hook must be single), and pulling the whole node definition in for two
// pure predicates was more than it needed. The dependency now runs callout-extension →
// callout-slice-guard → drop-target, with drop-cursor-guard reaching only the middle one.
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
// halfSelectedEdges below.
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
// already unanswerable when it starts: half a box is not a box, and it is not plain text either.
//
// So it is refused wherever it is aimed — one question about the slice, no question about position.
//
// "Half" is read off the open depths. openStart/openEnd say how deep the slice was cut at each end,
// so a callout at the first (or last) child position with a non-zero depth on that side was entered
// mid-way by the selection. What makes it *materialise* is being cut on one side only: the other
// side is a real node boundary, so ProseMirror has to keep the box to close it. A callout open on
// both sides — the whole slice for a selection made wholly inside one — has no closed edge to
// preserve, fits in as plain text wherever it lands, and is deliberately left alone. So is a callout
// the selection covers end-to-end, including the block drag handle's NodeSelection (openStart =
// openEnd = 0, see block-drag-handle.ts): that one really is a box being moved, and it is
// wouldNestCallout above that decides where it may go.
//
// Refusing rather than repairing the slice is deliberate, and it is the source side that forces it.
// A move deletes the dragged range before inserting, and a ranged delete across the callout's edge
// joins the box to the block below it despite the node's `isolating: true` — prosemirror-transform's
// isolating checks guard where a slice may be *placed*, not the frontier a deletion closes over. So
// even with a perfectly normalised slice the drop leaves the callout having swallowed the following
// paragraph. Refusing outright is the only outcome that leaves the document untouched. (The same
// join is reachable from the keyboard — select across the edge, press Backspace — which is a
// separate, pre-existing defect this guard neither causes nor fixes.)
//
// A copy-drag (the modifier held, `handleDrop`'s `move` false) deletes nothing and so could be
// repaired like a paste instead. It is refused with the rest deliberately: the gesture is the same
// gesture, told apart only by a key the user is holding, and one drag behaving two ways depending on
// that is worse than one that behaves once. Paste is a different gesture and gets the other answer.
function halfSelectedEdges(slice: Slice): { start: boolean; end: boolean } {
  const { content, openStart, openEnd } = slice;
  const first = content.firstChild;
  const last = content.lastChild;
  if (!first || !last) return { start: false, end: false };
  const start = openStart > 0 && first.type.name === CALLOUT_NAME;
  const end = openEnd > 0 && last.type.name === CALLOUT_NAME;
  // One callout, cut on both sides: nothing to close around, so nothing to answer for.
  if (content.childCount === 1 && start && end) return { start: false, end: false };
  return { start, end };
}

export function carriesHalfSelectedCallout(slice: Slice): boolean {
  const { start, end } = halfSelectedEdges(slice);
  return start || end;
}

// Paste gets the repair the drop can't have. The slice is the same broken shape — copy across a
// callout's edge and the clipboard carries the box, `data-pm-slice` round-tripping the open depths
// that make it materialise — but the *reason* drops are refused doesn't apply: a paste deletes
// nothing at the source, so there is no join to walk into. Normalising is simply right here, and it
// leaves the paste doing what the gesture plainly meant: the text comes over, the box does not.
//
// Each half-selected edge is replaced by that callout's own children, which drops exactly the one
// level of depth the box occupied. Everything halfSelectedEdges leaves alone is left alone: a whole
// callout in the middle of the slice, or one cut on both sides, still pastes as it did.
function unwrapHalfSelectedCallouts(slice: Slice): Slice {
  const { start, end } = halfSelectedEdges(slice);
  if (!start && !end) return slice;
  const lastIndex = slice.content.childCount - 1;
  const children: PMNode[] = [];
  slice.content.forEach((child, _offset, index) => {
    if ((start && index === 0) || (end && index === lastIndex)) {
      child.content.forEach((grandChild) => children.push(grandChild));
    } else {
      children.push(child);
    }
  });
  return new Slice(
    Fragment.fromArray(children),
    start ? slice.openStart - 1 : slice.openStart,
    end ? slice.openEnd - 1 : slice.openEnd,
  );
}

// The nesting case, on the paste side. A callout the selection covered end-to-end is a real box and
// stays one — but pasted into either of CALLOUT_HOSTILE_ANCESTORS it is the same forbidden shape a
// drop is refused for, and Ctrl+V reached both just as easily as a drag did. Here the box is dropped
// and its contents kept, which is the paste-shaped answer: nothing was deleted to get here, so
// nothing is lost by letting the text land where the caret is.
//
// Every depth, not just the slice's top level. A callout can sit one or more levels down — copy a
// quote that holds one (`> > [!NOTE]`, which loads from stored markdown even though it can no
// longer be authored) and the slice is blockquote(callout(…)). wouldNestCallout looks at every
// descendant, so a shallow repair reported "this needs fixing" and then returned the slice
// untouched, and the paste nested the box after all — while the same slice dropped was refused.
//
// The one thing that must not move is a node on an open edge. openStart/openEnd count levels down
// the slice's first and last child, and removing a node on either path would leave those depths
// describing content that is no longer there — ProseMirror throws on the mismatch. So the rule is:
// a callout is removable only where both open counts have run out. `startOpen`/`endOpen` follow
// the two paths down (a single child can be on both, which is the cut-on-both-sides case), and
// anything off them is fair game however deep it is.
//
// Restructuring off-path subtrees is safe because `child.copy(inner)` keeps the node itself, so no
// path ever gets shorter. Splicing a callout's `block+` children into its parent stays
// schema-valid throughout: blockquote and callout are both `block+`, listItem is `paragraph block*`
// so a callout can only ever sit at index ≥ 1 there, and cells are paragraph-only so none lives in
// one. Text nodes end the recursion on their own — an empty content fragment comes back unchanged.
//
// Returns the same Fragment when nothing changed, which is what lets the caller keep its identity
// check and skip dispatching a redundant transaction.
function flattenCallouts(fragment: Fragment, openStart: number, openEnd: number): Fragment {
  const lastIndex = fragment.childCount - 1;
  const children: PMNode[] = [];
  let changed = false;
  fragment.forEach((child, _offset, index) => {
    const startOpen = index === 0 ? openStart : 0;
    const endOpen = index === lastIndex ? openEnd : 0;
    if (startOpen === 0 && endOpen === 0 && child.type.name === CALLOUT_NAME) {
      changed = true;
      flattenCallouts(child.content, 0, 0).forEach((grandChild) => children.push(grandChild));
      return;
    }
    const inner = flattenCallouts(
      child.content,
      Math.max(startOpen - 1, 0),
      Math.max(endOpen - 1, 0),
    );
    if (inner === child.content) {
      children.push(child);
      return;
    }
    changed = true;
    children.push(child.copy(inner));
  });
  return changed ? Fragment.fromArray(children) : fragment;
}

function flattenClosedCallouts(slice: Slice): Slice {
  const { content, openStart, openEnd } = slice;
  const flattened = flattenCallouts(content, openStart, openEnd);
  return flattened === content ? slice : new Slice(flattened, openStart, openEnd);
}

const calloutSliceGuardKey = new PluginKey('calloutSliceGuard');

// Both gestures that can hand the editor a callout nobody asked for, and the two different answers
// they get: a drop is refused, a paste is repaired. `handlePaste` rather than `transformPasted`
// because the two are not the same hook — prosemirror-view runs transformPasted over the *drag*
// slice too (handleDrop's `view.dragging.slice`, before any handleDrop prop sees it), so unwrapping
// there would quietly disarm the refusal above and hand the drop back its mangle.
export function calloutSliceGuard(): Plugin {
  return new Plugin({
    key: calloutSliceGuardKey,
    props: {
      handlePaste(view, _event, slice) {
        const { $from } = view.state.selection;
        const unwrapped = unwrapHalfSelectedCallouts(slice);
        // A whole box in the slice can't go into a callout or a quote either, same as a drop.
        const repaired = wouldNestCallout($from, unwrapped)
          ? flattenClosedCallouts(unwrapped)
          : unwrapped;
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
        // Asked first, and without looking at where the pointer is: a half-selected callout is
        // refused at every destination (see carriesHalfSelectedCallout).
        if (carriesHalfSelectedCallout(slice)) {
          event.preventDefault();
          return true;
        }
        const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
        if (!coords) return false;
        // resolveDropTarget, not the raw position: a move deletes the dragged range first, and for
        // a selection running out of a callout that deletion joins the callout to what follows —
        // which is how a drop that looked like it landed *outside* still nested (see drop-target.ts).
        // `moved` is prosemirror-view's own move-vs-copy verdict for *this* event, which is why it
        // is threaded through rather than re-read from view.dragging (stale since dragstart).
        if (!wouldNestCallout(resolveDropTarget(view, coords.pos, slice, moved), slice))
          return false;
        // Returning true makes ProseMirror preventDefault and skip the drop entirely, so the
        // dragged text stays where it was instead of being deleted from its source.
        event.preventDefault();
        return true;
      },
    },
  });
}
