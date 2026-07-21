import { Extension, getHTMLFromFragment, type Editor } from '@tiptap/core';
import { Table, TableCell, TableHeader } from '@tiptap/extension-table';
import { Fragment, type Node as PMNode, type ResolvedPos } from '@tiptap/pm/model';
import { isInTable, nextCell, selectedRect, selectionCell } from '@tiptap/pm/tables';
import { Plugin, PluginKey, Selection } from '@tiptap/pm/state';
import { dropPoint } from '@tiptap/pm/transform';
import type { EditorView } from '@tiptap/pm/view';
import type { MarkdownSerializerState } from './markdown-serializer-state';

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

// Whether a drop at this position should be blocked. Two kinds of table drop turn
// into structure instead of a plain text move, and neither is a useful edit here:
//   • in a table but not in any cell (the gap between cells/rows) — ProseMirror
//     fits the slice by creating a stray cell, which tableEditing's fixTables then
//     rectangularizes into a whole spurious column;
//   • in a cell but at block level (its top/bottom edge, not inside the text) — the
//     drop adds a second paragraph to the cell, which forces the whole table out of
//     the clean GFM pipe form into an HTML fallback (and drops that table's column
//     alignment on the public page, where sanitize strips the inline style).
// A drop inside a cell's textblock (merges inline) or entirely outside any table is
// fine and left to ProseMirror.
function isDisallowedTableDrop($pos: ResolvedPos): boolean {
  let inTable = false;
  let inCell = false;
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const role: string | undefined = $pos.node(depth).type.spec.tableRole;
    if (role === 'table') inTable = true;
    if (role === 'cell' || role === 'header_cell') inCell = true;
  }
  if (!inTable) return false;
  if (!inCell) return true;
  // Inside a cell: allow only when the position lands in its text, not at the
  // block level between/around paragraphs (which would add a paragraph).
  return !$pos.parent.isTextblock;
}

const tableDropGuardKey = new PluginKey('tableDropGuard');

// Suppress table drops that ProseMirror would turn into structure rather than a
// plain text move (see isDisallowedTableDrop). Drops into a cell's text, or outside
// any table, fall through to the default handling, so moving text between cells and
// dragging elsewhere in the document still work.
function tableDropGuard(): Plugin {
  return new Plugin({
    key: tableDropGuardKey,
    props: {
      handleDrop(view, event, slice) {
        const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
        if (!coords) return false;
        // Mirror ProseMirror's own drop math so we test its real insertion point.
        const insertPos = dropPoint(view.state.doc, coords.pos, slice) ?? coords.pos;
        if (!isDisallowedTableDrop(view.state.doc.resolve(insertPos))) return false;
        // Returning true makes ProseMirror preventDefault and skip the whole drop,
        // so the dragged text stays put rather than being deleted from its source.
        event.preventDefault();
        return true;
      },
    },
  });
}

// prosemirror-dropcursor's `disableDropCursor` hook (return true to hide the drop
// indicator). It evaluates this on the node under the pointer but *draws* the cursor
// at dropPoint's target, so those two can disagree near a cell's top edge. We
// recompute that same target and reuse isDisallowedTableDrop, making the indicator
// appear exactly when tableDropGuard would accept the drop and hide when it would
// reject it. Flagged on paragraphs too (below), since a pointer over cell text
// resolves to the paragraph; outside a table isDisallowedTableDrop is false, so
// drops elsewhere are unaffected.
function disableTableDropCursor(view: EditorView, pos: { pos: number }): boolean {
  const slice = view.dragging?.slice;
  const target = slice ? (dropPoint(view.state.doc, pos.pos, slice) ?? pos.pos) : pos.pos;
  return isDisallowedTableDrop(view.state.doc.resolve(target));
}

const tableDropCursorNodeNames = new Set([
  'paragraph',
  'table',
  'tableRow',
  'tableHeader',
  'tableCell',
]);
export const TableDropCursorGuard = Extension.create({
  name: 'tableDropCursorGuard',
  extendNodeSchema(extension) {
    return tableDropCursorNodeNames.has(extension.name)
      ? { disableDropCursor: disableTableDropCursor }
      : {};
  },
});

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

// @tiptap/extension-table already stores an `align` attribute per cell (parsed
// from the `text-align` style markdown-it emits for `:-:`, rendered back as an
// inline style), but tiptap-markdown's built-in table serializer always writes a
// plain `---` delimiter, dropping that alignment on save. We override just the
// table node's markdown serializer to write the header row's alignment into the
// delimiter, and add a command to set a whole column's `align`. Everything else —
// cell parsing/display and the public render (remark emits `<td align>`, honored
// by globals.css) — already round-trips.
export const MarkdownTable = Table.extend({
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
      insertTable:
        (options?: { rows?: number; cols?: number; withHeaderRow?: boolean }) => (props) => {
          if (isInTable(props.state)) return false;
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
    };
  },
  addProseMirrorPlugins() {
    // Keep the base table plugins (tableEditing, etc.) and add the drop guard.
    return [...(this.parent?.() ?? []), tableDropGuard()];
  },
});
