import { describe, expect, it } from 'vitest';
import { getSchema } from '@tiptap/core';
import { TableKit } from '@tiptap/extension-table';
import StarterKit from '@tiptap/starter-kit';
import { Slice, type Node as PMNode, type Schema } from '@tiptap/pm/model';
import { Callout } from './callout-extension';
import { repairIncomingSlice, unwrapHalfSelectedCallouts } from './callout-slice-guard';
import { unwrapHalfSelectedDetails } from './details-slice-guard';
import { dropOpenWrappers } from './slice-placement';
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
import { ParagraphTableCell, ParagraphTableHeader } from './table-extensions';

// What the two box guards do to a slice on its way into the editor, pinned shape by shape.
//
// Written before any attempt to share code between `callout-slice-guard.ts` and
// `details-slice-guard.ts` — the two are structurally near-identical and a factory over
// `{ nodeName, unwrap, depthDrop }` is the obvious move, but nothing had recorded what the pair
// currently produces, so there was nothing for such a change to be measured against. That is what
// this file is: a net, not a specification. A shape it records is what happens today, which is not
// always the same as what should.
//
// The drop half of this cannot be driven end-to-end — an in-editor drag never fires `dragstart`
// under CDP — and the paste half only reaches these functions through a real clipboard, so a unit
// test over `doc.slice()` is the instrument that covers both. The schema is the one PostEditor
// actually builds, for the reason `details-title-slice.test.ts` gives: what these functions read is
// node types and open depths, and a schema written to suit the test would prove nothing.
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

const p = (text: string) => schema.nodes.paragraph.create(null, schema.text(text));
const callout = (...children: PMNode[]) => schema.nodes.callout.create(null, children);
const details = (...children: PMNode[]) => schema.nodes.details.create(null, children);
const summary = (text: string) => schema.nodes.detailsSummary.create(null, schema.text(text));
const detailsBody = (...children: PMNode[]) => schema.nodes.detailsContent.create(null, children);
const quote = (...children: PMNode[]) => schema.nodes.blockquote.create(null, children);
const doc = (...children: PMNode[]) => schema.nodes.doc.create(null, children);

// The slice a selection from `first` to `last` produces, built the way the editor builds it rather
// than by hand. Two things about that matter and both were got wrong on the way here.
//
// A hand-written `new Slice(…, 3, 3)` can describe a shape no selection can make, so the positions
// come from a real document. And the third argument to `slice` is `includeParents`, which
// `Selection.content()` passes as **true** (`this.$from.doc.slice(this.from, this.to, true)`) — it
// is what puts the callout or the accordion into the slice in the first place. Calling the two-
// argument form instead yields the minimal slice, `<"bc"> (0,0)` for a selection inside a box,
// which is a shape these guards have nothing to say about: the first draft of this file did that
// and every case passed with `dropOpenWrappers` disabled outright.
function sliceBetween(document: PMNode, first: string, last: string): Slice {
  let from = -1;
  let to = -1;
  document.descendants((node, pos) => {
    if (!node.isText) return true;
    const text = node.text ?? '';
    const start = text.indexOf(first);
    if (start >= 0 && from < 0) from = pos + start;
    const end = text.indexOf(last);
    if (end >= 0) to = pos + end + last.length;
    return true;
  });
  if (from < 0 || to < 0) throw new Error(`no selection from "${first}" to "${last}"`);
  return document.slice(from, to, true);
}

// The order the editor really runs on a paste. prosemirror-view's `transformPasted` callback
// returns undefined, so `someProp` never short-circuits and every registered one runs
// (prosemirror-view `view.someProp("transformPasted", f => { slice = f(slice, view, asText) })`);
// ExtensionManager reverses the extensions array before gathering plugins
// (`sortExtensions([...this.extensions].reverse())`), and `MarkdownDetails` sits after `Callout` in
// that array, so the details guard is asked first.
const asPasted = (slice: Slice) => repairIncomingSlice(unwrapHalfSelectedDetails(slice));

// The order `drop-cursor-guard.ts` composes by hand for the drop indicator, and the one
// `details-slice-guard.ts`'s own comment describes ("dropOpenWrappers has already taken that
// wrapper off before any of this runs") — which is true there and not on the paste path above.
const asDropIndicator = (slice: Slice) => unwrapHalfSelectedDetails(repairIncomingSlice(slice));

// Both unwraps first, `dropOpenWrappers` last. Neither path does this today; it is here because a
// shared factory would make the composition an explicit choice, and this says what choosing it
// would cost.
const dropLast = (slice: Slice) =>
  dropOpenWrappers(unwrapHalfSelectedDetails(unwrapHalfSelectedCallouts(slice)));

const shape = (slice: Slice) => `${slice.content.toString()} (${slice.openStart},${slice.openEnd})`;

const withTitle = (body = 'abcd') => details(summary('タイトル'), detailsBody(p(body)));

// Every selection reachable in the editor that either guard has an opinion about, and what the
// pair currently turns it into.
const cases: { name: string; slice: Slice; out: string }[] = [
  {
    name: 'text inside a callout',
    slice: sliceBetween(doc(callout(p('abcd'))), 'bc', 'bc'),
    out: '<paragraph("bc")> (1,1)',
  },
  {
    name: "text inside an accordion's body",
    slice: sliceBetween(doc(withTitle()), 'bc', 'bc'),
    out: '<paragraph("bc")> (1,1)',
  },
  {
    name: "text inside an accordion's title",
    slice: sliceBetween(doc(withTitle()), 'イト', 'イト'),
    out: '<detailsSummary("イト")> (1,1)',
  },
  {
    name: 'a callout body running into the paragraph after it',
    slice: sliceBetween(doc(callout(p('abcd')), p('efgh')), 'bc', 'fg'),
    out: '<paragraph("bcd"), paragraph("efg")> (1,1)',
  },
  {
    name: 'an accordion body running into the paragraph after it',
    slice: sliceBetween(doc(withTitle(), p('efgh')), 'bc', 'fg'),
    out: '<paragraph("bcd"), paragraph("efg")> (1,1)',
  },
  {
    name: "the paragraph before running into an accordion's title",
    slice: sliceBetween(doc(p('efgh'), withTitle()), 'fg', 'イト'),
    out: '<paragraph("fgh"), paragraph("タイト")> (1,0)',
  },
  {
    // A whole accordion is a real box and would stay one where it may go — but this selection
    // reaches past its end, so the box is half-selected and comes apart. The title returns as a
    // paragraph, which is `detailsUnwrapped`'s answer and the difference from the callout's.
    name: 'a whole accordion plus the paragraph after it',
    slice: sliceBetween(doc(withTitle(), p('efgh')), 'タイ', 'fg'),
    out: '<paragraph("タイトル"), paragraph("abcd"), paragraph("efg")> (0,1)',
  },
  {
    // A quote holding a box loads from stored markdown even though it can no longer be authored.
    name: 'text inside a quoted callout',
    slice: sliceBetween(doc(quote(callout(p('abcd')))), 'bc', 'bc'),
    out: '<paragraph("bc")> (1,1)',
  },
  {
    name: "text inside a quoted accordion's body",
    slice: sliceBetween(doc(quote(withTitle())), 'bc', 'bc'),
    out: '<paragraph("bc")> (1,1)',
  },
  {
    name: 'a callout and an accordion, each half-selected at its own end',
    slice: sliceBetween(doc(callout(p('abcd')), withTitle('efgh')), 'bc', 'fg'),
    out: '<paragraph("bcd"), paragraph("タイトル"), paragraph("efg")> (1,1)',
  },
];

describe('what the box guards make of a pasted slice', () => {
  for (const { name, slice, out } of cases) {
    it(name, () => {
      expect(shape(asPasted(slice))).toBe(out);
    });
  }
});

// The fact that unblocks sharing code between the two guards, recorded so it is not re-derived.
//
// The composition order looked like a fourth axis of variation — the callout guard folds
// `dropOpenWrappers` into its own `transformPasted` while the details guard never calls it, so the
// two sit at different points in the pipeline and a naive factory would have to take the
// composition as a parameter too. It does not have to: the two operations have **disjoint
// preconditions**. `dropOpenWrappers` acts only on `openStart > 1 && openEnd > 1 && childCount ===
// 1`, and that is exactly the shape `halfSelectedEdges` early-returns on (`childCount === 1 &&
// start && end`); once either unwrap has spliced a box open the fragment has more than one child,
// which `dropOpenWrappers` steps over. So they commute, and the order is free.
describe('the composition order does not change the result', () => {
  for (const { name, slice } of cases) {
    it(name, () => {
      const pasted = shape(asPasted(slice));
      expect(shape(asDropIndicator(slice))).toBe(pasted);
      expect(shape(dropLast(slice))).toBe(pasted);
    });
  }
});

// Two reachable selections leave an accordion's own children bare at the slice's top level, where
// the schema has no place for them. Recorded as they stand rather than as defects: what they cost
// has not been measured.
//
// Neither guard is looking for this. `halfSelectedEdges` asks whether the slice's first and last
// child is a `details`; here they are a `detailsSummary` and a `detailsContent`, exposed because
// the selection stayed *inside* one accordion instead of crossing its edge. `dropOpenWrappers`
// then takes the `details` off — one child, both ends open — and stops on `detailsSummary`,
// because it is a textblock and keeping the innermost one is the rule that makes an ordinary
// selection land as a paragraph.
//
// Probably harmless at a textblock destination: both ends stay open, so the wrappers dissolve and
// only the text lands. A **block** destination is the open question — the drop indicator between
// two blocks, which is the case slice-placement.ts exists for. There ProseMirror closes what is
// open, and a `detailsSummary` cannot be closed at doc level. Whether that drops the text, refuses
// the drop, or leaves the document byte-identical (which reads as the gesture doing nothing) needs
// a browser, not this file.
describe('a selection that stays inside one accordion', () => {
  it('leaves a bare detailsSummary when it is taken from the title', () => {
    const slice = sliceBetween(doc(withTitle()), 'イト', 'イト');
    expect(shape(slice)).toBe('<details(detailsSummary("イト"))> (2,2)');
    expect(shape(asPasted(slice))).toBe('<detailsSummary("イト")> (1,1)');
  });

  it('leaves both children bare when it runs from the title into the body', () => {
    const slice = sliceBetween(doc(withTitle()), 'イト', 'bc');
    expect(shape(slice)).toBe(
      '<details(detailsSummary("イトル"), detailsContent(paragraph("abc")))> (2,3)',
    );
    expect(shape(asPasted(slice))).toBe(
      '<detailsSummary("イトル"), detailsContent(paragraph("abc"))> (1,2)',
    );
  });
});
