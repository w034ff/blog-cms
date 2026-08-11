import { describe, expect, it } from 'vitest';
import markdownit from 'markdown-it';
import { installFootnotes } from './footnote-extension';
import { keepFootnoteDefinitionsLiteral } from './footnote-literal-extension';

// The editor's own options, with both parse hooks installed in the order PostEditor registers them,
// so these tests see what the editor sees. Testing the guard alone would prove nothing now: what it
// does depends entirely on which lines markdown-it-footnote has already claimed.
function editorParser() {
  const md = markdownit({ html: true, linkify: false, breaks: false });
  installFootnotes(md);
  keepFootnoteDefinitionsLiteral(md);
  return md;
}

describe('keepFootnoteDefinitionsLiteral', () => {
  it('leaves an ordinary footnote to the footnote plugin', () => {
    // `footnote_def` is registered before `reference`, so a well-formed definition never reaches
    // the guard at all. This is the case the guard used to own and no longer does.
    const html = editorParser().render('本文[^1]\n\n[^1]: 注釈テキスト\n');

    expect(html).toContain('data-footnote-ref');
    expect(html).toContain('注釈テキスト');
  });

  it('is what stands between a spaced label and deletion', () => {
    // The reason this file still exists. `footnote_def` refuses a label containing a space and
    // hands the line back to the block rules; `reference` then takes it as a link reference
    // definition and the note's words end up as a URL.
    const withGuard = editorParser().render('本文[^a b]\n\n[^a b]: 注釈テキスト\n');
    expect(withGuard).toContain('注釈テキスト');
    expect(withGuard).not.toContain('<a href=');

    const unguarded = markdownit({ html: true, linkify: false, breaks: false });
    installFootnotes(unguarded);
    const html = unguarded.render('本文[^a b]\n\n[^a b]: 注釈テキスト\n');
    // Pinned as the failure the guard prevents: the text is gone and a link took its place.
    expect(html).not.toContain('>注釈テキスト<');
    expect(html).toContain('<a href=');
  });

  it('still resolves an ordinary link reference definition', () => {
    const html = editorParser().render('see [foo][]\n\n[foo]: https://example.com\n');

    expect(html).toContain('<a href="https://example.com">foo</a>');
  });

  it('survives the repeated setup tiptap-markdown runs on every parse', () => {
    const md = editorParser();
    keepFootnoteDefinitionsLiteral(md);
    keepFootnoteDefinitionsLiteral(md);

    expect(md.render('[^a b]: 注釈テキスト\n')).toContain('注釈テキスト');
    expect(md.render('[foo]: https://example.com\n\nsee [foo][]\n')).toContain(
      '<a href="https://example.com">foo</a>',
    );
  });

  it('keeps the escaped form the serializer writes back', () => {
    // A line the guard kept is plain text, so prosemirror-markdown escapes its brackets on the way
    // out. Re-parsing `\[^a b\]: …` must not re-open the reference path.
    const html = editorParser().render('本文\\[^a b\\]\n\n\\[^a b\\]: 注釈テキスト\n');

    expect(html).toContain('注釈テキスト');
    expect(html).not.toContain('<a href=');
  });
});
