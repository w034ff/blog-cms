import type { ResolvedPos, Slice } from '@tiptap/pm/model';

// What a table cell may receive, and where a drop into a table may land (docs/editor-requirements.md
// §2). Asked by table-extensions.ts, drop-cursor-guard.ts and isolating-boundary.ts; kept out of
// table-extensions.ts because isolating-boundary.ts → drop-target.ts → table-extensions.ts would
// otherwise close an import cycle.

// Is the caret (or either end of the selection, or a drop's resolved target) inside a table cell?
function isInTableCell($pos: ResolvedPos): boolean {
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const role: string | undefined = $pos.node(depth).type.spec.tableRole;
    if (role === 'cell' || role === 'header_cell') return true;
  }
  return false;
}

// Does the slice carry a block a cell cannot hold? Cells are `paragraph+` (ParagraphTableCell); any
// other block splits the table around it, leaving a headerless second table
// (docs/editor-requirements.md §2). Only the slice's top level is examined, so inline content and
// paragraph-only slices — an ordinary Ctrl+V — are never refused. Text from inside a box arrives
// with the box already dropped (dropOpenWrappers), so a callout here is one that would be placed.
//
// `allowTable` is true only for paste, where prosemirror-tables' own `handlePaste` owns every
// table-carrying slice and merges it cell-wise. It has no `handleDrop` counterpart, so a dropped
// table tears the host table like any other block (§2.2).
function carriesNonParagraphBlock(slice: Slice, { allowTable = false } = {}): boolean {
  let found = false;
  slice.content.forEach((child) => {
    if (allowTable && child.type.spec.tableRole !== undefined) return;
    if (child.isBlock && child.type.name !== 'paragraph') found = true;
  });
  return found;
}

// Why a drop is refused, or null when it is allowed (docs/editor-requirements.md §2.3):
//
//   • 'structure' — the *position* would create table structure: between cells (fixTables then adds
//     a spurious column) or at a cell's block level (a second paragraph loses the pipe form).
//     Silent, because the drop indicator is already hidden there.
//   • 'content' — the *slice* carries a block no cell may hold. Gets the paste guard's notice, since
//     a refused gesture otherwise tells the author nothing.
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

// The paste half. Position is not asked: a caret always sits inside a cell's paragraph, so the
// position test would allow every paste.
export function pasteIntoCellRefused($pos: ResolvedPos, slice: Slice): boolean {
  return isInTableCell($pos) && carriesNonParagraphBlock(slice, { allowTable: true });
}

// Is the selection sitting inside one cell? The Enter binding's gate (see MarkdownTable), asked of
// both ends so a selection that leaves the cell is somebody else's business — the isolating clamp's.
export function selectionInsideCell($from: ResolvedPos, $to: ResolvedPos): boolean {
  return isInTableCell($from) && isInTableCell($to);
}
