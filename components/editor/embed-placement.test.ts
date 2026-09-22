import { describe, expect, it } from 'vitest';
import type { Slice } from '@tiptap/pm/model';
import { titleAcceptsSlice } from './details-slice-guard';
import { pasteIntoCellRefused, tableDropRefusal } from './table-cell-rules';
import { docOf, nodes, nodeSlice, para, rangeSlice, tableFixture, text } from './test-schema';

// docs/embed-requirements.md §5 and §12's first item. §5 decided that **no new slice guard is
// needed** for the embed — the accordion title's `titleAcceptsSlice` and the table cell's
// `carriesNonParagraphBlock` were expected to cover it "for the same reason they cover the card" —
// and §12 recorded that as inference: paste and drop had never been measured.
//
// This is the same file link-card-placement.test.ts is, for the node that arrived after it, and the
// finding is the same: both guards are written as "what does this destination accept" rather than
// as a list of hostile node types, so a block node added later is covered without being named.
//
// **The predicates alone would pass before this file existed**, so what makes these measurements
// rather than restatements is the two things around them: the schema-level fact that would change
// if the embed were ever made inline (the tripwire — an inline atom is deliberately let through,
// docs/accordion-requirements.md §6.5), and the negative controls, without which a rule that
// refused *everything* would pass.
//
// The slices are taken from real selections rather than built by hand, and their open depths are
// asserted before they are used: a hand-built triple that happens to agree with the gesture proves
// nothing about the gesture.
const { details, detailsSummary, detailsContent, embed } = nodes;

const HREF = 'https://www.youtube.com/watch?v=hDPybQwAuVo';

// doc(paragraph[0..6], embed[6..7], paragraph[7..13]) — the reachable document: an embed with a
// paragraph on each side, which is what `<url>` on its own line becomes once it is made an embed.
const doc = docOf(para('前の段落'), embed.create({ href: HREF }), para('後の段落'));

// What the block drag handle produces: the whole node, closed on both sides. `DRAGGABLE_TYPES`
// carries `embed` (§5), so this is the slice a drag of one really hands the guards.
const wholeEmbedSlice = (): Slice => nodeSlice(doc, 6);

// The cross-edge copy: from inside the paragraph above, past the embed, into the one below. The
// shape a selection sweeping past an embed produces — open on both sides, three children.
const acrossEmbedSlice = (): Slice => rangeSlice(doc, 3, 9);

describe('the fixtures are the shapes the gestures really produce', () => {
  it('the drag handle slice is one closed embed', () => {
    const slice = wholeEmbedSlice();
    expect(slice.openStart).toBe(0);
    expect(slice.openEnd).toBe(0);
    expect(slice.content.childCount).toBe(1);
    expect(slice.content.firstChild?.type.name).toBe('embed');
  });

  it('the cross-edge slice carries the embed between two open paragraphs', () => {
    const slice = acrossEmbedSlice();
    expect(slice.openStart).toBe(1);
    expect(slice.openEnd).toBe(1);
    expect(slice.content.childCount).toBe(3);
    expect(slice.content.child(1).type.name).toBe('embed');
  });
});

describe('the embed is a block node, so the schema itself refuses it in a title', () => {
  it('is not accepted by `detailsSummary`', () => {
    // The tripwire. `titleAcceptsSlice` deliberately lets *inline* atoms through — that question
    // belongs to the footnote's placement guard (accordion §6.5) — so the embed sits on the covered
    // side of that line only for as long as it is a block. If it is ever made inline, this goes red
    // and §6.5 is the section to read, not this file.
    expect(detailsSummary.contentMatch.matchType(embed)).toBeNull();
  });

  it('cannot be built into an accordion title at all', () => {
    // createChecked, not create: `create` writes whatever it is handed without consulting the
    // content expression, so the unchecked form builds the invalid node happily and would have made
    // this test pass for no reason.
    expect(() => detailsSummary.createChecked(null, embed.create({ href: HREF }))).toThrow();
    // …while the accordion around a legal title builds fine, so the refusal above is the title's.
    expect(() =>
      details.createChecked(null, [
        detailsSummary.createChecked(null, text('タイトル')),
        detailsContent.createChecked(null, para('本文')),
      ]),
    ).not.toThrow();
  });
});

describe('titleAcceptsSlice — the accordion title, paste and drop', () => {
  it('refuses a slice carrying a whole embed', () => {
    expect(titleAcceptsSlice(wholeEmbedSlice())).toBe(false);
  });

  it('refuses an embed travelling between two paragraphs', () => {
    expect(titleAcceptsSlice(acrossEmbedSlice())).toBe(false);
  });

  it('still accepts an ordinary in-paragraph text copy', () => {
    // The negative control: the gesture the guard must not take away. Without it, a rule that
    // refused every slice would pass everything above.
    expect(titleAcceptsSlice(rangeSlice(doc, 2, 5))).toBe(true);
  });
});

describe('table cells — paste and drop', () => {
  const { $inCell } = tableFixture();

  it('the caret used by these tests really is inside a cell', () => {
    expect($inCell.node($inCell.depth - 1).type.name).toBe('tableCell');
  });

  it('refuses a pasted embed', () => {
    // Cells are `paragraph+`; a block beside the paragraph splits the table in two around it.
    expect(pasteIntoCellRefused($inCell, wholeEmbedSlice())).toBe(true);
  });

  it('refuses a dropped embed, and for the content reason rather than the position one', () => {
    // 'content' is the refusal that comes with a notice — the author is told why, which for a
    // slice-carried block is the only feedback a refused gesture can give.
    expect(tableDropRefusal($inCell, wholeEmbedSlice())).toBe('content');
  });

  it('still accepts an ordinary paragraph paste into a cell', () => {
    expect(pasteIntoCellRefused($inCell, rangeSlice(doc, 2, 5))).toBe(false);
  });
});
