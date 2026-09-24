import { describe, expect, it } from 'vitest';
import { Fragment, Slice } from '@tiptap/pm/model';
import { isInDetailsTitle, titleAcceptsSlice } from './details-slice-guard';
import { docOf, nodes, para, text } from './test-schema';

// §6.8's rule, asked of PostEditor's own schema (`test-schema.ts`), since what refuses is
// `detailsSummary`'s content expression. The paste half is also covered in
// `e2e/editor-details-title-guard.spec.ts`; both halves ask this one predicate.
//
// **The slices below are built by hand on purpose.** This file is a truth table over slice shapes —
// open depths and child counts — rather than a stand-in for one gesture, so `nodeSlice` and
// `rangeSlice` would narrow it rather than sharpen it. Where a test does stand for a gesture, those
// are what it should use.
const { details, detailsSummary, detailsContent, paragraph, callout, footnoteReference } = nodes;

describe('titleAcceptsSlice', () => {
  it('accepts a range copied from within one paragraph', () => {
    // What Ctrl+C over part of a line produces: one textblock, open on both sides, so only its
    // inline content is placed. This is the gesture the guard must not take away.
    const slice = new Slice(Fragment.from(para('中身')), 1, 1);
    expect(titleAcceptsSlice(slice)).toBe(true);
  });

  it('accepts bare inline content', () => {
    // A plain-text paste can arrive already unwrapped.
    expect(titleAcceptsSlice(new Slice(Fragment.from(text('中身')), 0, 0))).toBe(true);
  });

  it('refuses a range that crossed a paragraph boundary', () => {
    // Two children is the whole discriminator: the selection carried a block boundary, and it is
    // that boundary the fitter makes room for by splitting the accordion.
    const slice = new Slice(Fragment.fromArray([para('一つ目'), para('二つ目')]), 1, 1);
    expect(titleAcceptsSlice(slice)).toBe(false);
  });

  it('refuses a whole block taken with a node selection', () => {
    // Closed on both sides — a block wherever it is put, even though it is only a paragraph.
    expect(titleAcceptsSlice(new Slice(Fragment.from(para('段落')), 0, 0))).toBe(false);
  });

  it('refuses a box even when the slice is open around it', () => {
    const boxed = callout.create(null, para('囲みの中身'));
    expect(titleAcceptsSlice(new Slice(Fragment.from(boxed), 1, 1))).toBe(false);
  });

  it('lets an inline atom through, because §6.5 owns that question', () => {
    // Inline atoms belong to the footnote's placement guard, which degrades rather than refuses
    // (see titleAcceptsSlice). One question per guard.
    const withRef = paragraph.create(null, [text('中身'), footnoteReference.create()]);
    expect(titleAcceptsSlice(new Slice(Fragment.from(withRef), 1, 1))).toBe(true);
  });

  it('still refuses an inline atom carried across a paragraph boundary', () => {
    // Block structure is this guard's question wherever the atom sits, so deferring above does not
    // open a hole: the footnote guard would let this land and the fitter would split the accordion.
    const withRef = paragraph.create(null, [text('中身'), footnoteReference.create()]);
    expect(titleAcceptsSlice(new Slice(Fragment.fromArray([withRef, para('次')]), 1, 1))).toBe(
      false,
    );
  });

  it('refuses an empty slice rather than treating it as text', () => {
    expect(titleAcceptsSlice(Slice.empty)).toBe(false);
  });
});

describe('isInDetailsTitle', () => {
  const doc = docOf(
    details.create(null, [
      detailsSummary.create(null, text('タイトル')),
      detailsContent.create(null, para('本文')),
    ]),
    para('あと'),
  );

  it('is true inside the title', () => {
    // 2 = inside detailsSummary's text (details opens at 0, the summary at 1).
    expect(isInDetailsTitle(doc.resolve(2))).toBe(true);
  });

  it('is false inside the body', () => {
    // 9 = inside the body's first paragraph: the summary spans 1–7 (2 + its 4 characters), so
    // detailsContent opens at 7, its paragraph at 8, and that paragraph's text at 9. Asserted
    // rather than assumed, so this cannot pass by pointing somewhere else entirely.
    const $body = doc.resolve(9);
    expect($body.parent.type.name).toBe('paragraph');
    expect($body.node(-1).type.name).toBe('detailsContent');
    expect(isInDetailsTitle($body)).toBe(false);
  });

  it('is false outside the accordion', () => {
    expect(isInDetailsTitle(doc.resolve(doc.content.size - 1))).toBe(false);
  });
});
