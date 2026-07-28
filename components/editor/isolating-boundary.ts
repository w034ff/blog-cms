import { Extension } from '@tiptap/core';
import type { CommandProps, Editor } from '@tiptap/core';
import type { Node as PMNode, NodeType, ResolvedPos, Slice } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { isInTable } from '@tiptap/pm/tables';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { dropPoint } from '@tiptap/pm/transform';
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

// The *innermost* ancestor of `$pos` that is isolating and does not also contain `other` — the box
// the endpoint really sits in, and so the one whose content edge a deletion may run to. Null when
// there is none, which is the common case and the one that must stay on ProseMirror's own path.
//
// `continue` rather than stop on an isolating ancestor that *does* contain `other`: a selection made
// wholly inside one callout has that callout as an ancestor of both endpoints and needs no clamping
// at all, but a code block nested inside it still does if only one endpoint is in the code block.
// Skipping past the containing box and carrying on inward is what finds that inner edge.
//
// Innermost rather than outermost, which is where the table bug was. A callout and a code block are
// each the only isolating node on their branch, so the distinction never showed; a table has two —
// @tiptap/extension-table marks `table` isolating as well as the cells — and taking the outer one
// made the deletion run to the *table's* content edge, i.e. from the first row. Selecting from the
// paragraph above into a body cell and pressing Backspace therefore deleted the header row, and a
// headerless table has no GFM pipe form, so the post saved as raw HTML (issue #7). The cell is the
// box that endpoint is in; the table is only the frame around it, which piece 2 below stops outside.
function isolatingCutDepth($pos: ResolvedPos, other: number): number | null {
  let found: number | null = null;
  for (let depth = 1; depth <= $pos.depth; depth += 1) {
    if (!$pos.node(depth).type.spec.isolating) continue;
    if (other >= $pos.start(depth) && other <= $pos.end(depth)) continue;
    found = depth;
  }
  return found;
}

// Split [from, to] into the ranges a replacement may delete without joining across an isolating
// edge — in ascending document order, or null when the range crosses no such edge (the caller must
// then leave the gesture to ProseMirror, which already does the right thing).
//
// Up to three pieces, and which of them exist depends on where the edges are:
//   1. inside the innermost isolating node the range *starts* in, from `from` down to that node's
//      content end;
//   2. everything between the two boxes, whole nodes only;
//   3. inside the innermost isolating node the range *ends* in, from its content start up to `to`.
// Each piece is handed to `tr.delete` unchanged, so ProseMirror's own fitting still decides what
// happens *within* a piece — only the frontier between them is taken away from it.
//
// Pieces 1 and 3 are the boundary-preserving ones. Piece 2 was measured rather than assumed: with
// only one edge crossed it is asymmetric (a doc-level boundary at one end, inline content at the
// other), which is the shape that could plausibly have re-opened the box to absorb the leftover
// text and reproduced the very bug. It does not — the fitter closes the surviving textblock in
// place. Both directions are covered by the boundary specs.
//
// "Whole nodes only" is a claim about piece 2's *ends*, and it is what frameDepth below states: the
// depth at which the two endpoints are siblings, so both ends are boundaries between one node's
// children rather than positions part-way inside one. For a top-level box (callout, code block,
// table) that is the box's own edge and the innermost cut depth would have said the same thing. It
// stops saying the same thing as soon as a box is wrapped in something that is *not* isolating — a
// code block inside a list item is the case in the specs — where cutting at the box left piece 2's
// far end inside the `listItem`, and the deletion closed over the list's own open token.
export function clampedDeleteRanges(doc: PMNode, from: number, to: number): ClampedRange[] | null {
  const $from = doc.resolve(from);
  const $to = doc.resolve(to);
  const startDepth = isolatingCutDepth($from, to);
  const endDepth = isolatingCutDepth($to, from);
  if (startDepth === null && endDepth === null) return null;

  // One below the deepest ancestor the two endpoints share, so a position taken here is a boundary
  // *between* that ancestor's children. Never deeper than either cut depth, and so never inside a
  // box the clamp is protecting: isolatingCutDepth skips every ancestor that contains the other
  // endpoint, which is the same containment test sharedDepth answers. (Pieces 1 and 3 run to the
  // *innermost* box's content edge instead — the two depths are what keep a table's frame standing
  // while still deleting inside the one cell the range reached.)
  const frameDepth = $from.sharedDepth(to) + 1;
  const ranges: ClampedRange[] = [];
  const middleFrom = startDepth === null ? from : $from.after(frameDepth);
  const middleTo = endDepth === null ? to : $to.before(frameDepth);
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

// The same deletion as a standalone transaction, for the gestures that reach it from a DOM event
// rather than a command — null when the selection crosses no isolating edge. The caret is left
// where the selection started, so callers that go on to insert something can do so at `from`.
function clampedSelectionDeletion(state: EditorState): Transaction | null {
  const ranges = clampedSelectionRanges(state);
  if (!ranges) return null;
  const tr = deleteClamped(state.tr, ranges);
  return tr.setSelection(TextSelection.near(tr.doc.resolve(state.selection.from)));
}

// Delete the current selection, clamped to any isolating edge it spans — and left to ProseMirror
// when it spans none. The unconditional form, for callers that are deleting the selection either
// way and only need it done correctly; `deleteSelection` on its own is what corrupts the document.
export function deleteSelectionClamped(state: EditorState): Transaction {
  return clampedSelectionDeletion(state) ?? state.tr.deleteSelection();
}

// Put `slice` where the current selection is, clamped to any isolating edge that selection spans.
// Exported because the paste path has two claimants: the callout guard repairs the *slice* (see
// callout-slice-guard.ts) and then needs this to place it, while the plugin below catches every
// paste the callout guard passed on. Both end at the same deletion rule, which is the point.
export function replaceSelectionClamped(state: EditorState, slice: Slice): Transaction {
  const tr = clampedSelectionDeletion(state);
  return (tr ?? state.tr).replaceSelection(slice);
}

const isolatingBoundaryKey = new PluginKey('isolatingBoundary');

// Typing over a boundary-spanning selection. `handleTextInput` is handed the range the input is
// about to replace, which for a plain keystroke is the selection — so the same clamp applies, with
// the character landing at the range's start (inside whichever box the selection began in).
//
// The TextSelection gate is the one clampedSelectionRanges applies for every other gesture, asked
// here directly because this hook is given a range rather than reading the selection itself. Both
// kinds it excludes were measured to be right without it — an AllSelection's endpoints sit at depth
// 0, where there are no ancestors to be isolating, and a CellSelection never brings a spanning range
// this far — but "correct because of where ProseMirror happens to put the endpoints" is a thinner
// guarantee than the other five entry points have, for no saving.
function handleTextInputClamped(view: EditorView, from: number, to: number, text: string): boolean {
  if (!(view.state.selection instanceof TextSelection)) return false;
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
  const tr = clampedSelectionDeletion(view.state);
  if (!tr) return false;
  const { dom, text } = view.serializeForClipboard(selection.content());
  event.preventDefault();
  clipboardData.clearData();
  clipboardData.setData('text/html', dom.innerHTML);
  clipboardData.setData('text/plain', text);
  view.dispatch(tr.scrollIntoView().setMeta('uiEvent', 'cut'));
  return true;
}

// IME, which is the typing path on a Japanese-language site rather than an exotic one. A
// composition never reaches `handleTextInput`: the browser edits the DOM itself and ProseMirror
// reads the result back at composition end, so a commit over a boundary-spanning selection
// reproduced the corruption with the clamp above never consulted.
//
// The one place to intervene is before the browser removes the selected text. `compositionstart`
// fires first, so the clamped deletion happens there and the composition then starts on a collapsed
// caret — which is what the gesture meant anyway, since a composition always replaces the selection
// it began over. Returning false deliberately: prosemirror-view's own compositionstart handler must
// still run, and it now runs against the collapsed selection.
//
// The one place this is not as tidy as the rest: it is a transaction of its own, with the
// composition's read-back arriving as a second one, where every other gesture here builds a single
// transaction and is therefore a single undo step. prosemirror-history joins the two while they
// fall within newGroupDelay, so a composition the author lingered over undoes in two steps rather
// than one. Both steps are on the stack and undo still converges — the boundary spec asserts that
// rather than a step count — but there is no hook between compositionstart and the read-back to
// fold them into one.
function handleCompositionStartClamped(view: EditorView): boolean {
  const tr = clampedSelectionDeletion(view.state);
  if (tr) view.dispatch(tr);
  return false;
}

// Paste replaces the selected range like everything else here, and Ctrl+V reached the corruption as
// easily as Backspace did. This catches the pastes callout-slice-guard.ts passed on (a code block's
// edge, or any slice needing no callout repair); the ones it handles go through the same clamp from
// its own handler, since `someProp` stops at the first plugin to return true and only one of the two
// can run. See the ordering note on this extension's `priority`.
function handlePasteClamped(view: EditorView, _event: ClipboardEvent, slice: Slice): boolean {
  if (!clampedSelectionRanges(view.state)) return false;
  view.dispatch(
    replaceSelectionClamped(view.state, slice)
      .scrollIntoView()
      .setMeta('paste', true)
      .setMeta('uiEvent', 'paste'),
  );
  return true;
}

// The last gesture, and the one that had been answered by refusing it outright. A *move* drag
// deletes its source range before inserting, and prosemirror-view does that with a bare
// `tr.deleteSelection()` — no keymap, no DOM handler, so nothing above sees it. That deletion is
// what made a drag out of a callout unanswerable: even a perfectly repaired slice landed in a
// document where the box had already swallowed the paragraph below it, which is why
// callout-slice-guard.ts refused the gesture at every destination rather than repairing it.
//
// So the drop is performed here instead, mirroring prosemirror-view's own drop handler with the
// clamped deletion in place of the bare one. Only when there is something to clamp: an ordinary
// drag returns false on the first two checks and takes the normal path untouched.
//
// prosemirror-view's single-closed-node branch (`replaceRangeWith` when the slice is one node cut
// open at neither end) is deliberately not reproduced. That shape comes from a NodeSelection — the
// block drag handle's — and a NodeSelection never reaches here, because a selection spanning an
// isolating edge is a TextSelection with at least one endpoint inside a textblock.
function handleDropClamped(
  view: EditorView,
  event: DragEvent,
  slice: Slice,
  moved: boolean,
): boolean {
  // A copy-drag deletes nothing at the source, so there is no join to walk into.
  if (!moved) return false;
  const deletion = clampedSelectionDeletion(view.state);
  if (!deletion) return false;
  const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
  if (!coords) return false;

  const insertPos = dropPoint(view.state.doc, coords.pos, slice) ?? coords.pos;
  event.preventDefault();
  const before = deletion.doc;
  const pos = deletion.mapping.map(insertPos);
  deletion.replaceRange(pos, pos, slice);
  // Nothing could be fitted at the destination. Dispatching nothing discards the source deletion
  // along with it, which is what leaves the document untouched — prosemirror-view bails the same way.
  if (deletion.doc.eq(before)) return true;

  // The inserted range's far end: the last step's map knows where its own content ended up.
  let end = deletion.mapping.map(insertPos);
  deletion.mapping.maps[deletion.mapping.maps.length - 1].forEach((_from, _to, _newFrom, newTo) => {
    end = newTo;
  });
  const $pos = deletion.doc.resolve(pos);
  const $end = deletion.doc.resolve(end);
  // `createSelectionBetween` is asked the way upstream asks it, so prosemirror-tables still gets to
  // turn a drop landing across cells into its own CellSelection rather than a plain text range.
  const selection =
    view.someProp('createSelectionBetween', (f) => f(view, $pos, $end)) ??
    TextSelection.between($pos, $end);
  deletion.setSelection(selection);
  view.focus();
  view.dispatch(deletion.setMeta('uiEvent', 'drop'));
  return true;
}

// The deletion rule, shared by every gesture that replaces a range. Registered once for the whole
// editor rather than per node: it reads `isolating` off the schema, so it covers the callout and
// the code block — the two nodes that claim the boundary — without either having to ask for it.
//
// Left at the default priority. Both orderings it depends on come from where it sits in
// PostEditor's extensions array (ExtensionManager reverses that array before gathering plugins, so
// a *later* entry is asked *first*), and both are pinned by specs:
//   • its keys must beat the core Keymap extension's baseKeymap, or `deleteSelection` handles the
//     Backspace first and the clamp never runs. Core extensions are registered ahead of everything
//     in the array, so any entry in it wins — but a lowered `priority` would sort this back behind
//     them, which is measurably the unfixed behaviour.
//   • the callout guard's `handlePaste` must be asked first, so a slice carrying a half-selected
//     callout is still repaired before it is placed (`someProp` stops at the first handler to
//     return true). That holds because `Callout` is registered *after* this extension.
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
        .first(({ commands, state }) => [
          // A table cell is `paragraph+`, but a *second* paragraph in one has no GFM pipe form, so
          // splitting there costs the whole table its pipe form and it saves as raw HTML — the
          // structure survives and the storage format doesn't. A selection running out of a cell
          // clamps with the caret back inside it, which is the one Enter that lands there. A hard
          // break is what Shift+Enter already makes in a cell and what the pipe-form repair turns a
          // pasted second paragraph into (see table-extensions.ts), so the three agree. A plain
          // Enter at a caret in a cell never reaches this chain — the clamp declines an empty
          // selection — and still splits.
          () => isInTable(state) && commands.setHardBreak(),
          // ListItem's own Enter, ahead of baseKeymap's chain rather than in it: a selection
          // running from inside a list item into a box clamps with the caret back in that item, and
          // splitBlock there opens a second paragraph inside the same bullet instead of a new one.
          // Measured; the rest of the chain is baseKeymap's Enter verbatim.
          () => commands.splitListItem('listItem'),
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
          handlePaste: handlePasteClamped,
          handleDrop: handleDropClamped,
          handleDOMEvents: {
            cut: handleCutClamped,
            compositionstart: handleCompositionStartClamped,
          },
        },
      }),
    ];
  },
});
