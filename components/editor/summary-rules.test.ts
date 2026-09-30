import { describe, expect, it } from 'vitest';
import { Fragment, type Node as PMNode, type Slice } from '@tiptap/pm/model';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import {
  boxesToDemote,
  demoteExtraBoxes,
  dropRuleBreak,
  newRuleBreak,
  pasteSlice,
  sectionsHoldOnlyLists,
  summaryNotLast,
  unwrapHalfSelectedBoxes,
} from './summary-rules';
import { docOf, nodes, nodeSlice, para, rangeSlice, schema } from './test-schema';

// The まとめ / TL;DR placement rules (docs/summary-requirements.md §3.2, §7) against the editor's own
// schema. The gestures that reach them are wired in summary-extension.ts and shown in
// e2e/editor-summary.spec.ts; this file owns the predicates.

const item = (text: string) => nodes.listItem.create(null, para(text));
const list = (...texts: string[]) => nodes.bulletList.create(null, texts.map(item));
const good = (...texts: string[]) => nodes.summaryGood.create(null, list(...texts));
const bad = (...texts: string[]) => nodes.summaryBad.create(null, list(...texts));
const summary = (overall: string[], ...sections: PMNode[]) =>
  nodes.summary.create(null, [...overall.map((text) => para(text)), ...sections]);
const tldr = (...texts: string[]) =>
  nodes.tldr.create(
    null,
    texts.map((text) => para(text)),
  );
const quote = (...content: PMNode[]) => nodes.blockquote.create(null, content);

// Every textblock's text, in document order: what "no character is lost" is measured on.
function textblocks(doc: PMNode): string[] {
  const out: string[] = [];
  doc.descendants((node) => {
    if (node.isTextblock) out.push(node.textContent);
    return !node.isTextblock;
  });
  return out;
}

function count(doc: PMNode, name: string): number {
  let n = 0;
  doc.descendants((node) => {
    if (node.type.name === name) n += 1;
  });
  return n;
}

// The position of the top-level child at `index`.
function childPos(doc: PMNode, index: number): number {
  let pos = 0;
  for (let i = 0; i < index; i += 1) pos += doc.child(i).nodeSize;
  return pos;
}

function paste(doc: PMNode, at: number, slice: Slice): PMNode {
  const state = EditorState.create({ schema, doc, selection: TextSelection.create(doc, at) });
  const place = (candidate: Slice) => state.tr.replaceSelection(candidate);
  return place(pasteSlice(state, slice, place)).doc;
}

describe('the schema', () => {
  it('keeps 良かった点 before 気になった点, and the 総評 first', () => {
    const { summary: box } = nodes;
    expect(box.validContent(Fragment.from([para('総評'), good('a'), bad('b')]))).toBe(true);
    expect(box.validContent(Fragment.from([para('総評'), bad('b'), good('a')]))).toBe(false);
    expect(box.validContent(Fragment.from([good('a')]))).toBe(false);
  });
});

describe('demoting on load', () => {
  const doc = docOf(
    tldr('一つ目の要点'),
    para('本文'),
    tldr('二つ目の要点'),
    quote(tldr('引用の中の要点')),
    summary(['一つ目の総評'], good('良い')),
    para('後書き'),
    summary(['二つ目の総評', '続き'], bad('悪い', '**太字**')),
  );

  it('keeps the first top-level box of each type and demotes the rest', () => {
    expect(boxesToDemote(doc).map(({ node }) => node.textContent)).toEqual([
      '二つ目の要点',
      '引用の中の要点',
      '二つ目の総評続き悪い**太字**',
    ]);
  });

  it('loses no character, and names each demoted list by its section', () => {
    const state = EditorState.create({ schema, doc });
    const { tr } = state;
    expect(demoteExtraBoxes(tr)).toBe(true);
    expect(count(tr.doc, 'tldr')).toBe(1);
    expect(count(tr.doc, 'summary')).toBe(1);

    const before = textblocks(doc);
    const after = textblocks(tr.doc);
    // The one addition is the section's title, as a paragraph ahead of its list.
    expect(after).toEqual([...before.slice(0, 9), '気になった点', ...before.slice(9)]);
    const title = tr.doc.child(tr.doc.childCount - 2);
    expect(title.type.name).toBe('paragraph');
    expect(title.firstChild?.marks.map((mark) => mark.type.name)).toEqual(['bold']);
    expect(tr.doc.lastChild?.type.name).toBe('bulletList');
  });

  it('changes nothing in a post that keeps the rules', () => {
    const { tr } = EditorState.create({ schema, doc: docOf(tldr('要点'), para('本文')) });
    expect(demoteExtraBoxes(tr)).toBe(false);
    expect(tr.docChanged).toBe(false);
  });
});

describe('newRuleBreak', () => {
  const valid = docOf(tldr('要点'), para('本文'), summary(['総評'], good('良い')), para());

  it('lets blank lines and the footnotes follow the まとめ', () => {
    const footnotes = nodes.footnoteSection.createAndFill();
    expect(footnotes).not.toBeNull();
    const after = docOf(para('本文'), summary(['総評']), para(), para(), footnotes as PMNode);
    expect(summaryNotLast(after)).toBe(false);
    expect(newRuleBreak(valid, after)).toBeNull();
  });

  it('refuses text after the まとめ', () => {
    const after = docOf(tldr('要点'), para('本文'), summary(['総評'], good('良い')), para('追記'));
    expect(newRuleBreak(valid, after)).toBe('not-last');
  });

  it('refuses a second box of either type', () => {
    expect(newRuleBreak(valid, docOf(tldr('a'), tldr('b'), summary(['c'])))).toBe('duplicate-tldr');
    expect(newRuleBreak(valid, docOf(summary(['a']), summary(['b'])))).toBe('duplicate-summary');
  });

  it('refuses a box below the top level', () => {
    expect(newRuleBreak(valid, docOf(quote(tldr('要点')), summary(['総評'])))).toBe('nested');
  });

  it('refuses a block other than a list inside a section', () => {
    const code = nodes.codeBlock.create(null, schema.text('x'));
    const section = nodes.summaryGood.create(
      null,
      nodes.bulletList.create(null, nodes.listItem.create(null, [para('良い'), code])),
    );
    const after = docOf(summary(['総評'], section));
    expect(sectionsHoldOnlyLists(after)).toBe(false);
    expect(newRuleBreak(valid, after)).toBe('section-block');
  });

  it('keeps a post saved before the rules editable', () => {
    const legacy = docOf(summary(['総評']), para('後書き'));
    const edited = docOf(summary(['総評を直した']), para('後書き'));
    expect(newRuleBreak(legacy, edited)).toBeNull();
  });
});

describe('pasting a box', () => {
  const source = docOf(para('前'), tldr('要点'), summary(['総評'], good('良い')));
  const tldrSlice = nodeSlice(source, childPos(source, 1));
  const summarySlice = nodeSlice(source, childPos(source, 2));

  it('takes the slices from a whole-node selection', () => {
    expect([tldrSlice.openStart, tldrSlice.openEnd]).toEqual([0, 0]);
    expect(summarySlice.content.firstChild?.type.name).toBe('summary');
  });

  it('keeps a まとめ pasted at the end of a post that has none', () => {
    const doc = docOf(para('本文'), para());
    const result = paste(doc, doc.content.size - 1, summarySlice);
    expect(count(result, 'summary')).toBe(1);
    expect(summaryNotLast(result)).toBe(false);
  });

  it('demotes a まとめ pasted mid-post, where it could not stay last', () => {
    const doc = docOf(para('本文'), para('続き'));
    const result = paste(doc, 3, summarySlice);
    expect(count(result, 'summary')).toBe(0);
    expect(textblocks(result).join('|')).toContain('総評|良かった点|良い');
  });

  it('demotes a second まとめ, keeping the first', () => {
    const doc = docOf(para('本文'), summary(['元の総評']), para());
    const result = paste(doc, doc.content.size - 1, summarySlice);
    expect(count(result, 'summary')).toBe(1);
    expect(textblocks(result)).toContain('元の総評');
    expect(textblocks(result)).toContain('総評');
  });

  it('demotes a second TL;DR, and a TL;DR pasted into a quote', () => {
    const withOne = docOf(tldr('元の要点'), para('本文'));
    expect(count(paste(withOne, withOne.content.size - 1, tldrSlice), 'tldr')).toBe(1);

    const quoted = docOf(quote(para('引用')), para());
    const result = paste(quoted, 3, tldrSlice);
    expect(count(result, 'tldr')).toBe(0);
    expect(textblocks(result)).toContain('要点');
  });

  it('keeps a TL;DR pasted anywhere at the top level of a post that has none', () => {
    const doc = docOf(para('本文'), para('続き'));
    expect(count(paste(doc, 3, tldrSlice), 'tldr')).toBe(1);
  });
});

describe('unwrapHalfSelectedBoxes', () => {
  it('opens a TL;DR the selection entered part-way', () => {
    const doc = docOf(tldr('要点の文'), para('次の段落'));
    const slice = rangeSlice(doc, 3, doc.content.size - 3);
    expect([slice.content.firstChild?.type.name, slice.openStart, slice.openEnd]).toEqual([
      'tldr',
      2,
      1,
    ]);
    const opened = unwrapHalfSelectedBoxes(slice);
    expect(opened.content.firstChild?.type.name).toBe('paragraph');
    expect([opened.openStart, opened.openEnd]).toEqual([1, 1]);
  });

  it('opens a まとめ entered through a section by two levels, without its title', () => {
    const doc = docOf(para('前の段落'), summary(['総評'], good('良い点')));
    const slice = rangeSlice(doc, 3, doc.content.size - 5);
    expect([slice.content.lastChild?.type.name, slice.openEnd]).toEqual(['summary', 5]);
    const opened = unwrapHalfSelectedBoxes(slice);
    expect(opened.content.lastChild?.type.name).toBe('bulletList');
    expect(opened.openEnd).toBe(3);
    expect(opened.content.textBetween(0, opened.content.size, '|')).not.toContain('良かった点');
  });

  it('leaves a selection inside one box to dropOpenWrappers', () => {
    const doc = docOf(tldr('要点の文'), para());
    const slice = rangeSlice(doc, 3, 5);
    expect(unwrapHalfSelectedBoxes(slice)).toBe(slice);
  });
});

describe('dropRuleBreak', () => {
  const source = docOf(tldr('要点'), para('本文'));
  const tldrSlice = nodeSlice(source, 0);
  const textSlice = rangeSlice(docOf(para('文字')), 1, 3);
  const doc = docOf(para('本文'), quote(para('引用')), summary(['総評']), para());

  it('refuses anything landing below the まとめ, text included', () => {
    const trailing = doc.resolve(doc.content.size - 1);
    expect(trailing.parent.type.name).toBe('paragraph');
    expect(dropRuleBreak(trailing, textSlice, true)).toBe('not-last');
    expect(dropRuleBreak(doc.resolve(doc.content.size), tldrSlice, true)).toBe('not-last');
  });

  it('lets text into the まとめ and a TL;DR into a top-level gap above it', () => {
    expect(dropRuleBreak(doc.resolve(childPos(doc, 2) + 2), textSlice, true)).toBeNull();
    expect(dropRuleBreak(doc.resolve(childPos(doc, 1)), tldrSlice, true)).toBeNull();
  });

  it('refuses a box headed into a quote', () => {
    expect(dropRuleBreak(doc.resolve(childPos(doc, 1) + 2), tldrSlice, true)).toBe('nested');
  });

  it('refuses a copy of a box the post has, not a move of it', () => {
    const withOne = docOf(tldr('要点'), para('本文'), para());
    const gap = withOne.resolve(withOne.content.size);
    expect(dropRuleBreak(gap, tldrSlice, false)).toBe('duplicate-tldr');
    // A move resolves in the document after its source is gone.
    const afterDeletion = docOf(para('本文'), para());
    expect(dropRuleBreak(afterDeletion.resolve(afterDeletion.content.size), tldrSlice, true)).toBeNull();
  });
});
