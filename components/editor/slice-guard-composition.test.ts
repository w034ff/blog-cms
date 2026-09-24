import { describe, expect, it } from 'vitest';
import { Slice, type Node as PMNode } from '@tiptap/pm/model';
import { schema } from './test-schema';
import {
  flattenClosedCallouts,
  repairIncomingSlice,
  unwrapHalfSelectedCallouts,
} from './callout-slice-guard';
import { flattenClosedDetails, unwrapHalfSelectedDetails } from './details-slice-guard';
import { dropOpenWrappers } from './slice-placement';

// What the two box guards do to a slice on its way into the editor, pinned shape by shape.
//
// A net, not a specification: it records what the pair produces today, which was the baseline the
// shared `box-slice-repair.ts` was extracted against. The schema is PostEditor's own
// (`test-schema.ts`), since these functions read node types and open depths.
const p = (text: string) => schema.nodes.paragraph.create(null, schema.text(text));
const callout = (...children: PMNode[]) => schema.nodes.callout.create(null, children);
const details = (...children: PMNode[]) => schema.nodes.details.create(null, children);
const summary = (text: string) => schema.nodes.detailsSummary.create(null, schema.text(text));
const detailsBody = (...children: PMNode[]) => schema.nodes.detailsContent.create(null, children);
const quote = (...children: PMNode[]) => schema.nodes.blockquote.create(null, children);
const doc = (...children: PMNode[]) => schema.nodes.doc.create(null, children);

// The slice a selection from `first` to `last` produces, from a real document and with
// `includeParents: true` as `Selection.content()` passes it — the two-argument form yields a
// minimal slice these guards never see (docs/editor-pitfalls.md §14).
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

// The order the editor runs on a paste: every `transformPasted` runs
// (`view.someProp("transformPasted", f => { slice = f(slice, view, asText) })`), and
// ExtensionManager reverses the array (`sortExtensions([...this.extensions].reverse())`), so the
// details guard, registered after Callout, is asked first.
const asPasted = (slice: Slice) => repairIncomingSlice(unwrapHalfSelectedDetails(slice));

// The order `drop-cursor-guard.ts` composes for the drop indicator.
const asDropIndicator = (slice: Slice) => unwrapHalfSelectedDetails(repairIncomingSlice(slice));

// Both unwraps first, `dropOpenWrappers` last — used by neither path, but it shows the order is
// free.
const dropLast = (slice: Slice) =>
  dropOpenWrappers(unwrapHalfSelectedDetails(unwrapHalfSelectedCallouts(slice)));

const shape = (slice: Slice) => `${slice.content.toString()} (${slice.openStart},${slice.openEnd})`;

const withTitle = (body = 'abcd') => details(summary('タイトル'), detailsBody(p(body)));

// Every reachable selection either guard has an opinion about.
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

// Why composition order is not a parameter of box-slice-repair.ts: the operations have **disjoint
// preconditions**. `dropOpenWrappers` acts only on `openStart > 1 && openEnd > 1 && childCount ===
// 1`, exactly the shape `halfSelectedEdges` early-returns on, and an unwrap always leaves more than
// one child. So they commute.
describe('the composition order does not change the result', () => {
  for (const { name, slice } of cases) {
    it(name, () => {
      const pasted = shape(asPasted(slice));
      expect(shape(asDropIndicator(slice))).toBe(pasted);
      expect(shape(dropLast(slice))).toBe(pasted);
    });
  }
});

// Two reachable selections leave an accordion's children bare at the slice's top level: the
// selection stays inside one accordion, so `halfSelectedEdges` sees no `details` at an edge, and
// `dropOpenWrappers` stops on the `detailsSummary` textblock. Measured in a browser, this is not a
// defect: at a block position the fitter turns `detailsSummary` into a paragraph
// (docs/editor-pitfalls.md §14).
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

// `flattenClosed*`, the paste answer to a *whole* box headed where it may not go, at every depth.
// Called directly: the position question (`wouldNest*`) belongs to specs with a live editor.
describe('what flattenClosed makes of a whole box in the slice', () => {
  it('takes a callout out of a quote and keeps its blocks', () => {
    const slice = new Slice(doc(quote(callout(p('中身')))).content, 0, 0);
    expect(shape(flattenClosedCallouts(slice))).toBe('<blockquote(paragraph("中身"))> (0,0)');
  });

  it('takes a callout out of a callout, at every depth', () => {
    const slice = new Slice(doc(callout(p('外'), callout(p('内')))).content, 0, 0);
    expect(shape(flattenClosedCallouts(slice))).toBe('<paragraph("外"), paragraph("内")> (0,0)');
  });

  it('leaves a slice with no callout in it identical', () => {
    const slice = new Slice(doc(quote(p('中身'))).content, 0, 0);
    expect(flattenClosedCallouts(slice)).toBe(slice);
  });

  it('takes an accordion out of a quote, title first as a paragraph', () => {
    const slice = new Slice(doc(quote(withTitle('本文'))).content, 0, 0);
    expect(shape(flattenClosedDetails(slice))).toBe(
      '<blockquote(paragraph("タイトル"), paragraph("本文"))> (0,0)',
    );
  });

  it('drops an empty title rather than leaving an empty paragraph', () => {
    const bare = details(schema.nodes.detailsSummary.create(), detailsBody(p('本文')));
    const slice = new Slice(doc(quote(bare)).content, 0, 0);
    expect(shape(flattenClosedDetails(slice))).toBe('<blockquote(paragraph("本文"))> (0,0)');
  });

  it('leaves a slice with no accordion in it identical', () => {
    const slice = new Slice(doc(quote(p('中身'))).content, 0, 0);
    expect(flattenClosedDetails(slice)).toBe(slice);
  });

  // `recurseIntoRemoved`: the callout flattens a callout nested in a callout; the accordion leaves a
  // box carried inside the body it lifts out as it was.
  it('does not recurse into what it lifts out of an accordion body', () => {
    const nested = details(summary('外'), detailsBody(quote(withTitle('内'))));
    const slice = new Slice(doc(nested).content, 0, 0);
    expect(shape(flattenClosedDetails(slice))).toBe(
      '<paragraph("外"), blockquote(details(detailsSummary("タイトル"), detailsContent(paragraph("内"))))> (0,0)',
    );
  });
});
