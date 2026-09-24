import { describe, expect, it } from 'vitest';
import type { Slice } from '@tiptap/pm/model';
import { titleAcceptsSlice } from './details-slice-guard';
import { pasteIntoCellRefused, tableDropRefusal } from './table-cell-rules';
import { docOf, nodes, nodeSlice, para, rangeSlice, tableFixture, text } from './test-schema';

// docs/link-card-requirements.md §5.4, criteria 6a/6b. `available` on the slash row covers the
// gesture; a card arriving by paste or drop never passes through it, and this is what answers for
// that half.
//
// **No new guard was needed:** both existing guards are written as "what does this destination
// accept", so a block node added later is covered without being named. Unlike the footnote
// reference, an inline atom `titleAcceptsSlice` lets through (accordion §6.5), the card is a block;
// if it is ever made inline, these go red.
const { details, detailsSummary, detailsContent, linkCard } = nodes;

const card = () => linkCard.create({ href: '/posts/abc123' });

// doc(paragraph[0..6], linkCard[6..7], paragraph[7..13]) — a card with a paragraph on each side,
// which is what a reference on its own line becomes once it is carded.
const doc = docOf(para('前の段落'), card(), para('後の段落'));

// What the block drag handle produces: the whole node, closed on both sides.
const cardSlice = (): Slice => nodeSlice(doc, 6);

// The cross-edge copy: from inside the paragraph above, past the card, into the one below.
const acrossCardSlice = (): Slice => rangeSlice(doc, 3, 9);

describe('the fixtures are the shapes the gestures really produce', () => {
  it('the drag handle slice is one closed card', () => {
    const slice = cardSlice();
    expect(slice.openStart).toBe(0);
    expect(slice.openEnd).toBe(0);
    expect(slice.content.childCount).toBe(1);
    expect(slice.content.firstChild?.type.name).toBe('linkCard');
  });

  it('the cross-edge slice carries the card between two open paragraphs', () => {
    const slice = acrossCardSlice();
    expect(slice.openStart).toBe(1);
    expect(slice.openEnd).toBe(1);
    expect(slice.content.childCount).toBe(3);
    expect(slice.content.child(1).type.name).toBe('linkCard');
  });
});

describe('the link card is a block node, so the schema itself refuses it in a title', () => {
  it('is not accepted by `detailsSummary`', () => {
    // What the guard enforces before ProseMirror "makes room" by splitting the accordion.
    expect(detailsSummary.contentMatch.matchType(linkCard)).toBeNull();
  });

  it('cannot be built into an accordion title at all', () => {
    // createChecked: `create` ignores the content expression and would pass vacuously.
    expect(() => detailsSummary.createChecked(null, card())).toThrow();
    // …while the accordion around a legal title builds fine, so the refusal above is the title's
    // and not some other part of the shape.
    expect(() =>
      details.createChecked(null, [
        detailsSummary.createChecked(null, text('タイトル')),
        detailsContent.createChecked(null, para('本文')),
      ]),
    ).not.toThrow();
  });
});

describe('titleAcceptsSlice — the accordion title, paste and drop (6a)', () => {
  it('refuses a slice carrying a whole card', () => {
    expect(titleAcceptsSlice(cardSlice())).toBe(false);
  });

  it('refuses a card travelling alongside a paragraph', () => {
    // The reachable shape: a selection that swept from the paragraph above, across the card, into
    // the one below.
    expect(titleAcceptsSlice(acrossCardSlice())).toBe(false);
  });

  it('still accepts an ordinary in-paragraph text copy', () => {
    // The gesture the guard must not take away — pinned here too, because a rule tightened for
    // the card that also refused this would be a regression nothing else in this file would see.
    expect(titleAcceptsSlice(rangeSlice(doc, 2, 5))).toBe(true);
  });
});

describe('table cells — paste and drop (6b)', () => {
  const { $inCell } = tableFixture();

  it('the caret used by these tests really is inside a cell', () => {
    expect($inCell.node($inCell.depth - 1).type.name).toBe('tableCell');
  });

  it('refuses a pasted card', () => {
    // Cells are `paragraph+`; a block beside the paragraph splits the table in two around it.
    expect(pasteIntoCellRefused($inCell, cardSlice())).toBe(true);
  });

  it('refuses a dropped card, and for the content reason rather than the position one', () => {
    // 'content' is the refusal that comes with a notice.
    expect(tableDropRefusal($inCell, cardSlice())).toBe('content');
  });

  it('still accepts an ordinary paragraph paste into a cell', () => {
    expect(pasteIntoCellRefused($inCell, rangeSlice(doc, 2, 5))).toBe(false);
  });
});
