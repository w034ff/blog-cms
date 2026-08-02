import { describe, expect, it } from 'vitest';
import markdownit from 'markdown-it';
import { keepFootnoteDefinitionsLiteral } from './footnote-literal-extension';

// The options PostEditor hands tiptap-markdown, so these tests parse the way the editor does.
function editorParser() {
  return markdownit({ html: true, linkify: false, breaks: false });
}

describe('keepFootnoteDefinitionsLiteral', () => {
  it('leaves a footnote definition in the document instead of consuming it', () => {
    const md = editorParser();
    keepFootnoteDefinitionsLiteral(md);

    const html = md.render('本文[^1]\n\n[^1]: 注釈テキスト\n');

    expect(html).toContain('<p>本文[^1]</p>');
    expect(html).toContain('<p>[^1]: 注釈テキスト</p>');
  });

  it('is what stands between the note text and deletion', () => {
    // Without the guard markdown-it reads the definition as a link reference: the line is
    // consumed whole and the body reference resolves against it, so the note's text ends up
    // as a URL and nothing else. Pinned as the reason the guard exists.
    const html = editorParser().render('本文[^1]\n\n[^1]: 注釈テキスト\n');

    expect(html).not.toContain('注釈テキスト');
    expect(html).toContain('<a href=');
  });

  it('covers the label shapes markdown-it would still accept as a reference', () => {
    // The predicate reads the first two characters of the line's content, so it has to hold for
    // the forms `reference` itself allows: up to three leading spaces (tShift skips them) and a
    // label that is not a bare number.
    const md = editorParser();
    keepFootnoteDefinitionsLiteral(md);

    expect(md.render('  [^1]: 注釈テキスト\n')).toContain('注釈テキスト');
    expect(md.render('[^a b]: 注釈テキスト\n')).toContain('注釈テキスト');
    expect(md.render('   [^note]: 注釈テキスト\n')).toContain('注釈テキスト');
  });

  it('still resolves an ordinary link reference definition', () => {
    const md = editorParser();
    keepFootnoteDefinitionsLiteral(md);

    const html = md.render('see [foo][]\n\n[foo]: https://example.com\n');

    expect(html).toContain('<a href="https://example.com">foo</a>');
  });

  it('survives the repeated setup tiptap-markdown runs on every parse', () => {
    const md = editorParser();
    keepFootnoteDefinitionsLiteral(md);
    keepFootnoteDefinitionsLiteral(md);
    keepFootnoteDefinitionsLiteral(md);

    expect(md.render('[^1]: 注釈テキスト\n')).toContain('<p>[^1]: 注釈テキスト</p>');
    expect(md.render('[foo]: https://example.com\n\nsee [foo][]\n')).toContain(
      '<a href="https://example.com">foo</a>',
    );
  });

  it('keeps the escaped form the serializer writes back', () => {
    // The round-trip's second half: prosemirror-markdown escapes `[`/`]` in plain text, so the
    // stored markdown is `\[^1\]: …`. Re-parsing that must not re-open the reference path.
    const md = editorParser();
    keepFootnoteDefinitionsLiteral(md);

    const html = md.render('本文\\[^1\\]\n\n\\[^1\\]: 注釈テキスト\n');

    expect(html).toContain('注釈テキスト');
    expect(html).not.toContain('<a href=');
  });
});
