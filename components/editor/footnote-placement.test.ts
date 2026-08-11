import { describe, expect, it } from 'vitest';
import { getSchema } from '@tiptap/core';
import { TableKit } from '@tiptap/extension-table';
import StarterKit from '@tiptap/starter-kit';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { Fragment, Slice } from '@tiptap/pm/model';
import type { Schema } from '@tiptap/pm/model';
import { Callout } from './callout-extension';
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
  hostRefusalAt,
  placementRefusal,
} from './footnote-extension';
import { ParagraphTableCell, ParagraphTableHeader } from './table-extensions';

// §6's placement rules, asked of the schema PostEditor actually builds rather than of a hand-written
// one — the whole point of the accordion case below is that it is the *node's content expression*
// that refuses, so a schema assembled to suit the test would prove nothing.
//
// Only the schema-shaped extensions are listed. The rest of PostEditor's array (the slash menu, the
// drag handle, the toolbar's guarded toggles) contributes commands and plugins, not nodes.
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
]);

const { details, detailsSummary, detailsContent, paragraph, footnoteReference } = schema.nodes;

// One accordion with a filled-in title and a one-line body, then a trailing paragraph — the shape
// `setDetails` leaves behind once the author has typed into both halves.
function docWithAccordion() {
  return schema.nodes.doc.create(null, [
    details.create(null, [
      detailsSummary.create(null, schema.text('タイトル')),
      detailsContent.create(null, paragraph.create(null, schema.text('本文'))),
    ]),
    paragraph.create(),
  ]);
}

// Positions inside the fixture: the title is text 2..6, the body's text 10..12.
const MID_TITLE = 4;
const MID_BODY = 11;

function stateWithCaretAt(pos: number): EditorState {
  const doc = docWithAccordion();
  return EditorState.create({ doc, schema, selection: TextSelection.create(doc, pos) });
}

describe('a footnote reference in an accordion title', () => {
  // The reason the guard exists, pinned as the failure rather than described. `detailsSummary` is
  // `text*`, so the reference has nowhere to go, and ProseMirror's fitter does not refuse — it
  // splits the accordion open to make room. This assertion is what turns red if a @tiptap bump ever
  // widens the summary's content expression, at which point the refusal below becomes a choice again
  // rather than a necessity.
  it('cannot be placed there at all, and forcing it tears the accordion in two', () => {
    expect(detailsSummary.contentMatch.matchType(footnoteReference)).toBeNull();

    const tr = stateWithCaretAt(MID_TITLE).tr;
    tr.replaceWith(MID_TITLE, MID_TITLE, footnoteReference.create({ label: 'fn-x' }));

    expect(tr.doc.childCount).toBe(3); // was 2 — a second, empty accordion appeared
    expect(tr.doc.child(0).firstChild?.textContent).toBe('タイ'); // half the title torn off
    expect(tr.doc.child(0).lastChild?.textContent).toBe('トル'); // and landed in the body
    expect(tr.doc.child(1).type).toBe(details);
    expect(tr.doc.child(1).firstChild?.textContent).toBe(''); // the spare's title is empty
  });

  it('is refused for the caret routes (Mod-Shift-F and the `[^` rule)', () => {
    expect(placementRefusal(stateWithCaretAt(MID_TITLE))).toBe(
      '脚注はアコーディオンのタイトル内には置けません。',
    );
  });

  // A selection dragged out of the title still counts, which is the property selectionTouches was
  // written for — `editor.isActive` would answer false here and wave it through.
  it('is refused for a range reaching out of the title', () => {
    const doc = docWithAccordion();
    const state = EditorState.create({
      doc,
      schema,
      selection: TextSelection.create(doc, MID_TITLE, MID_BODY),
    });
    expect(placementRefusal(state)).toBe('脚注はアコーディオンのタイトル内には置けません。');
  });

  // The paste and drop routes ask about a position, not a selection (§6.3).
  it('is refused for the paste and drop routes', () => {
    const doc = docWithAccordion();
    expect(hostRefusalAt(doc.resolve(MID_TITLE))).toBe(
      '脚注はアコーディオンのタイトル内には置けません。',
    );
  });
});

describe('a footnote reference in an accordion body', () => {
  it('is allowed by both guards', () => {
    expect(placementRefusal(stateWithCaretAt(MID_BODY))).toBeNull();
    expect(hostRefusalAt(docWithAccordion().resolve(MID_BODY))).toBeNull();
  });

  it('goes in without disturbing the accordion', () => {
    const tr = stateWithCaretAt(MID_BODY).tr;
    tr.replaceWith(MID_BODY, MID_BODY, footnoteReference.create({ label: 'fn-x' }));

    expect(tr.doc.childCount).toBe(2);
    expect(tr.doc.child(0).firstChild?.textContent).toBe('タイトル');
    expect(tr.doc.child(0).lastChild?.textContent).toBe('本文');
  });
});

// The refused paste falls back to `[^label]` as literal text (materializePendingNotes), and `text*`
// holds that happily — so the degraded path lands in the title without tearing anything.
describe('the refused paste degrades to plain text', () => {
  it('lands in the title intact', () => {
    const tr = stateWithCaretAt(MID_TITLE).tr;
    tr.replaceWith(MID_TITLE, MID_TITLE, schema.text('[^fn-x]'));

    expect(tr.doc.childCount).toBe(2);
    expect(tr.doc.child(0).firstChild?.textContent).toBe('タイ[^fn-x]トル');
  });
});

// Why the paste needs its own hook (§6.5) rather than the after-the-fact repair every other refused
// destination uses. `materializePendingNotes` asks `hostRefusalAt` about the reference's position
// *after* the slice has landed, which works for a table cell because the reference lands in the
// cell. It cannot work here: the reference never comes to rest in a `text*` node, so by the time the
// repair looks, the accordion has already been torn and the reference is sitting in an ordinary
// paragraph that refuses nothing.
describe('the after-the-fact repair is blind to the accordion title', () => {
  const carrying = (open: number) =>
    new Slice(
      Fragment.from(
        paragraph.create(null, [
          schema.text('本'),
          footnoteReference.create({ label: 'fn-x', pendingNote: 'A の注' }),
        ]),
      ),
      open,
      open,
    );

  // Both slice shapes a real paste produces: text selected inside a paragraph (open) and a whole
  // block (closed).
  for (const open of [0, 1]) {
    it(`sees no refusal once the slice has landed (openStart=${open})`, () => {
      const tr = stateWithCaretAt(MID_TITLE).tr;
      tr.replaceSelection(carrying(open));

      // The tear happened.
      expect(tr.doc.childCount).toBeGreaterThan(2);

      let landed = -1;
      tr.doc.descendants((node, pos) => {
        if (node.type === footnoteReference) landed = pos;
      });
      expect(landed).toBeGreaterThanOrEqual(0);
      // …and the guard that was supposed to answer for it has nothing to say.
      expect(hostRefusalAt(tr.doc.resolve(landed))).toBeNull();
    });
  }

  // Which is why handlePaste degrades the slice *before* it is placed. The degraded shape holds
  // plain text, which `text*` takes, so the ordinary paste lands in the title without tearing.
  it('but the degraded slice lands cleanly', () => {
    const degraded = new Slice(
      Fragment.from(paragraph.create(null, [schema.text('本[^fn-x]')])),
      1,
      1,
    );
    const tr = stateWithCaretAt(MID_TITLE).tr;
    tr.replaceSelection(degraded);

    expect(tr.doc.childCount).toBe(2);
    expect(tr.doc.child(0).firstChild?.textContent).toBe('タイ本[^fn-x]トル');
  });
});

// The enumeration the guard was sized from. `codeBlock` and `detailsSummary` are the only textblocks
// in this editor that refuse an inline atom; every other one takes a reference, and §6 refuses the
// table cell for a markdown reason rather than a schema one. A new `text*` node added later shows up
// here as a third name and needs its own row in hostRefusalAt.
describe('the textblocks that cannot hold an inline atom', () => {
  it('are exactly codeBlock and detailsSummary', () => {
    const refusing = Object.values(schema.nodes)
      .filter((type) => type.isTextblock)
      .filter((type) => type.contentMatch.matchType(footnoteReference) === null)
      .map((type) => type.name)
      .sort();

    expect(refusing).toEqual(['codeBlock', 'detailsSummary']);
  });
});
