import { Fragment, Slice, type Node as PMNode } from '@tiptap/pm/model';

// The two repairs a *box* node needs when a slice carrying one enters the editor, written once and
// specialised per box. `callout-slice-guard.ts` and `details-slice-guard.ts` each hold one of these
// and the rules about *where* their box may go; those rules do not generalise and are not here.
//
// The four ways the two boxes differ are the fields of BoxSliceSpec (docs/accordion-requirements.md
// §6.2). Where `dropOpenWrappers` runs relative to these is not a parameter: it acts only on a
// single child open past depth 1 at both ends, exactly the shape `halfSelectedEdges` declines, so
// every ordering agrees (slice-guard-composition.test.ts).

export type BoxSliceSpec = {
  // The node type this repair is about.
  nodeName: string;
  // The blocks a box becomes when it is taken apart. One level for a callout (`block+` children go
  // straight up); two for an accordion, whose title comes back as a paragraph ahead of its body.
  unwrap: (node: PMNode) => PMNode[];
  // How much open depth goes with the box: the levels `unwrap` removes, stated because `unwrap`
  // returns blocks, not a depth.
  depthDrop: number;
  // Whether `flattenClosed` re-scans what it has just lifted out. The callout does, because
  // `> > [!NOTE]` loads as a callout in a callout; the accordion does not.
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

  // A box at the first (or last) child with a non-zero open depth on that side was entered
  // mid-way; cut on one side only, ProseMirror has to keep it to close the real boundary on the
  // other. A box open on both sides is `dropOpenWrappers`'s case, and a closed one (openStart =
  // openEnd = 0, e.g. a drag-handle NodeSelection) is a box really being moved.
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

  // Each half-selected edge becomes the box's blocks, and the open depth on that side drops by
  // `depthDrop`, clamped at zero.
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

  // Every depth, since a quote holding a box loads from stored markdown. A node on an open edge must
  // not move: the open depths would then describe missing content and ProseMirror throws. So a box
  // is removable only where both open counts have run out; `startOpen`/`endOpen` follow the two
  // edge paths down. `child.copy(inner)` keeps each node, so no path gets shorter.
  //
  // Returns the same Fragment when nothing changed, so callers can skip a redundant dispatch.
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
