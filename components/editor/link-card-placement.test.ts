import { describe, expect, it } from 'vitest';
import { getSchema } from '@tiptap/core';
import { TableKit } from '@tiptap/extension-table';
import StarterKit from '@tiptap/starter-kit';
import { Fragment, Slice } from '@tiptap/pm/model';
import type { Schema } from '@tiptap/pm/model';
import { Callout } from './callout-extension';
import { titleAcceptsSlice } from './details-slice-guard';
import {
  MarkdownDetails,
  MarkdownDetailsContent,
  MarkdownDetailsSummary,
} from './details-extension';
import {
  Document,
  FootnoteDefinition,
  FootnoteReference,
  FootnoteSection,
} from './footnote-extension';
import { LinkCard } from './link-card-extension';
import { pasteIntoCellRefused, tableDropRefusal } from './table-cell-rules';
import { ParagraphTableCell, ParagraphTableHeader } from './table-extensions';

// docs/link-card-requirements.md §5.4, criteria 6a/6b. `available` on the slash row covers the
// gesture; a card arriving by paste or drop never passes through it, and this is what answers for
// that half.
//
// The finding these pin is that **no new guard was needed**. Both existing guards are written as
// "what does this destination accept" rather than as a list of hostile node types — the accordion
// one says so explicitly — so a block node added later is covered without being named, and the
// link card is exactly such a node.
//
// This is also where the card differs from the footnote reference, and the difference is the whole
// reason one needed its own handlePaste in 2026-08-08 and the other does not: a footnote reference
// is an *inline* atom, and `titleAcceptsSlice` deliberately lets those through (§6.5 of the
// accordion document owns that question). The card is a *block* atom, so it lands on the covered
// side of that line. If the card is ever made inline, these tests go red and that is the signal.
//
// Written as a unit test for the same reason details-title-slice.test.ts is: an in-editor drag
// never fires `dragstart` under CDP, so the drop half cannot be driven end-to-end at all.
const schema: Schema = getSchema([
  StarterKit.configure({ document: false }),
  Document,
  TableKit.configure({ tableCell: false, tableHeader: false }),
  ParagraphTableCell,
  ParagraphTableHeader,
  FootnoteReference,
  FootnoteDefinition,
  FootnoteSection,
  Callout,
  MarkdownDetails,
  MarkdownDetailsSummary,
  MarkdownDetailsContent,
  LinkCard,
]);

const { details, detailsSummary, detailsContent, paragraph, linkCard, table, tableRow, tableCell } =
  schema.nodes;

const card = () => linkCard.create({ href: '/posts/abc123' });
const para = (value: string) => paragraph.create(null, value ? schema.text(value) : null);

// A card picked up whole — what the block drag handle's NodeSelection produces, and what a copy of
// a paragraph-plus-card range produces. Closed on both sides: a whole block was taken.
const cardSlice = () => new Slice(Fragment.from(card()), 0, 0);

describe('the link card is a block node, so the schema itself refuses it in a title', () => {
  it('is not accepted by `detailsSummary`', () => {
    // The schema-level fact the guard exists to enforce *before* ProseMirror gets a chance to
    // "make room" by splitting the accordion in two (the 2026-08-08 tear).
    expect(detailsSummary.contentMatch.matchType(linkCard)).toBeNull();
  });

  it('cannot be built into an accordion title at all', () => {
    // createChecked, not create: `create` writes whatever it is handed without consulting the
    // content expression, so the unchecked form builds this invalid node quite happily and would
    // have made this test pass for no reason.
    expect(() => detailsSummary.createChecked(null, card())).toThrow();
    // …while the accordion around a legal title builds fine, so the refusal above is the title's
    // and not some other part of the shape.
    expect(() =>
      details.createChecked(null, [
        detailsSummary.createChecked(null, schema.text('タイトル')),
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
    // The reachable shape: a selection that swept a paragraph and the card below it.
    const slice = new Slice(Fragment.fromArray([para('前の行'), card()]), 0, 0);
    expect(titleAcceptsSlice(slice)).toBe(false);
  });

  it('still accepts an ordinary in-paragraph text copy', () => {
    // The gesture the guard must not take away — pinned here too, because a rule tightened for
    // the card that also refused this would be a regression nothing else in this file would see.
    expect(titleAcceptsSlice(new Slice(Fragment.from(para('中身')), 1, 1))).toBe(true);
  });
});

describe('table cells — paste and drop (6b)', () => {
  // A caret inside a body cell, resolved from a real document: the cell rules walk ancestors, so
  // a hand-built position would not exercise them.
  const doc = schema.topNodeType.create(null, [
    table.create(null, [
      tableRow.create(null, [
        tableCell.create(null, para('セルの中身')),
        tableCell.create(null, para('二つ目')),
      ]),
    ]),
  ]);
  const $inCell = doc.resolve(doc.content.size - 'セルの中身'.length - 6);

  it('the caret used by these tests really is inside a cell', () => {
    expect($inCell.node($inCell.depth - 1).type.name).toBe('tableCell');
  });

  it('refuses a pasted card', () => {
    // Cells are `paragraph+`; a block beside the paragraph splits the table in two around it.
    expect(pasteIntoCellRefused($inCell, cardSlice())).toBe(true);
  });

  it('refuses a dropped card, and for the content reason rather than the position one', () => {
    // 'content' is the refusal that comes with a notice — the author is told why, which for a
    // slice-carried block is the only feedback a refused gesture can give.
    expect(tableDropRefusal($inCell, cardSlice())).toBe('content');
  });

  it('still accepts an ordinary paragraph paste into a cell', () => {
    expect(pasteIntoCellRefused($inCell, new Slice(Fragment.from(para('文字')), 1, 1))).toBe(false);
  });
});
