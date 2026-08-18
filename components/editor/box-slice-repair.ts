import { Fragment, Slice, type Node as PMNode } from '@tiptap/pm/model';

// The two repairs a *box* node needs when a slice carrying one enters the editor, written once and
// specialised per box. `callout-slice-guard.ts` and `details-slice-guard.ts` each hold one of these
// and the rules about *where* their box may go; those rules do not generalise and are not here.
//
// The two guards had these ninety lines twice. `docs/accordion-requirements.md` §6.2 recorded why
// they could not be shared — the callout splices a box's children up one level, which is valid for
// its `block+` content, while an accordion's `[detailsSummary, detailsContent]` may not live at the
// top level — and that was true of the code as written. It stopped being an obstacle once the
// accordion's answer became `detailsUnwrapped()`: the difference is now a function, which is to say
// a parameter.
//
// What is *not* a parameter, though it looked like one: where `dropOpenWrappers` sits relative to
// these. The callout guard composes it into its own `transformPasted` and the accordion guard never
// calls it, so the two run at different points of the pipeline — but the orderings all agree,
// because `dropOpenWrappers` acts only on a single child open past depth 1 at both ends, which is
// exactly the shape `halfSelectedEdges` below declines to touch. Measured in
// `slice-guard-composition.test.ts`, which is also the net this extraction was made against.

export type BoxSliceSpec = {
  // The node type this repair is about.
  nodeName: string;
  // The blocks a box becomes when it is taken apart. One level for a callout (`block+` children go
  // straight up); two for an accordion, whose title comes back as a paragraph ahead of its body.
  unwrap: (node: PMNode) => PMNode[];
  // How much of the open depth that box occupied goes with it. The same count as the levels
  // `unwrap` removes, and the reason it is stated rather than derived is that `unwrap` returns
  // blocks, not a depth.
  depthDrop: number;
  // Whether `flattenClosed` re-scans what it has just lifted out. The callout does — a callout
  // inside a callout loads from stored markdown (`> > [!NOTE]`) and both boxes have to come off.
  // The accordion does not, which is what it has always done; an accordion cannot nest in an
  // accordion, so the only shape this changes is a box carried inside the body being lifted, and
  // leaving that alone is the behaviour `slice-guard-composition.test.ts` pins.
  recurseIntoRemoved: boolean;
};

export type BoxSliceRepair = {
  // A box the selection entered part-way, taken off so its contents come over as blocks.
  unwrapHalfSelected: (slice: Slice) => Slice;
  // A box the selection covered end-to-end, taken off at every depth it is removable from.
  flattenClosed: (slice: Slice) => Slice;
};

export function createBoxSliceRepair(spec: BoxSliceSpec): BoxSliceRepair {
  const { nodeName, unwrap, depthDrop, recurseIntoRemoved } = spec;

  // "Half" is read off the open depths. openStart/openEnd say how deep the slice was cut at each
  // end, so a box at the first (or last) child position with a non-zero depth on that side was
  // entered mid-way by the selection. What makes it *materialise* is being cut on one side only:
  // the other side is a real node boundary, so ProseMirror has to keep the box to close it.
  //
  // A box open on both sides — the whole slice for a selection made wholly inside one — is not this
  // rule's business: `dropOpenWrappers` (slice-placement.ts) takes that wrapper off instead, and the
  // two never contend for the same slice. Neither is a box the selection covered end-to-end,
  // including the block drag handle's NodeSelection (openStart = openEnd = 0): that one really is a
  // box being moved, and where it may go is each guard's own question.
  function halfSelectedEdges(slice: Slice): { start: boolean; end: boolean } {
    const { content, openStart, openEnd } = slice;
    const first = content.firstChild;
    const last = content.lastChild;
    if (!first || !last) return { start: false, end: false };
    const start = openStart > 0 && first.type.name === nodeName;
    const end = openEnd > 0 && last.type.name === nodeName;
    if (content.childCount === 1 && start && end) return { start: false, end: false };
    return { start, end };
  }

  // Each half-selected edge is replaced by that box's own blocks, and the open depth on that side
  // drops by the levels those blocks came up through. Clamped at zero, since a slice cut at a block
  // boundary on that side has nothing left to close. Everything `halfSelectedEdges` leaves alone is
  // left alone: a whole box in the middle of the slice, or one cut on both sides, lands as it did.
  function unwrapHalfSelected(slice: Slice): Slice {
    const { start, end } = halfSelectedEdges(slice);
    if (!start && !end) return slice;
    const lastIndex = slice.content.childCount - 1;
    const children: PMNode[] = [];
    slice.content.forEach((child, _offset, index) => {
      if ((start && index === 0) || (end && index === lastIndex)) {
        unwrap(child).forEach((block) => children.push(block));
      } else {
        children.push(child);
      }
    });
    return new Slice(
      Fragment.fromArray(children),
      start ? Math.max(slice.openStart - depthDrop, 0) : slice.openStart,
      end ? Math.max(slice.openEnd - depthDrop, 0) : slice.openEnd,
    );
  }

  // Every depth, not just the slice's top level: a box can sit one or more levels down, since a
  // quote holding one loads from stored markdown even where it can no longer be authored. A shallow
  // repair would report "this needs fixing" and then hand the slice back untouched.
  //
  // The one thing that must not move is a node on an open edge. openStart/openEnd count levels down
  // the slice's first and last child, and removing a node on either path would leave those depths
  // describing content that is no longer there — ProseMirror throws on the mismatch. So a box is
  // removable only where both open counts have run out. `startOpen`/`endOpen` follow the two paths
  // down (a single child can be on both, which is the cut-on-both-sides case), and anything off them
  // is fair game however deep it is.
  //
  // Restructuring off-path subtrees is safe because `child.copy(inner)` keeps the node itself, so no
  // path ever gets shorter. Text nodes end the recursion on their own — an empty content fragment
  // comes back unchanged.
  //
  // Returns the same Fragment when nothing changed, which is what lets the caller keep its identity
  // check and skip dispatching a redundant transaction.
  function flatten(fragment: Fragment, openStart: number, openEnd: number): Fragment {
    const lastIndex = fragment.childCount - 1;
    const children: PMNode[] = [];
    let changed = false;
    fragment.forEach((child, _offset, index) => {
      const startOpen = index === 0 ? openStart : 0;
      const endOpen = index === lastIndex ? openEnd : 0;
      if (startOpen === 0 && endOpen === 0 && child.type.name === nodeName) {
        changed = true;
        const removed = unwrap(child);
        if (recurseIntoRemoved) {
          flatten(Fragment.fromArray(removed), 0, 0).forEach((block) => children.push(block));
        } else {
          removed.forEach((block) => children.push(block));
        }
        return;
      }
      const inner = flatten(child.content, Math.max(startOpen - 1, 0), Math.max(endOpen - 1, 0));
      if (inner === child.content) {
        children.push(child);
        return;
      }
      changed = true;
      children.push(child.copy(inner));
    });
    return changed ? Fragment.fromArray(children) : fragment;
  }

  function flattenClosed(slice: Slice): Slice {
    const { content, openStart, openEnd } = slice;
    const flattened = flatten(content, openStart, openEnd);
    return flattened === content ? slice : new Slice(flattened, openStart, openEnd);
  }

  return { unwrapHalfSelected, flattenClosed };
}
