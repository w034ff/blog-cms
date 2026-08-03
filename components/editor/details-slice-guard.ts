import { Fragment, Slice, type Node as PMNode, type ResolvedPos } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { resolveDropTarget } from './drop-target';
import { replaceSelectionClamped } from './isolating-boundary';

// What a *slice* carrying an accordion may do — the same two questions calloutSliceGuard answers,
// but neither answer transfers, which is why this is its own file rather than a second type name
// in that one.
//
// The placement rule differs: a callout is refused inside a quote or another callout, while an
// accordion may only ever be placed at the document's top level (§6.3). And the repair differs in
// a way that would be a schema violation if it were shared — see unwrapHalfSelectedDetails.
export const DETAILS_NAME = 'details';

// Would the slice put an accordion anywhere but the top level? A slice carries a whole accordion
// when the block drag handle's NodeSelection picked one up, or when a selection swallowed one
// end-to-end on its way past.
//
// The test is "is any ancestor a container", not a list of hostile types. A drop into a top-level
// paragraph is fine — ProseMirror splits the paragraph and the accordion lands beside it — so the
// textblock the pointer is inside does not count; anything above it does. Written this way, a
// block node added to this editor later is covered without being named.
export function wouldNestDetails($pos: ResolvedPos, slice: Slice): boolean {
  let carriesDetails = false;
  slice.content.descendants((node) => {
    if (node.type.name === DETAILS_NAME) carriesDetails = true;
  });
  if (!carriesDetails) return false;
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    if (!$pos.node(depth).isTextblock) return true;
  }
  return false;
}

// A selection that crosses an accordion's edge hands the drag an accordion node the author never
// meant to move — the same problem halfSelectedEdges settles for the callout, and the same answer:
// the box comes off, its contents come over.
//
// The repair itself cannot be shared, and this is the trap the design document calls out. The
// callout's version splices `child.content` one level into the parent fragment, which is valid
// because a callout is `block+`. An accordion's children are `[detailsSummary, detailsContent]`,
// and neither may live at the top level: splicing them up produces a document ProseMirror refuses.
//
// So the unwrap goes two levels — the *body's* children are what survive — and the title has to be
// answered separately, since it is text that would otherwise vanish. It becomes a paragraph ahead
// of the body, which is what `unsetDetails` already does when an accordion is dissolved from the
// keyboard; a reader of the resulting document sees the same thing either way.
function detailsUnwrapped(details: PMNode, schema: PMNode['type']['schema']): PMNode[] {
  const out: PMNode[] = [];
  details.forEach((child) => {
    if (child.type.name === 'detailsSummary') {
      if (child.content.size > 0) out.push(schema.nodes.paragraph.create(null, child.content));
      return;
    }
    child.forEach((block) => out.push(block));
  });
  return out;
}

// "Half" is read off the open depths, exactly as the callout guard reads them: an accordion at the
// first (or last) child position with a non-zero depth on that side was entered part-way by the
// selection. One cut on both sides is not this rule's business — dropOpenWrappers (slice-placement)
// has already taken that wrapper off before any of this runs.
function halfSelectedEdges(slice: Slice): { start: boolean; end: boolean } {
  const { content, openStart, openEnd } = slice;
  const first = content.firstChild;
  const last = content.lastChild;
  if (!first || !last) return { start: false, end: false };
  const start = openStart > 0 && first.type.name === DETAILS_NAME;
  const end = openEnd > 0 && last.type.name === DETAILS_NAME;
  if (content.childCount === 1 && start && end) return { start: false, end: false };
  return { start, end };
}

export function unwrapHalfSelectedDetails(slice: Slice): Slice {
  const { start, end } = halfSelectedEdges(slice);
  if (!start && !end) return slice;
  const lastIndex = slice.content.childCount - 1;
  const children: PMNode[] = [];
  slice.content.forEach((child, _offset, index) => {
    if ((start && index === 0) || (end && index === lastIndex)) {
      detailsUnwrapped(child, child.type.schema).forEach((block) => children.push(block));
    } else {
      children.push(child);
    }
  });
  // Both open depths drop by two, not one: the slice was cut through `details` *and*
  // `detailsContent`, and both of those levels are gone now. Clamped at zero, since a slice cut at
  // a block boundary on that side has nothing left to close.
  return new Slice(
    Fragment.fromArray(children),
    start ? Math.max(slice.openStart - 2, 0) : slice.openStart,
    end ? Math.max(slice.openEnd - 2, 0) : slice.openEnd,
  );
}

// The paste-side answer to a *whole* accordion headed somewhere it may not go: the box is dropped
// and its contents kept, which is what a paste should do — the caret is where the text was asked
// for, and there is no second place it could land. Every depth, since an accordion can sit inside
// a quote in loaded markdown (legal to store, refused to author).
//
// A node on an open edge must not be removed: openStart/openEnd describe paths down the slice's
// first and last child, and shortening one leaves those counts pointing at content that is no
// longer there. So an accordion is removable only where both counts have run out.
function flattenDetails(fragment: Fragment, openStart: number, openEnd: number): Fragment {
  const lastIndex = fragment.childCount - 1;
  const children: PMNode[] = [];
  let changed = false;
  fragment.forEach((child, _offset, index) => {
    const startOpen = index === 0 ? openStart : 0;
    const endOpen = index === lastIndex ? openEnd : 0;
    if (startOpen === 0 && endOpen === 0 && child.type.name === DETAILS_NAME) {
      changed = true;
      detailsUnwrapped(child, child.type.schema).forEach((block) => children.push(block));
      return;
    }
    const inner = flattenDetails(
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

function flattenClosedDetails(slice: Slice): Slice {
  const { content, openStart, openEnd } = slice;
  const flattened = flattenDetails(content, openStart, openEnd);
  return flattened === content ? slice : new Slice(flattened, openStart, openEnd);
}

const detailsSliceGuardKey = new PluginKey('detailsSliceGuard');

// Named for the destination, like the callout's refusal: the author is holding the content, so
// what they need to know is where it may not go. §7.3.
const DETAILS_NESTING_BLOCKED = '折りたたみは引用やリスト、コールアウト、表の中には入れられません';

export function detailsSliceGuard(notify: (message: string) => void): Plugin {
  return new Plugin({
    key: detailsSliceGuardKey,
    props: {
      // Position-independent, so it rides the hook prosemirror-view runs over the drag slice as
      // well as the clipboard one. Registered here rather than composed into the callout guard's
      // transformPasted: prosemirror-view runs every registered one, and these two touch disjoint
      // node types, so their order does not matter.
      transformPasted: unwrapHalfSelectedDetails,
      handlePaste(view, _event, slice) {
        const { $from } = view.state.selection;
        if (!wouldNestDetails($from, slice)) return false;
        const repaired = flattenClosedDetails(slice);
        if (repaired === slice) return false;
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
        if (!wouldNestDetails(resolveDropTarget(view, coords.pos, slice, moved), slice)) {
          return false;
        }
        notify(DETAILS_NESTING_BLOCKED);
        event.preventDefault();
        return true;
      },
    },
  });
}
