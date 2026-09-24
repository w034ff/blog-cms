import { Extension } from '@tiptap/core';
import type { CommandProps, Editor } from '@tiptap/core';
import type { Node as PMNode, NodeType, ResolvedPos, Slice } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { isInTable } from '@tiptap/pm/tables';
import { tableDropRefusal } from './table-cell-rules';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { dropPoint } from '@tiptap/pm/transform';
import type { EditorView } from '@tiptap/pm/view';

// A command body for an `isolating` `nodeType` (callout, code block): Backspace at the start of the
// top-level block right after one puts the caret at the box's *end* instead of node-selecting it.
// An *empty* following block is deleted outright, as a blockquote join would; a non-empty one is
// never absorbed into the box. True when it acted.
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

// The Delete mirror: at the very end of the box's content, an empty following sibling is deleted.
// A non-empty one needs nothing: joinForward's `findCutAfter` already stops at an isolating edge.
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
  // …with every ancestor below the box the *last* child of its parent (a callout nests deeper than
  // a code block, which position arithmetic would miscount)…
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

// `isolating` guards where a slice is *placed*, not the frontier a ranged **replacement** closes
// over, so replacing a selection across a box's edge swallowed or destroyed the box
// (docs/editor-pitfalls.md §6.1). The clamp deletes inside and outside the box as separate ranges,
// leaving the boundary standing.

type ClampedRange = { from: number; to: number };

// The *innermost* ancestor of `$pos` that is isolating and does not also contain `other` — the box
// the endpoint really sits in, and so the one whose content edge a deletion may run to. Null when
// there is none, which is the common case and the one that must stay on ProseMirror's own path.
//
// A box containing both endpoints is skipped, not a stop, so a code block inside a callout is still
// found. **Innermost, not outermost** (docs/editor-pitfalls.md §6.2): `table` is isolating as well
// as its cells, and cutting at the table deleted the header row.
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
// Piece 2's asymmetric single-edge shape does not re-open the box (measured; the fitter closes the
// surviving textblock in place). Its ends are at frameDepth, where the endpoints are siblings: for a
// box inside a non-isolating wrapper (a code block in a list item) cutting at the box left an end
// inside the `listItem`.
export function clampedDeleteRanges(doc: PMNode, from: number, to: number): ClampedRange[] | null {
  const $from = doc.resolve(from);
  const $to = doc.resolve(to);
  const startDepth = isolatingCutDepth($from, to);
  const endDepth = isolatingCutDepth($to, from);
  if (startDepth === null && endDepth === null) return null;

  // A boundary between the shared ancestor's children; never inside a protected box, since
  // isolatingCutDepth skips ancestors containing both endpoints.
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

// Last range first, so earlier ones need no mapping; one transaction, so one undo step.
function deleteClamped(tr: Transaction, ranges: ClampedRange[]): Transaction {
  for (let index = ranges.length - 1; index >= 0; index -= 1) {
    tr.delete(ranges[index].from, ranges[index].to);
  }
  return tr;
}

// The clamped ranges for the current selection, or null when the gesture needs no help.
//
// TextSelection only, leaving CellSelection, AllSelection (Ctrl+A then Backspace clears everything)
// and NodeSelection (a whole box being replaced) their own behaviour.
function clampedSelectionRanges(state: EditorState): ClampedRange[] | null {
  const { selection } = state;
  if (!(selection instanceof TextSelection) || selection.empty) return null;
  return clampedDeleteRanges(state.doc, selection.from, selection.to);
}

// As a command body, leaving the caret where the selection started. False when no edge is crossed.
export function deleteClampedSelection({ state, tr, dispatch }: CommandProps): boolean {
  const ranges = clampedSelectionRanges(state);
  if (!ranges) return false;
  if (dispatch) {
    deleteClamped(tr, ranges);
    // The selection's start is untouched by the deletions.
    tr.setSelection(TextSelection.near(tr.doc.resolve(state.selection.from)));
    tr.scrollIntoView();
  }
  return true;
}

// The same deletion as a transaction for DOM-event gestures, or null.
function clampedSelectionDeletion(state: EditorState): Transaction | null {
  const ranges = clampedSelectionRanges(state);
  if (!ranges) return null;
  const tr = deleteClamped(state.tr, ranges);
  return tr.setSelection(TextSelection.near(tr.doc.resolve(state.selection.from)));
}

// The unconditional form: clamped when needed, plain `deleteSelection` otherwise.
export function deleteSelectionClamped(state: EditorState): Transaction {
  return clampedSelectionDeletion(state) ?? state.tr.deleteSelection();
}

// Put `slice` over the selection, clamped. Exported for the slice guards' own handlePaste, since
// only one handlePaste runs.
export function replaceSelectionClamped(state: EditorState, slice: Slice): Transaction {
  const tr = clampedSelectionDeletion(state);
  return (tr ?? state.tr).replaceSelection(slice);
}

const isolatingBoundaryKey = new PluginKey('isolatingBoundary');

// Typing over a boundary-spanning selection; the character lands at the range's start. The
// TextSelection gate is asked explicitly, since this hook gets a range rather than the selection.
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

// Cut ends in a bare `tr.deleteSelection()` and is reachable from the context menu, so it is handled
// as a DOM event: the copy half via `view.serializeForClipboard`, the delete half clamped. The
// `brokenClipboardAPI` fallback (IE/old iOS) is not reproduced; without `clipboardData` the event is
// handed back.
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

// IME, the ordinary typing path here, never reaches `handleTextInput`, so the clamped deletion runs
// at `compositionstart` and the composition starts on a collapsed caret. False, so
// prosemirror-view's own handler still runs. Known wart: two transactions, so a slow composition may
// undo in two steps; there is no hook to fold them.
function handleCompositionStartClamped(view: EditorView): boolean {
  const tr = clampedSelectionDeletion(view.state);
  if (tr) view.dispatch(tr);
  return false;
}

// Paste: catches what the slice guards passed on; the ones they handle use replaceSelectionClamped
// themselves, since `someProp` stops at the first true.
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

// A *move* drop deletes its source with a bare `tr.deleteSelection()`, reached by no keymap or DOM
// handler. So when there is something to clamp, the drop is performed here, mirroring
// prosemirror-view's handler with the clamped deletion. Its single-closed-node branch is not
// reproduced: that shape comes from a NodeSelection, which never spans an isolating edge.
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
  const before = deletion.doc;
  const pos = deletion.mapping.map(insertPos);
  // Claiming the drop would bypass tableDropGuard, so its question is asked first and the event
  // handed back (docs/editor-requirements.md §2.1). `deletion.doc.resolve(pos)` equals what
  // resolveDropTarget computes.
  if (tableDropRefusal(deletion.doc.resolve(pos), slice)) return false;
  event.preventDefault();
  deletion.replaceRange(pos, pos, slice);
  // Nothing fitted: dispatch nothing, as prosemirror-view does.
  if (deletion.doc.eq(before)) return true;

  // The inserted range's far end: the last step's map knows where its own content ended up.
  let end = deletion.mapping.map(insertPos);
  deletion.mapping.maps[deletion.mapping.maps.length - 1].forEach((_from, _to, _newFrom, newTo) => {
    end = newTo;
  });
  const $pos = deletion.doc.resolve(pos);
  const $end = deletion.doc.resolve(end);
  // Asked as upstream does, so prosemirror-tables can still make a CellSelection.
  const selection =
    view.someProp('createSelectionBetween', (f) => f(view, $pos, $end)) ??
    TextSelection.between($pos, $end);
  deletion.setSelection(selection);
  view.focus();
  view.dispatch(deletion.setMeta('uiEvent', 'drop'));
  return true;
}

// The deletion rule for every gesture that replaces a range, for every node the schema marks
// `isolating` (docs/editor-pitfalls.md §6.4 on the accordion's pair).
//
// **Default priority, position-dependent** (see extensions.ts): its keys must beat the core
// Keymap's `deleteSelection` (a lowered priority measurably loses), and Callout, registered after
// it, gets handlePaste first.
export const IsolatingBoundary = Extension.create({
  name: 'isolatingBoundary',

  addKeyboardShortcuts() {
    const del = ({ editor }: { editor: Editor }) => editor.commands.command(deleteClampedSelection);
    // Enter is a ranged replacement too: clamp, then baseKeymap's Enter chain on the caret left
    // behind, in one chain (one undo step). Whether it applies is asked *before* the chain, since
    // a TipTap chain runs and dispatches every step whatever an earlier one returned.
    const enter = ({ editor }: { editor: Editor }) => {
      if (!clampedSelectionRanges(editor.state)) return false;
      return editor
        .chain()
        .command(deleteClampedSelection)
        .first(({ commands, state }) => [
          // A hard break in a cell, as hardBreakInCell makes for a caret (docs/editor-requirements.md
          // §4): a second paragraph costs the table its pipe form.
          () => isInTable(state) && commands.setHardBreak(),
          // ListItem's own Enter first, or splitBlock opens a second paragraph in the same bullet.
          // The rest is baseKeymap's Enter verbatim.
          () => commands.splitListItem('listItem'),
          () => commands.newlineInCode(),
          () => commands.createParagraphNear(),
          () => commands.liftEmptyBlock(),
          () => commands.splitBlock(),
        ])
        .run();
    };
    // All six delete chords, since the code block binds all six too (deleteSoleCodeChar).
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
