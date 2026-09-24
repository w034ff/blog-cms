import { describe, expect, it } from 'vitest';
import type { Slice } from '@tiptap/pm/model';
import { titleAcceptsSlice } from './details-slice-guard';
import { pasteIntoCellRefused, tableDropRefusal } from './table-cell-rules';
import { docOf, nodes, nodeSlice, para, rangeSlice, tableFixture, text } from './test-schema';

// docs/embed-requirements.md §5 and §12's first item: **no new slice guard is needed** for the
// embed, because the existing guards are written as "what does this destination accept". Same file
// as link-card-placement.test.ts, for the node that came after it.
//
// What makes these measurements rather than restatements: the tripwire that fails if the embed is
// ever made inline (docs/accordion-requirements.md §6.5), and the negative controls, without which
// a rule refusing everything would pass.
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
    // The tripwire: `titleAcceptsSlice` lets inline atoms through (accordion §6.5), so the embed is
    // covered only while it is a block. If this goes red, read §6.5.
    expect(detailsSummary.contentMatch.matchType(embed)).toBeNull();
  });

  it('cannot be built into an accordion title at all', () => {
    // createChecked: `create` ignores the content expression and would pass vacuously.
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
    // The negative control: the gesture the guard must not take away.
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
    // 'content' is the refusal that comes with a notice.
    expect(tableDropRefusal($inCell, wholeEmbedSlice())).toBe('content');
  });

  it('still accepts an ordinary paragraph paste into a cell', () => {
    expect(pasteIntoCellRefused($inCell, rangeSlice(doc, 2, 5))).toBe(false);
  });
});
