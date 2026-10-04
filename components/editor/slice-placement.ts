import { Slice } from '@tiptap/pm/model';

// A selection made wholly inside one textblock should behave the same wherever it was made.
//
// It does not, out of the box: text selected in a paragraph gives `Slice(paragraph("…"), 1, 1)`,
// but inside a callout `Slice(callout(paragraph("…")), 2, 2)`. Dropped at a *block* position,
// ProseMirror closes what is open and the wrapper materialises — text dragged out of a callout
// arrived inside a new, nested callout.
//
// So wrapper levels open on *both* sides are dropped here, where the slice enters the editor. That
// makes "does this slice contain X" and "would it place an X" the same question again, so guards
// can read the content directly. Answering the second question at the predicates instead fails for
// block destinations: whether the box materialises is not a property of the slice alone.
//
// The innermost textblock is kept — `Slice(paragraph("…"), 1, 1)`, not a bare text fragment — so a
// block-position drop still lands as a paragraph rather than as inline content with nowhere to go.
// Stepping in only while there is a single child is what keeps this exact: two children means the
// first one's end is a real boundary, so it is placed and the slice describes a genuine structure.
export function dropOpenWrappers(slice: Slice): Slice {
  let { content, openStart, openEnd } = slice;
  while (openStart > 1 && openEnd > 1 && content.childCount === 1) {
    const only = content.firstChild;
    if (!only || only.isTextblock) break;
    content = only.content;
    openStart -= 1;
    openEnd -= 1;
  }
  return openStart === slice.openStart ? slice : new Slice(content, openStart, openEnd);
}
