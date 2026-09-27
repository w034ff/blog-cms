import { describe, expect, it } from 'vitest';
import { getMarkAttributes, isMarkActive } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { displayHref, editableLinkText, faviconSrc, linkAtCaret } from './link-at-caret';
import { docOf, marks, nodes, para, schema, text } from './test-schema';

// The link card's questions about the document (docs/link-requirements.md §5.5.12, §5.5.13) and
// about an href (§5.5.8, §5.5.10). Whether the card then shows, hides or keeps focus is wiring,
// and stays in e2e/editor-link-bubble.spec.ts.

const HREF = 'https://example.com';
const link = (value: string, ...extra: ReturnType<typeof marks.bold.create>[]): PMNode =>
  schema.text(value, [marks.link.create({ href: HREF }), ...extra]);

// 「前リンク後」: 前 = 1..2, リンク = 2..5, 後 = 5..6.
const LINK_LEFT_EDGE = 2;
const IN_LINK = 3;
const LINK_RIGHT_EDGE = 5;
const plainDoc = () =>
  docOf(nodes.paragraph.create(null, [text('前'), link('リンク'), text('後')]));

function stateAt(doc: PMNode, from: number, to = from): EditorState {
  const state = EditorState.create({ schema, doc });
  return state.apply(state.tr.setSelection(TextSelection.create(doc, from, to)));
}

describe('linkAtCaret', () => {
  it('fixture: the link spans 2..5', () => {
    expect(plainDoc().textBetween(LINK_LEFT_EDGE, LINK_RIGHT_EDGE)).toBe('リンク');
  });

  it('finds the link with the caret inside it', () => {
    expect(linkAtCaret(stateAt(plainDoc(), IN_LINK))).toEqual({ from: 2, to: 5, href: HREF });
  });

  it('finds it with the caret at its right edge', () => {
    expect(linkAtCaret(stateAt(plainDoc(), LINK_RIGHT_EDGE))).toEqual({
      from: 2,
      to: 5,
      href: HREF,
    });
  });

  it('does not find it at its left edge, as while the mark was inclusive', () => {
    expect(linkAtCaret(stateAt(plainDoc(), LINK_LEFT_EDGE))).toBeNull();
  });

  it('finds nothing outside a link', () => {
    expect(linkAtCaret(stateAt(plainDoc(), 6))).toBeNull();
  });

  it('answers a selection over the link, and nothing for one outside it', () => {
    expect(linkAtCaret(stateAt(plainDoc(), 2, 5))).toEqual({ from: 2, to: 5, href: HREF });
    expect(linkAtCaret(stateAt(plainDoc(), 5, 6))).toBeNull();
  });

  // 基準 7f: the reason `linkAtCaret` probes the text before the caret. Restored inclusiveness would
  // fail here.
  it('7f: at the right edge, isMarkActive and getMarkAttributes say there is no link', () => {
    const state = stateAt(plainDoc(), LINK_RIGHT_EDGE);
    expect(isMarkActive(state, 'link')).toBe(false);
    expect(getMarkAttributes(state, 'link')).toEqual({});
  });
});

describe('editableLinkText', () => {
  it('gives the text of a plain link', () => {
    expect(editableLinkText(plainDoc(), 2, 5)).toBe('リンク');
  });

  it('gives the text of a uniformly bold link, however many nodes it is in', () => {
    const doc = docOf(
      nodes.paragraph.create(null, [text('前'), link('強調', marks.bold.create()), text('後')]),
    );
    expect(editableLinkText(doc, 2, 4)).toBe('強調');
  });

  it('refuses a link whose marks change partway', () => {
    const doc = docOf(
      nodes.paragraph.create(null, [
        text('前'),
        link('強調', marks.bold.create()),
        link('リンク'),
        text('後'),
      ]),
    );
    expect(editableLinkText(doc, 2, 7)).toBeNull();
  });

  it('refuses a range holding an inline atom', () => {
    const doc = docOf(
      nodes.paragraph.create(null, [
        text('前'),
        link('リンク'),
        nodes.footnoteReference.create({ label: 'a' }, null, [marks.link.create({ href: HREF })]),
        text('後'),
      ]),
    );
    expect(editableLinkText(doc, 2, 6)).toBeNull();
  });

  it('walks into a footnote definition, where the reported link was', () => {
    const doc = docOf(
      para('本文'),
      nodes.footnoteSection.create(null, [
        nodes.footnoteDefinition.create({ label: 'a' }, [
          text('注'),
          link('打率.077', marks.bold.create()),
          text('後'),
        ]),
      ]),
    );
    const from = doc.content.size - '打率.077後'.length - 2;
    expect(doc.textBetween(from, from + '打率.077'.length)).toBe('打率.077');
    expect(editableLinkText(doc, from, from + '打率.077'.length)).toBe('打率.077');
  });
});

describe('displayHref', () => {
  it('drops https:// only', () => {
    expect(displayHref('https://example.com/a/b')).toBe('example.com/a/b');
  });

  // 基準 5p: the unencrypted scheme is the one that shows.
  it('5p: leaves http:// where it is', () => {
    expect(displayHref('http://example.com/a/b')).toBe('http://example.com/a/b');
  });
});

describe('faviconSrc', () => {
  const BASE = 'https://blog.example';

  it('asks the root of the link origin', () => {
    expect(faviconSrc('https://example.com/a/b?c', BASE)).toBe('https://example.com/favicon.ico');
  });

  it("resolves a relative link against this blog's origin", () => {
    expect(faviconSrc('/posts/foo', BASE)).toBe('https://blog.example/favicon.ico');
  });

  it('asks nothing for a scheme with no origin', () => {
    expect(faviconSrc('mailto:a@example.com', BASE)).toBeNull();
  });
});
