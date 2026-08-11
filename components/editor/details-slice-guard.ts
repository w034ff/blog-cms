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
// of the body, which is what `unsetDetails` does when an accordion is dissolved from the keyboard;
// a reader of the resulting document sees the same thing either way. An *empty* title is where the
// two used to disagree — the size check below drops it, the official command kept it as an empty
// paragraph — so details-extension.ts now overrides that case to read the rule the way this does
// (§7.5). Keep the two in step: this is the copy that was right.
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

// Is `$pos` inside an accordion's title? Asked of every ancestor rather than of `$pos.parent`,
// because a drop position resolved by `resolveDropTarget` can sit at the title's edge rather than
// in its text.
export function isInDetailsTitle($pos: ResolvedPos): boolean {
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    if ($pos.node(depth).type.name === 'detailsSummary') return true;
  }
  return false;
}

// May this slice enter a title? `detailsSummary` is `text*`, and ProseMirror does not refuse what
// will not fit — it *makes room*, splitting the accordion in two and growing a second, untitled one
// from the remainder (docs/accordion-requirements.md §6.6, §6.8). So the question has to be asked
// before the slice is placed, and asked of the slice rather than of the position: a selection made
// *within* one paragraph carries nothing but inline content and lands correctly as text, which is a
// gesture authors use and this must not take away. It is the moment a slice crosses a block
// boundary that it starts carrying structure.
//
// The rule is stated as what the title *accepts* rather than as a list of what it refuses, so a
// block node added to this editor later is covered without being named — the same reasoning §6.3
// gives for writing the placement rule as `depth === 1`.
//
// **This asks about block structure only, and deliberately lets an inline atom through.** A `text*`
// title tears on one of those too, but that question already belongs to the footnote's placement
// guard (§6.5), which answers it *better* than a refusal: on a paste it degrades the reference to
// literal text so the author's words still land, and on a drop it refuses with a message naming the
// footnote. Answering here first would take both away — measured, it turned two footnote specs red.
// One question per guard: this one owns block structure, §6.5's owns inline nodes. When an inline
// node type is added, §6.5 is the section to read, not this one.
export function titleAcceptsSlice(slice: Slice): boolean {
  const { content, openStart, openEnd } = slice;
  if (content.childCount === 0) return false;
  // Bare inline content — a plain-text paste can arrive already unwrapped.
  let allInline = true;
  content.forEach((node) => {
    if (!node.isInline) allInline = false;
  });
  if (allInline) return true;
  // Otherwise the only shape that flows in is one textblock opened on both sides — the copy of a
  // range inside a single paragraph. Two children means the selection crossed a block boundary;
  // a closed side means a whole block was taken, which is a block wherever it is put.
  if (content.childCount !== 1 || openStart === 0 || openEnd === 0) return false;
  return content.firstChild?.isTextblock ?? false;
}

const detailsSliceGuardKey = new PluginKey('detailsSliceGuard');

// Named for the destination, like the callout's refusal: the author is holding the content, so
// what they need to know is where it may not go. §7.3.
const DETAILS_NESTING_BLOCKED =
  'アコーディオンは引用やリスト、コールアウト、表の中には入れられません';

// Names the structures, like the nesting refusal above and unlike a positive "text only" rule.
// 「文字しか入れられません」 was the first wording and it misfires exactly when it appears: what the
// author is holding usually *is* text to them — two paragraphs of it — so being told that only text
// may go in reads as a contradiction. Naming what cannot go in is true of all three refused shapes,
// including the two that carry no line break at all: a whole paragraph taken by a node selection,
// and a pasted callout or table. A wording built around 改行 was considered and rejected for that
// reason — it would be plainly false in those two cases (§6.8).
// 「アコーディオンのタイトル」 is what the footnote guard and the image refusal already call this
// place (§7.3: one feature, one name).
const DETAILS_TITLE_NO_BLOCKS = 'アコーディオンのタイトルには段落やブロックを入れられません';

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
        // The title first: it refuses more than the nesting rule does, and a slice headed there
        // never reaches a position where a later repair could see it (§6.8 — the same blindness
        // that made the footnote need its own handlePaste). The caret is read from `state`, never
        // from the DOM: a click places the DOM caret ~20ms ahead of the state, and a Ctrl+V inside
        // that window would be judged against where the caret used to be.
        if (isInDetailsTitle($from) && !titleAcceptsSlice(slice)) {
          notify(DETAILS_TITLE_NO_BLOCKS);
          return true;
        }
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
        const $target = resolveDropTarget(view, coords.pos, slice, moved);
        // Same rule as the paste above, asked of where the pointer is rather than of the caret —
        // at drop time `state.selection` is still the *dragged* range. A drag whose selection
        // crossed a paragraph boundary is the reachable form of this (verified by hand in a real
        // browser; the harness cannot start an in-editor drag, see §6.8).
        if (isInDetailsTitle($target) && !titleAcceptsSlice(slice)) {
          notify(DETAILS_TITLE_NO_BLOCKS);
          event.preventDefault();
          return true;
        }
        if (!wouldNestDetails($target, slice)) return false;
        notify(DETAILS_NESTING_BLOCKED);
        event.preventDefault();
        return true;
      },
    },
  });
}
