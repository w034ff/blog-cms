import { Slice, type Node as PMNode, type ResolvedPos } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { createBoxSliceRepair } from './box-slice-repair';
import { resolveDropTarget } from './drop-target';
import { asPaste, replaceSelectionClamped } from './isolating-boundary';

// What a *slice* carrying an accordion may do — the questions calloutSliceGuard answers, with
// different answers: an accordion may only be placed at the top level
// (docs/accordion-requirements.md §6.3), and its unwrap goes two levels (§6.2).
export const DETAILS_NAME = 'details';

// Would the slice put a whole accordion anywhere but the top level? The test is "is any ancestor a
// container", not a list of hostile types, so a block node added later is covered without being
// named. The enclosing textblock does not count: ProseMirror splits it and the accordion lands
// beside it.
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

// How an accordion is taken apart when a slice must lose the box. Its children are
// `[detailsSummary, detailsContent]`, neither valid at the top level, so the unwrap goes two levels
// (§6.2): the body's blocks survive and a non-empty title becomes a paragraph ahead of them. This
// matches `unsetDetails` from the keyboard, including dropping an empty title (§7.5), so a reader
// sees the same result either way — keep the two in step.
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

// How these fields differ from the callout's: docs/accordion-requirements.md §6.2. `depthDrop: 2`
// because both `details` and `detailsContent` go with the unwrap; no recursion because an accordion
// cannot nest in an accordion.
const repair = createBoxSliceRepair({
  nodeName: DETAILS_NAME,
  unwrap: (node) => detailsUnwrapped(node, node.type.schema),
  depthDrop: 2,
  recurseIntoRemoved: false,
});

export const unwrapHalfSelectedDetails = repair.unwrapHalfSelected;

// The paste-side answer to a whole accordion headed somewhere it may not go: the box is dropped and
// its contents kept at the caret. Every depth, since loaded markdown can put one inside a quote.
export const flattenClosedDetails = repair.flattenClosed;

// Is `$pos` inside an accordion's title? Asked of every ancestor rather than of `$pos.parent`,
// because a drop position resolved by `resolveDropTarget` can sit at the title's edge rather than
// in its text.
export function isInDetailsTitle($pos: ResolvedPos): boolean {
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    if ($pos.node(depth).type.name === 'detailsSummary') return true;
  }
  return false;
}

// May this slice enter a title? `detailsSummary` is `text*`, and ProseMirror makes room for what
// will not fit by splitting the accordion (docs/accordion-requirements.md §6.6, §6.8), so this is
// asked of the slice before it is placed. Text selected within one paragraph must still flow in.
// Stated as what the title *accepts*, so a block node added later is covered without being named.
//
// **Block structure only; inline atoms are let through deliberately.** Those belong to the
// footnote's placement guard (§6.5), which degrades a pasted reference to text rather than
// refusing; answering here first would take that away. A new inline node type means reading §6.5.
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

// Named for the destination, like the callout's refusal (§7.3).
const DETAILS_NESTING_BLOCKED =
  'アコーディオンは引用やリスト、コールアウト、表の中には入れられません';

// Names what cannot go in rather than saying "text only", which reads as a contradiction to an
// author holding two paragraphs of text; a wording about 改行 would be false for a node-selected
// paragraph or a pasted table (§6.8). 「アコーディオンのタイトル」 matches the other guards (§7.3).
const DETAILS_TITLE_NO_BLOCKS = 'アコーディオンのタイトルには段落やブロックを入れられません';

export function detailsSliceGuard(notify: (message: string) => void): Plugin {
  return new Plugin({
    key: detailsSliceGuardKey,
    props: {
      // Position-independent, so it rides the hook prosemirror-view also runs over the drag slice.
      // Order against the callout guard's transformPasted does not matter: disjoint node types.
      transformPasted: unwrapHalfSelectedDetails,
      handlePaste(view, _event, slice) {
        const { $from } = view.state.selection;
        // The title first: a slice headed there never reaches a position a later repair could see
        // (§6.8). The caret comes from `state`, not the DOM, which runs ~20ms ahead after a click.
        if (isInDetailsTitle($from) && !titleAcceptsSlice(slice)) {
          notify(DETAILS_TITLE_NO_BLOCKS);
          return true;
        }
        if (!wouldNestDetails($from, slice)) return false;
        const repaired = flattenClosedDetails(slice);
        if (repaired === slice) return false;
        view.dispatch(asPaste(replaceSelectionClamped(view.state, repaired)));
        return true;
      },
      handleDrop(view, event, slice, moved) {
        const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
        if (!coords) return false;
        const $target = resolveDropTarget(view, coords.pos, slice, moved);
        // Same rule as the paste, asked of the pointer: at drop time `state.selection` is still the
        // dragged range.
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
