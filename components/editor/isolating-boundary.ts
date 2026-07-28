import { Extension } from '@tiptap/core';
import type { CommandProps, Editor } from '@tiptap/core';
import type { Node as PMNode, NodeType, ResolvedPos } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

// A command body (call it from inside a single `editor.commands.command(...)`) for an `isolating`
// block `nodeType`: at the very start of the top-level block sitting directly after one, drop the
// caret into the *end* of that isolating block, rather than ProseMirror's default (which
// node-selects the whole box). Shared by the callout and code block — both are isolating, so their
// lower edge would otherwise leave a bare node-selection when you Backspace up into them. Returns
// true when it acted, so a node can compose it with its own Backspace behavior in one command.
//
// An *empty* following block carries no content that could corrupt the isolating node (unlike a
// non-empty one, which is left untouched so text is never absorbed into e.g. a code fence), so it
// is deleted outright here — matching blockquote's plain-join behavior, where the empty line
// simply disappears instead of surviving as a dangling paragraph below the box.
export function stepIntoPreviousIsolating(
  nodeType: NodeType,
  { state, tr, dispatch }: CommandProps,
): boolean {
  const { selection } = state;
  if (!selection.empty) return false;
  const { $from } = selection;
  // Caret must sit at the very start of a top-level block…
  if ($from.depth !== 1 || $from.parentOffset !== 0) return false;
  // …whose immediately preceding sibling is the isolating node.
  const index = $from.index(0);
  if (index === 0 || state.doc.child(index - 1).type !== nodeType) return false;
  if (dispatch) {
    const boundary = $from.before(1); // position between that node and this block
    if ($from.parent.content.size === 0) tr.delete(boundary, $from.after(1));
    tr.setSelection(TextSelection.near(tr.doc.resolve(boundary - 1), -1));
    tr.scrollIntoView();
  }
  return true;
}

// The Delete-direction mirror: at the very end of an isolating block `nodeType`'s content
// (however deeply the caret sits inside it — a code block's content is flat, a callout's is
// nested), a following top-level sibling that is empty carries nothing that could corrupt the
// isolating node, so it is deleted outright — the same cleanup stepIntoPreviousIsolating does
// for a dangling empty line, just approached from the opposite edge. A non-empty following
// sibling needs no handling here: prosemirror-commands' joinForward already refuses to cross an
// isolating boundary (its findCutAfter helper stops at one), so Delete there is already a no-op.
export function stepIntoNextIsolating(
  nodeType: NodeType,
  { state, tr, dispatch }: CommandProps,
): boolean {
  const { selection } = state;
  if (!selection.empty) return false;
  const { $from } = selection;
  // Caret must sit inside a top-level isolating node of this type…
  if ($from.depth < 1 || $from.node(1).type !== nodeType) return false;
  // …at the end of its own textblock…
  if ($from.parentOffset !== $from.parent.content.size) return false;
  // …with every ancestor down to (but not including) the isolating node itself the *last* child
  // of its parent — otherwise there is more content after the caret somewhere inside the node
  // (e.g. a callout's paragraph nested one level deeper than a code block's flat text; a plain
  // position-arithmetic shortcut would silently miscount that extra level).
  for (let depth = $from.depth; depth > 1; depth -= 1) {
    if ($from.index(depth - 1) !== $from.node(depth - 1).childCount - 1) return false;
  }
  // …with a following sibling that exists and is empty.
  const index = $from.index(0);
  if (index + 1 >= state.doc.childCount) return false;
  const next = state.doc.child(index + 1);
  if (next.content.size > 0) return false;
  if (dispatch) {
    const from = $from.after(1);
    tr.delete(from, from + next.nodeSize).scrollIntoView();
  }
  return true;
}

// ---------------------------------------------------------------------------
// Ranged replacement across an isolating edge
// ---------------------------------------------------------------------------

// `isolating` does not do what the two nodes above rely on it for. prosemirror-transform's
// isolating checks guard where a slice may be *placed*; they say nothing about the frontier a
// ranged **replacement** closes over. So a selection spanning a callout's or code block's edge
// corrupted the document on the most ordinary editing path there is — select a range, then press
// Backspace, press Delete, or type a single character:
//
//   • lower edge: the box swallowed the block below (for a code block, exactly the
//     prose-becomes-code failure `isolating` was added to prevent);
//   • upper edge: the box was destroyed and its surviving content absorbed into the paragraph
//     above as plain prose — losing a fence's language and filename with it.
//
// The fix is to clamp the replacement to the boundary rather than let it close over: delete
// inside the box and outside it as separate ranges, leaving the boundary standing.

type ClampedRange = { from: number; to: number };

// The outermost ancestor of `$pos` that is isolating and does *not* also contain `other` — the
// edge a replacement from `$pos` to `other` would otherwise close over. Null when there is none,
// which is the common case and the one that must stay on ProseMirror's own path.
//
// Shallowest-first, and `continue` rather than stop on an isolating ancestor that *does* contain
// `other`: a selection made wholly inside one callout has that callout as an ancestor of both
// endpoints and needs no clamping at all, but a code block nested inside it still does if only one
// endpoint is in the code block. Skipping past the containing box and carrying on inward is what
// finds that inner edge.
function isolatingCutDepth($pos: ResolvedPos, other: number): number | null {
  for (let depth = 1; depth <= $pos.depth; depth += 1) {
    if (!$pos.node(depth).type.spec.isolating) continue;
    if (other >= $pos.start(depth) && other <= $pos.end(depth)) continue;
    return depth;
  }
  return null;
}

// Split [from, to] into the ranges a replacement may delete without joining across an isolating
// edge — in ascending document order, or null when the range crosses no such edge (the caller must
// then leave the gesture to ProseMirror, which already does the right thing).
//
// Up to three pieces, and which of them exist depends on where the edges are:
//   1. inside the isolating node the range *starts* in, from `from` down to that node's content end;
//   2. everything between the two boxes, whole nodes only;
//   3. inside the isolating node the range *ends* in, from its content start up to `to`.
// Each piece is handed to `tr.delete` unchanged, so ProseMirror's own fitting still decides what
// happens *within* a piece — only the frontier between them is taken away from it.
//
// Pieces 1 and 3 are the boundary-preserving ones. Piece 2 was measured rather than assumed: with
// only one edge crossed it is asymmetric (a doc-level boundary at one end, inline content at the
// other), which is the shape that could plausibly have re-opened the box to absorb the leftover
// text and reproduced the very bug. It does not — the fitter closes the surviving textblock in
// place. Both directions are covered by the boundary specs.
export function clampedDeleteRanges(doc: PMNode, from: number, to: number): ClampedRange[] | null {
  const $from = doc.resolve(from);
  const $to = doc.resolve(to);
  const startDepth = isolatingCutDepth($from, to);
  const endDepth = isolatingCutDepth($to, from);
  if (startDepth === null && endDepth === null) return null;

  const ranges: ClampedRange[] = [];
  const middleFrom = startDepth === null ? from : $from.after(startDepth);
  const middleTo = endDepth === null ? to : $to.before(endDepth);
  if (startDepth !== null) ranges.push({ from, to: $from.end(startDepth) });
  // Empty whenever the two boxes are adjacent, or the range only ever crossed one edge and
  // nothing outside it was selected.
  if (middleFrom < middleTo) ranges.push({ from: middleFrom, to: middleTo });
  if (endDepth !== null) ranges.push({ from: $to.start(endDepth), to });
  return ranges;
}

// Apply the ranges to one transaction, last first so the earlier ones need no mapping. One
// transaction rather than several on purpose: undo across this edit was already correct (a single
// Ctrl+Z restores the document), and N dispatches would turn it into N undo steps.
function deleteClamped(tr: Transaction, ranges: ClampedRange[]): Transaction {
  for (let index = ranges.length - 1; index >= 0; index -= 1) {
    tr.delete(ranges[index].from, ranges[index].to);
  }
  return tr;
}

// The clamped ranges for the current selection, or null when the gesture needs no help.
//
// TextSelection only. That one check excludes the three selection kinds that must keep their own
// behavior: a CellSelection (prosemirror-tables deletes cell contents itself, and cells are
// isolating so every multi-cell selection would otherwise land here), an AllSelection (Ctrl+A then
// Backspace means "clear the document", boxes included), and a NodeSelection (a whole box picked
// up by the block drag handle really is one node being replaced).
function clampedSelectionRanges(state: EditorState): ClampedRange[] | null {
  const { selection } = state;
  if (!(selection instanceof TextSelection) || selection.empty) return null;
  return clampedDeleteRanges(state.doc, selection.from, selection.to);
}

// The deletion itself, as a command body: clamp the current selection and delete the pieces,
// leaving the caret where the selection started. False (and nothing dispatched) when the selection
// crosses no isolating edge, so every gesture below falls straight through to its normal handling.
export function deleteClampedSelection({ state, tr, dispatch }: CommandProps): boolean {
  const ranges = clampedSelectionRanges(state);
  if (!ranges) return false;
  if (dispatch) {
    deleteClamped(tr, ranges);
    // Nothing before the selection's start was touched, so that position survives the deletions;
    // `near` snaps it onto the nearest inline spot in what remains.
    tr.setSelection(TextSelection.near(tr.doc.resolve(state.selection.from)));
    tr.scrollIntoView();
  }
  return true;
}

const isolatingBoundaryKey = new PluginKey('isolatingBoundary');

// Typing over a boundary-spanning selection. `handleTextInput` is handed the range the input is
// about to replace, which for a plain keystroke is the selection — so the same clamp applies, with
// the character landing at the range's start (inside whichever box the selection began in).
function handleTextInputClamped(view: EditorView, from: number, to: number, text: string): boolean {
  const ranges = clampedDeleteRanges(view.state.doc, from, to);
  if (!ranges) return false;
  const tr = deleteClamped(view.state.tr, ranges);
  tr.insertText(text, from);
  tr.setSelection(TextSelection.near(tr.doc.resolve(from + text.length)));
  view.dispatch(tr.scrollIntoView());
  return true;
}

// Ctrl+X. prosemirror-view's own cut handler ends in a bare `tr.deleteSelection()`, which is the
// same ranged replacement as everything else here and corrupted the document the same way — and it
// is reachable from the context menu as well as the chord, so a keymap entry would not cover it.
//
// A custom `handleDOMEvents` handler runs before the built-in one and returning true skips it, so
// the copy half is mirrored here (`view.serializeForClipboard`, a public EditorView method) and the
// delete half goes through the clamp. prosemirror-view's IE/old-iOS `brokenClipboardAPI` fallback
// is deliberately not reproduced: without `clipboardData` this hands the event back to the built-in
// rather than reimplementing a hidden-element copy for browsers this editor does not target.
function handleCutClamped(view: EditorView, event: Event): boolean {
  const { clipboardData } = event as ClipboardEvent;
  if (!clipboardData) return false;
  const { selection } = view.state;
  const ranges = clampedSelectionRanges(view.state);
  if (!ranges) return false;
  const { dom, text } = view.serializeForClipboard(selection.content());
  event.preventDefault();
  clipboardData.clearData();
  clipboardData.setData('text/html', dom.innerHTML);
  clipboardData.setData('text/plain', text);
  const tr = deleteClamped(view.state.tr, ranges);
  tr.setSelection(TextSelection.near(tr.doc.resolve(selection.from)));
  view.dispatch(tr.scrollIntoView().setMeta('uiEvent', 'cut'));
  return true;
}

// The deletion rule, shared by every gesture that replaces a range. Registered once for the whole
// editor rather than per node: it reads `isolating` off the schema, so it covers the callout and
// the code block — the two nodes that claim the boundary — without either having to ask for it.
export const IsolatingBoundary = Extension.create({
  name: 'isolatingBoundary',

  addKeyboardShortcuts() {
    const del = ({ editor }: { editor: Editor }) => editor.commands.command(deleteClampedSelection);
    // Enter is a ranged replacement too — it replaced the selection and then split, which pulled
    // the following paragraph into the box just as Backspace did. Clamp first, then take the
    // default Enter behaviour on the caret that leaves behind; `first` reproduces baseKeymap's own
    // Enter chain so a caret left inside a code block still gets a newline rather than a block
    // split. One `chain()`, so it stays one transaction and therefore one undo step.
    //
    // The applies-here test is asked *before* the chain rather than by letting the first command
    // fail: a TipTap chain runs every step regardless of what an earlier one returned, and
    // dispatches whether or not they all succeeded — so a chain entered on an ordinary selection
    // would split the block, dispatch that, and still report false, handing the same Enter to the
    // next binding to act on all over again.
    const enter = ({ editor }: { editor: Editor }) => {
      if (!clampedSelectionRanges(editor.state)) return false;
      return editor
        .chain()
        .command(deleteClampedSelection)
        .first(({ commands }) => [
          () => commands.newlineInCode(),
          () => commands.createParagraphNear(),
          () => commands.liftEmptyBlock(),
          () => commands.splitBlock(),
        ])
        .run();
    };
    // The word-delete chords replace a non-empty selection exactly like the plain keys do — and
    // the code block binds all six itself (deleteSoleCodeChar), so all six have to answer here too.
    return {
      Backspace: del,
      Delete: del,
      'Mod-Backspace': del,
      'Mod-Delete': del,
      'Alt-Backspace': del,
      'Alt-Delete': del,
      Enter: enter,
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: isolatingBoundaryKey,
        props: {
          handleTextInput: handleTextInputClamped,
          handleDOMEvents: { cut: handleCutClamped },
        },
      }),
    ];
  },
});
