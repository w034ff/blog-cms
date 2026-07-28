import { Slice } from '@tiptap/pm/model';

// A selection made wholly inside one textblock should behave the same wherever it was made.
//
// It does not, out of the box. `doc.slice` describes a range by how deep it was cut at each end, so
// selecting text in an ordinary paragraph gives `Slice(paragraph("…"), 1, 1)` while selecting text
// inside a callout gives `Slice(callout(paragraph("…")), 2, 2)` — the same three words, wrapped in a
// box nobody asked to move. Where that matters is the *destination*: dropped into a textblock both
// slices land as plain text (the open ends dissolve), but dropped at a **block** position — the
// horizontal drop indicator, between two blocks — ProseMirror has to close what is open, and the
// wrapper materialises. Text dragged out of a quote arrived inside a new quote; out of a callout,
// inside a new callout, which is the nested shape the callout guard exists to prevent.
//
// So the wrapper levels that are open on *both* sides are dropped here, at the point the slice
// enters the editor, and the slice arrives looking exactly like the ordinary-paragraph one. That
// makes the two questions a guard can ask — "does this slice contain X" and "would this slice place
// an X" — the same question again, which is what lets both guards go back to reading the content
// directly. (An earlier attempt answered the second question at the predicates instead; it was
// right for a textblock destination and wrong for a block one, because whether the box materialises
// is not a property of the slice alone.)
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
