import type { ResolvedPos, Slice } from '@tiptap/pm/model';

// What a table cell may receive, and where a drop into a table may land — the two questions every
// gesture that puts content into a table has to answer, kept in one module because four callers ask
// them: the paste guard and the drop guard (table-extensions.ts), the drop *indicator*
// (drop-cursor-guard.ts), and the clamped drop (isolating-boundary.ts). The last one is also why
// they cannot live with the node: isolating-boundary.ts is imported by drop-target.ts, which
// table-extensions.ts imports, so reaching back the other way would close an import cycle.

// Is the caret (or either end of the selection, or a drop's resolved target) inside a table cell?
function isInTableCell($pos: ResolvedPos): boolean {
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const role: string | undefined = $pos.node(depth).type.spec.tableRole;
    if (role === 'cell' || role === 'header_cell') return true;
  }
  return false;
}

// Does the slice carry a block a cell cannot hold? Cells are `paragraph+` (see ParagraphTableCell),
// so a paragraph fits and any other block does not — a callout, blockquote, code block, image, list
// or nested table. Putting one in splits the table in two around it: ProseMirror satisfies the
// schema by closing the table before the block and opening a fresh one after, and the second table
// has no header row. Measured on a two-column table, pasting a callout into the body cell
// 「セルの中身」:
//
//   before  table(row(th, th), row(td("セルの中身"), td("二つ目")))
//   after   table(row(th, th), row(td("セル"), td)), callout(…), table(row(td("の中身"), td("二つ目")))
//
// Every caret position inside a body cell does this — start, middle and end alike — so there is no
// safe spot to allow. (The very first header cell is the one exception, and it fails differently:
// the block lands above the table instead.)
//
// Only the slice's own top level is examined. A paragraph containing an inline image, or a cell's
// worth of marked-up text, is fine and stays fine; what cannot go in is a block *beside* the
// paragraphs. Inline content and paragraph-only slices — an ordinary Ctrl+V — never reach the
// refusal, which is the property that matters most here. Text taken from inside a callout or a
// quote is one of those: its slice arrives with the box already dropped (dropOpenWrappers, in
// slice-placement.ts), so "carries a callout" here means one that would really be placed.
//
// `allowTable` is the one difference between the two gestures, and it is not a matter of taste.
// prosemirror-tables' own `handlePaste` claims every table-carrying paste and merges it cell-wise —
// that is the code which makes cell-to-cell paste work, and it runs before any guard here, so on the
// paste path the exemption states who owns the case rather than leaving it to plugin order. There is
// no `handleDrop` counterpart: a dropped table slice goes in through ProseMirror's ordinary fitting
// and tears the host table exactly as the other four blocks do. Measured — dragging a selection that
// covers a whole table into another table's cell leaves a headerless
// `table(tableRow(tableCell("元二")))` fragment behind, which saves as raw HTML — while a
// CellSelection drag, the gesture the exemption might have been protecting on this path, does
// nothing at all today. So the drop path asks the strict question.
function carriesNonParagraphBlock(slice: Slice, { allowTable = false } = {}): boolean {
  let found = false;
  slice.content.forEach((child) => {
    if (allowTable && child.type.spec.tableRole !== undefined) return;
    if (child.isBlock && child.type.name !== 'paragraph') found = true;
  });
  return found;
}

// Why a drop is refused, or null when it is allowed. Two reasons, and the caller needs to tell them
// apart because only one of them is worth interrupting the author for:
//
//   • 'structure' — the *position* would turn a text move into table structure: in a table but in no
//     cell (the gap between cells/rows), where ProseMirror fits the slice by creating a stray cell
//     that tableEditing's fixTables then rectangularizes into a whole spurious column; or in a cell
//     but at block level (its top/bottom edge, not inside the text), which adds a second paragraph
//     and costs the table its pipe form. Silent: the drop indicator is already hidden for these, so
//     the refusal is visible before the mouse is released.
//   • 'content' — the *slice* carries a block no cell may hold, wherever in the cell it lands. This
//     is the paste guard's question asked of a drop, and it gets the paste guard's notice with it: a
//     refused gesture changes nothing, so without one the author is told nothing at all.
//
// A drop inside a cell's textblock carrying only inline content or paragraphs (merges inline), or
// one entirely outside any table, is allowed and left to ProseMirror.
export type TableDropRefusal = 'structure' | 'content' | null;

export function tableDropRefusal($pos: ResolvedPos, slice: Slice): TableDropRefusal {
  let inTable = false;
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    if ($pos.node(depth).type.spec.tableRole === 'table') inTable = true;
  }
  if (!inTable) return null;
  if (!isInTableCell($pos)) return 'structure';
  if (carriesNonParagraphBlock(slice)) return 'content';
  return $pos.parent.isTextblock ? null : 'structure';
}

// The paste half of the same rule. The position is not asked at all here, and deliberately not: a
// caret always sits inside a cell's paragraph, so the position test above answers "allowed" for
// every paste into a cell and would guard nothing. What decides a paste is the slice.
export function pasteIntoCellRefused($pos: ResolvedPos, slice: Slice): boolean {
  return isInTableCell($pos) && carriesNonParagraphBlock(slice, { allowTable: true });
}

// Is the selection sitting inside one cell? The Enter binding's gate (see MarkdownTable), asked of
// both ends so a selection that leaves the cell is somebody else's business — the isolating clamp's.
export function selectionInsideCell($from: ResolvedPos, $to: ResolvedPos): boolean {
  return isInTableCell($from) && isInTableCell($to);
}
