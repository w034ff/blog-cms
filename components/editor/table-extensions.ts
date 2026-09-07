import { getHTMLFromFragment, type Editor } from '@tiptap/core';
import { Table, TableCell, TableHeader, type TableOptions } from '@tiptap/extension-table';
import { Fragment, type Node as PMNode, type ResolvedPos } from '@tiptap/pm/model';
import { isInTable, nextCell, selectedRect, selectionCell } from '@tiptap/pm/tables';
import { Plugin, PluginKey, Selection, TextSelection } from '@tiptap/pm/state';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import type { MarkdownSerializerState } from './markdown-serializer-state';
import { resolveDropTarget } from './drop-target';
import { selectionTouches } from './selection-scan';
import { pasteIntoCellRefused, selectionInsideCell, tableDropRefusal } from './table-cell-rules';

// A column's text alignment. `null` is GFM's default (`---`, renders left) and is
// what an untouched column carries; the three explicit values map to `:--`/`:-:`/`--:`.
export type CellAlign = 'left' | 'center' | 'right' | null;

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    tableColumnAlign: {
      // Set the alignment of every cell in the current column (GFM alignment is
      // per-column, so a single-cell change would not round-trip).
      setColumnAlign: (align: CellAlign) => ReturnType;
    };
  }
}

// Collect a node's direct children as an array via the public API (avoids reaching
// into Fragment internals).
function childrenOf(node: PMNode): PMNode[] {
  const children: PMNode[] = [];
  node.forEach((child) => children.push(child));
  return children;
}

function cellHasSpan(cell: PMNode): boolean {
  return cell.attrs.colspan > 1 || cell.attrs.rowspan > 1;
}

// A table maps to a GFM pipe table only when its first row is all header cells and
// no cell spans or holds more than one block. Merged/multi-paragraph tables have
// no pipe-table form, so those fall back to raw HTML — matching tiptap-markdown's
// own serializer, so such tables keep working exactly as before this change.
function isPipeTable(node: PMNode): boolean {
  const [firstRow, ...bodyRows] = childrenOf(node);
  if (!firstRow) return false;
  const headerBad = childrenOf(firstRow).some(
    (cell) => cell.type.name !== 'tableHeader' || cellHasSpan(cell) || cell.childCount > 1,
  );
  if (headerBad) return false;
  return !bodyRows.some((row) =>
    childrenOf(row).some(
      (cell) => cell.type.name === 'tableHeader' || cellHasSpan(cell) || cell.childCount > 1,
    ),
  );
}

// GFM encodes column alignment in the delimiter row that follows the header.
function alignDelimiter(align: CellAlign): string {
  if (align === 'left') return ':---';
  if (align === 'center') return ':--:';
  if (align === 'right') return '---:';
  return '---';
}

// The refusal both guards below report. One string for both gestures on purpose: it is one rule
// ("a cell holds paragraphs"), and the author who just dragged a code block into a cell is owed the
// same answer as the one who pasted it. Worded for both — 「貼り付け」 would be wrong for a drop.
const TABLE_CELL_BLOCK_BLOCKED = '表のセルにはこの要素を入れられません';

const tableDropGuardKey = new PluginKey('tableDropGuard');
const tableCellPasteGuardKey = new PluginKey('tableCellPasteGuard');

// Refuse a paste that would put a non-paragraph block inside a cell (pasteIntoCellRefused, in
// table-cell-rules.ts). Refusing rather than repairing, unlike the callout paste guard: there is no one repair
// that fits every offender. A callout or a quote could be unwrapped to its text, but a code block
// would lose its fence, and an image or a nested table has no text to keep at all — so a repair
// would be a different rule per node type with a refusal underneath it anyway. One refusal, and
// the same verdict the drop guard already gives the same content, is the smaller and more
// consistent answer.
//
// A refused paste is silent by nature — the clipboard is unchanged and the document is unchanged —
// so the notice is the whole of the feedback, the same reason a refused image raises one.
function tableCellPasteGuard(notify: (message: string) => void): Plugin {
  return new Plugin({
    key: tableCellPasteGuardKey,
    props: {
      handlePaste(view, _event, slice) {
        if (!pasteIntoCellRefused(view.state.selection.$from, slice)) return false;
        notify(TABLE_CELL_BLOCK_BLOCKED);
        // True stops prosemirror-view before it inserts anything, leaving the document untouched.
        return true;
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Keeping a table that was pasted or dropped into in its pipe form
// ---------------------------------------------------------------------------

// Putting outside content into a cell can leave the table whole on screen but no longer
// representable as a GFM pipe table, so isPipeTable turns false and the serializer above writes the
// whole thing as raw HTML — silently, and only visible once it reaches the stored markdown and the
// public page. Three things go with the pipe form: column alignment (`align="…"` survives; the
// fallback's inline `text-align` is stripped by rehype-sanitize), `<thead>`, and `<colgroup>`. The
// markdown also stops being markdown, gaining `min-width: 50px` and `colspan="1"` noise no one can
// hand-edit.
//
//   A. a multi-paragraph paste, or the same slice dropped into a cell's text → a cell holding more
//      than one block;
//   B. a whole table pasted into a cell → prosemirror-tables merges it cell-wise and the copied
//      header row lands in the body, where a row of `th` has no pipe form.
//
// Neither is the table-splitting defect tableCellPasteGuard refuses, which is why they were left out
// of it. Both are repaired here instead, *after* the gesture rather than at the slice: B is
// performed by prosemirror-tables' own handlePaste, which runs before this extension's plugins and
// is also the code that makes cell-to-cell paste work correctly — racing it would break the gesture
// this is trying to protect.

// The table `$pos` sits in, with its document position, or null when it is in none.
function tableAround($pos: ResolvedPos): { table: PMNode; pos: number } | null {
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const node = $pos.node(depth);
    if (node.type.spec.tableRole === 'table') return { table: node, pos: $pos.before(depth) };
  }
  return null;
}

// Would repairing the two shapes below actually give a pipe table back? isPipeTable minus exactly
// those two conditions — so this is false only for the reasons no repair reaches: a merged cell
// (colspan/rowspan has no pipe form at all), or a first row that isn't a header.
//
// That second one is why this is a precondition rather than "repair whatever you find". The
// toolbar's 見出し行 button (toggleHeaderRow) deliberately produces a headerless table, which is
// also not a pipe table; a table already in the HTML fallback for a reason of its own gains nothing
// from having its cells rewritten, so it is left exactly as the author left it.
function repairRestoresPipeForm(table: PMNode): boolean {
  const [firstRow, ...bodyRows] = childrenOf(table);
  if (!firstRow) return false;
  if (childrenOf(firstRow).some((cell) => cell.type.name !== 'tableHeader' || cellHasSpan(cell))) {
    return false;
  }
  return !bodyRows.some((row) => childrenOf(row).some(cellHasSpan));
}

// A cell's paragraphs as one paragraph, separated by hard breaks. Not a bare join: concatenating
// would run the last word of one paragraph into the first of the next, and a hard break is already
// the supported way to get two lines into a cell — Shift+Enter makes one, and tiptap-markdown
// serializes it as `<br>` while `inTable` (the flag the table serializer above sets), which is
// valid GFM and reloads as the same hardBreak node. So the repair produces a shape the editor could
// already have been asked for by hand, rather than a new one.
function joinedCellContent(cell: PMNode): PMNode {
  const first = cell.firstChild;
  if (!first) return cell;
  const parts: PMNode[] = [];
  cell.forEach((paragraph, _offset, index) => {
    if (index > 0) parts.push(cell.type.schema.nodes.hardBreak.create());
    paragraph.forEach((inline) => parts.push(inline));
  });
  return first.type.create(first.attrs, Fragment.fromArray(parts));
}

// The repair itself, or null when there is nothing to do. Applied to the table holding the
// selection: every route puts content *into* a cell and leaves the selection there (prosemirror-view
// selects what it inserted; prosemirror-tables sets a CellSelection over the cells it wrote), so
// that is the table the gesture touched. One whose selection ends up elsewhere is simply not
// repaired — a miss, never a corruption.
function repairPipeTable(state: EditorState): Transaction | null {
  const found = tableAround(state.selection.$from);
  if (!found || isPipeTable(found.table) || !repairRestoresPipeForm(found.table)) return null;
  const { table, pos } = found;
  const cellType = state.schema.nodes.tableCell;

  const edits: { at: number; cell: PMNode; demote: boolean; join: boolean }[] = [];
  table.forEach((row, rowOffset, rowIndex) => {
    row.forEach((cell, cellOffset) => {
      const demote = rowIndex > 0 && cell.type.name === 'tableHeader';
      const join = cell.childCount > 1;
      // +1 steps into the table, +1 into the row.
      if (demote || join)
        edits.push({ at: pos + 1 + rowOffset + 1 + cellOffset, cell, demote, join });
    });
  });
  if (edits.length === 0) return null;

  // Last cell first, so every remaining position is still the one measured above — joining shortens
  // a cell, and only positions after it move. Within a cell the order is free: the join rewrites the
  // content, leaving the cell's own position (and so setNodeMarkup's target) untouched.
  const tr = state.tr;
  for (let index = edits.length - 1; index >= 0; index -= 1) {
    const { at, cell, demote, join } = edits[index];
    if (join) tr.replaceWith(at + 1, at + 1 + cell.content.size, joinedCellContent(cell));
    if (demote) tr.setNodeMarkup(at, cellType, cell.attrs);
  }
  return tr;
}

const tablePipeFormRepairKey = new PluginKey('tablePipeFormRepair');

// Both gestures that put outside content into a cell, and no others. Drop is here because the drop
// guard's *position* rule does not cover it: that one refuses a drop at a cell's block edge, on the
// grounds that a drop inside the cell's text merges inline — true of a one-paragraph slice, but a
// two-paragraph one still lands as two paragraphs and costs the table its pipe form exactly as the
// paste does. Measured, not assumed.
//
// The scope is load-bearing in both directions:
//   • Enter inside a cell is the *gesture's* business, not the repair's: an unconditional join here
//     would undo every Enter the instant it was typed, so what changed is what Enter does (a hard
//     break — hardBreakInCell below), leaving this repair with nothing to see;
//   • the same shapes arrive from `setContent` when a post already stored in the HTML fallback is
//     opened, and repairing there would silently rewrite stored content on open and hand the
//     autosave an edit the author never made.
//
// The flag is set from `handleDOMEvents`, which is the only hook that sits ahead of *every*
// handlePaste and handleDrop claimant — prosemirror-tables' handlePaste among them, and this repair
// exists precisely because that one gets there first. It is cleared on the next microtask rather
// than by the transaction, because a gesture one of the guards above refuses produces no transaction
// at all and would otherwise leave the flag standing over the next keystroke. Everything a paste or
// a drop dispatches is synchronous, so the window is exact. (Not prosemirror-view's
// brokenClipboardAPI fallback, which finishes on a timeout — the same browsers this editor already
// doesn't target, see the note on handleCutClamped in isolating-boundary.ts.)
function tablePipeFormRepair(): Plugin {
  let placing = false;
  // False throughout: this only wants to know the gesture is happening, not to handle it.
  const note = (): boolean => {
    placing = true;
    queueMicrotask(() => {
      placing = false;
    });
    return false;
  };
  return new Plugin({
    key: tablePipeFormRepairKey,
    props: { handleDOMEvents: { paste: note, drop: note } },
    // Registered after the parent's plugins so prosemirror-tables' own appendTransaction (fixTables)
    // has already rectangularized the table by the time this reads it.
    appendTransaction(transactions, _oldState, newState) {
      if (!placing || !transactions.some((tr) => tr.docChanged)) return null;
      return repairPipeTable(newState);
    },
  });
}

// Suppress table drops that ProseMirror would turn into structure rather than a
// plain text move, and those carrying a block no cell may hold (see
// tableDropRefusal). Drops into a cell's text, or outside any table, fall through
// to the default handling, so moving text between cells and dragging elsewhere in
// the document still work.
//
// The slice question is the paste guard's, and it is here because the position
// question never covered it: this guard used to allow anything dropped inside a
// cell's *text*, on the grounds that inline content merges — true of text and of a
// single paragraph, and false of a block, which splits the table in two exactly as
// the refused paste would have. Same rule, same notice, three gestures agreeing.
function tableDropGuard(notify: (message: string) => void): Plugin {
  return new Plugin({
    key: tableDropGuardKey,
    props: {
      handleDrop(view, event, slice, moved) {
        const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
        if (!coords) return false;
        // resolveDropTarget rather than a local dropPoint call, so this and the drop *indicator*
        // (drop-cursor-guard.ts) compute the same target. They used to differ: this side resolved
        // against the document on screen, the indicator against the one the move's own deletion
        // leaves behind. The two agree except where that deletion joins two nodes — which changes
        // the depth the mapped position resolves at, and is exactly the case resolveDropTarget
        // exists for — so the indicator could promise a drop this then refused, or hide on one it
        // would have taken. Both silent.
        const refusal = tableDropRefusal(resolveDropTarget(view, coords.pos, slice, moved), slice);
        if (!refusal) return false;
        // A position refusal stays silent: the indicator was already hidden while the
        // author hovered there (drop-cursor-guard.ts), so the answer arrived before
        // the mouse came up. A content refusal has no such tell — the block would
        // have landed anywhere in the cell — so it says why, the same way the paste
        // guard does for the same slice.
        if (refusal === 'content') notify(TABLE_CELL_BLOCK_BLOCKED);
        // Returning true makes ProseMirror preventDefault and skip the whole drop,
        // so the dragged text stays put rather than being deleted from its source.
        event.preventDefault();
        return true;
      },
    },
  });
}

// Markdown can't hold block structure in a table cell: the GFM pipe form is one line
// of inline content, and even the raw-HTML fallback (spans / multi-paragraph, see
// isPipeTable) only survives for paragraph content. With the stock `block+` cells a
// nested code block, callout, list, or table silently flattens to its text on save
// (a lone block in a cell still counts as the pipe form and is rendered inline).
// Narrow the schema to paragraphs so such structure can't be authored in a cell at
// all — block input rules simply don't fire there, and block inserts land outside
// the table instead of inside the cell.
export const ParagraphTableCell = TableCell.extend({ content: 'paragraph+' });
export const ParagraphTableHeader = TableHeader.extend({ content: 'paragraph+' });

// Whether `selection` covers a whole textblock's content start-to-end — the shape
// Tab's own goToNextCell leaves behind (it selects the entire destination cell,
// mirroring spreadsheet overwrite-on-type UX), as opposed to an ordinary partial
// selection a user made by hand.
function isWholeTextblockSelected(selection: Selection): boolean {
  const { $from, $to } = selection;
  if (selection.empty || $from.parent !== $to.parent) return false;
  return $from.parentOffset === 0 && $to.parentOffset === $from.parent.content.size;
}

// prosemirror-view's own vertical-arrow handling (selectVertically) refuses to act
// on a non-empty TextSelection at all, so right after Tab the keydown falls through
// to the browser's native behavior for a range selection, which collapses it to an
// edge instead of moving a row — ArrowDown after Tab, Tab looks like it moved
// sideways instead of down. Recognize that specific "whole cell selected" shape and
// move to the same column one row up/down ourselves, the same way prosemirror-tables'
// own (selection-empty-only) arrow keymap would. An ordinary partial selection made
// by hand is left alone, so plain shift-selecting text still collapses normally.
function tableVerticalArrow(dir: 1 | -1, editor: Editor): boolean {
  const { state, view } = editor;
  if (!isInTable(state) || !isWholeTextblockSelected(state.selection)) return false;
  const $next = nextCell(selectionCell(state), 'vert', dir);
  if (!$next) return false;
  view.dispatch(state.tr.setSelection(Selection.near($next, 1)).scrollIntoView());
  return true;
}

// Enter inside a cell makes a hard break rather than a second paragraph. A cell is `paragraph+`, so
// the second paragraph is legal and the table still looks right — but two blocks in a cell has no
// GFM pipe form, so the whole table silently serializes as raw HTML from that keystroke on, losing
// column alignment on the public page (sanitize strips the fallback's inline `text-align`), its
// `<thead>` and any chance of hand-editing the markdown. A shape this editor cannot store is not a
// shape typing should be able to produce — the same argument that already narrowed cells from
// `block+` to `paragraph+`.
//
// A hard break is not a new shape either: Shift+Enter already makes one here, tiptap-markdown writes
// it as `<br>` while `inTable` and `| x<br>y |` round-trips byte-identically, and the pipe-form
// repair converts a pasted or dropped second paragraph into exactly this. So all four routes into a
// cell now agree.
//
// **Keymap only — the schema stays `paragraph+`.** Posts already stored in the HTML fallback keep
// loading exactly as they do today; only what can be newly authored changes.
//
// The binding is document-wide, so it has to decline everything that is not a caret (or a plain
// selection) inside one cell: false hands the key on, and the empty-selection case then reaches
// baseKeymap's Enter as before. A selection that runs *out* of a cell is not this binding's problem
// either — the isolating clamp is asked first and answers it (isolating-boundary.ts), including the
// hard break it leaves in the cell for the same reason as here.
//
// Three keys make a hard break, and all three are routed through here (see addKeyboardShortcuts
// below): Enter, because in a cell it must not split; Shift+Enter and Mod+Enter, because
// @tiptap/extension-hard-break binds them straight to `setHardBreak` and so would otherwise skip
// the whole-cell guard below — the same wipe on the key this comment calls the canonical in-cell
// break. Outside a cell this declines, and HardBreak's own bindings answer them as before.
//
// The one selection it must not take at face value is the one Tab leaves behind. setHardBreak is an
// insert, so it replaces whatever is selected — and after Tab that is the destination cell's entire
// content (isWholeTextblockSelected above), which the author never selected and cannot see they are
// about to lose. Tab then Enter read as "move here, then add a line" and instead wiped the cell,
// leaving only the break. Collapse that shape to the end of the cell first and insert there: the
// content survives and Enter still does the one thing it does in a cell. This is the same defect the
// arrow keys had for the same reason, answered the same way (tableVerticalArrow above) — a
// selection made *by hand* is left alone there, and a partial one is left alone here, so typing over
// a range you actually chose still replaces it. A hand-made whole-cell selection is
// indistinguishable from Tab's and so takes the same non-destructive branch; undo is one step
// either way.
function hardBreakInCell(editor: Editor): boolean {
  const { selection } = editor.state;
  if (!(selection instanceof TextSelection)) return false;
  if (!selectionInsideCell(selection.$from, selection.$to)) return false;
  if (!isWholeTextblockSelected(selection)) return editor.commands.setHardBreak();
  // One chain, so the collapse and the break stay one transaction and therefore one undo step.
  return editor.chain().setTextSelection(selection.to).setHardBreak().run();
}

// @tiptap/extension-table already stores an `align` attribute per cell (parsed
// from the `text-align` style markdown-it emits for `:-:`, rendered back as an
// inline style), but tiptap-markdown's built-in table serializer always writes a
// plain `---` delimiter, dropping that alignment on save. We override just the
// table node's markdown serializer to write the header row's alignment into the
// delimiter, and add a command to set a whole column's `align`. Everything else —
// cell parsing/display and the public render (remark emits `<td align>`, honored
// by globals.css) — already round-trips.
// Table's own options plus the refusal reporter the cell paste guard needs. Declared as a type
// (rather than left inferred) so `MarkdownTable.configure({ onBlocked })` typechecks at the call
// site in PostEditor.
export type MarkdownTableOptions = TableOptions & {
  onBlocked: (message: string) => void;
};

export const MarkdownTable = Table.extend<MarkdownTableOptions>({
  addStorage() {
    return {
      ...this.parent?.(),
      markdown: {
        serialize(state: MarkdownSerializerState, node: PMNode) {
          if (!isPipeTable(node)) {
            // No pipe-table form: emit raw HTML like tiptap-markdown does (html
            // mode is on), so merged/multi-paragraph tables don't regress.
            state.write(getHTMLFromFragment(Fragment.from(node), node.type.schema));
            state.closeBlock(node);
            return;
          }
          state.inTable = true;
          const headerCells = childrenOf(childrenOf(node)[0]);
          node.forEach((row, _offset, rowIndex) => {
            state.write('| ');
            row.forEach((cell, _cellOffset, cellIndex) => {
              if (cellIndex) state.write(' | ');
              const content = cell.firstChild;
              if (content && content.textContent.trim()) state.renderInline(content);
            });
            state.write(' |');
            state.ensureNewLine();
            if (rowIndex === 0) {
              const delimiter = headerCells
                .map((cell) => alignDelimiter(cell.attrs.align))
                .join(' | ');
              state.write(`| ${delimiter} |`);
              state.ensureNewLine();
            }
          });
          state.closeBlock(node);
          state.inTable = false;
        },
      },
    };
  },
  addCommands() {
    const parent = this.parent?.();
    return {
      ...parent,
      // A table can't nest inside a cell (paragraph-only cells), so inserting from
      // within one would split the host table in two around the new table. Refuse
      // instead; the picker is a no-op while the caret is in a table.
      //
      // selectionTouches rather than isInTable, which reads `$head` alone: a selection dragged
      // *out* of a table upwards leaves the head outside and so passed the check, and insertTable
      // then replaced the range — the existing table was swapped for a fresh empty one, its
      // contents gone. The scan is direction-agnostic (selection.from/to are normalized) and still
      // covers the plain caret-in-a-cell case.
      insertTable:
        (options?: { rows?: number; cols?: number; withHeaderRow?: boolean }) => (props) => {
          // `detailsSummary` for the same reason one level over: an accordion's title is `text*`,
          // so a table inserted there does not go in — the fitter splits the accordion around it
          // and the document saves as two `<details>`. The body is untouched by this name and
          // still takes a table, which §6.3 of docs/accordion-requirements.md asks for explicitly.
          //
          // `linkCard`/`embed`: both are atoms, so selecting one gives a NodeSelection over exactly
          // that node, and the stock command replaces a NodeSelection outright — the card or embed
          // was silently swapped for a fresh empty table (reported 2026-09-05). `image` is named
          // alongside them for consistency of the refusal rather than for invisibility: losing a
          // picture to a fresh table is visible, but the four controls refuse over a selected block
          // atom as one rule (2026-09-08 — callout-extension.ts carries the same note).
          if (
            selectionTouches(props.state, 'table', 'detailsSummary', 'linkCard', 'embed', 'image')
          )
            return false;
          return parent?.insertTable?.(options)(props) ?? false;
        },
      setColumnAlign:
        (align: CellAlign) =>
        ({ state, tr, dispatch }) => {
          if (!isInTable(state)) return false;
          const { map, table, tableStart, left, right } = selectedRect(state);
          // A cell can appear in the map more than once (row/col spans), so gather
          // unique offsets before mutating.
          const offsets = new Set<number>();
          for (let col = left; col < right; col += 1) {
            for (let row = 0; row < map.height; row += 1) {
              offsets.add(map.map[row * map.width + col]);
            }
          }
          offsets.forEach((offset) => {
            const cell = table.nodeAt(offset);
            if (cell) tr.setNodeMarkup(tableStart + offset, undefined, { ...cell.attrs, align });
          });
          if (dispatch) dispatch(tr);
          return true;
        },
    };
  },
  addKeyboardShortcuts() {
    // Merge with the parent's Tab/Shift-Tab/Backspace/Delete shortcuts — returning
    // a fresh object here would replace them outright, not just add to them.
    return {
      ...(this.parent?.() ?? {}),
      ArrowDown: () => tableVerticalArrow(1, this.editor),
      ArrowUp: () => tableVerticalArrow(-1, this.editor),
      Enter: () => hardBreakInCell(this.editor),
      // HardBreak's own Shift-Enter/Mod-Enter call setHardBreak directly, so they have to be
      // intercepted here to reach the whole-cell guard — this extension is registered after
      // StarterKit in PostEditor's array, which ExtensionManager reverses, so these are asked first.
      'Shift-Enter': () => hardBreakInCell(this.editor),
      'Mod-Enter': () => hardBreakInCell(this.editor),
    };
  },
  addOptions(): MarkdownTableOptions {
    return {
      ...(this.parent?.() as TableOptions),
      // How the paste guard tells the author why nothing happened. Supplied by PostEditor, which
      // owns the one notice both this and the image refusals write to (useEditorNotice). Defaults
      // to a no-op so the extension stays usable — and testable — without the host wiring it up.
      onBlocked: () => {},
    };
  },
  addProseMirrorPlugins() {
    // Keep the base table plugins (tableEditing, etc.) and add the two guards.
    return [
      ...(this.parent?.() ?? []),
      tableDropGuard(this.options.onBlocked),
      tableCellPasteGuard(this.options.onBlocked),
      tablePipeFormRepair(),
    ];
  },
});
