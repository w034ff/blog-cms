import type { Fragment, Slice } from '@tiptap/pm/model';

// The part of a slice that is actually *placed* as nodes, as opposed to the part that merely
// describes where the selection was cut.
//
// `openStart`/`openEnd` count how many levels deep the slice was opened at each end, and a node
// opened on *both* sides has no boundary left for ProseMirror to preserve: only its content lands.
// Select text inside a callout and the slice is `Slice(callout(paragraph("…")), 2, 2)` — a callout
// node, which never becomes a callout anywhere it is dropped or pasted. Select from inside that
// callout out into the block below and the slice is opened on one side only; there the box is real,
// which is the case callout-slice-guard.ts repairs.
//
// So a guard reading "does this slice contain node X" answers a different question from "would
// this slice place an X", and gets the safe case exactly backwards: the both-sides-open slice is
// the harmless one, and it was the one being refused — text dragged out of a callout could not be
// dropped into a table cell or a quote, while the *edge-crossing* selection could, because the
// repair had already flattened that one down to paragraphs.
//
// Stepping in only while there is a single child is what keeps this exact: two children means the
// first one's end (or the last one's start) is a real boundary, so it is placed.
export function placedContent(slice: Slice): Fragment {
  let { content, openStart, openEnd } = slice;
  while (openStart > 0 && openEnd > 0 && content.childCount === 1) {
    const only = content.firstChild;
    if (!only) break;
    content = only.content;
    openStart -= 1;
    openEnd -= 1;
  }
  return content;
}
