import { Fragment, Slice, type Node as PMNode, type ResolvedPos } from '@tiptap/pm/model';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { SUMMARY_SECTION_TITLES, type SummarySectionKind } from '@/lib/summary-types';

// The placement rules of the まとめ and TL;DR blocks (docs/summary-requirements.md §3.2), as pure
// functions over documents and slices, apart from the node definitions in summary-extension.ts so
// that vitest can hold them against the real schema.
//
// Neither rule fits a content expression: "anywhere, but at most one" and "last, apart from blank
// lines and the footnotes" both depend on the rest of the document. So the schema allows what
// stored markdown may contain, and these decide what an edit may leave behind.

export const SUMMARY_NAME = 'summary';
export const TLDR_NAME = 'tldr';
export const SECTION_NAMES: Record<SummarySectionKind, string> = {
  good: 'summaryGood',
  bad: 'summaryBad',
};

// Both boxes answer the same two rules: one per post, and only at the top level.
export const BOX_NAMES = [SUMMARY_NAME, TLDR_NAME] as const;

// No inserted block fits inside either box: the 総評 and a TL;DR are `paragraph+`, and a section's
// list items hold text only (`sectionsHoldOnlyLists`). Asked with selectionTouches by the block
// insert commands, so `can()` — and with it every menu — refuses there instead of offering a row
// the rules would then refuse.
export const BLOCK_REFUSING_BOXES = BOX_NAMES;
export type BoxName = (typeof BOX_NAMES)[number];

function isBox(node: PMNode): boolean {
  return (BOX_NAMES as readonly string[]).includes(node.type.name);
}

export function sectionKind(node: PMNode): SummarySectionKind | null {
  if (node.type.name === SECTION_NAMES.good) return 'good';
  if (node.type.name === SECTION_NAMES.bad) return 'bad';
  return null;
}

/**
 * The ordinary blocks a box becomes when it cannot stay a box (a second one, or one out of place).
 * Nothing written is lost: a TL;DR is its paragraphs, a まとめ is its 総評 followed, for each section
 * it has, by the section's title as a bold paragraph and its list — the words the published page
 * showed as chrome come back as text, so the demoted blocks still say which list is which (§7).
 */
export function demotedBlocks(node: PMNode): PMNode[] {
  const { schema } = node.type;
  const out: PMNode[] = [];
  node.forEach((child) => {
    const kind = sectionKind(child);
    if (!kind) {
      out.push(child);
      return;
    }
    const title = schema.text(SUMMARY_SECTION_TITLES[kind], [schema.marks.bold.create()]);
    out.push(schema.nodes.paragraph.create(null, title));
    child.forEach((block) => out.push(block));
  });
  return out;
}

type Located = { node: PMNode; pos: number };

/**
 * The boxes in `doc` that break the rules as loaded: every one after the first of its type, and
 * every one not directly under the document. The first top-level one of each type is kept, in
 * document order (§3.2).
 */
export function boxesToDemote(doc: PMNode): Located[] {
  const kept = new Set<string>();
  const out: Located[] = [];
  doc.descendants((node, pos, parent) => {
    if (!isBox(node)) return true;
    if (parent === doc && !kept.has(node.type.name)) {
      kept.add(node.type.name);
    } else {
      out.push({ node, pos });
    }
    // A box holds paragraphs and lists only, so nothing inside can be another box.
    return false;
  });
  return out;
}

/** Demotes `boxesToDemote(tr.doc)` in place. True when it changed anything. */
export function demoteExtraBoxes(tr: Transaction): boolean {
  const targets = boxesToDemote(tr.doc);
  // From the end, so the positions still ahead stay valid.
  for (const { node, pos } of [...targets].reverse()) {
    tr.replaceWith(pos, pos + node.nodeSize, demotedBlocks(node));
  }
  return targets.length > 0;
}

function isBlankParagraph(node: PMNode): boolean {
  return node.type.name === 'paragraph' && node.content.size === 0;
}

/**
 * Does anything written follow the まとめ? Only blank paragraphs (TrailingNode keeps one there, and
 * it is the caret's way out) and the footnote section (pinned last by the document's content
 * expression, docs/footnote-requirements.md §3) may.
 */
export function summaryNotLast(doc: PMNode): boolean {
  let seen = false;
  let broken = false;
  doc.forEach((child) => {
    if (seen && !isBlankParagraph(child) && child.type.name !== 'footnoteSection') broken = true;
    if (child.type.name === SUMMARY_NAME) seen = true;
  });
  return broken;
}

// The blocks a section's list may hold: its own structure, and a nested list. Anything else — a
// code block, a table, a callout — is what "箇条書きだけ" refuses. A listItem is `paragraph block*`,
// so the schema alone would let them in.
const SECTION_BLOCKS = new Set(['bulletList', 'listItem', 'paragraph']);

export function sectionsHoldOnlyLists(doc: PMNode): boolean {
  let ok = true;
  doc.descendants((node) => {
    if (!ok) return false;
    if (!sectionKind(node)) return true;
    node.descendants((inner) => {
      if (inner.isBlock && !SECTION_BLOCKS.has(inner.type.name)) ok = false;
      return ok;
    });
    return false;
  });
  return ok;
}

type BoxCounts = Record<BoxName, number> & { nested: number };

function countBoxes(doc: PMNode): BoxCounts {
  const counts: BoxCounts = { summary: 0, tldr: 0, nested: 0 };
  doc.descendants((node, _pos, parent) => {
    if (!isBox(node)) return true;
    counts[node.type.name as BoxName] += 1;
    if (parent !== doc) counts.nested += 1;
    return false;
  });
  return counts;
}

export type SummaryRuleBreak =
  | 'duplicate-summary'
  | 'duplicate-tldr'
  | 'nested'
  | 'not-last'
  | 'section-block';

/**
 * The rule an edit from `before` to `after` breaks, or null. Only a rule the edit *newly* breaks
 * counts: a post saved before these rules may already break one, and it must stay editable rather
 * than freeze (§3.2) — its extra boxes are demoted on load, and a まとめ with text after it is
 * flagged, not moved.
 */
export function newRuleBreak(before: PMNode, after: PMNode): SummaryRuleBreak | null {
  const was = countBoxes(before);
  const now = countBoxes(after);
  if (now.summary > Math.max(was.summary, 1)) return 'duplicate-summary';
  if (now.tldr > Math.max(was.tldr, 1)) return 'duplicate-tldr';
  if (now.nested > was.nested) return 'nested';
  if (!summaryNotLast(before) && summaryNotLast(after)) return 'not-last';
  if (sectionsHoldOnlyLists(before) && !sectionsHoldOnlyLists(after)) return 'section-block';
  return null;
}

// A position below the top level. The enclosing textblock does not count: ProseMirror splits it and
// a block lands beside it — the same test as `wouldNestDetails`.
function nestedAt($pos: ResolvedPos): boolean {
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    if (!$pos.node(depth).isTextblock) return true;
  }
  return false;
}

function sliceBoxNames(slice: Slice): Set<string> {
  const names = new Set<string>();
  slice.content.descendants((node) => {
    if (isBox(node)) names.add(node.type.name);
    return !isBox(node);
  });
  return names;
}

/**
 * The rule a drop at `$target` would break, or null. `$target` is where the drop lands, resolved in
 * the document the drop leaves behind (`resolveDropTarget`), and `moved` whether the drag is a move.
 * Asked by the drop handler and by the drop cursor, so the cursor is hidden exactly where the drop
 * is refused (docs/summary-requirements.md §3.2).
 */
export function dropRuleBreak(
  $target: ResolvedPos,
  slice: Slice,
  moved: boolean,
): SummaryRuleBreak | null {
  const doc = $target.doc;
  let summaryIndex = -1;
  doc.forEach((child, _offset, index) => {
    if (child.type.name === SUMMARY_NAME && summaryIndex === -1) summaryIndex = index;
  });
  // Anything landing below the まとめ, a block or text into the blank line kept there.
  if (summaryIndex !== -1 && $target.index(0) > summaryIndex) return 'not-last';
  const names = sliceBoxNames(slice);
  if (names.size === 0) return null;
  if (nestedAt($target)) return 'nested';
  let found: SummaryRuleBreak | null = null;
  doc.descendants((node) => {
    // A move has already taken its box out of `doc`; a copy has not.
    if (!moved && names.has(node.type.name) && isBox(node)) {
      found = node.type.name === SUMMARY_NAME ? 'duplicate-summary' : 'duplicate-tldr';
    }
    return found === null && !isBox(node);
  });
  return found;
}

export function sliceCarriesBox(slice: Slice): boolean {
  let found = false;
  slice.content.descendants((node) => {
    if (isBox(node)) found = true;
    return !found;
  });
  return found;
}

// A box's children with its sections opened too, for a box the selection entered part-way: what
// was selected comes over as blocks, and the section titles, which are chrome and were never
// selected text, do not.
function openedChildren(node: PMNode): PMNode[] {
  const out: PMNode[] = [];
  node.forEach((child) => {
    if (sectionKind(child)) child.forEach((block) => out.push(block));
    else out.push(child);
  });
  return out;
}

// How much open depth an edge loses when its box is opened: the box, plus the section when the
// edge runs through one.
function edgeDrop(node: PMNode, edge: 'start' | 'end'): number {
  const child = edge === 'start' ? node.firstChild : node.lastChild;
  return child && sectionKind(child) ? 2 : 1;
}

/**
 * A box the selection entered part-way — cut on one side only, so ProseMirror would rebuild it at
 * the destination — is opened, as `createBoxSliceRepair` does for the callout and the accordion.
 * Written apart from it because the depth a まとめ loses depends on the edge: one level through the
 * 総評, two through a section. A box open on both sides with nothing beside it is
 * `dropOpenWrappers`'s case (slice-placement.ts) and is left alone.
 */
export function unwrapHalfSelectedBoxes(slice: Slice): Slice {
  const { content, openStart, openEnd } = slice;
  const first = content.firstChild;
  const last = content.lastChild;
  if (!first || !last) return slice;
  let start = openStart > 0 && isBox(first);
  let end = openEnd > 0 && isBox(last);
  if (content.childCount === 1 && start && end) start = end = false;
  if (!start && !end) return slice;
  const lastIndex = content.childCount - 1;
  const children: PMNode[] = [];
  content.forEach((child, _offset, index) => {
    if ((start && index === 0) || (end && index === lastIndex)) {
      openedChildren(child).forEach((block) => children.push(block));
    } else {
      children.push(child);
    }
  });
  return new Slice(
    Fragment.fromArray(children),
    start ? Math.max(openStart - edgeDrop(first, 'start'), 0) : openStart,
    end ? Math.max(openEnd - edgeDrop(last, 'end'), 0) : openEnd,
  );
}

/**
 * Every whole box in the slice demoted (`demotedBlocks`), at every depth where it can be removed —
 * a node on an open edge cannot move without the open depths describing missing content, the rule
 * `createBoxSliceRepair`'s flatten states. Returns the same slice when nothing changed.
 */
export function demoteBoxesInSlice(slice: Slice): Slice {
  function walk(fragment: Fragment, openStart: number, openEnd: number): Fragment {
    const lastIndex = fragment.childCount - 1;
    const children: PMNode[] = [];
    let changed = false;
    fragment.forEach((child, _offset, index) => {
      const startOpen = index === 0 ? openStart : 0;
      const endOpen = index === lastIndex ? openEnd : 0;
      if (startOpen === 0 && endOpen === 0 && isBox(child)) {
        changed = true;
        demotedBlocks(child).forEach((block) => children.push(block));
        return;
      }
      const inner = walk(child.content, Math.max(startOpen - 1, 0), Math.max(endOpen - 1, 0));
      if (inner !== child.content) changed = true;
      children.push(inner === child.content ? child : child.copy(inner));
    });
    return changed ? Fragment.fromArray(children) : fragment;
  }
  const content = walk(slice.content, slice.openStart, slice.openEnd);
  return content === slice.content ? slice : new Slice(content, slice.openStart, slice.openEnd);
}

/**
 * The slice a paste should place: as copied when that breaks no rule, otherwise with its boxes
 * demoted. Asked of the result rather than predicted, since whether a pasted まとめ can stay one
 * depends on where it lands and on what the selection it replaces removes (§3.2).
 *
 * `place` builds the paste's transaction for a slice; it is a parameter so this stays free of the
 * view.
 */
export function pasteSlice(
  state: EditorState,
  slice: Slice,
  place: (slice: Slice) => Transaction,
): Slice {
  if (!sliceCarriesBox(slice)) return slice;
  const tried = place(slice);
  const broken = newRuleBreak(state.doc, tried.doc);
  return broken === null || broken === 'section-block' ? slice : demoteBoxesInSlice(slice);
}
