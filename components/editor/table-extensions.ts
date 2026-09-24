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

// One string for paste and drop, since it is one rule (docs/editor-requirements.md §2.1).
const TABLE_CELL_BLOCK_BLOCKED = '表のセルにはこの要素を入れられません';

const tableDropGuardKey = new PluginKey('tableDropGuard');
const tableCellPasteGuardKey = new PluginKey('tableCellPasteGuard');

// Refuse a paste that would put a non-paragraph block in a cell. Refused rather than repaired: no
// one repair fits every block (docs/editor-requirements.md §2.1). The notice is the only feedback.
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
// Neither splits the table, so tableCellPasteGuard doesn't refuse them; both are repaired *after* the
// gesture, since B is prosemirror-tables' own handlePaste (which also makes cell-to-cell paste work)
// and runs before this extension's plugins.

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
// A table in the HTML fallback for its own reason (e.g. 見出し行 toggled off) is left as it is.
function repairRestoresPipeForm(table: PMNode): boolean {
  const [firstRow, ...bodyRows] = childrenOf(table);
  if (!firstRow) return false;
  if (childrenOf(firstRow).some((cell) => cell.type.name !== 'tableHeader' || cellHasSpan(cell))) {
    return false;
  }
  return !bodyRows.some((row) => childrenOf(row).some(cellHasSpan));
}

// A cell's paragraphs joined with hard breaks, the shape Shift+Enter makes (`<br>` while `inTable`,
// round-tripping as the same node).
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

// The repair, or null. Applied to the table holding the selection, where every route leaves it; a
// selection elsewhere means a miss, never a corruption.
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

// Only paste and drop (a two-paragraph drop into a cell's text also loses the pipe form). The scope
// is load-bearing: Enter is handled by hardBreakInCell instead, and repairing on `setContent` would
// rewrite a stored HTML-fallback post on open and autosave an edit nobody made.
//
// The flag is set from `handleDOMEvents`, the only hook ahead of every handlePaste/handleDrop
// (prosemirror-tables' included), and cleared on the next microtask, since a refused gesture makes
// no transaction. Paste and drop dispatch synchronously, so the window is exact (not so
// prosemirror-view's brokenClipboardAPI fallback; see handleCutClamped in isolating-boundary.ts).
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

// Refuse table drops that would create structure or carry a block no cell may hold
// (tableDropRefusal, docs/editor-requirements.md §2.3). Drops into a cell's text, or outside any
// table, fall through.
function tableDropGuard(notify: (message: string) => void): Plugin {
  return new Plugin({
    key: tableDropGuardKey,
    props: {
      handleDrop(view, event, slice, moved) {
        const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
        if (!coords) return false;
        // resolveDropTarget, so this and the drop indicator (drop-cursor-guard.ts) agree.
        const refusal = tableDropRefusal(resolveDropTarget(view, coords.pos, slice, moved), slice);
        if (!refusal) return false;
        // Only the content refusal notifies; the position one was shown by the hidden indicator.
        if (refusal === 'content') notify(TABLE_CELL_BLOCK_BLOCKED);
        // Returning true makes ProseMirror preventDefault and skip the whole drop,
        // so the dragged text stays put rather than being deleted from its source.
        event.preventDefault();
        return true;
      },
    },
  });
}

// Cells are `paragraph+`: markdown can't hold block structure in a cell, and with stock `block+`
// cells nested blocks flattened to text on save.
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

// After Tab, `selectVertically` ignores the non-empty selection and the browser just collapses it,
// so ArrowUp/Down didn't move a row (docs/editor-requirements.md §4.1). For that whole-cell shape,
// move a row as prosemirror-tables' arrow keymap would; a partial selection is left alone.
function tableVerticalArrow(dir: 1 | -1, editor: Editor): boolean {
  const { state, view } = editor;
  if (!isInTable(state) || !isWholeTextblockSelected(state.selection)) return false;
  const $next = nextCell(selectionCell(state), 'vert', dir);
  if (!$next) return false;
  view.dispatch(state.tr.setSelection(Selection.near($next, 1)).scrollIntoView());
  return true;
}

// Enter, Shift+Enter and Mod+Enter in a cell make a hard break (docs/editor-requirements.md §4): a
// second paragraph would drop the whole table to the raw-HTML fallback. **Keymap only**, so stored
// fallback posts still load. Declines outside a single cell; a selection leaving the cell is the
// isolating clamp's. Shift/Mod+Enter are routed here because HardBreak binds them straight to
// `setHardBreak`, skipping the whole-cell guard.
//
// After Tab the whole cell is selected (§4.1), and inserting would wipe it; that shape collapses to
// the cell's end first. A partial selection is still replaced.
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
// Declared so `MarkdownTable.configure({ onBlocked })` typechecks.
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
      // Refused where the selection touches a table (a cell can't hold one), asked with
      // selectionTouches rather than `isInTable`, which reads `$head` alone and let a range dragged
      // out of a table replace it.
      insertTable:
        (options?: { rows?: number; cols?: number; withHeaderRow?: boolean }) => (props) => {
          // Also an accordion title (`text*`; the body still takes a table,
          // docs/accordion-requirements.md §6.3) and a selected block atom, as in setCallout.
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
      // Asked before HardBreak's own bindings, being later in the extensions array.
      'Shift-Enter': () => hardBreakInCell(this.editor),
      'Mod-Enter': () => hardBreakInCell(this.editor),
    };
  },
  addOptions(): MarkdownTableOptions {
    return {
      ...(this.parent?.() as TableOptions),
      // The shared refusal notice; a no-op default so the extension works without the host.
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
